import { hovercardLogin, selectors as s } from './selectors';
import type { PageContext } from './types';

export function pageContext(pathname: string): PageContext | undefined {
  const m = pathname.match(/^\/([^/]+)\/([^/]+)\/(pull\/(\d+)|compare\/)/);
  if (!m) return undefined;
  return { owner: m[1]!, repo: m[2]!, pr: m[4] ? Number(m[4]) : undefined };
}

export interface Slot {
  login: string;
  /** Element the pill is placed in or next to. */
  anchor: Element;
  where: 'append' | 'prepend' | 'after' | 'before';
}

export function findSlots(root: ParentNode): { picker: Slot[]; sidebar: Slot[] } {
  const menu = root.querySelector(s.reviewersMenu);
  const item = menu?.closest(s.sidebarItem);
  const picker: Slot[] = [];
  const sidebar: Slot[] = [];

  // Redesigned PR page. The picker is in a portal away from the sidebar, so look for it on its own.
  for (const row of root.querySelectorAll<HTMLElement>(s.reactPickerRow)) {
    const login = row.dataset.id;
    const label = row.querySelector(s.reactPickerLabel);
    if (!login || !label || login.includes('/') || row.querySelector(s.reactPickerApp)) continue; // team or app
    // Right after the login, before the full name.
    const name = label.querySelector(s.reactPickerName);
    picker.push(name ? { login, anchor: name, where: 'before' } : { login, anchor: label, where: 'append' });
  }
  const section = root.querySelector(s.reactReviewersButton)?.closest(s.reactSidebarSection);
  for (const el of section?.querySelectorAll(s.sidebarUser) ?? []) {
    const login = hovercardLogin(el);
    const indicators = el.closest('li')?.querySelector(s.reactSidebarIndicators);
    if (login && indicators) sidebar.push({ login, anchor: indicators, where: 'prepend' });
  }

  if (!menu || !item) return { picker, sidebar };

  for (const row of menu.querySelectorAll(s.pickerRow)) {
    if (!row.querySelector(s.pickerUserInput)) continue; // a team
    // Right after the login, so a long full name never pushes the pill onto its own line.
    const anchor = row.querySelector(s.pickerLogin);
    const login = anchor?.textContent?.trim();
    if (login && anchor) picker.push({ login, anchor, where: 'after' });
  }
  for (const el of item.querySelectorAll(s.sidebarUser)) {
    if (el.closest(s.pickerMenu)) continue;
    const login = hovercardLogin(el);
    if (login) sidebar.push({ login, anchor: el, where: 'after' });
  }
  return { picker, sidebar };
}
