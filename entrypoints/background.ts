import { sessionCache } from '@/lib/cache';
import { graphql } from '@/lib/github';
import { Loader } from '@/lib/loader';
import { buildQuery, isLogin, parseResponse, scopeQualifier } from '@/lib/query';
import { getSettings, tokenItem } from '@/lib/settings';
import type { LoadsMessage, Request } from '@/lib/types';

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
    void handle(msg, push);
  });

  async function handle(msg: Extract<Request, { type: 'getLoads' }>, push: (m: Omit<LoadsMessage, 'type'>) => unknown) {
    const token = await tokenItem.getValue();
    if (!token) return push({ loads: {}, error: { kind: 'no-token' } });
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

    await loader.load({
      prefix: `${qualifier}|${settings.includeTeams ? 'teams' : 'direct'}`,
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
