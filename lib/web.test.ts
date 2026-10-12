import { describe, expect, it, vi } from 'vitest';
import { parseWebSearch, webLoad, webSearchUrl, type WebSearchResult } from './web';

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
