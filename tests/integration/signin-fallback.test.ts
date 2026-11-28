import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// /signin without the customer account provider and without the work foundations: the page must never draw a sign-in
// form that cannot work. With the sign-in window (CORRIDRA_UX_ACCESS_WINDOW_V11, live by default) the window says
// sign-in is not switched on here yet and offers a request without an account; set to "false" it is the earlier
// "Sign-in is coming soon." page. With the foundations on, the page still sends the person to the work sign-in.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;

const state = { config: null as null | { NEON_AUTH_BASE_URL: string } };
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));
vi.doMock(web.resolve('next/navigation'), () => ({
  redirect: (to: string) => {
    throw new Error('redirect:' + to);
  },
  notFound: () => {
    throw new Error('notFound');
  },
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/signin',
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => state.config,
}));
vi.mock('../../apps/web/components/public-shell', () => ({
  PublicShell: ({ children }: { children: unknown }) =>
    createElement('main', { 'data-shell': 'public' }, children),
}));

const names = ['CORRIDRA_UX_ACCESS_WINDOW_V11', 'CORRIDRA_FOUNDATIONS_ENABLED'];
beforeEach(() => {
  state.config = null;
  for (const key of names) delete process.env[key];
});
afterEach(() => {
  for (const key of names) delete process.env[key];
});

async function page() {
  const file = '../../apps/web/app/signin/page';
  const signin = (await import(/* @vite-ignore */ file)) as {
    default: (props: unknown) => Promise<unknown>;
  };
  return render(await signin.default({ searchParams: Promise.resolve({}) }));
}

// The links of a page as [address, visible words], read by walking the markup one anchor at a time with plain string
// searches (no pattern is used to strip tags). The words are the text between the tags of the anchor.
function anchors(html: string): string[][] {
  const found: string[][] = [];
  let at = html.indexOf('<a ');
  while (at !== -1) {
    const open = html.indexOf('>', at);
    const close = html.indexOf('</a>', open);
    if (open === -1 || close === -1) break;
    const tag = html.slice(at, open);
    const from = tag.indexOf('href="');
    const href = from === -1 ? '' : tag.slice(from + 6, tag.indexOf('"', from + 6));
    let words = '';
    let inTag = false;
    for (const ch of html.slice(open + 1, close)) {
      if (ch === '<') inTag = true;
      else if (ch === '>') inTag = false;
      else if (!inTag) words += ch;
    }
    found.push([href, words.trim()]);
    at = html.indexOf('<a ', close);
  }
  return found;
}

describe('sign-in without the account provider', () => {
  it('in the window (switch unset) says sign-in is not on and draws no form', async () => {
    const html = await page();
    expect(html).toMatch(/class="operator-page aw[ "]/);
    expect(html).toContain('<h1 class="aw-title">Sign-in is coming soon.</h1>');
    expect(html).toContain('Temporarily unavailable');
    expect(html).toContain(
      'Customer sign-in is not switched on here yet. You can still start a request without an account. Team members sign in separately.',
    );
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('disabled');
    const links = anchors(html);
    expect(links).toContainEqual(['/plan', 'Start a Request Without an Account']);
    // The earlier page's other ways in are kept: team sign-in, helper tasks and back to Corridra.
    for (const link of [
      ['/operator', 'Team Sign-in'],
      ['/contributor', 'Local Helper Tasks'],
      ['/', 'Back to Corridra'],
    ])
      expect(links).toContainEqual(link);
  });
  it('with the window switch exactly "false" is the earlier coming-soon page', async () => {
    process.env.CORRIDRA_UX_ACCESS_WINDOW_V11 = 'false';
    const html = await page();
    expect(html).toContain('data-shell="public"');
    expect(html).not.toContain('operator-page aw');
    expect(html).toContain('<p class="label">Coming soon</p><h1>Sign-in is coming soon.</h1>');
    expect(html).not.toContain('<form');
    expect(anchors(html).slice(0, 2)).toEqual([
      ['/plan', 'Start a Request Without an Account'],
      ['/how-it-works', 'See How Corridra Works'],
    ]);
    expect(html).toContain('<nav class="guide-links" aria-label="Other ways in">');
  });
  it('keeps the redirect to the work sign-in while the foundations are on', async () => {
    process.env.CORRIDRA_FOUNDATIONS_ENABLED = 'true';
    await expect(page()).rejects.toThrow('redirect:/operator/signin');
    process.env.CORRIDRA_UX_ACCESS_WINDOW_V11 = 'false';
    await expect(page()).rejects.toThrow('redirect:/operator/signin');
  });
  it('with the provider set, shows the sign-in form in the window, or the earlier page when off', async () => {
    state.config = { NEON_AUTH_BASE_URL: 'https://auth.example' };
    const html = await page();
    expect(html).toContain('<h1 class="aw-title">Sign in.</h1>');
    expect(html).toContain('<form');
    expect(html).not.toContain('Sign-in is coming soon.');
    process.env.CORRIDRA_UX_ACCESS_WINDOW_V11 = 'false';
    const before = await page();
    expect(before).not.toContain('operator-page aw');
    expect(before).toContain('ux-account-access');
  });
});
