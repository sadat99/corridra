import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  discoverRoutes,
  expectation,
  fillRoute,
  routeArea,
  sweepRoles,
} from '../../scripts/qa/sweep-routes';

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
