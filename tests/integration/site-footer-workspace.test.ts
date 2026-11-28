import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Wave 1: the public marketing footer must not sit under a signed-in workspace. It follows the same
// rule as the header: when the signed-in shells are on, a page inside /account, /operator or
// /contributor gets a one-line footer (copyright and the privacy link, so the notice stays reachable);
// every public page, the sign-in and recovery pages and the staff customer preview keep the full
// footer, and with the shells switch off nothing changes. These describe blocks are the footers of before, which
// CORRIDRA_UX_HOME_V44 set to "false" gives back (the switch is live by default, owner, 28 Nov 2026). The last block
// is the same rule for the new footer, which is the footer of every page while the switch is on.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: unknown; href: string }) =>
    createElement('a', { href, ...rest }, children as never),
}));
let pathname = '/';
vi.doMock(web.resolve('next/navigation'), () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => vi.resetModules());

const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
async function footer(path: string, props: Record<string, unknown>) {
  pathname = path;
  const { SiteFooterPlace } = await load('components/site-footer-place.tsx');
  return renderToStaticMarkup(createElement(SiteFooterPlace, { shells: false, ...props }));
}
const full = (html: string) =>
  html.includes('guide-footer-top') && html.includes('href="/institutions"');

describe('with the home v4.4 switch off: the footer inside signed-in workspaces', () => {
  it.each([
    '/account',
    '/account/requests/abc',
    '/account/delegations/organise',
    '/operator',
    '/operator/missions',
    '/operator/missions/abc',
    '/operator/owner',
    '/contributor',
    '/contributor/tasks',
  ])('%s shows only the one-line footer when shells are on', async (path) => {
    const html = await footer(path, { realUse: true, shells: true });
    expect(full(html)).toBe(false);
    expect(html).not.toContain('guide-footer');
    expect(html).toContain('site-footer');
    expect(html).toContain('© 2026 Corridra');
    expect(html).toContain('href="/privacy"');
  });
  it('says what the privacy notice is in sample mode too', async () => {
    const sample = await footer('/account', { realUse: false, shells: true });
    const real = await footer('/account', { realUse: true, shells: true });
    expect(sample).toContain('href="/privacy"');
    expect(sample).not.toBe(real);
  });
});

describe('with the home v4.4 switch off: the footer everywhere else', () => {
  it.each([
    '/',
    '/plan',
    '/about',
    '/network',
    '/workspace',
    '/corridors/bangladesh-china',
    '/signin',
    '/operator/signin',
    '/operator/forgot-password',
    '/operator/reset-password',
    '/operator/setup',
    '/operator/view-as/owner',
  ])('%s keeps the full footer when shells are on', async (path) => {
    expect(full(await footer(path, { realUse: true, shells: true }))).toBe(true);
  });
  it('the staff customer preview keeps the full footer but offers no account actions', async () => {
    const html = await footer('/operator/view-as/owner', { realUse: true, shells: true });
    expect(full(html)).toBe(true);
    expect(html).not.toContain('guide-footer-actions');
    expect(html).not.toContain('href="/plan"');
    expect(html).not.toContain('href="/signin"');
  });
  it.each(['/account', '/operator', '/contributor'])(
    '%s keeps the full footer when the shells switch is off',
    async (path) => {
      expect(full(await footer(path, { realUse: true, shells: false }))).toBe(true);
      expect(full(await footer(path, { realUse: true }))).toBe(true);
    },
  );
  it('keeps every destination the full footer has today', async () => {
    const html = await footer('/', { realUse: true, shells: true });
    for (const href of [
      '/workspace',
      '/corridors#mission-example',
      '/trust',
      '/about',
      '/network',
      '/institutions',
      '/privacy',
    ])
      expect(html, href).toContain(`href="${href}"`);
  });
});

// The new footer (home page v4.4, owner, 28 Nov 2026: "new home footer should across full site by replacing existing
// one"): a footer on every page, with the privacy link and every destination the full footer had.
const v44 = (html: string) => html.includes('data-footer="v44"') && html.includes('hv7-footer');
const everyDestination = [
  '/source',
  '/machinery',
  '/corridors/bangladesh-china',
  '/corridors#mission-example',
  '/trade-missions',
  '/business-trips',
  '/institutions',
  '/network',
  '/sell',
  '/enter-market',
  '/corridors/bangladesh-eu',
  '/corridors',
  '/how-it-works',
  '/about',
  '/trust',
  '/privacy',
];
describe('with the home v4.4 switch on: one footer on every page', () => {
  it.each([
    '/',
    '/plan',
    '/about',
    '/network',
    '/workspace',
    '/corridors/bangladesh-china',
    '/signin',
    '/operator/signin',
    '/operator/forgot-password',
    '/operator/setup',
    '/operator/view-as/owner',
  ])('%s shows the new footer with the privacy link and every destination', async (path) => {
    const html = await footer(path, { realUse: true, shells: true, homeV44: true });
    expect(v44(html)).toBe(true);
    expect(html).not.toContain('guide-footer');
    expect(html).toContain('© 2026 Corridra');
    for (const href of everyDestination)
      expect(html, `${path} ${href}`).toContain(`href="${href}"`);
  });
  it.each([
    '/account',
    '/account/requests/abc',
    '/account/delegations/organise',
    '/operator',
    '/operator/missions/abc',
    '/contributor',
    '/contributor/tasks',
  ])(
    '%s inside a signed-in workspace shows the new footer as one line with the privacy link',
    async (path) => {
      const html = await footer(path, { realUse: true, shells: true, homeV44: true });
      expect(v44(html)).toBe(true);
      expect(html).toContain('hv7-footer-quiet');
      expect(html).not.toContain('href="/institutions"');
      expect(html).toContain('© 2026 Corridra');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/trust"');
    },
  );
  it('shows the new footer inside the workspaces too when the shells switch is off, with every destination', async () => {
    const html = await footer('/account', { realUse: true, shells: false, homeV44: true });
    expect(v44(html)).toBe(true);
    expect(html).toContain('href="/institutions"');
  });
  it('names the notice as the test notice while real use is off', async () => {
    const real = await footer('/', { realUse: true, shells: true, homeV44: true });
    const sample = await footer('/', { realUse: false, shells: true, homeV44: true });
    expect(sample).toContain('href="/privacy"');
    expect(sample).not.toBe(real);
  });
  it('offers sign-in outside the staff preview, and no account action inside it', async () => {
    expect(await footer('/', { realUse: true, shells: true, homeV44: true })).toContain(
      'href="/signin"',
    );
    const preview = await footer('/operator/view-as/owner', {
      realUse: true,
      shells: true,
      homeV44: true,
    });
    expect(preview).not.toContain('href="/signin"');
    expect(preview).not.toContain('hv7-footer-actions');
  });
  it('sends the network link to its access door while the doors are on, and shows the three doors', async () => {
    const html = await footer('/', {
      realUse: true,
      shells: true,
      homeV44: true,
      accessDoors: true,
    });
    expect(html).toContain('href="/access/team"');
    expect(html).not.toContain('href="/network"');
    expect(html).toContain('Find your way in.');
    expect(html).toContain('href="/access/customer"');
  });
  it('shows nothing on the pages that are bare', async () => {
    expect(await footer('/offline', { realUse: true, shells: true, homeV44: true })).toBe('');
  });
});
