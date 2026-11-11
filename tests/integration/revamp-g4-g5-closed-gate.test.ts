import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The closed-account gate is mounted for every customer page when the account module is on. It is told which person the
// page is drawn for; when that identity cannot be read just now it is still mounted (the server verifies the session
// itself), so a transient provider error never shows a closed account its pages.
const web = createRequire(resolve('apps/web/package.json'));
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: () => null }));
afterEach(() => vi.resetModules());

const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const mount = async (identity: { subject: string; issuer: string } | null) => {
  vi.doMock(resolve('apps/web/lib/customer-page-session.ts'), () => ({
    customerIdentity: async () => identity,
  }));
  // The wrapper also asks whether Report a Problem is offered (server code that needs a database).
  vi.doMock(resolve('apps/web/lib/problem-reports-offered.ts'), () => ({
    problemReportsOffered: async () => false,
  }));
  const { IdentifiedClosedAccountGate } = await load(
    'components/customer-closed-account-server.tsx',
  );
  const { ClosedAccountGate } = await load('components/customer-closed-account.tsx');
  const element = (await IdentifiedClosedAccountGate({ children: 'page' })) as {
    type: unknown;
    props: { subject?: string; issuer?: string };
  };
  return { element, ClosedAccountGate };
};

describe('the closed-account gate wrapper', () => {
  it('passes the identity of the person the page is drawn for', async () => {
    const { element, ClosedAccountGate } = await mount({
      subject: 'synthetic-gate-person',
      issuer: 'https://ep-gate.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    });
    expect(element.type).toBe(ClosedAccountGate);
    expect(element.props).toMatchObject({ subject: 'synthetic-gate-person' });
  });

  it('still mounts the gate, without an identity, when the identity cannot be read', async () => {
    const { element, ClosedAccountGate } = await mount(null);
    expect(element.type).toBe(ClosedAccountGate);
    expect(element.props.subject).toBeUndefined();
    expect(element.props.issuer).toBeUndefined();
  });
});

// Report a Problem (ADR-078 decision 4): a closed account can still read its problem reports and remove their words, so
// the problem report pages are drawn for it and the closed-account screen links to them, but only where Report a Problem
// is offered. Every other page keeps the gate.
describe('the closed-account gate and the problem report pages', () => {
  const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
    e: unknown,
  ) => string;
  const createElement = web('react').createElement as (
    t: unknown,
    p?: unknown,
    ...c: unknown[]
  ) => unknown;
  const identity = {
    subject: 'synthetic-gate-person',
    issuer: 'https://ep-gate.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
  };
  const closed = {
    status: 'closed',
    canUndo: false,
    undoUntil: null,
    erasure: null,
  };

  const shell = async (props: Record<string, unknown>) => {
    vi.resetModules();
    vi.doMock(web.resolve('@corridra/auth/customer-account-lifecycle'), () => ({
      customerAccountLifecycleEnabled: () => true,
    }));
    const { CustomerShell } = await load('components/customer-shell.tsx');
    const { IdentifiedClosedAccountGate } = await load(
      'components/customer-closed-account-server.tsx',
    );
    const element = CustomerShell({
      tab: 'more',
      title: 'x',
      children: 'page',
      ...props,
    }) as { type: unknown; props: Record<string, unknown> };
    return { element, IdentifiedClosedAccountGate };
  };

  it('every other page keeps the gate', async () => {
    const { element, IdentifiedClosedAccountGate } = await shell({});
    expect(element.type).toBe(IdentifiedClosedAccountGate);
  });

  it('a problem report page that opts out is drawn for a closed account, with no gate around it', async () => {
    const { element, IdentifiedClosedAccountGate } = await shell({ closedAccountReads: true });
    expect(element.type).not.toBe(IdentifiedClosedAccountGate);
    // The frame itself is drawn, so the page is the page, not the closed-account screen.
    expect(JSON.stringify(element.props.children)).toContain('page');
  });

  it('the closed-account screen links to the problem reports only where both probes hold', async () => {
    const { CustomerClosedAccount } = await load('components/customer-closed-account.tsx');
    const draw = (problemReports?: boolean) =>
      renderToStaticMarkup(
        createElement(CustomerClosedAccount, {
          state: closed,
          headers: {},
          problemReports,
          onReopened: () => undefined,
        }),
      );
    for (const off of [undefined, false]) {
      expect(draw(off)).not.toContain('Your Problem Reports');
      expect(draw(off)).not.toContain('/account/problem-reports');
    }
    const on = draw(true);
    expect(on).toContain('Your Problem Reports');
    expect(on.match(/\/account\/problem-reports/g)).toHaveLength(1);
    // Nothing else about the screen changed: the same words with the link taken out.
    expect(on.replace(/<p><a [^>]*>Your Problem Reports<\/a><\/p>/, '')).toBe(draw(false));
  });

  it('the gate tells the screen whether Report a Problem is offered', async () => {
    for (const offered of [true, false]) {
      vi.resetModules();
      vi.doMock(resolve('apps/web/lib/customer-page-session.ts'), () => ({
        customerIdentity: async () => identity,
      }));
      vi.doMock(resolve('apps/web/lib/problem-reports-offered.ts'), () => ({
        problemReportsOffered: async () => offered,
      }));
      const { IdentifiedClosedAccountGate } = await load(
        'components/customer-closed-account-server.tsx',
      );
      const { ClosedAccountGate } = await load('components/customer-closed-account.tsx');
      const element = (await IdentifiedClosedAccountGate({ children: 'page' })) as {
        type: unknown;
        props: Record<string, unknown>;
      };
      expect(element.type).toBe(ClosedAccountGate);
      expect(element.props.problemReports).toBe(offered);
    }
  });
});
