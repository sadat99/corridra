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
