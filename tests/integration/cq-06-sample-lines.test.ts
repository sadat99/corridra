import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// CQ-06: the lines that say "this is sample mode" are shown only where real use is off, and are
// absent where real use is on. Real use is the shared helper realUseEnabled(): DATA_ENVIRONMENT is
// "real", CORRIDRA_REAL_USE_ENABLED is "true", and a production deployment is unlocked. The words
// are not under test here (they are owner-gated); only which mode shows which set of lines.
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
// The app resolves its own copy of next, so mock that one.
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const realUseOn = {
  DATA_ENVIRONMENT: 'real',
  CORRIDRA_REAL_USE_ENABLED: 'true',
  VERCEL_ENV: '',
};
const sampleOn = {
  DATA_ENVIRONMENT: 'synthetic',
  CORRIDRA_REAL_USE_ENABLED: '',
  VERCEL_ENV: '',
};
// Real use requested on a production deployment that is not unlocked is still real use off.
const realUseRequestedButLocked = {
  DATA_ENVIRONMENT: 'real',
  CORRIDRA_REAL_USE_ENABLED: 'true',
  VERCEL_ENV: 'production',
  CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK: '',
};
function mode(env: Record<string, string>) {
  vi.unstubAllEnvs();
  vi.stubEnv('CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK', '');
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}
afterEach(() => vi.unstubAllEnvs());

const shellSampleLine = 'Preview workspace:';
const shellRealLine = 'Your work stays private to the people given access.';
const renderShell = async () => {
  const { CustomerShell } = await load('components/customer-shell.tsx');
  return renderToStaticMarkup(
    createElement(CustomerShell, { tab: 'home', eyebrow: 'ACCOUNT', title: 'Your account' }, null),
  );
};

describe('CQ-06: the customer frame note says sample mode only where real use is off', () => {
  it('CQ-06: with real use off the frame shows the sample line and not the real line', async () => {
    mode(sampleOn);
    const html = await renderShell();
    // The amber banner is gone (customer experience spec CX-06); the line is carried for the account menu.
    expect(html).toContain('class="ux-customer-note"');
    expect(html).not.toContain('ux-testmode');
    expect(html).toContain(shellSampleLine);
    expect(html).toContain('use made-up names and details here.');
    expect(html).not.toContain(shellRealLine);
  });
  it('CQ-06: with real use on the frame shows no sample line', async () => {
    mode(realUseOn);
    const html = await renderShell();
    expect(html).toContain(shellRealLine);
    expect(html).not.toContain(shellSampleLine);
    expect(html).not.toContain('made-up');
  });
  it('CQ-06: real use requested on a locked production deployment still shows the sample line', async () => {
    mode(realUseRequestedButLocked);
    const html = await renderShell();
    expect(html).toContain(shellSampleLine);
    expect(html).not.toContain(shellRealLine);
  });
});

// The request form passes a private submission so it renders without the sign-in router.
const renderIntake = async (realMode: boolean) => {
  const { Intake } = await load('app/plan/intake.tsx');
  return renderToStaticMarkup(
    createElement(Intake, {
      realMode,
      privateSubmission: { draftStorageKey: 'cq-06', submit: async () => undefined },
    }),
  );
};
const intakeSampleLines = [
  'Test mode',
  'Test intake is open. Real customer mission admission is unavailable.',
  'Use invented details and an email ending in',
  '@example.invalid',
  'Sample requests stay private to this account.',
  'Email delivery is not enabled.',
  'Read the test intake notice',
];

describe('CQ-06: the request form notice says sample mode only where real use is off', () => {
  it('CQ-06: the sample form notice carries every sample line and marks the panel as made up', async () => {
    mode(sampleOn);
    const html = await renderIntake(false);
    for (const line of intakeSampleLines) expect(html, line).toContain(line);
    expect(html).toContain('data-madeup-panel');
  });
  it('CQ-06: the real form notice carries none of the sample lines', async () => {
    mode(realUseOn);
    const html = await renderIntake(true);
    for (const line of intakeSampleLines) expect(html, line).not.toContain(line);
    expect(html).not.toContain('data-madeup-panel');
    expect(html).toContain('intake-notice');
  });
  it('CQ-06: the /plan page chooses the form mode from the shared real-use helper', async () => {
    const { default: Page } = await load('app/plan/page.tsx');
    const { realUseEnabled } = await import('../../packages/auth/src/customer-production');
    for (const [env, expectedReal] of [
      [sampleOn, false],
      [realUseOn, true],
      [realUseRequestedButLocked, false],
    ] as const) {
      mode(env);
      expect(realUseEnabled()).toBe(expectedReal);
      const html = renderToStaticMarkup(createElement(Page));
      expect(html.includes('data-madeup-panel'), JSON.stringify(env)).toBe(!expectedReal);
      expect(html.includes('Email delivery is not enabled.'), JSON.stringify(env)).toBe(
        !expectedReal,
      );
    }
  });
});
