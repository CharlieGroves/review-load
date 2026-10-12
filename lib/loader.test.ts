import { describe, expect, it, vi } from 'vitest';
import { GitHubError } from './github';
import { Loader, MAX_IN_FLIGHT, TTL, type Batch, type Cache, type LoadRequest } from './loader';
import type { Load } from './types';

function memoryCache(): Cache & { loads: Map<string, Load>; backoff: number } {
  const loads = new Map<string, Load>();
  const c = {
    loads,
    backoff: 0,
    async getLoads(keys: string[]) {
      return Object.fromEntries(keys.map((k) => [k, loads.get(k)]));
    },
    async setLoads(e: Record<string, Load>) {
      for (const [k, v] of Object.entries(e)) loads.set(k, v);
    },
    async getBackoff() {
      return c.backoff;
    },
    async setBackoff(u: number) {
      c.backoff = u;
    },
  };
  return c;
}

const load = (count: number, fetchedAt: number): Load => ({ count, prs: [], fetchedAt });

function fetcher(now: number) {
  return vi.fn(async (logins: string[]): Promise<Batch> => ({
    loads: new Map(logins.map((l) => [l, load(l.length, now)])),
  }));
}

function request(over: Partial<LoadRequest> & Pick<LoadRequest, 'fetchBatch'>) {
  const updates: Parameters<LoadRequest['onUpdate']>[0][] = [];
  const req: LoadRequest = { prefix: 'user:acme|direct', logins: [], onUpdate: (u) => updates.push(u), ...over };
  return { req, updates };
}

describe('Loader', () => {
  it('fetches missing logins and caches them under the scope prefix', async () => {
    const cache = memoryCache();
    const fetchBatch = fetcher(100);
    const { req, updates } = request({ logins: ['alice', 'Bob'], fetchBatch });
    await new Loader(cache, () => 100).load(req);
    expect(fetchBatch).toHaveBeenCalledWith(['alice', 'Bob']);
    expect(cache.loads.get('user:acme|direct|bob')).toEqual(load(3, 100));
    expect(updates.at(-1)?.loads.Bob).toEqual({ ...load(3, 100), stale: false });
  });

  it('answers from a fresh cache without fetching', async () => {
    const cache = memoryCache();
    cache.loads.set('user:acme|direct|alice', load(4, 0));
    const fetchBatch = fetcher(10);
    const { req, updates } = request({ logins: ['alice'], fetchBatch });
    await new Loader(cache, () => TTL - 1).load(req);
    expect(fetchBatch).not.toHaveBeenCalled();
    expect(updates).toEqual([{ loads: { alice: { ...load(4, 0), stale: false } } }]);
  });

  it('shows stale numbers first, then refreshes them', async () => {
    const cache = memoryCache();
    cache.loads.set('user:acme|direct|alice', load(4, 0));
    const fetchBatch = fetcher(TTL + 1);
    const { req, updates } = request({ logins: ['alice'], fetchBatch });
    await new Loader(cache, () => TTL + 1).load(req);
    expect(updates[0]!.loads.alice!.stale).toBe(true);
    expect(updates.at(-1)!.loads.alice).toEqual({ ...load(5, TTL + 1), stale: false });
  });

  it('refetches fresh entries when forced', async () => {
    const cache = memoryCache();
    cache.loads.set('user:acme|direct|alice', load(4, 0));
    const fetchBatch = fetcher(1);
    await new Loader(cache, () => 1).load(request({ logins: ['alice'], fetchBatch, force: true }).req);
    expect(fetchBatch).toHaveBeenCalledOnce();
  });

  it('splits into batches of 5 and runs at most 4 at once', async () => {
    let running = 0;
    let peak = 0;
    const fetchBatch = vi.fn(async (logins: string[]): Promise<Batch> => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { loads: new Map(logins.map((l) => [l, load(1, 0)])) };
    });
    const logins = Array.from({ length: 27 }, (_, i) => `user${i}`);
    await new Loader(memoryCache(), () => 0).load(request({ logins, fetchBatch }).req);
    expect(fetchBatch.mock.calls.map((c) => c[0].length)).toEqual([5, 5, 5, 5, 5, 2]);
    expect(peak).toBe(MAX_IN_FLIGHT);
  });

  it('shares an in-flight fetch between overlapping requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchBatch = vi.fn(async (logins: string[]): Promise<Batch> => {
      await gate;
      return { loads: new Map(logins.map((l) => [l, load(2, 0)])) };
    });
    const loader = new Loader(memoryCache(), () => 0);
    const first = loader.load(request({ logins: ['alice'], fetchBatch }).req);
    await new Promise((r) => setTimeout(r, 0));
    const second = request({ logins: ['alice', 'bob'], fetchBatch });
    const done = loader.load(second.req);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, done]);
    expect(fetchBatch.mock.calls.map((c) => c[0])).toEqual([['alice'], ['bob']]);
    expect(Object.assign({}, ...second.updates.map((u) => u.loads))).toMatchObject({
      alice: { count: 2 },
      bob: { count: 2 },
    });
  });

  it('records a rate limit and stops fetching until it passes', async () => {
    const cache = memoryCache();
    cache.loads.set('user:acme|direct|alice', load(1, 0));
    const limited = vi.fn(async (): Promise<Batch> => {
      throw new GitHubError({ kind: 'rate-limited', until: TTL + 60_000 });
    });
    const loader = new Loader(cache, () => TTL + 1);
    const first = request({ logins: ['alice'], fetchBatch: limited });
    await loader.load(first.req);
    expect(first.updates.at(-1)?.error).toEqual({ kind: 'rate-limited', until: TTL + 60_000 });
    expect(cache.backoff).toBe(TTL + 60_000);

    const fetchBatch = fetcher(0);
    const second = request({ logins: ['alice'], fetchBatch });
    await loader.load(second.req);
    expect(fetchBatch).not.toHaveBeenCalled();
    expect(second.updates[0]!.loads.alice!.stale).toBe(true);
    expect(second.updates[1]!.error?.kind).toBe('rate-limited');
  });

  it('reports other errors without caching anything', async () => {
    const cache = memoryCache();
    const { req, updates } = request({
      logins: ['alice'],
      fetchBatch: async () => {
        throw new GitHubError({ kind: 'unauthorized' });
      },
    });
    await new Loader(cache, () => 0).load(req);
    expect(updates).toEqual([{ loads: {}, error: { kind: 'unauthorized' } }]);
    expect(cache.loads.size).toBe(0);
    expect(cache.backoff).toBe(0);
  });
});
