import { demoLoad } from '@/lib/demo';
import { findSlots, pageContext } from '@/lib/page';
import { ensureHost, Popover, renderPill, type PillState } from '@/lib/pill';
import { displayCount, scopeQualifier, searchString } from '@/lib/query';
import { getSettings, settingsItem } from '@/lib/settings';
import type { Load, LoadError, LoadsMessage, PageContext, PrSnapshot, Request, Settings } from '@/lib/types';

const REQUEST_DEBOUNCE_MS = 150;
/** Search indexing lags a reviewer being added; wait before re-asking. */
const SIDEBAR_REFRESH_MS = 3000;

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    let settings: Settings = await getSettings();
    const popover = new Popover();
    popover.onOpenOptions = () => send({ type: 'openOptions' });

    let page: PageContext | undefined;
    let pageKey = '';
    let loads = new Map<string, Load & { stale: boolean }>();
    let snapshot: PrSnapshot | undefined;
    let error: LoadError | undefined;
    let asked = new Set<string>();
    let pending = new Set<string>();
    let sidebarSeen: string | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;

    const send = (msg: Request) => browser.runtime.sendMessage(msg).catch(() => {});

    function resetIfNavigated() {
      const next = pageContext(location.pathname);
      const key = next ? `${next.owner}/${next.repo}#${next.pr ?? 'new'}`.toLowerCase() : '';
      if (key === pageKey) return;
      pageKey = key;
      page = next;
      loads = new Map();
      snapshot = undefined;
      error = undefined;
      asked = new Set();
      pending = new Set();
      sidebarSeen = undefined;
    }

    function requestLoads(logins: string[], force = false) {
      if (!page) return;
      if (force) return void send({ type: 'getLoads', logins, ctx: page, force });
      for (const l of logins) pending.add(l);
      clearTimeout(requestTimer);
      requestTimer = setTimeout(() => {
        const batch = [...pending];
        pending.clear();
        if (batch.length && page) send({ type: 'getLoads', logins: batch, ctx: page });
      }, REQUEST_DEBOUNCE_MS);
    }

    function stateFor(login: string): PillState {
      const now = Date.now();
      if (settings.demo) {
        const d = demoLoad(login, now);
        return { kind: 'count', n: d.count, prs: d.prs, stale: false, fetchedAt: now, demo: true };
      }
      const load = loads.get(login.toLowerCase());
      if (!load) return error ? { kind: 'error', error } : { kind: 'loading' };
      const here = page?.pr ? `https://github.com/${page.owner}/${page.repo}/pull/${page.pr}`.toLowerCase() : '';
      return {
        kind: 'count',
        n: displayCount(login, load, snapshot),
        prs: load.prs.filter((p) => p.url.toLowerCase() !== here),
        stale: load.stale,
        fetchedAt: load.fetchedAt,
        demo: false,
        allUrl: page && searchUrl(login, page),
        error: error?.kind === 'rate-limited' ? error : undefined,
      };
    }

    function searchUrl(login: string, ctx: PageContext): string | undefined {
      try {
        const q = searchString(login, scopeQualifier(ctx, settings.scope), settings.includeTeams);
        return `https://github.com/search?type=pullrequests&q=${encodeURIComponent(q)}`;
      } catch {
        return undefined;
      }
    }

    function scan() {
      resetIfNavigated();
      if (!page) return;
      const { picker, sidebar } = findSlots(document);
      const slots = [...picker, ...sidebar];
      if (!slots.length) return;

      const missing: string[] = [];
      for (const slot of slots) {
        const host = ensureHost(slot);
        if (!host.dataset.rlBound) {
          host.dataset.rlBound = '1';
          host.addEventListener('mouseenter', () => {
            if (settings.showHover) popover.show(host, slot.login, stateFor(slot.login));
          });
          host.addEventListener('mouseleave', () => popover.hide());
        }
        renderPill(host, stateFor(slot.login), settings);
        const key = slot.login.toLowerCase();
        if (!settings.demo && !asked.has(key)) {
          asked.add(key);
          missing.push(slot.login);
        }
      }
      if (missing.length) requestLoads(missing);

      // When reviewers are added or removed, re-fetch them so "excludes this PR" stays true.
      const sidebarNow = sidebar
        .map((s) => s.login.toLowerCase())
        .sort()
        .join(',');
      if (sidebarSeen !== undefined && sidebarNow !== sidebarSeen && !settings.demo) {
        const before = new Set(sidebarSeen.split(','));
        const after = new Set(sidebarNow.split(','));
        const changed = [...before, ...after].filter((l) => l && before.has(l) !== after.has(l));
        if (changed.length) setTimeout(() => requestLoads(changed, true), SIDEBAR_REFRESH_MS);
      }
      sidebarSeen = sidebarNow;
    }

    // setTimeout, not requestAnimationFrame: rAF never fires in background tabs, so pills there would stay on "…".
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        scan();
      }, 16);
    };

    browser.runtime.onMessage.addListener((msg: LoadsMessage) => {
      if (msg?.type !== 'loads') return;
      for (const [login, load] of Object.entries(msg.loads)) loads.set(login.toLowerCase(), load);
      if (msg.snapshot) snapshot = msg.snapshot;
      if (msg.error) error = msg.error;
      else if (Object.keys(msg.loads).length && error?.kind !== 'rate-limited') error = undefined;
      schedule();
    });

    settingsItem.watch(async () => {
      settings = await getSettings();
      asked = new Set();
      loads = new Map();
      error = undefined;
      schedule();
    });

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());
    ctx.addEventListener(window, 'wxt:locationchange', schedule);
    scan();
  },
});
