import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildQueue,
  discoverRoutes,
  expectation,
  fillRoute,
  harvestLinks,
  routeArea,
  stateRoutes,
  sweepRoles,
  sweepWidthOrder,
  sweepWidths,
  tabRoute,
} from '../../scripts/qa/sweep-routes';
import { screenLimitFor, targetsBroken, type PageMeasure } from '../../scripts/qa/ux-measure';

// The signed-in sweep (scripts/qa/signed-in-sweep.ts) opens every page for every role. These cases prove the page
// inventory is complete and that no page is left without a stated access rule. No database is used.
const routes = discoverRoutes(join(process.cwd(), 'apps/web/app'));

describe('signed-in sweep route inventory', () => {
  test('finds the real pages and no API routes', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes).toContain('/account');
    expect(routes).toContain('/operator/[section]/[missionId]');
    expect(routes.some((route) => route.startsWith('/api'))).toBe(false);
  });

  test('every page belongs to exactly one access area', () => {
    for (const route of routes)
      expect(['public', 'customer', 'staff', 'staff-entry'], route).toContain(routeArea(route));
    expect(routes.filter((route) => routeArea(route) === 'customer').length).toBeGreaterThan(15);
    expect(routes.filter((route) => routeArea(route) === 'staff').length).toBeGreaterThan(5);
  });

  test('staff sign-in pages stay open to everyone and the rest of /operator is staff only', () => {
    expect(routeArea('/operator/signin')).toBe('staff-entry');
    expect(routeArea('/operator/setup')).toBe('staff-entry');
    expect(routeArea('/operator/owner')).toBe('staff');
    expect(routeArea('/operator/problem-reports/new')).toBe('staff');
    expect(routeArea('/operator')).toBe('staff');
  });

  test('a customer role never opens a staff page and staff never open a customer page', () => {
    for (const role of sweepRoles) {
      expect(expectation(role, '/'), role).toBe('content');
      expect(expectation(role, '/operator/signin'), role).toBe('content');
      expect(expectation(role, '/operator/owner'), role).toBe(
        role === 'staff' ? 'content' : 'gated',
      );
      expect(expectation(role, '/account/billing'), role).toBe(
        role === 'staff' ? 'gated' : 'content',
      );
    }
  });

  test('parameters are filled from known ids and a missing id is reported, not guessed', () => {
    expect(fillRoute('/account/billing/[workspaceId]', { workspaceId: 'abc' })).toBe(
      '/account/billing/abc',
    );
    expect(fillRoute('/account/billing/[workspaceId]', {})).toBeNull();
    expect(fillRoute('/account', {})).toBe('/account');
  });
});

describe('signed-in sweep coverage', () => {
  test('harvests links at any width, keeps query links and leaves anchors and other areas out', () => {
    expect(
      harvestLinks([
        '/account/delegations/w1?programme=p1',
        '/account/delegations/w1?programme=p1',
        '/account#customer-workspaces',
        '/operator',
        '/pricing',
        'https://example.com/account',
        null,
        undefined,
      ]),
    ).toEqual(['/account/delegations/w1?programme=p1', '/operator']);
  });

  test('reaches the programme room and the open draft by their query pages, and skips what has no id', () => {
    expect(stateRoutes({ workspaceId: 'w1', programmeId: 'p1', draftId: 'd1' })).toEqual([
      '/account/delegations/w1?programme=p1',
      '/account/drafts/w1?draft=d1',
    ]);
    expect(stateRoutes({ workspaceId: 'w1', programmeId: 'p1' })).toEqual([
      '/account/delegations/w1?programme=p1',
    ]);
    expect(stateRoutes({ programmeId: 'p1', draftId: 'd1' })).toEqual([]);
  });

  test('the widest width runs first and the queue lists each page once, harvested links last', () => {
    expect(sweepWidthOrder[0]).toBe(1440);
    expect([...sweepWidthOrder].sort()).toEqual([...sweepWidths].sort());
    expect(
      buildQueue({
        base: ['/account'],
        dynamic: ['/account/billing/w1'],
        state: ['/account/delegations/w1?programme=p1'],
        links: ['/account', '/account/meetings?tab=past'],
      }),
    ).toEqual([
      '/account',
      '/account/billing/w1',
      '/account/delegations/w1?programme=p1',
      '/account/meetings?tab=past',
    ]);
    expect(tabRoute('/account/x', 'Terms')).toBe('/account/x [tab: Terms]');
  });
});

const measured = (over: Partial<PageMeasure>): PageMeasure => ({
  path: '/account',
  width: 1440,
  status: 200,
  screens: 1,
  forms: 0,
  openForms: 0,
  inputs: 0,
  buttons: 0,
  smallTargets: 0,
  horizontalScroll: false,
  forbidden: [],
  isoDates: [],
  usDates: [],
  rawIdFields: [],
  h1: 1,
  title: 'x',
  ...over,
});

describe('signed-in page length limits', () => {
  test('desktop is limited to 1 screen and a phone to 2, and only signed-in pages are judged', () => {
    expect(screenLimitFor(1440)).toBe(1);
    expect(screenLimitFor(1024)).toBe(1);
    expect(screenLimitFor(768)).toBeNull();
    expect(screenLimitFor(390)).toBe(2);
    expect(targetsBroken(measured({ screens: 1 }), { signedIn: true })).toEqual([]);
    expect(targetsBroken(measured({ screens: 1.4 }), { signedIn: true })).toEqual([
      'page length 1.4 screens, over the 1 screen limit at 1440',
    ]);
    expect(targetsBroken(measured({ width: 390, screens: 2 }), { signedIn: true })).toEqual([]);
    expect(targetsBroken(measured({ width: 390, screens: 2.6 }), { signedIn: true })).toEqual([
      'page length 2.6 screens, over the 2 screen limit at 390',
    ]);
    expect(targetsBroken(measured({ width: 768, screens: 5 }), { signedIn: true })).toEqual([]);
    expect(targetsBroken(measured({ screens: 6 }))).toEqual([]);
  });

  test('sideways scroll, forbidden words, extra h1 and several open forms are still reported', () => {
    expect(
      targetsBroken(
        measured({ horizontalScroll: true, forbidden: ['/test mode/i'], h1: 2, openForms: 2 }),
        { signedIn: true },
      ),
    ).toEqual([
      'horizontal scroll',
      'forbidden words: /test mode/i',
      '2 forms open at once',
      '2 h1 headings',
    ]);
  });
});
