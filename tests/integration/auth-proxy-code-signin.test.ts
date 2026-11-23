import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// B1 (23 Nov 2026). The customer auth proxy, the sign-in page's `next` handling and the security headers.
// No provider, no database, no browser: the provider handler is a recorder, so this proves what the proxy
// forwards and refuses, not that a real code is accepted. The provider behaviour it relies on is recorded in
// docs/runbooks/neon-auth-accounts.md.
const web = createRequire(resolve('apps/web/package.json'));
const origin = 'https://app.example.invalid';
type Reply = { status: number; body: Record<string, unknown>; cookie?: string };
type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let replies: Record<string, Reply | 'throw'> = {};

beforeEach(() => {
  vi.resetModules();
  calls = [];
  replies = {};
  vi.doMock('server-only', () => ({}));
  Object.assign(process.env, {
    CORRIDRA_NEON_AUTH_ENABLED: 'true',
    NEON_AUTH_BASE_URL: 'https://ep-b1-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
    NEON_AUTH_COOKIE_SECRET: 'f'.repeat(64),
    APP_ORIGIN: origin,
  });
  const answer = async (request: Request, context: { params: Promise<{ path: string[] }> }) => {
    const path = (await context.params).path.join('/');
    calls.push({
      method: request.method,
      path,
      body: request.method === 'GET' ? null : JSON.parse(await request.text()),
    });
    const reply = replies[path] ?? { status: 200, body: { success: true } };
    if (reply === 'throw') throw new Error('provider unreachable');
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: {
        'Content-Type': 'application/json',
        ...(reply.cookie ? { 'Set-Cookie': reply.cookie } : {}),
      },
    });
  };
  vi.doMock('../../apps/web/lib/neon-auth', () => ({
    neonAuth: () => ({ handler: () => ({ GET: answer, POST: answer }) }),
  }));
});

async function call(
  path: string,
  init: { method?: string; body?: string; origin?: string | null } = {},
) {
  const route = await import('../../apps/web/app/api/auth/[...all]/route');
  const method = init.method ?? 'POST';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const from = init.origin === undefined ? origin : init.origin;
  if (from) headers.set('Origin', from);
  const request = new Request(`${origin}/api/auth/${path}`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: init.body ?? '{}' }),
  });
  return route[method as 'GET' | 'POST'](request, {
    params: Promise.resolve({ all: path.split('/') }),
  });
}
const code = JSON.stringify({ email: 'Person@Example.invalid', otp: '123456' });

describe('the customer auth proxy and sign-in with a code (D-015)', () => {
  it('still answers 404 for a path that is not on the list, and never asks the provider', async () => {
    for (const path of ['update-user', 'sign-in/social', 'email-otp/check-verification-otp']) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls).toEqual([]);
  });

  it('accepts POST sign-in/email-otp: checks the code first, then forwards only the email and the code', async () => {
    replies['sign-in/email-otp'] = {
      status: 200,
      body: { token: 't', user: { id: 'u' } },
      cookie: 'session=abc; Path=/; HttpOnly',
    };
    const response = await call('sign-in/email-otp', {
      body: JSON.stringify({
        email: 'Person@Example.invalid',
        otp: '123456',
        name: 'Made Up',
        image: 'https://example.invalid/x.png',
        role: 'admin',
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('session=abc');
    expect(calls).toEqual([
      {
        method: 'POST',
        path: 'email-otp/check-verification-otp',
        body: { email: 'Person@Example.invalid', type: 'sign-in', otp: '123456' },
      },
      {
        method: 'POST',
        path: 'sign-in/email-otp',
        body: { email: 'Person@Example.invalid', otp: '123456' },
      },
    ]);
  });

  it('never creates an account by code: an address with no account is refused before sign-in is asked', async () => {
    replies['email-otp/check-verification-otp'] = {
      status: 400,
      body: { code: 'USER_NOT_FOUND', message: 'User not found' },
    };
    const response = await call('sign-in/email-otp', { body: code });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'ACCOUNT_REQUIRED', error: 'Account required' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls.map((c) => c.path)).toEqual(['email-otp/check-verification-otp']);
  });

  it('passes a refused code back with its status and code only, and does not ask for the sign-in', async () => {
    // The browser client keeps only the status, so too many tries (403 at the provider) is answered as 429.
    for (const [status, refusal, answered] of [
      [400, 'INVALID_OTP', 400],
      [400, 'OTP_EXPIRED', 400],
      [403, 'TOO_MANY_ATTEMPTS', 429],
      [403, '', 403],
      [429, '', 429],
    ] as const) {
      calls = [];
      replies['email-otp/check-verification-otp'] = {
        status,
        body: { code: refusal, message: 'Provider words that must not be shown' },
      };
      const response = await call('sign-in/email-otp', { body: code });
      expect(response.status, refusal).toBe(answered);
      expect(await response.json()).toEqual({ code: refusal, error: 'Sign-in refused' });
      expect(calls.map((c) => c.path)).toEqual(['email-otp/check-verification-otp']);
    }
  });

  it('fails closed when the check itself is unavailable', async () => {
    for (const reply of [{ status: 404, body: {} }, { status: 500, body: {} }, 'throw'] as const) {
      calls = [];
      replies['email-otp/check-verification-otp'] = reply;
      const response = await call('sign-in/email-otp', { body: code });
      expect(response.status).toBe(503);
      expect(calls.map((c) => c.path)).toEqual(['email-otp/check-verification-otp']);
    }
  });

  it('keeps the same origin, size, method and shape checks as the other paths', async () => {
    expect(
      (await call('sign-in/email-otp', { body: code, origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await call('sign-in/email-otp', { body: code, origin: null })).status).toBe(403);
    expect((await call('sign-in/email-otp', { method: 'GET' })).status).toBe(404);
    expect(
      (
        await call('sign-in/email-otp', {
          body: JSON.stringify({ email: 'a@b.invalid', otp: 'x'.repeat(16400) }),
        })
      ).status,
    ).toBe(413);
    for (const body of ['not json', '[]', '{"email":"a@b.invalid"}', '{"email":7,"otp":"123456"}'])
      expect((await call('sign-in/email-otp', { body })).status, body).toBe(400);
    expect(calls).toEqual([]);
  });

  it('leaves the other allowed paths forwarded as they were', async () => {
    const body = JSON.stringify({ email: 'person@example.invalid', type: 'sign-in' });
    expect((await call('email-otp/send-verification-otp', { body })).status).toBe(200);
    expect((await call('get-session', { method: 'GET' })).status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST email-otp/send-verification-otp',
      'GET get-session',
    ]);
    expect(calls[0]!.body).toEqual({ email: 'person@example.invalid', type: 'sign-in' });
  });
});

describe('the sign-up name rule at the proxy (D-028)', () => {
  const signUp = (name: unknown) =>
    call('sign-up/email', {
      body: JSON.stringify({ name, email: 'person@example.invalid', password: 'x'.repeat(14) }),
    });
  it('refuses a name outside 1 to 100 characters before the provider is asked', async () => {
    for (const name of ['', '   ', 'n'.repeat(101), 'Line\nBreak', 7, undefined]) {
      const response = await signUp(name);
      expect(response.status, String(name)).toBe(400);
      expect(await response.json()).toEqual({ error: 'Name is not valid', code: 'INVALID_NAME' });
    }
    expect(calls).toEqual([]);
  });
  it('forwards a name of 1 and of 100 characters unchanged', async () => {
    for (const name of ['A', 'n'.repeat(100), '\u{1F642}'.repeat(100)]) {
      calls = [];
      expect((await signUp(name)).status).toBe(200);
      expect(calls).toEqual([
        {
          method: 'POST',
          path: 'sign-up/email',
          body: { name, email: 'person@example.invalid', password: 'x'.repeat(14) },
        },
      ]);
    }
  });
});

describe('/signin?next= (D-027)', () => {
  async function landing(query: Record<string, string>, env: Record<string, string>) {
    vi.doMock(web.resolve('next/navigation'), () => ({
      redirect: (to: string) => {
        throw new Error(`REDIRECT ${to}`);
      },
    }));
    vi.doMock(web.resolve('next/link'), () => ({ default: () => null }));
    for (const file of [
      'public-shell.tsx',
      'arrow.tsx',
      'account-access.tsx',
      'access-options.tsx',
    ])
      vi.doMock(resolve('apps/web/components', file), () => ({
        PublicShell: () => null,
        Arrow: () => null,
        AccountAccess: () => null,
        AccessOptions: () => null,
      }));
    const before = { ...process.env };
    Object.assign(process.env, env);
    try {
      // A computed path: the page is a .tsx file, which the package type check does not read.
      const file = resolve('apps/web/app/signin/page.tsx');
      const page = (await import(file)) as {
        default: (props: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
      };
      await page.default({ searchParams: Promise.resolve(query) });
      return 'RENDERED';
    } catch (error) {
      return (error as Error).message;
    } finally {
      for (const key of Object.keys(env)) delete process.env[key];
      Object.assign(process.env, before);
    }
  }
  const emailPages = { CORRIDRA_PULSE_ENABLED: 'true' };

  it('keeps a reviewed deeper page as returnTo', async () => {
    expect(await landing({ next: '/account/move' }, emailPages)).toBe(
      'REDIRECT /signin?returnTo=%2Faccount%2Fmove',
    );
    expect(await landing({ next: '/account/move', method: 'code' }, emailPages)).toBe(
      'REDIRECT /signin?returnTo=%2Faccount%2Fmove&method=code',
    );
    expect(await landing({ next: '/plan' }, {})).toBe('REDIRECT /signin?returnTo=%2Fplan');
  });

  it('drops an outside address, a page that is not reviewed, and the fallback itself', async () => {
    for (const next of [
      'https://evil.example/account/move',
      '//evil.example/account/move',
      '/account/move?x=1',
      '/account/billing',
      '/account',
    ])
      expect(await landing({ next }, emailPages), next).toBe('REDIRECT /signin');
    // Without the email pages switch only the request form and the organiser page are kept.
    expect(await landing({ next: '/account/move' }, {})).toBe('REDIRECT /signin');
  });
});

describe('security headers for every page (D-014)', () => {
  const config = readFileSync(resolve('apps/web/next.config.ts'), 'utf8');
  const all = /source:\s*'\/:path\*',\s*headers:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
  it('finds the rule for every path with the headers it already had', () => {
    for (const key of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ])
      expect(all, key).toContain(`key: '${key}'`);
  });
  it('sends Cross-Origin-Opener-Policy: same-origin', () => {
    expect(all).toContain("{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }");
  });
});
