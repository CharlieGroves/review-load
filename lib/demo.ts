import type { Load } from './types';

const TITLES = [
  'Add retry to webhook delivery',
  'Migrate billing jobs to the new queue',
  'Fix flaky date picker test',
  'Bump dependencies for October',
  'Cache org settings per request',
  'Split the onboarding wizard into steps',
];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Stable, clearly fake numbers for demo mode. No network. */
export function demoLoad(login: string, now: number): Load {
  const h = hash(login);
  const count = h % 9;
  const prs = Array.from({ length: Math.min(count, 5) }, (_, i) => ({
    title: TITLES[(h + i) % TITLES.length]!,
    url: 'https://github.com/',
    repo: 'example-org/demo',
    createdAt: new Date(now - (count - i) * 26 * 3_600_000).toISOString(),
  }));
  return { count, prs, fetchedAt: now };
}
