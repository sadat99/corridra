import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// ADR-086. Every account security control ships switched off, with no probe record, and a control that is off makes its
// route answer 404 before the provider or the database is touched. The auth proxy allowlist is pinned: account changes
// never reach the browser-facing provider endpoints.
const touched: string[] = [];
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async () => {
      touched.push('getSession');
      return { data: { user: { id: 'user-1', emailVerified: true } }, error: null };
    },
    updateUser: async () => {
      touched.push('updateUser');
      return { data: {}, error: null };
    },
  }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'http://localhost' },
    customerPersonalProfiles: {
      nameChangePreflight: async () => {
        touched.push('preflight');
        return { limited: false, noted: false };
      },
      noteSecurityChange: async () => touched.push('note'),
    },
  }),
}));

describe('account security capabilities', () => {
  test('all four controls are off and no probe is recorded', async () => {
    const { accountSecurityCapabilities } =
      await import('../../apps/web/lib/account-security-capabilities');
    expect(accountSecurityCapabilities).toEqual({
      updateName: false,
      changePassword: false,
      listSessions: false,
      revokeSession: false,
      probe: null,
    });
    expect(Object.isFrozen(accountSecurityCapabilities)).toBe(true);
  });

  test('with updateName off the name route answers 404 and touches nothing', async () => {
    const { POST } = await import('../../apps/web/app/api/account/name/route');
    const response = await POST(
      new Request('http://localhost/api/account/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ commandId: randomUUID(), name: 'Synthetic Name' }),
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(touched).toEqual([]);
  });

  test('the auth proxy allowlist is unchanged: no account change path reaches the browser', () => {
    const source = readFileSync(resolve('apps/web/app/api/auth/[...all]/route.ts'), 'utf8');
    const block = source.slice(
      source.indexOf('const paths = new Set(['),
      source.indexOf(']);') + 3,
    );
    expect(block).toBe(`const paths = new Set([
  'sign-in/email',
  'sign-up/email',
  'sign-out',
  'get-session',
  'email-otp/send-verification-otp',
  'email-otp/verify-email',
  'request-password-reset',
  'reset-password',
]);`);
    for (const banned of [
      'update-user',
      'change-password',
      'list-sessions',
      'revoke-session',
      'revoke-other-sessions',
      'revoke-sessions',
    ])
      expect(source).not.toContain(banned);
  });

  test('no application code calls the banned bulk revocations', () => {
    for (const file of [
      'apps/web/app/api/account/name/route.ts',
      'apps/web/lib/account-provider-guard.ts',
      'apps/web/lib/account-security-capabilities.ts',
    ]) {
      const source = readFileSync(resolve(file), 'utf8');
      expect(source).not.toMatch(/revokeOtherSessions|revokeSessions\b/);
    }
  });
});
