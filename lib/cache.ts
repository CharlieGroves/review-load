import { storage } from 'wxt/utils/storage';
import type { Cache } from './loader';
import type { Load } from './types';

/**
 * storage.session survives the MV3 worker being shut down when idle, and is
 * cleared when the browser closes. Content scripts can't read it.
 */
export const sessionCache: Cache = {
  async getLoads(keys) {
    if (!keys.length) return {};
    const items = await storage.getItems(keys.map((k) => `session:load:${k}` as const));
    const out: Record<string, Load | undefined> = {};
    items.forEach(({ key, value }) => (out[key.replace(/^session:load:/, '')] = (value as Load | null) ?? undefined));
    return out;
  },
  async setLoads(entries) {
    const items = Object.entries(entries).map(([k, value]) => ({ key: `session:load:${k}` as const, value }));
    if (items.length) await storage.setItems(items);
  },
  async getBackoff() {
    return (await storage.getItem<number>('session:backoffUntil')) ?? 0;
  },
  async setBackoff(until) {
    await storage.setItem('session:backoffUntil', until);
  },
};
