import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Wave 1: the public marketing footer must not sit under a signed-in workspace. It follows the same
// rule as the header: when the signed-in shells are on, a page inside /account, /operator or
// /contributor gets a one-line footer (copyright and the privacy link, so the notice stays reachable);
// every public page, the sign-in and recovery pages and the staff customer preview keep the full
// footer, and with the shells switch off nothing changes.
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

describe('the footer inside signed-in workspaces', () => {
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

describe('the footer everywhere else', () => {
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
