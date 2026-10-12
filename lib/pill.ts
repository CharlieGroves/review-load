import type { Slot } from './page';
import type { LoadError, PrSummary, Settings } from './types';

export type PillState =
  | { kind: 'loading' }
  | {
      kind: 'count';
      n: number;
      prs: PrSummary[];
      stale: boolean;
      fetchedAt: number;
      demo: boolean;
      /** GitHub search listing every PR behind the number. */
      allUrl?: string;
      error?: LoadError;
    }
  | { kind: 'error'; error: LoadError };

export const HOST_ATTR = 'data-reviewload';

export function level(n: number, s: Pick<Settings, 'amber' | 'red'>): 'green' | 'amber' | 'red' {
  return n >= s.red ? 'red' : n >= s.amber ? 'amber' : 'green';
}

export function age(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

const PILL_CSS = `
:host { display: inline-flex; vertical-align: middle; margin-left: 6px; flex: none; }
.pill { font: 600 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-width: 18px;
  padding: 0 6px; border-radius: 999px; text-align: center; cursor: default; color: #fff; box-sizing: border-box; }
.green { background: #1f883d; } .amber { background: #d4a72c; color: #1f2328; } .red { background: #cf222e; }
.muted { background: transparent; color: var(--fgColor-muted, #59636e); border: 1px solid var(--borderColor-default, #d1d9e0); }
.stale { opacity: .55; }
`;

/** Find or create the pill host for a slot. Idempotent: GitHub re-renders never produce duplicates. */
export function ensureHost(slot: Slot): HTMLElement {
  const existing =
    slot.where === 'append'
      ? slot.anchor.querySelector(`:scope > [${HOST_ATTR}]`)
      : slot.anchor.nextElementSibling?.hasAttribute(HOST_ATTR)
        ? slot.anchor.nextElementSibling
        : null;
  if (existing instanceof HTMLElement && existing.getAttribute(HOST_ATTR) === slot.login) return existing;
  existing?.remove();

  const host = document.createElement('span');
  host.setAttribute(HOST_ATTR, slot.login);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PILL_CSS;
  const pill = document.createElement('span');
  pill.className = 'pill muted';
  root.append(style, pill);
  if (slot.where === 'append') slot.anchor.append(host);
  else slot.anchor.after(host);
  return host;
}

export function renderPill(host: HTMLElement, state: PillState, settings: Settings): void {
  const pill = host.shadowRoot!.querySelector('.pill') as HTMLElement;
  let text: string;
  let cls: string;
  let label: string;
  switch (state.kind) {
    case 'loading':
      [text, cls, label] = ['…', 'muted', 'Loading review load'];
      break;
    case 'error':
      [text, cls, label] = [state.error.kind === 'no-token' ? '?' : '!', 'muted', errorText(state.error)];
      break;
    case 'count':
      text = String(state.n);
      cls = level(state.n, settings) + (state.stale ? ' stale' : '');
      label = `${state.n} pending review request${state.n === 1 ? '' : 's'}${state.demo ? ' (demo data)' : ''}`;
  }
  if (pill.textContent !== text) pill.textContent = text;
  const full = `pill ${cls}`;
  if (pill.className !== full) pill.className = full;
  pill.setAttribute('aria-label', label);
  host.title = settings.showHover ? '' : label;
}

export function errorText(e: LoadError): string {
  switch (e.kind) {
    case 'no-token':
      return 'Sign in to GitHub, or add a GitHub token in ReviewLoad options, to see review load.';
    case 'unauthorized':
      return 'GitHub rejected the token. It may have expired or been revoked.';
    case 'sso':
      return 'This organisation uses SAML single sign-on. Authorise your token for it.';
    case 'rate-limited':
      return `GitHub asked us to slow down. Showing saved numbers until ${new Date(e.until).toLocaleTimeString()}.`;
    case 'network':
      return `Couldn't reach GitHub (${e.message}).`;
  }
}

const POPOVER_CSS = `
:host { all: initial; }
.card { position: fixed; z-index: 2147483647; width: 320px; max-width: calc(100vw - 16px); box-sizing: border-box;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--fgColor-default, #1f2328); background: var(--overlay-bgColor, #fff);
  border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 8px; padding: 8px 10px;
  box-shadow: var(--shadow-floating-small, 0 6px 18px rgba(0,0,0,.15)); }
.title { font-weight: 600; margin-bottom: 4px; }
ol { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; padding: 3px 0; border-top: 1px solid var(--borderColor-muted, #eff2f5); }
a { color: var(--fgColor-accent, #0969da); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a:hover { text-decoration: underline; }
.repo, .meta, .age { color: var(--fgColor-muted, #59636e); }
.repo { grid-column: 1 / -1; font-size: 11px; }
.all { display: block; margin-top: 4px; }
.meta { margin-top: 6px; font-size: 11px; }
button { font: inherit; margin-top: 6px; cursor: pointer; }
`;

/** One shared popover on <body>, so menus with overflow never clip it. */
export class Popover {
  private host?: HTMLElement;
  private card?: HTMLElement;
  private hideTimer?: ReturnType<typeof setTimeout>;
  onOpenOptions: () => void = () => {};

  private ensure() {
    if (this.host?.isConnected) return;
    this.host = document.createElement('div');
    this.host.setAttribute(HOST_ATTR, 'popover');
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = POPOVER_CSS;
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.card.setAttribute('role', 'tooltip');
    this.card.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.card.addEventListener('mouseleave', () => this.hide());
    root.append(style, this.card);
    document.body.append(this.host);
  }

  show(anchor: HTMLElement, login: string, state: PillState, now = Date.now()) {
    clearTimeout(this.hideTimer);
    this.ensure();
    const card = this.card!;
    card.replaceChildren(...content(login, state, now, () => this.onOpenOptions()));
    card.style.visibility = 'hidden';
    card.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    // Sit beside the picker rather than over it, so the other people stay visible.
    const beside = (anchor.closest('details-menu') ?? anchor).getBoundingClientRect();
    if (beside.left - w - 8 >= 8) {
      card.style.left = `${beside.left - w - 8}px`;
      card.style.top = `${Math.min(Math.max(8, r.top - 12), window.innerHeight - h - 8)}px`;
    } else {
      const below = r.bottom + 6 + h < window.innerHeight;
      card.style.left = `${Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)}px`;
      card.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    }
    card.style.visibility = '';
  }

  hide(delay = 150) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.card && (this.card.hidden = true), delay);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function content(login: string, state: PillState, now: number, openOptions: () => void): Node[] {
  if (state.kind === 'loading') return [el('div', 'title', `Loading ${login}'s review load…`)];
  if (state.kind === 'error') {
    const nodes: Node[] = [el('div', 'title', login), el('div', '', errorText(state.error))];
    const b = el('button', '', state.error.kind === 'sso' ? 'Open options' : 'Open ReviewLoad options');
    b.addEventListener('click', openOptions);
    if (state.error.kind !== 'network' && state.error.kind !== 'rate-limited') nodes.push(b);
    return nodes;
  }
  const nodes: Node[] = [el('div', 'title', `${login}: ${state.n} pending review request${state.n === 1 ? '' : 's'}`)];
  if (state.prs.length) {
    const ol = el('ol');
    for (const pr of state.prs) {
      const li = el('li');
      const a = el('a', '', pr.title);
      a.href = pr.url;
      a.title = pr.title;
      li.append(a, el('span', 'age', pr.createdAt ? age(pr.createdAt, now) : ''), el('span', 'repo', pr.repo));
      ol.append(li);
    }
    nodes.push(ol);
  }
  if (state.allUrl && state.n > state.prs.length) {
    const all = el('a', 'all', `See all ${state.n} on GitHub`);
    all.href = state.allUrl;
    nodes.push(all);
  }
  const meta = state.demo
    ? 'Demo data: turn off demo mode in ReviewLoad options.'
    : `Excludes this PR. Oldest first. ${state.stale ? `Saved ${age(new Date(state.fetchedAt).toISOString(), now)} ago.` : ''}`;
  nodes.push(el('div', 'meta', meta));
  if (state.error) nodes.push(el('div', 'meta', errorText(state.error)));
  return nodes;
}
