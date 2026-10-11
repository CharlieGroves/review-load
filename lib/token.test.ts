import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { GRAPHQL_URL } from './github';
import { tokenItem } from './settings';
import { cachedStatus, checkToken, removeToken, saveToken, STATUS_MAX_AGE, tokenStatusItem } from './token';

let reply: () => Response;
const server = setupServer(http.post(GRAPHQL_URL, () => reply()));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  fakeBrowser.reset();
  reply = () =>
    HttpResponse.json({
      data: { viewer: { login: 'alice', organizations: { nodes: [{ login: 'acme' }, null] } } },
    });
});

describe('checkToken', () => {
  it('returns who the token belongs to and remembers it', async () => {
    const result = await checkToken('github_pat_abcd1234', 1000);
    const status = { login: 'alice', orgs: ['acme'], checkedAt: 1000, tail: '1234' };
    expect(result).toEqual({ ok: true, status });
    expect(await tokenStatusItem.getValue()).toEqual(status);
  });

  it('reports failures without caching anything', async () => {
    reply = () => HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
    expect(await checkToken('t')).toEqual({ ok: false, error: { kind: 'unauthorized' } });
    expect(await tokenStatusItem.getValue()).toBeNull();
  });
});

describe('cachedStatus', () => {
  it('trusts a recent check of the same token', async () => {
    await checkToken('github_pat_abcd1234', 1000);
    expect((await cachedStatus('github_pat_abcd1234', 1000 + STATUS_MAX_AGE))?.login).toBe('alice');
  });

  it('ignores a check that is too old or for a different token', async () => {
    await checkToken('github_pat_abcd1234', 1000);
    expect(await cachedStatus('github_pat_abcd1234', 1001 + STATUS_MAX_AGE)).toBeUndefined();
    expect(await cachedStatus('github_pat_wxyz9999', 1000)).toBeUndefined();
  });
});

describe('saving and removing', () => {
  it('saves the token, clears cached counts, and checks it', async () => {
    await fakeBrowser.storage.session.set({ 'load:x': 1 });
    const result = await saveToken('github_pat_new00000');
    expect(result.ok).toBe(true);
    expect(await tokenItem.getValue()).toBe('github_pat_new00000');
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('removes the token and what was known about it', async () => {
    await saveToken('github_pat_new00000');
    await removeToken();
    expect(await tokenItem.getValue()).toBeNull();
    expect(await tokenStatusItem.getValue()).toBeNull();
  });
});
