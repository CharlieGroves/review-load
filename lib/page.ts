import { hovercardLogin, selectors as s } from './selectors';
import type { PageContext } from './types';

export function pageContext(pathname: string): PageContext | undefined {
  const m = pathname.match(/^\/([^/]+)\/([^/]+)\/(pull\/(\d+)|compare\/)/);
  if (!m) return undefined;
  return { owner: m[1]!, repo: m[2]!, pr: m[4] ? Number(m[4]) : undefined };
}

export interface Slot {
  login: string;
  /** Element the pill is appended to (picker) or inserted after (sidebar). */
  anchor: Element;
  where: 'append' | 'after';
}

export function findSlots(root: ParentNode): { picker: Slot[]; sidebar: Slot[] } {
  const menu = root.querySelector(s.reviewersMenu);
  const item = menu?.closest(s.sidebarItem);
  const picker: Slot[] = [];
  const sidebar: Slot[] = [];
  if (!menu || !item) return { picker, sidebar };

  for (const row of menu.querySelectorAll(s.pickerRow)) {
    if (!row.querySelector(s.pickerUserInput)) continue; // a team
    const login = row.querySelector(s.pickerLogin)?.textContent?.trim();
    const anchor = row.querySelector(s.pickerSlot);
    if (login && anchor) picker.push({ login, anchor, where: 'append' });
  }
  for (const el of item.querySelectorAll(s.sidebarUser)) {
    if (el.closest(s.pickerMenu)) continue;
    const login = hovercardLogin(el);
    if (login) sidebar.push({ login, anchor: el, where: 'after' });
  }
  return { picker, sidebar };
}
