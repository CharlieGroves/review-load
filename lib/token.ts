import { storage } from 'wxt/utils/storage';
import { graphql, GitHubError } from './github';
import { errorText } from './pill';
import { tokenItem } from './settings';
import type { LoadError } from './types';

export const CREATE_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?' +
  new URLSearchParams({
    name: 'ReviewLoad',
    description: 'Read-only token for the ReviewLoad browser extension',
    expires_in: '90',
    pull_requests: 'read',
  });

/** The last successful check, so the popup can show who's connected without calling GitHub each time. */
export interface TokenStatus {
  login: string;
  orgs: string[];
  checkedAt: number;
  /** Last 4 characters of the token it describes, to notice when the token changes. */
  tail: string;
}

export const tokenStatusItem = storage.defineItem<TokenStatus>('local:tokenStatus');

/** Re-check a cached status older than this. */
export const STATUS_MAX_AGE = 24 * 3_600_000;

export type CheckResult = { ok: true; status: TokenStatus } | { ok: false; error: LoadError };

export async function checkToken(token: string, now = Date.now()): Promise<CheckResult> {
  try {
    const data = await graphql<{
      viewer: { login: string; organizations: { nodes: Array<{ login: string } | null> } };
    }>(token, 'query { viewer { login organizations(first: 50) { nodes { login } } } }');
    const status: TokenStatus = {
      login: data.viewer.login,
      orgs: data.viewer.organizations.nodes.filter(Boolean).map((o) => o!.login),
      checkedAt: now,
      tail: token.slice(-4),
    };
    await tokenStatusItem.setValue(status);
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e instanceof GitHubError ? e.detail : { kind: 'network', message: String(e) } };
  }
}

/** A cached status for the current token, if it's recent enough to trust. */
export async function cachedStatus(token: string, now = Date.now()): Promise<TokenStatus | undefined> {
  const status = await tokenStatusItem.getValue();
  if (!status || status.tail !== token.slice(-4) || now - status.checkedAt > STATUS_MAX_AGE) return undefined;
  return status;
}

export async function saveToken(token: string): Promise<CheckResult> {
  await tokenItem.setValue(token);
  await tokenStatusItem.removeValue();
  await browser.storage.session.clear(); // counts seen through the old token
  return checkToken(token);
}

export async function removeToken(): Promise<void> {
  await tokenItem.removeValue();
  await tokenStatusItem.removeValue();
  await browser.storage.session.clear();
}

/** Write a check result into a status element, with an SSO authorisation link when there is one. */
export function showResult(el: HTMLElement, result: CheckResult): void {
  el.replaceChildren();
  if (result.ok) {
    const { login, orgs } = result.status;
    el.className = 'ok';
    el.textContent =
      `✓ Token works for ${login}.` +
      (orgs.length
        ? ` Organisations visible: ${orgs.join(', ')}.`
        : ' A fine-grained token covers only the owner you picked when creating it.');
    return;
  }
  el.className = 'bad';
  el.textContent = errorText(result.error);
  if (result.error.kind === 'sso' && result.error.url) {
    const a = document.createElement('a');
    a.href = result.error.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = ' Authorise it ↗';
    el.append(a);
  }
}
