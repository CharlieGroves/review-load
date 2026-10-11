import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { findSlots, pageContext } from './page';
import { age, ensureHost, HOST_ATTR, level, renderPill } from './pill';
import { defaultSettings } from './types';

const fixture = readFileSync(resolve(__dirname, '../fixtures/pr-sidebar.html'), 'utf8');

describe('pageContext', () => {
  it('reads PR pages, including sub-tabs', () => {
    expect(pageContext('/acme/web/pull/42')).toEqual({ owner: 'acme', repo: 'web', pr: 42 });
    expect(pageContext('/acme/web/pull/42/files')).toEqual({ owner: 'acme', repo: 'web', pr: 42 });
  });

  it('reads the compare (new PR) page without a PR number', () => {
    expect(pageContext('/acme/web/compare/main...feature')).toEqual({ owner: 'acme', repo: 'web', pr: undefined });
  });

  it('ignores other pages', () => {
    expect(pageContext('/acme/web')).toBeUndefined();
    expect(pageContext('/acme/web/pulls')).toBeUndefined();
    expect(pageContext('/acme/web/issues/3')).toBeUndefined();
  });
});

describe('findSlots on the PR sidebar fixture', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it('finds people in the picker, including filtered-out rows, and skips teams', () => {
    const { picker } = findSlots(document);
    expect(picker.map((s) => s.login)).toEqual(['alice-example', 'bob-example', 'carol-example']);
    expect(picker.every((s) => s.anchor.classList.contains('js-username') && s.where === 'after')).toBe(true);
  });

  it('finds requested reviewers in the sidebar but not elsewhere on the page', () => {
    const { sidebar } = findSlots(document);
    expect(sidebar.map((s) => s.login)).toEqual(['bob-example']);
  });

  it('finds nothing when the reviewers block is missing', () => {
    document.body.innerHTML = '<div>no sidebar</div>';
    expect(findSlots(document)).toEqual({ picker: [], sidebar: [] });
  });
});

describe('pills', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it('injects one pill per slot no matter how often it runs', () => {
    for (let i = 0; i < 3; i++) {
      const { picker, sidebar } = findSlots(document);
      [...picker, ...sidebar].forEach(ensureHost);
    }
    const hosts = [...document.querySelectorAll(`[${HOST_ATTR}]`)].map((h) => h.getAttribute(HOST_ATTR));
    expect(hosts).toEqual(['alice-example', 'bob-example', 'carol-example', 'bob-example']);
  });

  it('survives GitHub replacing the sidebar', () => {
    const inject = () => {
      const { picker, sidebar } = findSlots(document);
      [...picker, ...sidebar].forEach(ensureHost);
    };
    inject();
    document.body.innerHTML = fixture;
    inject();
    expect(document.querySelectorAll(`[${HOST_ATTR}]`)).toHaveLength(4);
  });

  it('places the sidebar pill right after the reviewer link', () => {
    const { sidebar } = findSlots(document);
    const host = ensureHost(sidebar[0]!);
    expect(sidebar[0]!.anchor.nextElementSibling).toBe(host);
  });

  it('renders counts with colour, staleness and an accessible label', () => {
    const { picker } = findSlots(document);
    const host = ensureHost(picker[0]!);
    renderPill(host, { kind: 'count', n: 6, prs: [], stale: true, fetchedAt: 0, demo: false }, defaultSettings);
    const pill = host.shadowRoot!.querySelector('.pill')!;
    expect(pill.textContent).toBe('6');
    expect(pill.className).toBe('pill red stale');
    expect(pill.getAttribute('aria-label')).toBe('6 pending review requests');
  });

  it('shows ? when no token is set', () => {
    const host = ensureHost(findSlots(document).picker[0]!);
    renderPill(host, { kind: 'error', error: { kind: 'no-token' } }, defaultSettings);
    expect(host.shadowRoot!.querySelector('.pill')!.textContent).toBe('?');
  });
});

describe('level and age', () => {
  it('colours by thresholds', () => {
    expect([0, 2, 3, 5, 6, 20].map((n) => level(n, defaultSettings))).toEqual([
      'green',
      'green',
      'amber',
      'amber',
      'red',
      'red',
    ]);
  });

  it('formats ages compactly', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(age('2026-10-11T11:30:00Z', now)).toBe('30m');
    expect(age('2026-10-11T07:00:00Z', now)).toBe('5h');
    expect(age('2026-10-08T12:00:00Z', now)).toBe('3d');
  });
});
