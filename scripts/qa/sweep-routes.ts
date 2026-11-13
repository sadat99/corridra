import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Route inventory and role access rules for the signed-in sweep (scripts/qa/signed-in-sweep.ts).
// Pure and database-free, so a test can prove that every page in apps/web/app is classified: a new page
// cannot be added without saying who may open it.

export const sweepWidths = [390, 768, 1440] as const;
export const sweepRoles = ['customer', 'organiser', 'participant', 'seller', 'staff'] as const;
export type SweepRole = (typeof sweepRoles)[number];
/** public: anyone. customer: needs a customer sign-in. staff: needs staff sign-in and authenticator. */
export type RouteArea = 'public' | 'customer' | 'staff' | 'staff-entry';
export type Expectation = 'content' | 'gated';

/** Every page.tsx under the app directory as a route such as /account/billing/[workspaceId]. */
export function discoverRoutes(appDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'api' && name !== 'node_modules') walk(path);
      } else if (name === 'page.tsx') {
        const route = dir
          .slice(appDir.length)
          .split(sep)
          .filter((part) => part && !/^\(.*\)$/.test(part))
          .join('/');
        found.push('/' + route);
      }
    }
  };
  walk(appDir);
  return found.sort();
}

/** Staff pages that anyone may open because they are the way in (sign-in, recovery, first setup). */
const staffEntry = new Set([
  '/operator/signin',
  '/operator/setup',
  '/operator/forgot-password',
  '/operator/reset-password',
]);

export function routeArea(route: string): RouteArea {
  if (staffEntry.has(route)) return 'staff-entry';
  if (route === '/operator' || route.startsWith('/operator/')) return 'staff';
  if (route === '/account' || route.startsWith('/account/')) return 'customer';
  return 'public';
}

export const isDynamic = (route: string) => route.includes('[');

/**
 * What a role should get at a route. A role sees its own area's content and every public page; it must
 * be turned away (sign-in prompt, redirect, 403 or 404) from the other sign-in area. Staff are not
 * customers: a staff sign-in alone does not open /account, and no customer role opens /operator.
 */
export function expectation(role: SweepRole, route: string): Expectation {
  const area = routeArea(route);
  if (area === 'public' || area === 'staff-entry') return 'content';
  if (area === 'staff') return role === 'staff' ? 'content' : 'gated';
  return role === 'staff' ? 'gated' : 'content';
}

/** Fills [param] segments from known ids. Returns null when an id is not known, so the page is reported as skipped. */
export function fillRoute(route: string, ids: Record<string, string | undefined>): string | null {
  let missing = false;
  const path = route.replace(/\[(\w+)\]/g, (_, name: string) => {
    const value = ids[name];
    if (!value) missing = true;
    return value ?? '';
  });
  return missing ? null : path;
}
