import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GitHubError, graphql, GRAPHQL_URL } from './github';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const respond = (body: JsonBodyType, init?: ResponseInit) =>
  server.use(http.post(GRAPHQL_URL, () => HttpResponse.json(body, init)));

async function failure(): Promise<GitHubError['detail']> {
  try {
    await graphql('t', 'query { viewer { login } }', {}, 1_000_000);
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError);
    return (e as GitHubError).detail;
  }
  throw new Error('expected a failure');
}

describe('graphql', () => {
  it('sends the token and variables, and returns data', async () => {
    let seen: { auth: string | null; body: unknown } | undefined;
    server.use(
      http.post(GRAPHQL_URL, async ({ request }) => {
        seen = { auth: request.headers.get('authorization'), body: await request.json() };
        return HttpResponse.json({ data: { viewer: { login: 'alice' } } });
      }),
    );
    await expect(graphql('tok', 'query($a: String!) { x }', { a: 'b' })).resolves.toEqual({
      viewer: { login: 'alice' },
    });
    expect(seen).toEqual({ auth: 'Bearer tok', body: { query: 'query($a: String!) { x }', variables: { a: 'b' } } });
  });

  it('returns partial data when only some fields errored', async () => {
    respond({ data: { p0: { issueCount: 1 }, p1: null }, errors: [{ type: 'NOT_FOUND', message: 'nope' }] });
    await expect(graphql('t', 'q')).resolves.toEqual({ p0: { issueCount: 1 }, p1: null });
  });

  it('maps 401 to unauthorized', async () => {
    respond({ message: 'Bad credentials' }, { status: 401 });
    expect(await failure()).toEqual({ kind: 'unauthorized' });
  });

  it('maps an SSO 403 with its authorisation URL', async () => {
    respond(
      { message: 'Resource protected by organization SAML enforcement.' },
      {
        status: 403,
        headers: { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso?authorization_request=abc' },
      },
    );
    expect(await failure()).toEqual({ kind: 'sso', url: 'https://github.com/orgs/acme/sso?authorization_request=abc' });
  });

  it('maps an SSO error inside a 200 response when no data came back', async () => {
    respond(
      {
        data: { p0: null },
        errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' }],
      },
      { headers: { 'X-GitHub-SSO': 'partial-results; organizations=123' } },
    );
    expect((await failure()).kind).toBe('sso');
  });

  it('maps secondary rate limits using retry-after', async () => {
    respond({ message: 'You have exceeded a secondary rate limit' }, { status: 403, headers: { 'retry-after': '60' } });
    expect(await failure()).toEqual({ kind: 'rate-limited', until: 1_060_000 });
  });

  it('maps primary rate limits using the reset header', async () => {
    respond({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' } });
    expect(await failure()).toEqual({ kind: 'rate-limited', until: 2_000_000 });
  });

  it('maps a RATE_LIMITED GraphQL error', async () => {
    respond({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] });
    expect((await failure()).kind).toBe('rate-limited');
  });

  it('maps a fetch failure to network', async () => {
    server.use(http.post(GRAPHQL_URL, () => HttpResponse.error()));
    expect((await failure()).kind).toBe('network');
  });

  it('maps server errors to network', async () => {
    respond({}, { status: 502 });
    expect(await failure()).toEqual({ kind: 'network', message: 'HTTP 502' });
  });
});
