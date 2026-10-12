export interface PrSummary {
  title: string;
  url: string;
  repo: string;
  createdAt: string;
}

/** Pending review requests for one person within one scope. */
export interface Load {
  count: number;
  /** Oldest first, at most 5. */
  prs: PrSummary[];
  fetchedAt: number;
}

/** The PR page being viewed. `pr` is absent on the compare (new PR) page. */
export interface PageContext {
  owner: string;
  repo: string;
  pr?: number;
}

/** Who is directly requested on the current PR, from the same fetch as the counts. */
export interface PrSnapshot {
  countable: boolean;
  requested: string[];
}

export type LoadError =
  | { kind: 'no-token' }
  | { kind: 'unauthorized' }
  | { kind: 'sso'; url?: string }
  | { kind: 'rate-limited'; until: number }
  | { kind: 'network'; message: string };

export interface Settings {
  scope: 'owner' | 'repo';
  includeTeams: boolean;
  amber: number;
  red: number;
  showHover: boolean;
  demo: boolean;
}

export const defaultSettings: Settings = {
  scope: 'owner',
  includeTeams: false,
  amber: 3,
  red: 6,
  showHover: true,
  demo: false,
};

/** content script -> background */
export type Request =
  { type: 'getLoads'; logins: string[]; ctx: PageContext; force?: boolean } | { type: 'openOptions' };

/** background -> content script: run a github.com/pulls search with the browser session (no token). */
export interface WebSearchMessage {
  type: 'webSearch';
  query: string;
}

export type WebSearchReply = { ok: true; result: import('./web').WebSearchResult } | { ok: false; error: LoadError };

/** background -> content script */
export interface LoadsMessage {
  type: 'loads';
  loads: Record<string, Load & { stale: boolean }>;
  snapshot?: PrSnapshot;
  error?: LoadError;
}
