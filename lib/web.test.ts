import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWebSearch, webLoad, webSearch, webSearchUrl, type WebSearchResult } from './web';

const item = (repo: string, number: number) => ({
  title: `PR ${number}`,
  permalink: `https://github.com/${repo}/pull/${number}`,
  repoNameWithOwner: repo,
  createdAt: '2026-01-01T00:00:00Z',
  number,
});

describe('parseWebSearch', () => {
  it('reads the single block under the opaque route key', () => {
    const body = {
      payload: { pullsDashboardSurfaceContentRoute: { results: [item('acme/web', 1)], pageInfo: { totalCount: 12 } } },
    };
    expect(parseWebSearch(body)).toEqual({
      total: 12,
      items: [
        {
          title: 'PR 1',
          url: 'https://github.com/acme/web/pull/1',
          repo: 'acme/web',
          createdAt: '2026-01-01T00:00:00Z',
          number: 1,
        },
      ],
    });
  });

  it('treats an empty search as zero', () => {
    expect(parseWebSearch({ payload: { x: { results: [], pageInfo: { totalCount: 0 }, error: 'no user' } } })).toEqual({
      total: 0,
      items: [],
    });
  });

  it('rejects an unrecognised body', () => {
    expect(() => parseWebSearch({ payload: {} })).toThrow();
  });
});

describe('webSearchUrl', () => {
  it('encodes the query', () => {
    expect(webSearchUrl('is:pr a:b')).toBe('https://github.com/pulls?q=is%3Apr+a%3Ab&page=1');
  });
});

describe('webSearch', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (res: Response) => {
    const f = vi.fn(async () => res);
    vi.stubGlobal('fetch', f);
    return f;
  };
  const json = { 'content-type': 'application/json' };
  const kind = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: { detail: unknown }) => e.detail,
    );

  it('asks for JSON without following redirects', async () => {
    const f = respond(new Response(JSON.stringify({ payload: { x: { results: [] } } }), { headers: json }));
    await expect(webSearch('is:pr')).resolves.toEqual({ total: 0, items: [] });
    expect(f).toHaveBeenCalledWith(
      webSearchUrl('is:pr'),
      expect.objectContaining({ credentials: 'include', redirect: 'manual' }),
    );
  });

  it('treats a 429 as a rate limit, timed by retry-after', async () => {
    respond(new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    expect(await kind(webSearch('q', 1_000))).toEqual({ kind: 'rate-limited', until: 31_000 });
  });

  it('treats a 403 with rate-limit headers as a rate limit', async () => {
    respond(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '90' } }));
    expect(await kind(webSearch('q', 1_000))).toEqual({ kind: 'rate-limited', until: 90_000 });
  });

  it('treats any other 403 as an ordinary error', async () => {
    respond(new Response('', { status: 403 }));
    expect(await kind(webSearch('q'))).toEqual({ kind: 'network', message: 'HTTP 403' });
  });

  it('treats a redirect as signed out', async () => {
    const redirected = new Response(null, { status: 200 });
    Object.defineProperty(redirected, 'type', { value: 'opaqueredirect' });
    respond(redirected);
    expect(await kind(webSearch('q'))).toEqual({ kind: 'no-token' });
  });

  it('treats a 200 HTML page as signed out', async () => {
    respond(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await kind(webSearch('q'))).toEqual({ kind: 'no-token' });
  });

  it('reports a server error as a network error, not as signed out', async () => {
    respond(new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(await kind(webSearch('q'))).toEqual({ kind: 'network', message: 'HTTP 502' });
  });
});

describe('webLoad', () => {
  const pr = { owner: 'acme', repo: 'web', number: 7 };

  it('subtracts the current PR when it is on the first page', async () => {
    const search = vi.fn(async (): Promise<WebSearchResult> => ({
      total: 2,
      items: [{ ...toSummary(item('acme/web', 7)) }],
    }));
    const load = await webLoad(search, 'alice', 'user:acme', false, pr, 1);
    expect(load.count).toBe(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('asks about the current PR directly when it may be on a later page', async () => {
    const search = vi.fn(async (q: string): Promise<WebSearchResult> =>
      q.endsWith(' 7')
        ? { total: 1, items: [toSummary(item('acme/web', 7))] }
        : { total: 30, items: Array.from({ length: 10 }, (_, i) => toSummary(item('acme/api', i))) },
    );
    const load = await webLoad(search, 'alice', 'user:acme', false, pr, 1);
    expect(search).toHaveBeenLastCalledWith(
      'is:pr is:open draft:false user-review-requested:alice user:acme repo:acme/web 7',
    );
    expect(load.count).toBe(29);
    expect(load.prs).toHaveLength(5);
  });

  it('does not subtract on the new-PR page', async () => {
    const search = vi.fn(async (): Promise<WebSearchResult> => ({ total: 4, items: [] }));
    expect((await webLoad(search, 'alice', 'user:acme', true, undefined, 1)).count).toBe(4);
  });
});

function toSummary(i: ReturnType<typeof item>) {
  return { title: i.title, url: i.permalink, repo: i.repoNameWithOwner, createdAt: i.createdAt, number: i.number };
}
