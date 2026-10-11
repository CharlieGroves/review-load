import { getSettings, settingsItem, tokenItem } from '@/lib/settings';
import { cachedStatus, checkToken, CREATE_TOKEN_URL, removeToken, saveToken, showResult } from '@/lib/token';
import type { Settings } from '@/lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function check(run: () => Promise<Parameters<typeof showResult>[1]>) {
  const status = $('token-status');
  status.className = '';
  status.textContent = 'Checking…';
  showResult(status, await run());
}

async function init() {
  $<HTMLAnchorElement>('create-token').href = CREATE_TOKEN_URL;

  const token = await tokenItem.getValue();
  if (token) {
    $<HTMLInputElement>('token').placeholder = 'Saved. Paste a new token to replace it';
    const cached = await cachedStatus(token);
    if (cached) showResult($('token-status'), { ok: true, status: cached });
    else void check(() => checkToken(token));
  }

  $('token-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('token');
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    input.placeholder = 'Saved. Paste a new token to replace it';
    await check(() => saveToken(value));
  });

  $('remove').addEventListener('click', async () => {
    await removeToken();
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
