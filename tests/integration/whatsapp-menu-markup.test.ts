import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Chat on WhatsApp in the signed-in menus and the customer rail (docs/revamp/specs/workflow-intelligence.md, W9).
// Only a made-up number is used. The behaviour in a browser is tests/e2e/verification/revamp-s2/customer-whatsapp.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const href = 'https://wa.me/6500000000';
const suffix = ' (opens WhatsApp outside Corridra, in a new tab)';

async function load<T>(path: string, name: string) {
  const loaded = await import(/* @vite-ignore */ path);
  return loaded[name] as T;
}
const menus = '../../apps/web/components/ux/utility-menus';
const rail = '../../apps/web/components/ux/customer-rail';
const icon = '../../apps/web/components/corridra-icon';

async function iconMarkup(name: string, className?: string) {
  const CorridraIcon = await load<unknown>(icon, 'CorridraIcon');
  return renderToStaticMarkup(createElement(CorridraIcon, { name, className }));
}
async function entry(value: unknown) {
  const Entry = await load<unknown>(menus, 'Entry');
  return renderToStaticMarkup(createElement(Entry, { entry: value }));
}

describe('an external menu row', () => {
  test('is a menu item link that opens a new tab safely, label first, naming WhatsApp for assistive technology', async () => {
    const html = await entry({ kind: 'external', label: 'Chat on WhatsApp', href });
    expect(html).toMatch(/^<a /);
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain('target="_blank"');
    const rel = /rel="([^"]*)"/.exec(html)![1]!.split(' ');
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    expect(html).not.toContain('aria-label');
    expect(html).not.toContain('Coming soon');
    expect(html).not.toContain('aria-disabled');
    expect(html.indexOf('<span>Chat on WhatsApp</span>')).toBeGreaterThan(-1);
    expect(html.indexOf('<span>Chat on WhatsApp</span>')).toBeLessThan(html.indexOf('sr-only'));
    expect(html).toContain(`<span class="sr-only">${suffix}</span>`);
    expect(html).toContain('ux-menu-external-icon');
    // The label and the spoken hint are English whatever the page language, as on the rail link.
    expect(html).toContain('lang="en"');
  });
  test('a Coming soon row is still plain text: announced as unavailable, with no link', async () => {
    const html = await entry({ kind: 'soon', label: 'Chat on WhatsApp' });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Coming soon');
    expect(html).not.toContain('href');
    expect(html).not.toMatch(/^<a /);
  });
  test('an ordinary link row is unchanged and does not open a new tab', async () => {
    const html = await entry({ kind: 'link', label: 'Privacy Notice', href: '/privacy' });
    expect(html).not.toContain('target=');
    expect(html).not.toContain('sr-only');
  });
});

describe('the customer rail foot', () => {
  async function foot(props: Record<string, unknown>) {
    const CustomerRailFoot = await load<unknown>(rail, 'CustomerRailFoot');
    return renderToStaticMarkup(createElement(CustomerRailFoot, props));
  }
  test('without a number it is exactly the Coming soon text it always was', async () => {
    const expected =
      '<div class="ux-rail-foot"><p class="ux-rail-soon">' +
      (await iconMarkup('help')) +
      '<span>Help on WhatsApp</span><span class="ux-soon-tag">Coming soon</span></p></div>';
    expect(await foot({})).toBe(expected);
    expect(await foot({ href: null })).toBe(expected);
    expect(await foot({ href: '' })).toBe(expected);
  });
  test('with a number it is a link that opens a new tab, with the help icon, the label and an open hint', async () => {
    const html = await foot({ href });
    expect(html).toBe(
      '<div class="ux-rail-foot">' +
        `<a class="ux-rail-help" href="${href}" target="_blank" rel="noopener noreferrer" lang="en">` +
        (await iconMarkup('help')) +
        '<span>Help on WhatsApp</span>' +
        (await iconMarkup('open', 'ux-rail-help-open')) +
        `<span class="sr-only">${suffix}</span></a></div>`,
    );
    expect(html).not.toContain('ux-rail-soon');
    expect(html).not.toContain('Coming soon');
  });
});
