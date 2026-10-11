import { graphql, GitHubError } from '@/lib/github';
import { errorText } from '@/lib/pill';
import { getSettings, settingsItem, tokenItem } from '@/lib/settings';
import type { Settings } from '@/lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const CREATE_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?' +
  new URLSearchParams({
    name: 'ReviewLoad',
    description: 'Read-only token for the ReviewLoad browser extension',
    expires_in: '90',
    pull_requests: 'read',
  });

async function checkToken(token: string) {
  const status = $('token-status');
  status.className = '';
  status.textContent = 'Checking…';
  try {
    const data = await graphql<{
      viewer: { login: string; organizations: { nodes: Array<{ login: string } | null> } };
    }>(token, 'query { viewer { login organizations(first: 50) { nodes { login } } } }');
    const orgs = data.viewer.organizations.nodes.filter(Boolean).map((o) => o!.login);
    status.className = 'ok';
    status.textContent =
      `✓ Token works for ${data.viewer.login}.` +
      (orgs.length
        ? ` Organisations visible: ${orgs.join(', ')}.`
        : ' A fine-grained token covers only the owner you picked when creating it.');
  } catch (e) {
    status.className = 'bad';
    status.textContent = e instanceof GitHubError ? errorText(e.detail) : String(e);
    if (e instanceof GitHubError && e.detail.kind === 'sso' && e.detail.url) {
      const a = document.createElement('a');
      a.href = e.detail.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = ' Authorise it ↗';
      status.append(a);
    }
  }
}

async function init() {
  $<HTMLAnchorElement>('create-token').href = CREATE_TOKEN_URL;

  const token = await tokenItem.getValue();
  if (token) {
    $<HTMLInputElement>('token').placeholder = 'Saved. Paste a new token to replace it';
    void checkToken(token);
  }

  $('token-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('token');
    const value = input.value.trim();
    if (!value) return;
    await tokenItem.setValue(value);
    await browser.storage.session.clear();
    input.value = '';
    input.placeholder = 'Saved. Paste a new token to replace it';
    await checkToken(value);
  });

  $('remove').addEventListener('click', async () => {
    await tokenItem.removeValue();
    await browser.storage.session.clear();
    $<HTMLInputElement>('token').placeholder = 'github_pat_…';
    const status = $('token-status');
    status.className = '';
    status.textContent = 'Token removed.';
  });

  const s = await getSettings();
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=scope]')) r.checked = r.value === s.scope;
  $<HTMLInputElement>('includeTeams').checked = s.includeTeams;
  $<HTMLInputElement>('amber').value = String(s.amber);
  $<HTMLInputElement>('red').value = String(s.red);
  $<HTMLInputElement>('showHover').checked = s.showHover;
  $<HTMLInputElement>('demo').checked = s.demo;

  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  document.querySelectorAll('section input:not(#token)').forEach((el) =>
    el.addEventListener('change', async () => {
      const amber = clamp($<HTMLInputElement>('amber').valueAsNumber, 3);
      const red = Math.max(amber + 1, clamp($<HTMLInputElement>('red').valueAsNumber, 6));
      const next: Settings = {
        scope:
          document.querySelector<HTMLInputElement>('input[name=scope]:checked')?.value === 'repo' ? 'repo' : 'owner',
        includeTeams: $<HTMLInputElement>('includeTeams').checked,
        amber,
        red,
        showHover: $<HTMLInputElement>('showHover').checked,
        demo: $<HTMLInputElement>('demo').checked,
      };
      $<HTMLInputElement>('red').value = String(red);
      await settingsItem.setValue(next);
      $('saved').textContent = 'Saved.';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
    }),
  );
}

function clamp(n: number, fallback: number) {
  return Number.isFinite(n) ? Math.min(99, Math.max(1, Math.round(n))) : fallback;
}

void init();
