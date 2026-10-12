import { GitHubError, rateLimitUntil } from './github';
import { searchString } from './query';
import type { Load, PrSummary } from './types';

/**
 * Token-less fallback: GitHub's own pull request dashboard (github.com/pulls)
 * answers with JSON when asked like its React front end does. It runs on the
 * signed-in browser session, so it must be fetched from the github.com content
 * script, where the session cookies are first-party.
 */
export const PULLS_URL = 'https://github.com/pulls';

/** Headers GitHub's front end sends; without them the endpoint returns HTML. */
const HEADERS = {
  accept: 'application/json',
  'github-verified-fetch': 'true',
  'x-requested-with': 'XMLHttpRequest',
};

/** One page of the dashboard, reduced to what ReviewLoad needs. */
export interface WebSearchResult {
  total: number;
  items: Array<PrSummary & { number: number }>;
}

interface DashboardItem {
  title?: string;
  permalink?: string;
  repoNameWithOwner?: string;
  createdAt?: string;
  number?: number;
}

interface DashboardBlock {
  results?: DashboardItem[];
  pageInfo?: { totalCount?: number };
}

export function webSearchUrl(query: string): string {
  return `${PULLS_URL}?${new URLSearchParams({ q: query, page: '1' })}`;
}

/** The payload has a single block under an opaque route key. */
export function parseWebSearch(body: unknown): WebSearchResult {
  const payload = (body as { payload?: Record<string, DashboardBlock | null> } | null)?.payload;
  const block = payload && Object.values(payload).find((b) => b && Array.isArray(b.results));
  if (!block) throw new GitHubError({ kind: 'network', message: 'Unexpected response from github.com/pulls' });
  const items = block
    .results!.filter((r) => r?.permalink)
    .map((r) => ({
      title: r.title ?? '',
      url: r.permalink!,
      repo: r.repoNameWithOwner ?? '',
      createdAt: r.createdAt ?? '',
      number: r.number ?? 0,
    }));
  return { total: block.pageInfo?.totalCount ?? items.length, items };
}

/** Fetch one dashboard search. Call from a github.com page so the session cookies go along. */
export async function webSearch(query: string, now = Date.now()): Promise<WebSearchResult> {
  // Firefox content scripts need the page's own fetch, called on the page, to send first-party cookies.
  const page = (globalThis as { content?: { fetch: typeof fetch } }).content;
  const pageFetch: typeof fetch = page ? page.fetch.bind(page) : fetch;
  let res: Response;
  try {
    // Manual redirects: when signed out, stop at the redirect instead of downloading the login page.
    res = await pageFetch(webSearchUrl(query), { headers: HEADERS, credentials: 'include', redirect: 'manual' });
  } catch (e) {
    throw new GitHubError({ kind: 'network', message: String(e) });
  }
  const rateLimited =
    res.status === 429 ||
    (res.status === 403 && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0'));
  if (rateLimited) throw new GitHubError({ kind: 'rate-limited', until: rateLimitUntil(res, now) });
  // Signed out: GitHub redirects to the login page, or answers 401/404.
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 404)
    throw new GitHubError({ kind: 'no-token' });
  if (!res.ok) throw new GitHubError({ kind: 'network', message: `HTTP ${res.status}` });
  // A 200 that isn't JSON is a page rendered for a signed-out visitor.
  if (!/json/.test(res.headers.get('content-type') ?? '')) throw new GitHubError({ kind: 'no-token' });
  return parseWebSearch(await res.json());
}

/**
 * One person's load from the dashboard. The current PR is subtracted here,
 * because there is no batch-wide snapshot of who is requested on it.
 */
export async function webLoad(
  search: (query: string) => Promise<WebSearchResult>,
  login: string,
  qualifier: string,
  includeTeams: boolean,
  pr: { owner: string; repo: string; number: number } | undefined,
  now: number,
): Promise<Load> {
  const query = searchString(login, qualifier, includeTeams);
  const { total, items } = await search(query);
  let here = false;
  if (pr) {
    const isHere = (i: { repo: string; number: number }) =>
      i.number === pr.number && i.repo.toLowerCase() === `${pr.owner}/${pr.repo}`.toLowerCase();
    here = items.some(isHere);
    // Not on the first page: ask about this one PR directly (open, non-draft and requested).
    if (!here && total > items.length) {
      const one = await search(`${query.replace(/ sort:\S+$/, '')} repo:${pr.owner}/${pr.repo} ${pr.number}`);
      here = one.items.some(isHere);
    }
  }
  return {
    count: Math.max(0, total - (here ? 1 : 0)),
    prs: items.slice(0, 5).map(({ number: _n, ...p }) => p),
    fetchedAt: now,
  };
}
