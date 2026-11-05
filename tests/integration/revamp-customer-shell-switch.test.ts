import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// CX PR 1: the left bar's drawer opener lives only in the signed-in header, which ShellHeader shows only
// with CORRIDRA_UX_SHELLS_V2 on. With it off the customer frame must stay as it was (tab row, notice,
// eyebrow), or a customer below 1024 px would have no way to reach the destinations.
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
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
afterEach(() => vi.unstubAllEnvs());

const render = async () => {
  const { CustomerShell } = await load('components/customer-shell.tsx');
  return renderToStaticMarkup(
    createElement(CustomerShell, { tab: 'home', eyebrow: 'ACCOUNT', title: 'Your account' }, null),
  );
};

describe('CX PR 1: the customer frame follows the shells switch', () => {
  it('with the switch off the tab row, notice and eyebrow are kept and there is no left bar', async () => {
    vi.stubEnv('CORRIDRA_UX_SHELLS_V2', '');
    const html = await render();
    expect(html).toContain('guide-tabs');
    expect(html).toContain('class="ux-testmode"');
    expect(html).toContain('ACCOUNT');
    expect(html).not.toContain('ux-leftnav-frame');
  });
  it('with the switch on the left bar replaces the tab row, notice and eyebrow', async () => {
    vi.stubEnv('CORRIDRA_UX_SHELLS_V2', 'true');
    const html = await render();
    expect(html).toContain('ux-leftnav-frame');
    expect(html).not.toContain('guide-tabs');
    expect(html).not.toContain('ux-testmode');
    expect(html).not.toContain('>ACCOUNT<');
  });
  it('with the switch on the sample or real-use line is still carried for the account menu', async () => {
    vi.stubEnv('CORRIDRA_UX_SHELLS_V2', 'true');
    vi.stubEnv('CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK', '');
    vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
    vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    expect(await render()).toContain('Preview workspace: use made-up names and details here.');
    vi.stubEnv('DATA_ENVIRONMENT', 'real');
    vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
    const real = await render();
    expect(real).toContain('Your work stays private to the people given access.');
    expect(real).not.toContain('made-up');
  });
});
