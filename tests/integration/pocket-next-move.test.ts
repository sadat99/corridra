import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { countText, nextMove, type PocketSignals } from '../../apps/web/lib/ux/next-move';
import { pocketHiddenOn } from '../../apps/web/lib/ux/pocket-pages';
import { pocketSignalsOf, quotesListHref } from '../../apps/web/lib/work-items/pocket-signals';
import { journeyCountsOf } from '../../apps/web/lib/work-items/journey-counts';
import { filterWorkItems } from '../../apps/web/lib/work-items/view';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import type { WorkItem, WorkList } from '../../apps/web/lib/work-items/types';

// Pocket (phone), Step 1: the Next Move rules. Pure functions, so every rule is tested without a database or a browser.
const none: PocketSignals = {
  quotes: { count: 0, href: null },
  drafts: { count: 0, href: null },
  partial: false,
  hasWorkspace: true,
};
const signals = (over: Partial<PocketSignals>): PocketSignals => ({ ...none, ...over });

describe('Next Move order: first rule that fits wins', () => {
  it('starts a new request when nothing waits', () => {
    const move = nextMove(none);
    expect(move.key).toBe('new');
    expect(move.label).toBe('New Request');
    expect(move.href).toBe('/account?view=work#customer-workspaces');
    expect(move.badge).toBeNull();
    expect(move.reason).toMatch(/nothing is waiting/i);
  });

  it('is New Request, and the plan page for a person with no workspace, when the signals could not be read', () => {
    expect(nextMove(null)).toMatchObject({ key: 'new', href: '/plan' });
    expect(nextMove(signals({ hasWorkspace: false }))).toMatchObject({ key: 'new', href: '/plan' });
  });

  it('puts a half done draft before a new request', () => {
    const move = nextMove(signals({ drafts: { count: 1, href: '/account/drafts/w1?draft=d1' } }));
    expect(move).toMatchObject({
      key: 'draft',
      label: 'Finish Your Draft',
      href: '/account/drafts/w1?draft=d1',
      badge: null,
    });
  });

  it('puts a quote waiting for an answer before a draft (tie: both waiting, the decision wins)', () => {
    const move = nextMove(
      signals({
        quotes: { count: 2, href: quotesListHref },
        drafts: { count: 3, href: '/account/drafts/w1?draft=d1' },
      }),
    );
    expect(move.key).toBe('quotes');
    expect(move.label).toBe('Review 2 Quotes');
    expect(move.href).toBe(quotesListHref);
  });

  it('says Quote for one and opens it directly', () => {
    const move = nextMove(signals({ quotes: { count: 1, href: '/account/service-requests/w/r' } }));
    expect(move.label).toBe('Review 1 Quote');
    expect(move.href).toBe('/account/service-requests/w/r');
    expect(move.reason).toBe('A quote is ready for your answer.');
  });
});

describe('counts shown are honest', () => {
  it('never draws a zero', () => {
    expect(countText(0, false)).toBe('');
    expect(countText(0, true)).toBe('');
    expect(countText(-1, false)).toBe('');
    expect(countText(Number.NaN, false)).toBe('');
    // A count of zero with a href is not a move: the rule does not fit.
    expect(nextMove(signals({ quotes: { count: 0, href: '/x' } })).key).toBe('new');
    expect(nextMove(signals({ drafts: { count: 0, href: '/x' } })).key).toBe('new');
  });

  it('draws N+ when the list may be longer', () => {
    expect(countText(3, true)).toBe('3+');
    expect(
      nextMove(signals({ quotes: { count: 3, href: quotesListHref }, partial: true })).label,
    ).toBe('Review 3+ Quotes');
    const draft = nextMove(
      signals({ drafts: { count: 1, href: '/account/drafts/w1' }, partial: true }),
    );
    expect(draft.badge).toBe('1+');
  });

  it('shows a draft count only when there is more than one', () => {
    expect(nextMove(signals({ drafts: { count: 4, href: '/d' } })).badge).toBe('4');
    expect(nextMove(signals({ drafts: { count: 1, href: '/d' } })).badge).toBeNull();
  });

  it('drops a rule whose signal is unavailable instead of drawing it', () => {
    // A count with no destination is unavailable: it cannot be a move.
    expect(nextMove(signals({ quotes: { count: 2, href: null } })).key).toBe('new');
    expect(nextMove(signals({ drafts: { count: 2, href: null } })).key).toBe('new');
    expect(
      nextMove(signals({ quotes: { count: 2, href: null }, drafts: { count: 1, href: '/d' } })).key,
    ).toBe('draft');
  });

  it('writes every label as a Title Case action, with no em dash', () => {
    const labels = [
      nextMove(none).label,
      nextMove(signals({ drafts: { count: 1, href: '/d' } })).label,
      nextMove(signals({ quotes: { count: 1, href: '/q' } })).label,
      nextMove(signals({ quotes: { count: 5, href: '/q' }, partial: true })).label,
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/[—–]/);
      for (const word of label.split(' '))
        expect(word[0], `${label}: ${word}`).toBe(word[0]!.toUpperCase());
    }
    for (const move of [nextMove(none), nextMove(signals({ drafts: { count: 1, href: '/d' } }))])
      expect(move.reason).not.toMatch(/[—–]/);
  });
});

const item = (over: Partial<WorkItem> & Pick<WorkItem, 'key' | 'kind'>): WorkItem => ({
  id: over.key.split(':')[1] ?? 'x',
  workspaceId: 'w1',
  family: 'SELL',
  title: null,
  status: '',
  at: '2026-11-10T10:00:00.000Z',
  atKind: 'updated',
  href: `/${over.key.replace(':', '/')}`,
  ...over,
});
const list = (items: WorkItem[], over: Partial<WorkList> = {}): WorkList => ({
  items,
  unreadable: [],
  partial: false,
  skippedWorkspaces: 0,
  workspaces: [{ id: 'w1', name: 'Workspace' }],
  ...over,
});

describe('the signals come from the list the sidebar already reads', () => {
  it('counts quoted service requests and open drafts, newest draft first', () => {
    const read = pocketSignalsOf(
      list([
        item({ key: 'draft:d2', kind: 'draft', status: 'OPEN', at: '2026-11-12T10:00:00.000Z' }),
        item({ key: 'draft:d1', kind: 'draft', status: 'OPEN', at: '2026-11-01T10:00:00.000Z' }),
        item({ key: 'service_request:s1', kind: 'service_request', status: 'quoted' }),
        item({ key: 'service_request:s2', kind: 'service_request', status: 'requested' }),
        item({ key: 'service_request:s3', kind: 'service_request', status: 'accepted' }),
        item({ key: 'request:r1', kind: 'request', status: 'quoted' }),
        item({ key: 'programme:p1', kind: 'programme' }),
      ]),
    );
    expect(read.quotes).toEqual({ count: 1, href: '/service_request/s1' });
    expect(read.drafts).toEqual({ count: 2, href: '/draft/d2' });
    expect(read.partial).toBe(false);
    expect(read.hasWorkspace).toBe(true);
  });

  it('opens the list when more than one quote waits, and nothing when none does', () => {
    const two = pocketSignalsOf(
      list([
        item({ key: 'service_request:s1', kind: 'service_request', status: 'quoted' }),
        item({ key: 'service_request:s2', kind: 'service_request', status: 'quoted' }),
      ]),
    );
    expect(two.quotes).toEqual({ count: 2, href: quotesListHref });
    expect(pocketSignalsOf(list([])).quotes).toEqual({ count: 0, href: null });
  });

  it('uses the same incomplete rule as the sidebar counts and the Requests page', () => {
    const items = [item({ key: 'draft:d1', kind: 'draft', status: 'OPEN' })];
    for (const over of [
      { partial: true },
      { unreadable: ['drafts' as const] },
      { skippedWorkspaces: 2 },
    ])
      expect(pocketSignalsOf(list(items, over)).partial).toBe(true);
    expect(pocketSignalsOf(list(items)).partial).toBe(false);
    // The sidebar's journey counts use the same list, so the draft the button counts is a row the Requests page lists.
    const all = list(items);
    expect(journeyCountsOf(all).sell.partial).toBe(pocketSignalsOf(all).partial);
    expect(filterWorkItems(all.items, 'all').filter((i) => i.kind === 'draft').length).toBe(
      pocketSignalsOf(all).drafts.count,
    );
  });

  it('reports a person with no workspace, who is sent to the plan page', () => {
    const read = pocketSignalsOf(list([], { workspaces: [] }));
    expect(read.hasWorkspace).toBe(false);
    expect(nextMove(read).href).toBe('/plan');
  });
});

describe('where the button is not drawn', () => {
  it('hides on form steps and pages with their own bottom action', () => {
    for (const path of [
      '/account/request/00000000-0000-4000-8000-000000000001',
      '/account/drafts/00000000-0000-4000-8000-000000000001',
      '/account/service-requests/new',
      '/account/problem-reports/new',
      '/account/profile/00000000-0000-4000-8000-000000000001',
      '/account/billing/00000000-0000-4000-8000-000000000001',
      '/account/delegations/00000000-0000-4000-8000-000000000001',
      '/plan',
    ])
      expect(pocketHiddenOn(path), path).toBe(true);
  });

  it('keeps the button on the pages people move between', () => {
    for (const path of [
      '/account',
      '/account/move',
      '/account/meetings',
      '/account/companies',
      '/account/requests/00000000-0000-4000-8000-000000000001',
      '/account/rooms/00000000-0000-4000-8000-000000000001',
      '/account/service-requests',
      '/account/delegations',
      '/account/delegations/organise',
      '/account/notifications',
      '/account/profile',
      '/account/billing',
    ])
      expect(pocketHiddenOn(path), path).toBe(false);
    expect(pocketHiddenOn(null)).toBe(false);
  });
});

describe('the read', () => {
  it('shares the Requests page read and never delays the first paint', () => {
    const server = readFileSync('apps/web/lib/work-items/journey-counts-server.ts', 'utf8');
    // The same loader and the same switch as the sidebar counts and the pages, so one render makes one read.
    expect(server).toMatch(
      /readPocketSignals[\s\S]*loadWorkItems\(identity\.subject, identity\.issuer, \{\s*rooms: uxSwitchOn\('CORRIDRA_UX_ROAD'\)/,
    );
    expect(readFileSync('apps/web/lib/work-items/load.ts', 'utf8')).toMatch(
      /const loadOnce = cache\(/,
    );
    const shell = readFileSync('apps/web/components/customer-shell.tsx', 'utf8');
    // A promise the button reads in the browser: the frame never awaits it, so the button is drawn at once.
    expect(shell).toContain('signals={readPocketSignals()}');
    expect(shell).not.toMatch(/await readPocketSignals/);
    // It is read only when the switch is on.
    expect(shell).toMatch(/uxSwitchOn\('CORRIDRA_UX_POCKET'\) \? \(\s*<PocketButton/);
  });

  it('adds no request of its own in the browser: it reads the shell promise and nothing else', () => {
    const button = readFileSync('apps/web/components/ux/pocket-button.tsx', 'utf8');
    expect(button).not.toMatch(/\bfetch\(/);
    expect(button).not.toMatch(/useWorkspaces/);
  });
});

describe('the switch', () => {
  it('is read on the server, off unless exactly true, and described in plain language', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_POCKET');
    expect(uxSwitchOn('CORRIDRA_UX_POCKET', {})).toBe(false);
    for (const value of ['', 'TRUE', '1', 'yes', 'false', ' true'])
      expect(uxSwitchOn('CORRIDRA_UX_POCKET', { CORRIDRA_UX_POCKET: value }), value).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_POCKET', { CORRIDRA_UX_POCKET: 'true' })).toBe(true);
    const entry = switchRegistry.find((s) => s.name === 'CORRIDRA_UX_POCKET');
    expect(entry?.kind).toBe('flag');
    expect(entry?.label).toBeTruthy();
    expect(entry?.line).not.toMatch(/[—–]/);
    expect(entry?.line.length).toBeGreaterThan(40);
  });

  it('gates the shell button and the header title, and is off by default in the sweep list', () => {
    const shell = readFileSync('apps/web/components/customer-shell.tsx', 'utf8');
    expect(shell).toMatch(/uxSwitchOn\('CORRIDRA_UX_POCKET'\)\s*\?/);
    const layout = readFileSync('apps/web/app/layout.tsx', 'utf8');
    expect(layout).toMatch(/uxSwitchOn\('CORRIDRA_UX_POCKET'\)/);
    expect(readFileSync('scripts/qa/signed-in-sweep.ts', 'utf8')).toContain("'CORRIDRA_UX_POCKET'");
  });
});
