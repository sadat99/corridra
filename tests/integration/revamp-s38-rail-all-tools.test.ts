import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Account settings tabs: All Tools has one home on a wide screen, the customer rail foot, and one row below the
// rail breakpoint on the Account page. The rail markup is unchanged when the link is off. Behaviour in a browser is
// tests/e2e/verification/revamp-s2/account-all-tools.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const rail = '../../apps/web/components/ux/customer-rail';
const icon = '../../apps/web/components/corridra-icon';
const href = 'https://wa.me/6500000000';

async function load<T>(path: string, name: string) {
  const loaded = await import(/* @vite-ignore */ path);
  return loaded[name] as T;
}
async function foot(props: Record<string, unknown>) {
  const CustomerRailFoot = await load<unknown>(rail, 'CustomerRailFoot');
  return renderToStaticMarkup(createElement(CustomerRailFoot, props));
}

describe('the customer rail foot with All Tools', () => {
  test('has one All Tools link to /account/all-tools, before the Help row, with the grid icon', async () => {
    const CorridraIcon = await load<unknown>(icon, 'CorridraIcon');
    const gridIcon = renderToStaticMarkup(createElement(CorridraIcon, { name: 'grid' }));
    for (const props of [{ allTools: true }, { allTools: true, href }]) {
      const html = await foot(props);
      expect(html.match(/<a class="ux-rail-tools"/g)).toHaveLength(1);
      expect(html).toContain(
        `<a class="ux-rail-tools" href="/account/all-tools">${gridIcon}<span>All Tools</span></a>`,
      );
      expect(html.indexOf('ux-rail-tools')).toBeLessThan(html.indexOf('Help on WhatsApp'));
      expect(html.startsWith('<div class="ux-rail-foot"><a class="ux-rail-tools"')).toBe(true);
    }
  });
  test('is not a Help row: the Help row class is untouched, so nothing that reads it changes', async () => {
    const html = await foot({ allTools: true, href });
    expect(html.match(/class="ux-rail-help"/g)).toHaveLength(1);
    expect(html).not.toContain('class="ux-rail-tools ux-rail-help"');
  });
  test('leaves the default markup byte for byte as it was', async () => {
    const without = await foot({ href });
    expect(await foot({ href, allTools: false })).toBe(without);
    expect(without).not.toContain('ux-rail-tools');
    expect(without).not.toContain('All Tools');
    const soon = await foot({});
    expect(await foot({ allTools: false })).toBe(soon);
    expect(soon).not.toContain('ux-rail-tools');
  });
});

describe('where the shell and the Account page link to All Tools', () => {
  test('the shell passes allTools only under the navigation switch', () => {
    const shell = read('apps/web/components/customer-shell.tsx');
    expect(shell).toContain("const plainNames = uxSwitchOn('CORRIDRA_UX_NAV');");
    expect(shell.match(/allTools=\{plainNames\}/g)).toHaveLength(1);
    expect(shell).toContain(
      '<CustomerRailFoot href={supportWhatsappHref()} allTools={plainNames} />',
    );
  });
  test('the Account page names /account/all-tools once, outside the Security panel, under the same switch', () => {
    const page = read('apps/web/app/account/page.tsx');
    expect(page.match(/\/account\/all-tools/g)).toHaveLength(1);
    const security = page.slice(
      page.indexOf('security={'),
      page.indexOf('<AccountClosureComingSoon />'),
    );
    expect(security).not.toContain('/account/all-tools');
    expect(security).toContain("{!uxSwitchOn('CORRIDRA_UX_NAV') && <WaysIn />}");
    const row = page.slice(page.lastIndexOf("{uxSwitchOn('CORRIDRA_UX_NAV') ? ("));
    expect(row).toContain("{uxSwitchOn('CORRIDRA_UX_NAV') ? (");
    expect(page.indexOf('ux-account-alltools')).toBeGreaterThan(page.indexOf('security={'));
  });
  test('the row is hidden only when a rail carrying All Tools is present, at the rail breakpoint in px', () => {
    const css = read('apps/web/app/globals.css');
    expect(css).toContain(
      '@media (min-width: 1024px) {\n  .ux-leftnav-frame:has(.ux-rail-tools) .ux-account-alltools {\n    display: none;',
    );
    const railCss = read('apps/web/components/ux/customer-rail.css');
    expect(railCss).toContain("[data-collapsed='true'] .ux-rail-tools span");
    expect(railCss).toContain('.ux-rail-tools:focus-visible');
  });
});

describe('the team setup hint', () => {
  test('keeps its h2 and operator section class by default, and lowers only when asked', () => {
    const hint = read('apps/web/components/operator-invitation-hint.tsx');
    expect(hint).toContain('headingLevel = 2');
    expect(hint).toContain("className = 'operator-section'");
    expect(hint).toContain('headingLevel === 3 ?');
    const signin = read('apps/web/app/operator/signin/page.tsx');
    expect(signin).toMatch(/<OperatorInvitationHint\s*\/>/);
    const page = read('apps/web/app/account/page.tsx');
    expect(page).toContain('headingLevel={3}');
  });
});
