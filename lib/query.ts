import type { Load, PageContext, PrSummary } from './types';

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

/** One document with an aliased search per login. Search strings travel as variables, never inlined. */
export function buildQuery(
  logins: string[],
  qualifier: string,
  includeTeams: boolean,
): { query: string; variables: Record<string, string> } {
  const variables: Record<string, string> = {};
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
  return { query: `query(${defs.join(', ')}) { ${fields.join(' ')} }`, variables };
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

export function parseResponse(
  logins: string[],
  data: Record<string, unknown> | null | undefined,
  now: number,
): { loads: Map<string, Load> } {
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
  return { loads };
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
