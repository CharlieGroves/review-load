/**
 * Every GitHub selector lives here, so a GitHub UI change is a one-file fix.
 * Verified against the PR page's legacy (server-rendered) sidebar, Oct 2026.
 */
export const selectors = {
  /** <details> wrapping the Reviewers gear menu. */
  reviewersMenu: '#reviewers-select-menu',
  /** Sidebar block containing the menu and the list of requested reviewers. */
  sidebarItem: '.discussion-sidebar-item',
  /** One person or team in the open picker; filtered by toggling `hidden`. */
  pickerRow: '[role="menuitemcheckbox"]',
  /** Present on people, absent on teams (which use reviewer_team_ids[]). */
  pickerUserInput: 'input[name="reviewer_user_ids[]"]',
  pickerLogin: '.js-username',
  /** Where the pill goes inside a picker row. */
  pickerSlot: '.select-menu-item-heading',
  /** A requested or past reviewer listed in the sidebar. */
  sidebarUser: '[data-hovercard-url^="/users/"]',
  pickerMenu: 'details-menu',
} as const;

export const hovercardLogin = (el: Element) => el.getAttribute('data-hovercard-url')?.match(/^\/users\/([^/]+)/)?.[1];
