import { getSettings, tokenItem, updateSettings } from '@/lib/settings';
import { cachedStatus, checkToken, CREATE_TOKEN_URL, saveToken, showResult, type CheckResult } from '@/lib/token';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function showConnected(result: CheckResult) {
  $('connected').hidden = false;
  $('setup').hidden = true;
  const who = $('who');
  if (result.ok) {
    const { login, orgs } = result.status;
    who.className = '';
    who.replaceChildren(`Connected as ${login}`);
    const detail = document.createElement('small');
    detail.textContent = orgs.length
      ? `Organisations: ${orgs.join(', ')}`
      : 'Token covers the owner chosen when it was created';
    who.append(detail);
  } else showResult(who, result);
  $('connected').querySelector<HTMLElement>('.dot')!.style.background = result.ok ? '' : 'var(--bad)';
}

function showSetup(intro?: string) {
  $('connected').hidden = true;
  $('setup').hidden = false;
  if (intro) $('setup-intro').textContent = intro;
  $('token').focus();
}

async function init() {
  $<HTMLAnchorElement>('create-token').href = CREATE_TOKEN_URL;

  const token = await tokenItem.getValue();
  if (!token) showSetup();
  else {
    const cached = await cachedStatus(token);
    if (cached) showConnected({ ok: true, status: cached });
    else {
      $('who').textContent = 'Checking token…';
      $('connected').hidden = false;
      showConnected(await checkToken(token));
    }
  }

  $('change').addEventListener('click', () => showSetup('Paste a new token to replace the saved one.'));

  $('token-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('token');
    const value = input.value.trim();
    if (!value) return;
    const status = $('token-status');
    status.className = '';
    status.textContent = 'Checking…';
    const result = await saveToken(value);
    input.value = '';
    if (result.ok) showConnected(result);
    else showResult(status, result);
  });

  const s = await getSettings();
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=scope]')) {
    r.checked = r.value === s.scope;
    r.addEventListener('change', () => updateSettings({ scope: r.value === 'repo' ? 'repo' : 'owner' }));
  }
  for (const key of ['includeTeams', 'demo'] as const) {
    const box = $<HTMLInputElement>(key);
    box.checked = s[key];
    box.addEventListener('change', () => updateSettings({ [key]: box.checked }));
  }

  $('all-settings').addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });
}

void init();
