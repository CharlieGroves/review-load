import type { Load, PageContext, PrSnapshot, PrSummary } from './types';

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export const isLogin = (s: string) => LOGIN.test(s);

/** GraphQL resolves aliased searches roughly serially, so keep batches small and run them in parallel. */
export const BATCH_SIZE = 5;

export function scopeQualifier(ctx: PageContext, scope: 'owner' | 'repo'): string {
  if (!isLogin(ctx.owner) || !REPO.test(ctx.repo)) throw new Error('Invalid repository');
  return scope === 'repo' ? `repo:${ctx.owner}/${ctx.repo}` : `user:${ctx.owner}`;
}

export function searchString(login: string, qualifier: string, includeTeams: boolean): string {
  const who = includeTeams ? 'review-requested' : 'user-review-requested';
  return `is:pr is:open draft:false ${who}:${login} ${qualifier} sort:created-asc`;
}

/**
 * One document with an aliased search per login, plus the current PR's direct
 * requests when `pr` is set. Search strings travel as variables, never inlined.
 */
export function buildQuery(
  logins: string[],
  qualifier: string,
  includeTeams: boolean,
  pr?: { owner: string; repo: string; number: number },
): { query: string; variables: Record<string, string | number> } {
  const variables: Record<string, string | number> = {};
  const defs: string[] = [];
  const fields: string[] = [];
  logins.forEach((login, i) => {
    if (!isLogin(login)) throw new Error(`Invalid login: ${login}`);
    variables[`q${i}`] = searchString(login, qualifier, includeTeams);
    defs.push(`$q${i}: String!`);
    fields.push(
      `p${i}: search(type: ISSUE, first: 5, query: $q${i}) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } } }`,
    );
  });
  if (pr) {
    Object.assign(variables, { owner: pr.owner, repo: pr.repo, number: pr.number });
    defs.push('$owner: String!', '$repo: String!', '$number: Int!');
    fields.push(
      'pr: repository(owner: $owner, name: $repo) { pullRequest(number: $number) { state isDraft reviewRequests(first: 100) { nodes { requestedReviewer { __typename ... on User { login } } } } } }',
    );
  }
  const head = defs.length ? `query(${defs.join(', ')})` : 'query';
  return { query: `${head} { ${fields.join(' ')} }`, variables };
}

interface SearchResult {
  issueCount: number;
  nodes: Array<{
    title?: string;
    url?: string;
    createdAt?: string;
    repository?: { nameWithOwner: string };
  } | null>;
}

interface PrResult {
  pullRequest: {
    state: string;
    isDraft: boolean;
    reviewRequests: { nodes: Array<{ requestedReviewer: { __typename: string; login?: string } | null }> };
  } | null;
}

export function parseResponse(
  logins: string[],
  data: Record<string, unknown> | null | undefined,
  now: number,
): { loads: Map<string, Load>; snapshot?: PrSnapshot } {
  const loads = new Map<string, Load>();
  logins.forEach((login, i) => {
    const r = data?.[`p${i}`] as SearchResult | null | undefined;
    if (!r) return;
    const prs: PrSummary[] = r.nodes
      .filter((n): n is NonNullable<typeof n> => !!n?.url)
      .map((n) => ({
        title: n.title ?? '',
        url: n.url!,
        repo: n.repository?.nameWithOwner ?? '',
        createdAt: n.createdAt ?? '',
      }));
    loads.set(login, { count: r.issueCount, prs, fetchedAt: now });
  });
  const pr = (data?.pr as PrResult | null | undefined)?.pullRequest;
  const snapshot = pr
    ? {
        countable: pr.state === 'OPEN' && !pr.isDraft,
        requested: pr.reviewRequests.nodes
          .map((n) => n.requestedReviewer)
          .filter((r) => r?.__typename === 'User' && r.login)
          .map((r) => r!.login!),
      }
    : undefined;
  return { loads, snapshot };
}

/** The count to display: the current PR is excluded, since you're looking at it. */
export function displayCount(login: string, load: Pick<Load, 'count'>, snapshot: PrSnapshot | undefined): number {
  const here = snapshot?.countable && snapshot.requested.some((l) => l.toLowerCase() === login.toLowerCase());
  return Math.max(0, load.count - (here ? 1 : 0));
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
