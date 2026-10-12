import { BATCH_SIZE, chunk } from './query';
import { toLoadError } from './github';
import type { Load, LoadError, PrSnapshot } from './types';

export const TTL = 5 * 60_000;
export const MAX_IN_FLIGHT = 4;

export interface Cache {
  getLoads(keys: string[]): Promise<Record<string, Load | undefined>>;
  setLoads(entries: Record<string, Load>): Promise<void>;
  getSnapshot(key: string): Promise<(PrSnapshot & { fetchedAt: number }) | undefined>;
  setSnapshot(key: string, s: PrSnapshot & { fetchedAt: number }): Promise<void>;
  getBackoff(): Promise<number>;
  setBackoff(until: number): Promise<void>;
}

export interface Batch {
  loads: Map<string, Load>;
  snapshot?: PrSnapshot;
  /** Set when part of the batch failed; `loads` holds the people that succeeded. */
  error?: LoadError;
}

export interface LoadRequest {
  /** Cache namespace: scope qualifier + team toggle, so changing settings never shows wrong numbers. */
  prefix: string;
  logins: string[];
  /** Cache key for the current PR snapshot, if on a PR page. */
  snapshotKey?: string;
  force?: boolean;
  fetchBatch(logins: string[], withSnapshot: boolean): Promise<Batch>;
  onUpdate(update: {
    loads: Record<string, Load & { stale: boolean }>;
    snapshot?: PrSnapshot;
    error?: LoadError;
  }): void;
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
    const snap = req.snapshotKey ? await this.cache.getSnapshot(req.snapshotKey) : undefined;

    const isFresh = (t: number | undefined) => t !== undefined && now - t < TTL;
    const initial: Record<string, Load & { stale: boolean }> = {};
    for (const login of req.logins) {
      const c = cached[key(login)];
      if (c) initial[login] = { ...c, stale: !isFresh(c.fetchedAt) };
    }
    if (Object.keys(initial).length || snap) req.onUpdate({ loads: initial, snapshot: snap && strip(snap) });

    const backoff = await this.cache.getBackoff();
    if (backoff > now) {
      req.onUpdate({ loads: {}, error: { kind: 'rate-limited', until: backoff } });
      return;
    }

    const need = req.logins.filter((l) => req.force || !isFresh(cached[key(l)]?.fetchedAt));
    const needSnapshot = !!req.snapshotKey && (req.force || !isFresh(snap?.fetchedAt));

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

    const batches = chunk(fresh, BATCH_SIZE);
    if (needSnapshot && batches.length === 0) batches.push([]);

    batches.forEach((logins, i) => {
      const withSnapshot = needSnapshot && i === 0;
      const p = this.limit(() => req.fetchBatch(logins, withSnapshot));
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
            if (b.snapshot && req.snapshotKey)
              await this.cache.setSnapshot(req.snapshotKey, { ...b.snapshot, fetchedAt: this.now() });
            if (b.error?.kind === 'rate-limited') await this.cache.setBackoff(b.error.until);
            req.onUpdate({ loads, snapshot: b.snapshot, ...(b.error && { error: b.error }) });
          })
          .catch(async (e) => {
            const error = toLoadError(e);
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

function strip({ countable, requested }: PrSnapshot & { fetchedAt: number }): PrSnapshot {
  return { countable, requested };
}
