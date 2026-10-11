import { storage } from 'wxt/utils/storage';
import { defaultSettings, type Settings } from './types';

/** storage.local only: never sync the token between machines. */
export const tokenItem = storage.defineItem<string>('local:token');

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: defaultSettings,
});

export async function getSettings(): Promise<Settings> {
  return { ...defaultSettings, ...(await settingsItem.getValue()) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}
