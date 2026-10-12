import { BATCH_SIZE, chunk } from './query';
import { GitHubError } from './github';
import type { Load, LoadError } from './types';

export const TTL = 5 * 60_000;
export const MAX_IN_FLIGHT = 4;

export interface Cache {
  getLoads(keys: string[]): Promise<Record<string, Load | undefined>>;
  setLoads(entries: Record<string, Load>): Promise<void>;
  getBackoff(): Promise<number>;
  setBackoff(until: number): Promise<void>;
}

export interface Batch {
  loads: Map<string, Load>;
}

export interface LoadRequest {
  /** Cache namespace: scope qualifier + team toggle, so changing settings never shows wrong numbers. */
  prefix: string;
  logins: string[];
  force?: boolean;
  fetchBatch(logins: string[]): Promise<Batch>;
  onUpdate(update: { loads: Record<string, Load & { stale: boolean }>; error?: LoadError }): void;
}

export class Loader {
  private inFlight = new Map<string, Promise<Batch>>();
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(
    private cache: Cache,
    private now: () => number = Date.now,
  ) {}

  async load(req: LoadRequest): Promise<void> {
    const now = this.now();
    const key = (login: string) => `${req.prefix}|${login.toLowerCase()}`;
    const cached = await this.cache.getLoads(req.logins.map(key));

    const isFresh = (t: number | undefined) => t !== undefined && now - t < TTL;
    const initial: Record<string, Load & { stale: boolean }> = {};
    for (const login of req.logins) {
      const c = cached[key(login)];
      if (c) initial[login] = { ...c, stale: !isFresh(c.fetchedAt) };
    }
    if (Object.keys(initial).length) req.onUpdate({ loads: initial });

    const backoff = await this.cache.getBackoff();
    if (backoff > now) {
      req.onUpdate({ loads: {}, error: { kind: 'rate-limited', until: backoff } });
      return;
    }

    const need = req.logins.filter((l) => req.force || !isFresh(cached[key(l)]?.fetchedAt));

    const waits: Promise<unknown>[] = [];
    const fresh: string[] = [];
    for (const login of need) {
      const pending = this.inFlight.get(key(login));
      if (pending && !req.force) {
        waits.push(
          pending.then(
            (b) => b.loads.has(login) && req.onUpdate({ loads: { [login]: { ...b.loads.get(login)!, stale: false } } }),
            () => {},
          ),
        );
      } else fresh.push(login);
    }

    chunk(fresh, BATCH_SIZE).forEach((logins) => {
      const p = this.limit(() => req.fetchBatch(logins));
      logins.forEach((l) => this.inFlight.set(key(l), p));
      waits.push(
        p
          .then(async (b) => {
            const entries: Record<string, Load> = {};
            const loads: Record<string, Load & { stale: boolean }> = {};
            b.loads.forEach((load, login) => {
              entries[key(login)] = load;
              loads[login] = { ...load, stale: false };
            });
            await this.cache.setLoads(entries);
            req.onUpdate({ loads });
          })
          .catch(async (e) => {
            const error: LoadError = e instanceof GitHubError ? e.detail : { kind: 'network', message: String(e) };
            if (error.kind === 'rate-limited') await this.cache.setBackoff(error.until);
            req.onUpdate({ loads: {}, error });
          })
          .finally(() => logins.forEach((l) => this.inFlight.get(key(l)) === p && this.inFlight.delete(key(l)))),
      );
    });

    await Promise.all(waits);
  }

  private limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            this.queue.shift()?.();
          });
      };
      if (this.running < MAX_IN_FLIGHT) run();
      else this.queue.push(run);
    });
  }
}
