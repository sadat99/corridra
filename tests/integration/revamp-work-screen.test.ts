import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  contentLang,
  parseWorkFilter,
  workCounts,
  workFilters,
  workState,
  workStatusWords,
} from '../../apps/web/lib/work-items/view';
import type { WorkItem, WorkList } from '../../apps/web/lib/work-items/types';

// Revamp Wave 2, spec docs/revamp/specs/home-work.md: the Work list inside /account?view=work.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));
// The filter bar changes the address, so it asks for the router; a static render has none.
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const W = '11111111-1111-4111-8111-111111111111';

const item = (n: number, extra: Partial<WorkItem> = {}): WorkItem => ({
  key: `draft:${id(n)}`,
  kind: 'draft',
  id: id(n),
  workspaceId: W,
  family: 'SELL',
  title: `Draft ${n}`,
  status: 'OPEN',
  at: '2026-11-04T10:00:00.000Z',
  atKind: 'updated',
  href: `/account/drafts/${W}`,
  ...extra,
});
const list = (items: WorkItem[], extra: Partial<WorkList> = {}): WorkList => ({
  items,
  unreadable: [],
  partial: false,
  skippedWorkspaces: 0,
  workspaces: [{ id: W, name: 'Atelier Rahman' }],
  ...extra,
});
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const view = async (data: WorkList, filter: (typeof workFilters)[number] = 'all') => {
  const { WorkListView } = await loadWeb('app/account/work-list');
  return render(createElement(WorkListView, { list: data, filter }));
};

describe('H-01 navigation is untouched', () => {
  it('keeps the tab labels and order in both modes', () => {
    const nav = read('apps/web/components/customer-nav.tsx');
    const labels = [...nav.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Home',
      'Home',
      'Requests',
      'Companies',
      'Reports',
      'Account',
      'Home',
      'Requests',
      'Companies',
      'Reports',
      'Account',
    ]);
  });
});

describe('H-02 the existing Work panels are all still there', () => {
  const page = read('apps/web/app/account/page.tsx');
  it.each([
    'id="my-work"',
    'id="customer-workspaces"',
    'id="customer-requests"',
    '<CustomerWorkspaces',
    '<CustomerRequests',
    'href="/account/profile"',
    'href="/account/delegations/organise"',
    'href="/account/service-requests"',
    'href="/account/billing"',
    'href="/account/delegations"',
    'Delegation registrations',
    'aria-label="Manage your work"',
  ])('keeps %s', (needle) => {
    expect(page).toContain(needle);
  });
  it('puts the new list first inside the Work view, only when workspaces are on', () => {
    const work = page.slice(page.indexOf('id="my-work"'));
    expect(work.indexOf('<WorkList')).toBeGreaterThan(0);
    expect(work.indexOf('<WorkList')).toBeLessThan(work.indexOf('aria-label="Manage your work"'));
    expect(work).toMatch(/workspaceIssuer && \(\s*<Suspense/);
  });
  it('H-04 loading and signed-out screens are the existing ones', () => {
    expect(page).toContain('<p role="status">Loading your work…</p>');
    expect(page).toContain('Verify your email.');
    expect(page).toContain("redirect('/signin')");
  });
});

describe('H-04 each state says its own words', () => {
  const emptyWords = 'You have no work here yet.';
  const unreadableWords =
    'We could not check everything just now. Something may be waiting for you that this page could not read. Your work is safe.';

  it('true empty says so and offers the three starts', async () => {
    const html = await view(list([]));
    expect(html).toContain(emptyWords);
    expect(html).not.toContain('could not check');
    expect(html).not.toContain('type="radio"');
    expect(html).toContain('href="/plan?job=buyers"');
  });

  it('unreadable with nothing listed never shows the empty words', async () => {
    const html = await view(list([], { unreadable: ['drafts'] }));
    expect(html).toContain(unreadableWords);
    expect(html).toContain('Try again');
    expect(html).not.toContain(emptyWords);
  });

  it('a cut-off or skipped list with nothing shown is not called empty either', async () => {
    for (const extra of [{ partial: true }, { skippedWorkspaces: 2 }]) {
      const html = await view(list([], extra));
      expect(html).not.toContain(emptyWords);
      expect(html).toContain('could not check everything');
    }
  });

  it('filtered empty names the family and links back to All', async () => {
    const html = await view(list([item(1)]), 'source');
    expect(html).toContain('No Source work.');
    expect(html).toContain('href="/account?view=work"');
    expect(html).toContain('Show all');
  });

  it('partial shows the list and one note, with the right action', async () => {
    const failed = await view(list([item(1)], { unreadable: ['services'] }));
    expect(failed).toContain('Draft 1');
    expect(failed).toContain('role="note"');
    expect(failed).toContain('This list may not show everything.');
    expect(failed).toContain('Try again');
    const skipped = await view(list([item(1)], { skippedWorkspaces: 1 }));
    expect(skipped).toContain('Open your workspaces');
    expect(skipped).toContain('href="#customer-workspaces"');
    const whole = await view(list([item(1)]));
    expect(whole).not.toContain('may not show everything');
  });

  it('classifies the five states from the data alone', () => {
    expect(workState(list([]), 'all')).toBe('empty');
    expect(workState(list([], { unreadable: ['drafts'] }), 'all')).toBe('unreadable');
    expect(workState(list([item(1)]), 'source')).toBe('filtered-empty');
    expect(workState(list([item(1)]), 'sell')).toBe('list');
  });
});

describe('H-05 the work filter', () => {
  it('accepts only the five values', () => {
    for (const value of workFilters) expect(parseWorkFilter(value)).toBe(value);
    for (const bad of [undefined, '', 'SELL', 'sell ', '<script>alert(1)</script>', '__proto__'])
      expect(parseWorkFilter(bad)).toBe('all');
    expect(parseWorkFilter(['sell', 'source'])).toBe('all');
  });
  it('never puts the raw value on the page', async () => {
    const html = await view(list([item(1)]), parseWorkFilter('"><script>alert(1)</script>'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('value="all"');
    // The live filter and its no-script copy each mark the chosen segment once.
    expect(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').match(/checked=""/g)).toHaveLength(
      1,
    );
  });
});

describe('H-06 counts', () => {
  const items = [
    item(1),
    item(2, { family: 'SOURCE' }),
    item(3, { family: 'SOURCE' }),
    item(4, { family: 'ORGANISE' }),
    item(5, { family: 'UNCLASSIFIED' }),
  ];
  it('are plain numbers for a whole list', () => {
    expect(workCounts(list(items))).toEqual({
      all: '5',
      sell: '1',
      source: '2',
      organise: '1',
      other: '1',
    });
  });
  it.each([
    ['partial', { partial: true }],
    ['unreadable', { unreadable: ['requests' as const] }],
    ['skipped', { skippedWorkspaces: 1 }],
  ])('read "N or more" when the list is %s', async (_name, extra) => {
    const counts = workCounts(list(items, extra));
    expect(Object.values(counts).every((c) => c.endsWith(' or more'))).toBe(true);
    expect(await view(list(items, extra))).toContain('Source <span class="work-count">2 or more');
  });
});

describe('rows', () => {
  it('show stored text, the existing status words, the workspace and a plain date', async () => {
    const html = await view(
      list([
        item(1, { title: '广州家具采购', at: '2026-11-04T10:00:00.000Z' }),
        item(5, { title: 'কারখানা পরিদর্শন' }),
        item(2, {
          kind: 'service_request',
          key: 'service_request:x',
          id: 'x',
          title: 'Quote check',
          status: 'quoted',
          href: `/account/service-requests/${W}/x`,
        }),
        item(3, {
          kind: 'request',
          key: 'request:r',
          id: 'r',
          title: null,
          status: 'ACTIVE',
          atKind: 'created',
        }),
        item(4, {
          kind: 'programme',
          key: 'programme:p',
          id: 'p',
          title: 'Dhaka visit',
          status: '',
          atKind: 'created',
        }),
      ]),
    );
    expect(html).toContain('lang="zh"');
    expect(html).toContain('lang="bn"');
    expect(html).toContain('কারখানা পরিদর্শন');
    expect(html).toContain('广州家具采购');
    expect(html).toContain('Atelier Rahman');
    expect(html).toContain('Quote ready for you');
    expect(html).toContain('Updated 4 Nov 2026');
    expect(html).toContain('Sent 4 Nov 2026');
    expect(html).toContain('Created 4 Nov 2026');
    // A request has no stored title, so its kind word is the heading and nothing is invented.
    expect(html).toContain('<span class="ux-row-title" dir="auto">Request</span>');
    // Each row is one link, which takes the place of the old Open link.
    expect(html.match(/<li class="ux-row"/g)).toHaveLength(5);
    expect(html.match(/work-open/g)).toBeNull();
  });
  it('use no status word that does not already exist', () => {
    expect(workStatusWords(item(1))).toBe('Draft');
    expect(workStatusWords(item(2, { kind: 'programme', status: '' }))).toBe('');
    expect(workStatusWords(item(3, { kind: 'request', status: 'CLOSED' }))).toBe('Finished');
  });
  it('show ten rows and one button for more', async () => {
    const html = await view(list(Array.from({ length: 25 }, (_, n) => item(n + 1))));
    expect(html.match(/<li class="ux-row"/g)).toHaveLength(10);
    expect(html).toContain('Show 10 more');
    const small = await view(list([item(1)]));
    expect(small).not.toContain('work-more');
  });
  it('H-08 the starts go only to the existing plan addresses', async () => {
    const html = await view(list([]));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/plan?job=buyers', '/plan?job=sourcing', '/plan?job=delegations']);
  });
});

describe('language marks for stored text', () => {
  it('marks Chinese text lang zh in a title and in a workspace name', async () => {
    expect(contentLang('广州家具采购')).toBe('zh');
    const html = await view(
      list([item(1, { title: '广州家具采购' })], { workspaces: [{ id: W, name: '广州工厂' }] }),
    );
    expect(html).toContain('<span class="ux-row-title" dir="auto" lang="zh">广州家具采购</span>');
    expect(html).toContain('lang="zh">广州工厂</span>');
  });
  it('marks Bangla text lang bn in a title and in a workspace name', async () => {
    expect(contentLang('কারখানা পরিদর্শন')).toBe('bn');
    const html = await view(
      list([item(1, { title: 'কারখানা পরিদর্শন' })], {
        workspaces: [{ id: W, name: 'ঢাকা নিটওয়্যার' }],
      }),
    );
    expect(html).toContain(
      '<span class="ux-row-title" dir="auto" lang="bn">কারখানা পরিদর্শন</span>',
    );
    expect(html).toContain('lang="bn">ঢাকা নিটওয়্যার</span>');
  });
  it('leaves English text unmarked', () => {
    expect(contentLang('Sourcing request 1')).toBeUndefined();
    expect(contentLang('')).toBeUndefined();
  });
});
