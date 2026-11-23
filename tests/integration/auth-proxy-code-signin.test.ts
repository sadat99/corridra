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
type Call = { method: string; path: string; body: unknown; type?: string | null };
let hold: Promise<void> | null = null;
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
    CORRIDRA_CUSTOMER_CODE_SIGNIN: 'true',
  });
  hold = null;
  const answer = async (request: Request, context: { params: Promise<{ path: string[] }> }) => {
    const path = (await context.params).path.join('/');
    calls.push({
      method: request.method,
      path,
      body: request.method === 'GET' ? null : JSON.parse(await request.text()),
      type: request.headers.get('content-type'),
    });
    if (hold) await hold;
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
  const seen = () => calls.map((c) => c.path);
  it('still answers 404 for a path that is not on the list, and never asks the provider', async () => {
    for (const path of ['update-user', 'sign-in/social', 'email-otp/check-verification-otp']) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls).toEqual([]);
  });

  it('answers 404 while the switch is not exactly true, and never asks the provider', async () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      if (value === undefined) delete process.env.CORRIDRA_CUSTOMER_CODE_SIGNIN;
      else process.env.CORRIDRA_CUSTOMER_CODE_SIGNIN = value;
      expect((await call('sign-in/email-otp', { body: code })).status, String(value)).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it('a valid code for an existing account: checks first, then forwards only the email and the code as JSON', async () => {
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
        type: 'application/json',
      },
      {
        method: 'POST',
        path: 'sign-in/email-otp',
        body: { email: 'Person@Example.invalid', otp: '123456' },
        type: 'application/json',
      },
    ]);
  });

  it('gives one answer, byte for byte, for no account, a wrong code, an expired code and too many tries', async () => {
    const answers: string[] = [];
    // The older provider says USER_NOT_FOUND before it looks at the code; the newer one after a valid code.
    for (const [status, refusal] of [
      [400, 'USER_NOT_FOUND'],
      [400, 'INVALID_OTP'],
      [400, 'OTP_EXPIRED'],
      [403, 'TOO_MANY_ATTEMPTS'],
      [401, ''],
      [422, 'VALIDATION_ERROR'],
    ] as const) {
      calls = [];
      replies['email-otp/check-verification-otp'] = {
        status,
        body: { code: refusal, message: 'Provider words that must not be shown' },
        cookie: 'leak=1',
      };
      const response = await call('sign-in/email-otp', { body: code });
      expect(response.headers.get('set-cookie'), refusal).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      answers.push(`${response.status} ${await response.text()}`);
      // No account is ever created by code: the sign-in itself is not asked.
      expect(seen()).toEqual(['email-otp/check-verification-otp']);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe('400 {"error":"Sign-in refused","code":"CODE_REFUSED"}');
    // A refusal by the sign-in itself, after a passed check, reads the same.
    calls = [];
    delete replies['email-otp/check-verification-otp'];
    replies['sign-in/email-otp'] = { status: 400, body: { code: 'INVALID_OTP' }, cookie: 'leak=1' };
    const late = await call('sign-in/email-otp', { body: code });
    expect(`${late.status} ${await late.text()}`).toBe(answers[0]);
    expect(late.headers.get('set-cookie')).toBeNull();
  });

  it('says 429 for a provider rate limit and fails closed with 503 when the check is unavailable', async () => {
    replies['email-otp/check-verification-otp'] = { status: 429, body: {} };
    expect((await call('sign-in/email-otp', { body: code })).status).toBe(429);
    for (const reply of [{ status: 404, body: {} }, { status: 500, body: {} }, 'throw'] as const) {
      calls = [];
      replies['email-otp/check-verification-otp'] = reply;
      const response = await call('sign-in/email-otp', { body: code });
      expect(response.status).toBe(503);
      expect(seen()).toEqual(['email-otp/check-verification-otp']);
    }
  });

  it('runs one attempt per address at a time: parallel guesses do not reach the provider', async () => {
    let release = () => {};
    hold = new Promise<void>((done) => (release = done));
    replies['email-otp/check-verification-otp'] = { status: 400, body: { code: 'INVALID_OTP' } };
    const guess = (email: string, otp: string) =>
      call('sign-in/email-otp', { body: JSON.stringify({ email, otp }) });
    const first = guess('Person@Example.invalid', '000001');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const parallel = await Promise.all(
      ['000002', '000003', '000004'].map((otp) => guess('person@example.INVALID', otp)),
    );
    expect(parallel.map((r) => r.status)).toEqual([429, 429, 429]);
    expect(calls).toHaveLength(1);
    // Another address is not held up.
    const other = guess('other@example.invalid', '000001');
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    release();
    expect((await first).status).toBe(400);
    expect((await other).status).toBe(400);
    // The address is free again once its attempt has ended, also after a provider failure.
    hold = null;
    replies['email-otp/check-verification-otp'] = 'throw';
    expect((await guess('person@example.invalid', '000005')).status).toBe(503);
    replies['email-otp/check-verification-otp'] = { status: 400, body: {} };
    expect((await guess('person@example.invalid', '000006')).status).toBe(400);
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
          type: 'application/json',
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
