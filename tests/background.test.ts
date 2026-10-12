import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { GRAPHQL_URL } from '@/lib/github';
import { tokenItem } from '@/lib/settings';
import type { LoadsMessage, WebSearchMessage, WebSearchReply } from '@/lib/types';
import background from '@/entrypoints/background';

const server = setupServer(
  http.post(GRAPHQL_URL, async ({ request }) => {
    const { variables } = (await request.json()) as { variables: Record<string, string> };
    const data: Record<string, unknown> = {};
    for (const k of Object.keys(variables).filter((k) => /^q\d+$/.test(k)))
      data[k.replace('q', 'p')] = { issueCount: 4, nodes: [] };
    if (variables.owner)
      data.pr = {
        pullRequest: {
          state: 'OPEN',
          isDraft: false,
          reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'alice' } }] },
        },
      };
    return HttpResponse.json({ data });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

describe('background', () => {
  let sent: LoadsMessage[];
  const searches: string[] = [];
  let webReply: WebSearchReply;

  beforeEach(() => {
    fakeBrowser.reset();
    sent = [];
    webReply = { ok: true, result: { total: 3, items: [] } };
    fakeBrowser.tabs.sendMessage = vi.fn(async (_tabId: number, msg: LoadsMessage | WebSearchMessage) => {
      if (msg.type === 'webSearch') {
        searches.push(msg.query);
        return webReply;
      }
      sent.push(msg);
    }) as never;
    background.main();
  });

  const ask = async (msg: unknown) => {
    await fakeBrowser.runtime.onMessage.trigger(msg, { tab: { id: 1 } } as never, () => {});
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
  };

  it('without a token, asks the tab to search github.com/pulls', async () => {
    searches.length = 0;
    await ask({ type: 'getLoads', logins: ['alice'], ctx: { owner: 'acme', repo: 'web', pr: 7 } });
    expect(searches[0]).toBe('is:pr is:open draft:false user-review-requested:alice user:acme sort:created-asc');
    expect(sent[0]?.loads.alice).toMatchObject({ count: 3, stale: false });
  });

  it('without a token, reports a signed-out tab as no-token', async () => {
    webReply = { ok: false, error: { kind: 'no-token' } };
    await ask({ type: 'getLoads', logins: ['alice'], ctx: { owner: 'acme', repo: 'web', pr: 7 } });
    expect(sent[0]).toEqual({ type: 'loads', loads: {}, error: { kind: 'no-token' } });
  });

  it('fetches counts and the PR snapshot and pushes them to the tab', async () => {
    await tokenItem.setValue('tok');
    await ask({ type: 'getLoads', logins: ['alice', 'bob'], ctx: { owner: 'acme', repo: 'web', pr: 7 } });
    await vi.waitFor(() => expect(sent.some((m) => m.loads.alice)).toBe(true));
    const msg = sent.find((m) => m.loads.alice)!;
    expect(msg.loads.alice).toMatchObject({ count: 4, stale: false });
    expect(msg.snapshot).toEqual({ countable: true, requested: ['alice'] });
  });
});
