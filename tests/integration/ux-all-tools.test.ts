import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  excludedPages,
  toolGroups,
  tools,
  toolsFor,
  type ToolModules,
} from '../../apps/web/lib/all-tools';

// All tools (Lane 4 of the UX update): the list that makes sure the shorter navigation hides nothing.
// A customer page that is neither listed nor excluded with a written reason fails this file.
const app = resolve('apps/web/app');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}
const routeOf = (file: string) => {
  const route = '/' + relative(app, file).replace(/\/?page\.tsx$/, '');
  return route === '/' ? '/' : route.replace(/\/$/, '');
};
const accountRoutes = pages(join(app, 'account')).map(routeOf).sort();

const allOn: ToolModules = {
  move: true,
  serviceRequests: true,
  participants: true,
  programmes: true,
  companies: true,
  profiles: true,
  billing: true,
  notifications: true,
};
const allOff = Object.fromEntries(Object.keys(allOn).map((k) => [k, false])) as ToolModules;

describe('every customer page is listed or excluded with a reason', () => {
  const listed = new Set(tools.filter((t) => t.route.startsWith('/account')).map((t) => t.route));
  const excluded = new Map(excludedPages.map((e) => [e.route, e.why]));

  it('finds the customer pages on disk', () => {
    expect(accountRoutes.length).toBeGreaterThanOrEqual(18);
    expect(accountRoutes).toContain('/account');
    expect(accountRoutes).toContain('/account/move');
  });

  it.each(accountRoutes)('%s is listed or excluded', (route) => {
    const home = route === '/account';
    expect(listed.has(route) || excluded.has(route) || home, `${route} has no entry`).toBe(true);
  });

  it('has no stale entry: every listed or excluded account page exists', () => {
    for (const route of listed) expect(accountRoutes, route).toContain(route);
    for (const [route] of excluded)
      if (route.startsWith('/account')) expect(accountRoutes, route).toContain(route);
  });

  it('every exclusion has a written reason, and a page is never both listed and excluded', () => {
    for (const { route, why } of excludedPages) {
      expect(why.length, route).toBeGreaterThan(20);
      expect(why, route).not.toMatch(/[—–]| - /);
      expect(listed.has(route), route).toBe(false);
    }
  });

  it('the pages for people who arrive by a private link are excluded and really exist', () => {
    const all = pages(app).map(routeOf);
    for (const route of ['/client', '/programme', '/buyer', '/mute/[requestId]']) {
      expect(excluded.has(route), route).toBe(true);
      expect(all, route).toContain(route);
    }
  });

  it('every non-account link points at a page that exists', () => {
    const all = pages(app).map(routeOf);
    for (const tool of tools) expect(all, tool.href).toContain(tool.route);
  });
});

describe('the list itself', () => {
  it('gives every tool a plain verb, a line and a known group, with no dash punctuation', () => {
    for (const tool of tools) {
      expect(toolGroups, tool.href).toContain(tool.group);
      expect(tool.label.length, tool.href).toBeGreaterThan(8);
      expect(tool.line.length, tool.href).toBeGreaterThan(12);
      expect(tool.label + tool.line, tool.href).not.toMatch(/[—–]| - /);
    }
  });

  it('never lists the same link twice', () => {
    const hrefs = tools.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('hides a tool whose module is off, and shows billing only when its switch is on', () => {
    const none = toolsFor(allOff).map((t) => t.href);
    expect(none).not.toContain('/account/billing');
    expect(none).not.toContain('/account/companies');
    expect(none).not.toContain('/account/move');
    expect(none).toContain('/account?view=work');
    expect(none).toContain('/plan');
    expect(toolsFor({ ...allOff, billing: true }).map((t) => t.href)).toContain('/account/billing');
    expect(toolsFor(allOn)).toHaveLength(tools.length);
  });

  it('keeps every original view reachable: work, results and more', () => {
    const hrefs = toolsFor(allOff).map((t) => t.href);
    for (const view of ['work', 'results', 'more'])
      expect(hrefs).toContain(`/account?view=${view}`);
  });
});

describe('the page', () => {
  const source = readFileSync(join(app, 'account/all-tools/page.tsx'), 'utf8');
  it('does not exist unless the navigation switch is on, and asks for a verified sign-in', () => {
    expect(source).toContain("uxSwitchOn('CORRIDRA_UX_NAV')");
    expect(source).toMatch(/notFound\(\)/);
    expect(source).toContain('customerPageSession');
  });
});
