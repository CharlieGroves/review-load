import type { LoadError } from './types';

export const GRAPHQL_URL = 'https://api.github.com/graphql';

export class GitHubError extends Error {
  constructor(readonly detail: LoadError) {
    super(detail.kind);
  }
}

interface GraphQLError {
  type?: string;
  message?: string;
}

function ssoUrl(header: string | null): string | undefined {
  return header?.match(/url=([^;\s]+)/)?.[1];
}

function rateLimitUntil(res: Response, now: number): number {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (retryAfter > 0) return now + retryAfter * 1000;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (reset > 0) return reset * 1000;
  return now + 60_000;
}

/**
 * POST a GraphQL document. Returns `data` (which may be partial when some
 * fields errored) or throws a GitHubError the UI knows how to explain.
 */
export async function graphql<T = Record<string, unknown>>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  now = Date.now(),
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new GitHubError({ kind: 'network', message: String(e) });
  }

  const sso = res.headers.get('x-github-sso');
  if (res.status === 401) throw new GitHubError({ kind: 'unauthorized' });
  if (res.status === 403 || res.status === 429) {
    if (sso?.startsWith('required')) throw new GitHubError({ kind: 'sso', url: ssoUrl(sso) });
    if (res.status === 429 || res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0')
      throw new GitHubError({ kind: 'rate-limited', until: rateLimitUntil(res, now) });
    throw new GitHubError({ kind: 'unauthorized' });
  }
  if (!res.ok) throw new GitHubError({ kind: 'network', message: `HTTP ${res.status}` });

  const body = (await res.json()) as { data?: T | null; errors?: GraphQLError[] };
  const errors = body.errors ?? [];
  if (errors.some((e) => e.type === 'RATE_LIMITED' || /rate limit/i.test(e.message ?? '')))
    throw new GitHubError({ kind: 'rate-limited', until: rateLimitUntil(res, now) });
  if (errors.some((e) => /SAML|single sign-on/i.test(e.message ?? '')) && !hasAnyData(body.data))
    throw new GitHubError({ kind: 'sso', url: ssoUrl(sso) });
  if (!body.data) throw new GitHubError({ kind: 'network', message: errors[0]?.message ?? 'Empty response' });
  return body.data;
}

function hasAnyData(data: unknown): boolean {
  return !!data && typeof data === 'object' && Object.values(data).some((v) => v != null);
}
