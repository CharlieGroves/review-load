import { storage } from 'wxt/utils/storage';
import { sessionCache } from '@/lib/cache';
import { GitHubError, graphql, toLoadError } from '@/lib/github';
import { Loader } from '@/lib/loader';
import { buildQuery, isLogin, parseResponse, scopeQualifier } from '@/lib/query';
import { getSettings, tokenItem } from '@/lib/settings';
import type { Load, LoadError, LoadsMessage, PrSnapshot, Request, WebSearchMessage, WebSearchReply } from '@/lib/types';
import { webLoad, type WebSearchResult } from '@/lib/web';

/** After the fallback finds the user signed out, skip it for this long instead of asking again for everyone. */
const SIGNED_OUT_MS = 60_000;

/** Session storage, so it's cleared with the counts when a token is saved or removed. */
const webSignedOutUntil = storage.defineItem<number>('session:webSignedOutUntil', { fallback: 0 });

/**
 * Fallback counts already leave out the current PR, so the page must not subtract it again
 * using a snapshot left over from when a token was saved.
 */
const NO_SNAPSHOT: PrSnapshot = { countable: false, requested: [] };

export default defineBackground(() => {
  const loader = new Loader(sessionCache);

  browser.runtime.onMessage.addListener((msg: Request, sender) => {
    if (msg.type === 'openOptions') {
      void browser.runtime.openOptionsPage();
      return;
    }
    if (msg.type !== 'getLoads') return;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const push = (m: Omit<LoadsMessage, 'type'>) =>
      browser.tabs.sendMessage(tabId, { type: 'loads', ...m } satisfies LoadsMessage).catch(() => {});
    handle(msg, tabId, push).catch((e) => push({ loads: {}, error: { kind: 'network', message: String(e) } }));
  });

  /** Without a token, searches run in the tab, which carries the user's github.com session. */
  async function searchInTab(tabId: number, query: string): Promise<WebSearchResult> {
    const reply = (await browser.tabs.sendMessage(tabId, { type: 'webSearch', query } satisfies WebSearchMessage)) as
      WebSearchReply | undefined;
    if (!reply) throw new GitHubError({ kind: 'network', message: 'The GitHub tab did not answer' });
    if (!reply.ok) throw new GitHubError(reply.error);
    return reply.result;
  }

  async function handle(
    msg: Extract<Request, { type: 'getLoads' }>,
    tabId: number,
    push: (m: Omit<LoadsMessage, 'type'>) => unknown,
  ) {
    const token = await tokenItem.getValue();
    const settings = await getSettings();
    const { ctx } = msg;
    let qualifier: string;
    try {
      qualifier = scopeQualifier(ctx, settings.scope);
    } catch {
      return;
    }
    const logins = [...new Set(msg.logins.filter(isLogin))];
    const pr = ctx.pr ? { owner: ctx.owner, repo: ctx.repo, number: ctx.pr } : undefined;

    const prefix = `${qualifier}|${settings.includeTeams ? 'teams' : 'direct'}`;

    if (!token) {
      // Fallback: github.com/pulls with the signed-in session. Counts already exclude the current PR,
      // so no snapshot, and a separate cache namespace from token results.
      if ((await webSignedOutUntil.getValue()) > Date.now()) return push({ loads: {}, error: { kind: 'no-token' } });
      await loader.load({
        prefix: `web|${prefix}|${pr ? `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase() : 'new'}`,
        logins,
        force: msg.force,
        async fetchBatch(batch) {
          // Everyone in the batch at once; the loader still caps how many batches run together.
          const results = await Promise.allSettled(
            batch.map((login) =>
              webLoad((q) => searchInTab(tabId, q), login, qualifier, settings.includeTeams, pr, Date.now()),
            ),
          );
          // Keep whoever succeeded, and report the first failure alongside them.
          const loads = new Map<string, Load>();
          let error: LoadError | undefined;
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') loads.set(batch[i]!, r.value);
            else error ??= toLoadError(r.reason);
          });
          if (error?.kind === 'no-token') await webSignedOutUntil.setValue(Date.now() + SIGNED_OUT_MS);
          return { loads, error };
        },
        onUpdate: (u) => push({ ...u, snapshot: NO_SNAPSHOT }),
      });
      return;
    }

    await loader.load({
      prefix,
      logins,
      snapshotKey: pr && `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase(),
      force: msg.force,
      async fetchBatch(batch, withSnapshot) {
        const { query, variables } = buildQuery(batch, qualifier, settings.includeTeams, withSnapshot ? pr : undefined);
        const data = await graphql(token, query, variables);
        return parseResponse(batch, data, Date.now());
      },
      onUpdate: (u) => push(u),
    });
  }
});
