import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

// Account settings tabs, default CI coverage of the three things the browser specs only prove with extra switches on:
// the rail All Tools row (expanded and collapsed), the phone row that is never shown twice, and the closure card
// in each of its states. Browser behaviour with the switches on is
// tests/e2e/verification/revamp-s2/account-all-tools.spec.ts (it needs CORRIDRA_UX_NAV and the account lifecycle
// switch, so CI skips it). Nothing here needs a database or a browser.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the rail All Tools row, expanded and collapsed', () => {
  const css = read('apps/web/components/ux/customer-rail.css');
  const leftNav = read('apps/web/components/ux/left-nav.css');
  const rule = (selector: string) => {
    const start = css.indexOf(selector);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  test('expanded: a 44 px row with an icon, the same row pattern as Help on WhatsApp, with a visible focus ring', () => {
    const base = rule('.ux-rail-help,\n.ux-rail-tools {');
    expect(base).toContain('min-height: 2.75rem');
    expect(base).toContain('display: flex');
    expect(rule('.ux-rail-help .corridra-icon,\n.ux-rail-tools .corridra-icon {')).toContain(
      'width: 20px',
    );
    expect(rule('.ux-rail-help:focus-visible,\n.ux-rail-tools:focus-visible {')).toContain(
      'outline: 3px solid var(--focus)',
    );
  });
  test('collapsed: the word is clipped, not removed, so the link keeps its name, and the row keeps its width', () => {
    const clip = rule("[data-collapsed='true'] .ux-rail-new span,");
    expect(clip).toContain('clip: rect(0 0 0 0)');
    expect(clip).not.toContain('display: none');
    expect(css).toContain("[data-collapsed='true'] .ux-rail-tools span");
    expect(
      rule("[data-collapsed='true'] .ux-rail-help,\n[data-collapsed='true'] .ux-rail-tools {"),
    ).toContain('justify-content: center');
    // Nothing in the collapsed rules hides the link itself or shrinks its height.
    expect(css).not.toMatch(/\.ux-rail-tools\s*\{[^}]*display:\s*none/);
    expect(css).not.toMatch(/\[data-collapsed='true'\]\s+\.ux-rail-tools\s*\{[^}]*(height|width):/);
  });
  test('the rail collapses only at the wide breakpoint, so a phone never has a collapsed rail', () => {
    expect(read('apps/web/components/ux/left-nav.tsx')).toContain(
      "const wideQuery = '(min-width: 1024px)';",
    );
    expect(leftNav).toContain('@media (max-width: 1023.98px)');
    expect(leftNav).toContain('@media (min-width: 1024px)');
  });
  test('with the navigation switch off the shell gives the foot no All Tools row', () => {
    const shell = read('apps/web/components/customer-shell.tsx');
    expect(shell).toContain("const plainNames = uxSwitchOn('CORRIDRA_UX_NAV');");
    expect(shell).toContain('allTools={plainNames}');
    expect(read('apps/web/components/ux/customer-rail.tsx')).toMatch(
      /allTools\s*\?\s*\(|allTools\s*&&|allTools\s*\?/,
    );
  });
});

describe('the phone row is never shown twice and never orphaned', () => {
  const page = read('apps/web/app/account/page.tsx');
  const globals = read('apps/web/app/globals.css');

  test('the rail and the Account page are the only two links to /account/all-tools in the app', () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === 'node_modules' || name === '.next') continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && read(path).includes('/account/all-tools'))
          found.push(path.replace(/\\/g, '/'));
      }
    };
    walk('apps/web/components');
    walk('apps/web/app');
    expect(found.filter((path) => !path.includes('/account/all-tools/')).sort()).toEqual([
      'apps/web/app/account/page.tsx',
      'apps/web/components/ux/customer-rail.tsx',
    ]);
  });
  test('the phone row exists only under the navigation switch, below the tabs and outside every tab panel', () => {
    const start = page.indexOf('<AccountSettings');
    const end = page.indexOf('</CustomerShell>');
    const after = page.slice(page.indexOf('/>', page.indexOf('security={')), end);
    expect(after).toContain("{uxSwitchOn('CORRIDRA_UX_NAV') ? (");
    expect(after).toContain('ux-account-alltools');
    expect(after).toContain('href="/account/all-tools"');
    expect(after.match(/>\s*All Tools\s*</g)).toHaveLength(1);
    expect(page.slice(start, page.indexOf('security={'))).not.toContain('All Tools');
  });
  test('it hides at the rail breakpoint, and only when a rail that carries All Tools is on the page', () => {
    const hides = globals.match(
      /@media \(min-width: (\d+)px\) \{\s*\.ux-leftnav-frame:has\(\.ux-rail-tools\) \.ux-account-alltools \{\s*display: none;/,
    );
    expect(hides?.[1]).toBe('1024');
    // The same width the rail itself appears at, so the two can never both be hidden or both shown.
    expect(read('apps/web/components/ux/left-nav.css')).toContain('@media (min-width: 1024px)');
    // Without a rail (old navigation) nothing hides it, and below 1024 px nothing hides it.
    expect(globals.match(/\.ux-account-alltools/g)).toHaveLength(1);
  });
});

// The closure card: AccountClosure reads its state in an effect, so a server render only ever sees "loading". The first
// useState of the component is replaced here with the state under test; every other hook is the real one.
// A variable path keeps the packages type check from compiling the component (it has no jsx setting), as the other markup tests do.
const closurePath = '../../apps/web/app/account/account-closure';
const injected = { armed: false, value: undefined as unknown };
async function renderClosure(state: unknown) {
  vi.resetModules();
  const react = await import(/* @vite-ignore */ web.resolve('react'));
  const actual = (react.default ?? react) as Record<string, unknown>;
  vi.doMock(web.resolve('react'), () => ({
    ...actual,
    default: {
      ...actual,
      useState: (init: unknown) =>
        injected.armed
          ? ((injected.armed = false), [injected.value, () => undefined])
          : (actual.useState as (i: unknown) => unknown)(init),
    },
    useState: (init: unknown) =>
      injected.armed
        ? ((injected.armed = false), [injected.value, () => undefined])
        : (actual.useState as (i: unknown) => unknown)(init),
  }));
  const { AccountClosure } = await import(/* @vite-ignore */ closurePath);
  injected.armed = true;
  injected.value = state;
  const html = renderToStaticMarkup(
    createElement(AccountClosure, { subject: 's', issuer: 'https://i.example' }),
  );
  injected.armed = false;
  return html;
}
const active = {
  open: true,
  status: 'active',
  closedAt: null,
  undoUntil: null,
  canUndo: false,
  erasure: null,
  blockers: [],
};
const outsideDialog = (html: string) => html.slice(0, html.indexOf('<dialog'));

describe('the closure card in each state', () => {
  afterEach(() => {
    vi.doUnmock(web.resolve('react'));
    vi.resetModules();
  });

  test('available: a danger card titled by the section heading, one row per action, each with its button', async () => {
    const html = outsideDialog(await renderClosure(active));
    expect(html).toContain('class="ux-account-card ux-account-zone" data-tone="danger"');
    expect(html).toContain('<h3 tabindex="-1">Close Account or Erase Data</h3>');
    expect(html.match(/class="ux-account-row"/g)).toHaveLength(2);
    expect(html).toContain(
      '<h4>Close Account</h4><p>Close your account. You can undo this for 30 days.</p>',
    );
    expect(html).toContain(
      '<h4>Ask for Erasure</h4><p>Ask the Corridra team to erase your personal data.</p>',
    );
    // The text comes first in each row and the button last, which is the tab order and the layout order.
    expect(html.indexOf('<h4>Close Account</h4>')).toBeLessThan(
      html.indexOf('>Close Account</button>'),
    );
    expect(html.indexOf('>Close Account</button>')).toBeLessThan(
      html.indexOf('<h4>Ask for Erasure</h4>'),
    );
    expect(html.indexOf('<h4>Ask for Erasure</h4>')).toBeLessThan(
      html.indexOf('>Ask for Erasure</button>'),
    );
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('Reopen My Account');
  });
  test('an open erasure request: the status block shows every field in order, in one list', async () => {
    const html = outsideDialog(
      await renderClosure({
        ...active,
        erasure: {
          reference: 'ER-2026-0042',
          filedAt: '2026-11-08T09:00:00Z',
          dueAt: '2026-12-08T09:00:00Z',
          status: 'received',
          note: null,
        },
      }),
    );
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('class="ux-account-status"');
    expect(html.match(/<dl/g)).toHaveLength(1);
    const terms = [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1]);
    expect(terms).toEqual(['Reference', 'Sent', 'Staff reply due by', 'Status']);
    expect(html).toContain('ER-2026-0042');
    expect(html).toContain('<h4>Erasure Request</h4>');
    expect(html).toContain('<h4>Close Account</h4>');
    expect(html).not.toContain('<h4>Ask for Erasure</h4>');
  });
  test('closed with an undo window: a neutral card with the closed text and Reopen My Account, no close row', async () => {
    const html = outsideDialog(
      await renderClosure({
        ...active,
        open: false,
        status: 'closed',
        closedAt: '2026-11-09T09:00:00Z',
        undoUntil: '2026-12-09T09:00:00Z',
        canUndo: true,
      }),
    );
    expect(html).toContain('data-tone="neutral"');
    expect(html).not.toContain('data-tone="danger"');
    expect(html).toContain('Your account is closed until');
    expect(html).toContain('>Reopen My Account</button>');
    expect(html).not.toContain('<h4>Close Account</h4>');
    expect(html).toContain('<h4>Ask for Erasure</h4>');
  });
  test('closed for good: the final notice, no Reopen button', async () => {
    const html = outsideDialog(
      await renderClosure({ ...active, open: false, status: 'final', canUndo: false }),
    );
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain('Your account was closed and can no longer be reopened.');
    expect(html).not.toContain('Reopen My Account');
  });
  test('loading: an empty hidden placeholder, so no text, link or button appears before the state is known', async () => {
    const html = await renderClosure(undefined);
    expect(html).toBe(
      '<div class="ux-account-card ux-account-zone" data-tone="loading" aria-hidden="true"></div>',
    );
  });
  test('lifecycle off: a quiet notice with the privacy link, no button and no danger tone', async () => {
    const { AccountClosureComingSoon } = await import(/* @vite-ignore */ closurePath);
    for (const html of [
      await renderClosure(null),
      renderToStaticMarkup(createElement(AccountClosureComingSoon)),
    ]) {
      expect(html).toContain('data-tone="notice"');
      expect(html).not.toContain('data-tone="danger"');
      expect(html).not.toContain('<button');
      expect(html).toContain('Coming soon.');
      expect(html).toContain('<h3>Close Account or Erase Data</h3>');
      expect(html).toMatch(/<a [^>]*href="\/privacy"[^>]*>privacy page<\/a>/);
      expect(html).toContain('We reply within 30 days.');
    }
  });
});
