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

/** background -> content script */
export interface LoadsMessage {
  type: 'loads';
  loads: Record<string, Load & { stale: boolean }>;
  error?: LoadError;
}
