import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { teamHelpGroups } from '../../apps/web/lib/ux/team-help';

// The avatar menu's place links (Navigation v1 part 3). The workspace switches section on `hashchange`, and Next's
// router makes a same-page `#` change without one, so a `#` address must be a plain anchor, as in the sidebar. The
// router link is marked here so the difference can be seen in the markup.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const path = '../../apps/web/components/ux/team-utility-menus';

async function render(href: string, plain: boolean, current = false) {
  vi.resetModules();
  vi.doMock(web.resolve('next/navigation'), () => ({ usePathname: () => '/operator' }));
  vi.doMock(web.resolve('next/link'), () => ({
    default: ({ children, href: to, ...rest }: { children: unknown; href: string }) =>
      createElement('a', { href: to, 'data-soft-link': 'true', ...rest }, children as never),
  }));
  const { PlaceLink } = await import(/* @vite-ignore */ path);
  return renderToStaticMarkup(createElement(PlaceLink, { href, plain, current }, 'Health'));
}

describe('a menu link to a team place', () => {
  test('a `#` address is a plain anchor, never the router link', async () => {
    const html = await render('/operator?workspace=t#ops-health', false);
    expect(html).toContain('<a ');
    expect(html).not.toContain('data-soft-link');
    expect(html).toContain('role="menuitem"');
  });
  test('on a mission page or the owner page every link is a plain anchor', async () => {
    expect(await render('/operator/health', true)).not.toContain('data-soft-link');
  });
  test('a section address on the workspace page uses the router link', async () => {
    expect(await render('/operator/health', false)).toContain('data-soft-link');
  });
  test('the current place carries aria-current="page", another does not', async () => {
    expect(await render('/operator/health', false, true)).toContain('aria-current="page"');
    expect(await render('/operator/health', false, false)).not.toContain('aria-current');
    expect(await render('/operator#ops-health', false, true)).toContain('aria-current="page"');
  });
});

describe('the team Help groups', () => {
  test('keep what the old corner Help sheet reached: How it works, Listen and Start a Request', () => {
    const entries = teamHelpGroups().flatMap((group) => group.items);
    const links = entries.filter((e) => e.kind === 'link').map((e) => (e as { href: string }).href);
    expect(links).toEqual(expect.arrayContaining(['/how-it-works', '/plan', '/', '/privacy']));
    expect(entries.some((e) => e.kind === 'listen')).toBe(true);
    // W7, W10: the team has the same three reading controls as the customer menu, and the same two Coming soon rows.
    expect(entries.map((e) => e.kind).filter((kind) => kind === 'textsize')).toHaveLength(1);
    expect(entries.map((e) => e.kind).filter((kind) => kind === 'contrast')).toHaveLength(1);
    expect(entries.map((e) => e.kind).filter((kind) => kind === 'lessmovement')).toHaveLength(1);
    expect(entries.filter((e) => e.kind === 'soon').map((e) => e.label)).toEqual([
      'Chat on WhatsApp',
      'Report a Problem',
    ]);
    for (const group of teamHelpGroups()) expect(group.items.length).toBeLessThanOrEqual(4);
  });
  test('with a support number set only the Chat on WhatsApp row changes, and Start a Request stays', () => {
    const href = 'https://wa.me/6500000000';
    const unset = teamHelpGroups().flatMap((group) => group.items);
    const set = teamHelpGroups(href);
    const entries = set.flatMap((group) => group.items);
    expect(entries).toHaveLength(unset.length);
    expect(
      entries.filter((entry, i) => JSON.stringify(entry) !== JSON.stringify(unset[i])),
    ).toEqual([{ kind: 'external', label: 'Chat on WhatsApp', href }]);
    expect(entries).toContainEqual({ kind: 'link', label: 'Start a Request', href: '/plan' });
    for (const group of set) expect(group.items.length).toBeLessThanOrEqual(4);
  });
  test('without a number the team Help says Coming soon and has no external row', () => {
    const entries = teamHelpGroups().flatMap((group) => group.items);
    expect(entries).toContainEqual({ kind: 'soon', label: 'Chat on WhatsApp' });
    expect(entries.some((entry) => entry.kind === 'external')).toBe(false);
  });
});
