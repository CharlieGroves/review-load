/**
 * Every GitHub selector lives here, so a GitHub UI change is a one-file fix.
 * Verified against the PR page's legacy (server-rendered) sidebar, Oct 2026,
 * which the compare (new PR) page still uses. The `react*` ones match the redesigned PR page, Nov 2026.
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
  /** The login; the pill goes right after it. */
  pickerLogin: '.js-username',
  /** A requested or past reviewer listed in the sidebar. */
  sidebarUser: '[data-hovercard-url^="/users/"]',
  pickerMenu: 'details-menu',

  /** Redesigned PR page. Its class names end in a build hash, so match their prefix. */
  reactReviewersButton: 'button[data-dd-action-name="pull_requests.reviewers.open"]',
  reactSidebarSection: '[data-overview-sidebar-item]',
  /** Status icons at the end of a sidebar row; the pill goes first, since the name sits in a grid column. */
  reactSidebarIndicators: '[class*="indicators__"]',
  /** A picker row; `data-id` is the login, or `org/team`. Unselected rows say `.request`, selected `.remove`. */
  reactPickerRow: '[role="option"][data-dd-action-name^="pull_requests.reviewers."]',
  /** Copilot and other apps have /in/ avatars. */
  reactPickerApp: 'img[src*="/in/"]',
  reactPickerLabel: '[data-component="ActionList.Item.Label"]',
  /** "Everyone else" rows wrap the login in a span; "Suggestions" rows leave it as bare text before the name. */
  reactPickerLogin: '[class*="reviewerOptionLogin__"]',
  /** The full name after the login, if the person has one. */
  reactPickerName: '[class*="inlineSubtleName__"], [class*="reviewerOptionName__"]',
  reactPickerMenu: '[role="dialog"]',
} as const;

export const hovercardLogin = (el: Element) => el.getAttribute('data-hovercard-url')?.match(/^\/users\/([^/]+)/)?.[1];
