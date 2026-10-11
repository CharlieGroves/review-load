import { describe, expect, it } from 'vitest';
import { buildQuery, chunk, displayCount, parseResponse, scopeQualifier, searchString } from './query';

describe('scopeQualifier', () => {
  it('uses user: for the owner, which works for orgs and personal accounts', () => {
    expect(scopeQualifier({ owner: 'acme', repo: 'web' }, 'owner')).toBe('user:acme');
    expect(scopeQualifier({ owner: 'acme', repo: 'web.js' }, 'repo')).toBe('repo:acme/web.js');
  });

  it('rejects owners and repos that are not valid GitHub names', () => {
    expect(() => scopeQualifier({ owner: 'acme org:evil', repo: 'web' }, 'owner')).toThrow();
    expect(() => scopeQualifier({ owner: 'acme', repo: 'web x' }, 'repo')).toThrow();
  });
});

describe('searchString', () => {
  it('counts only direct requests unless team requests are included', () => {
    expect(searchString('alice', 'user:acme', false)).toBe(
      'is:pr is:open draft:false user-review-requested:alice user:acme sort:created-asc',
    );
    expect(searchString('alice', 'user:acme', true)).toContain(' review-requested:alice ');
  });
});

describe('buildQuery', () => {
  it('passes search strings as variables, one aliased search per login', () => {
    const { query, variables } = buildQuery(['alice', 'bob-2'], 'user:acme', false);
    expect(query).toContain('query($q0: String!, $q1: String!)');
    expect(query).toContain('p0: search(type: ISSUE, first: 5, query: $q0)');
    expect(query).not.toContain('alice');
    expect(variables.q1).toContain('user-review-requested:bob-2');
  });

  it('adds the current PR snapshot when asked', () => {
    const { query, variables } = buildQuery(['alice'], 'user:acme', false, { owner: 'acme', repo: 'web', number: 7 });
    expect(query).toContain('pr: repository(owner: $owner, name: $repo)');
    expect(variables).toMatchObject({ owner: 'acme', repo: 'web', number: 7 });
  });

  it('builds a snapshot-only query with no logins', () => {
    const { query } = buildQuery([], 'user:acme', false, { owner: 'acme', repo: 'web', number: 7 });
    expect(query).not.toContain('search(');
  });

  it('refuses logins that could alter the search', () => {
    expect(() => buildQuery(['alice org:other'], 'user:acme', false)).toThrow();
    expect(() => buildQuery(['dependabot[bot]'], 'user:acme', false)).toThrow();
  });
});

describe('parseResponse', () => {
  const pr = (n: number) => ({
    title: `PR ${n}`,
    url: `https://github.com/acme/web/pull/${n}`,
    createdAt: '2026-10-01T00:00:00Z',
    repository: { nameWithOwner: 'acme/web' },
  });

  it('maps aliases back to logins and keeps PRs in order', () => {
    const { loads } = parseResponse(
      ['alice', 'bob'],
      { p0: { issueCount: 7, nodes: [pr(1), pr(2)] }, p1: { issueCount: 0, nodes: [] } },
      1000,
    );
    expect(loads.get('alice')).toEqual({
      count: 7,
      fetchedAt: 1000,
      prs: [
        {
          title: 'PR 1',
          url: 'https://github.com/acme/web/pull/1',
          repo: 'acme/web',
          createdAt: '2026-10-01T00:00:00Z',
        },
        {
          title: 'PR 2',
          url: 'https://github.com/acme/web/pull/2',
          repo: 'acme/web',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
    });
    expect(loads.get('bob')?.count).toBe(0);
  });

  it('skips logins whose search errored (null) and empty nodes', () => {
    const { loads } = parseResponse(['alice', 'bob'], { p0: null, p1: { issueCount: 1, nodes: [null] } }, 0);
    expect(loads.has('alice')).toBe(false);
    expect(loads.get('bob')).toMatchObject({ count: 1, prs: [] });
  });

  it('reads direct user requests from the PR snapshot, ignoring teams', () => {
    const { snapshot } = parseResponse(
      [],
      {
        pr: {
          pullRequest: {
            state: 'OPEN',
            isDraft: false,
            reviewRequests: {
              nodes: [
                { requestedReviewer: { __typename: 'User', login: 'alice' } },
                { requestedReviewer: { __typename: 'Team' } },
                { requestedReviewer: null },
              ],
            },
          },
        },
      },
      0,
    );
    expect(snapshot).toEqual({ countable: true, requested: ['alice'] });
  });

  it('marks drafts and closed PRs as not counted', () => {
    const snap = (state: string, isDraft: boolean) =>
      parseResponse([], { pr: { pullRequest: { state, isDraft, reviewRequests: { nodes: [] } } } }, 0).snapshot;
    expect(snap('OPEN', true)?.countable).toBe(false);
    expect(snap('MERGED', false)?.countable).toBe(false);
  });
});

describe('displayCount', () => {
  const snapshot = { countable: true, requested: ['Alice'] };

  it('excludes the current PR for people requested on it', () => {
    expect(displayCount('alice', { count: 3 }, snapshot)).toBe(2);
    expect(displayCount('bob', { count: 3 }, snapshot)).toBe(3);
  });

  it('never goes below zero while search indexing catches up', () => {
    expect(displayCount('alice', { count: 0 }, snapshot)).toBe(0);
  });

  it('does not subtract on drafts or without a snapshot', () => {
    expect(displayCount('alice', { count: 3 }, { ...snapshot, countable: false })).toBe(3);
    expect(displayCount('alice', { count: 3 }, undefined)).toBe(3);
  });
});

it('chunk splits into fixed-size batches', () => {
  expect(chunk([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([
    [1, 2, 3, 4, 5],
    [6, 7],
  ]);
  expect(chunk([], 5)).toEqual([]);
});
