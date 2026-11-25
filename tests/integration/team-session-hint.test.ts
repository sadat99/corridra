import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  missingTeamSessionHint,
  teamSessionHinted,
  withTeamSessionHint,
} from '../../apps/web/lib/team-session-hint';

// Audit row public-customer-24: the plain marker beside the HttpOnly team session cookie. Set when Better Auth sets the
// session token or a session read finds a session; cleared when the token is cleared or a read finds none.
const hint = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith('corridra-team='));
const answer = (body: unknown, cookies: string[] = [], status = 200) => {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
};
const at = (path: string) => new Request(`https://c.example.test/api/operator-auth/${path}`);

describe('withTeamSessionHint', () => {
  it('sets the marker when sign-in sets the session token, Secure on https', async () => {
    const response = await withTeamSessionHint(
      at('two-factor/verify-totp'),
      answer({ token: 't' }, [
        '__Secure-better-auth.session_token=abc.def; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax',
      ]),
      true,
    );
    expect(hint(response)).toBe('corridra-team=1; Path=/; Max-Age=86400; SameSite=Lax; Secure');
    // The session cookie itself is untouched and stays HttpOnly.
    expect(response.headers.getSetCookie()[0]).toContain('HttpOnly');
  });

  it('clears the marker when sign-out clears the session token', async () => {
    const response = await withTeamSessionHint(
      at('sign-out'),
      answer({ success: true }, ['better-auth.session_token=; Max-Age=0; Path=/; HttpOnly']),
      false,
    );
    expect(hint(response)).toBe('corridra-team=; Path=/; Max-Age=0; SameSite=Lax');
  });

  it('follows a session read: a session keeps the marker, none clears it', async () => {
    expect(
      hint(await withTeamSessionHint(at('get-session'), answer({ session: { id: 's' } }), false)),
    ).toBe('corridra-team=1; Path=/; Max-Age=86400; SameSite=Lax');
    expect(hint(await withTeamSessionHint(at('get-session'), answer(null), false))).toBe(
      'corridra-team=; Path=/; Max-Age=0; SameSite=Lax',
    );
  });

  it('leaves every other answer alone, and never reads a refused session read', async () => {
    expect(hint(await withTeamSessionHint(at('sign-in/email'), answer({}), true))).toBeUndefined();
    expect(
      hint(await withTeamSessionHint(at('get-session'), answer({ message: 'no' }, [], 429), true)),
    ).toBeUndefined();
    // The two-factor cookie is not the session token.
    expect(
      hint(
        await withTeamSessionHint(
          at('sign-in/email'),
          answer({ twoFactorRedirect: true }, ['better-auth.two_factor=x; Max-Age=600; Path=/']),
          true,
        ),
      ),
    ).toBeUndefined();
  });
});

describe('teamSessionHinted', () => {
  it('reads only the exact marker', () => {
    expect(teamSessionHinted('a=1; corridra-team=1; b=2')).toBe(true);
    expect(teamSessionHinted('corridra-team=1')).toBe(true);
    expect(teamSessionHinted('corridra-team=')).toBe(false);
    expect(teamSessionHinted('corridra-team=0; x-corridra-team=1')).toBe(false);
    expect(teamSessionHinted('')).toBe(false);
  });
});

describe('missingTeamSessionHint (the page proxy)', () => {
  it('adds the marker for a team session token without one, Secure on https', () => {
    expect(missingTeamSessionHint('__Secure-better-auth.session_token=abc.def', true)).toBe(
      'corridra-team=1; Path=/; Max-Age=86400; SameSite=Lax; Secure',
    );
    expect(missingTeamSessionHint('x=1; better-auth.session_token=abc', false)).toBe(
      'corridra-team=1; Path=/; Max-Age=86400; SameSite=Lax',
    );
  });
  it('adds nothing when the marker is there, or for any other cookie', () => {
    expect(
      missingTeamSessionHint('better-auth.session_token=abc; corridra-team=1', false),
    ).toBeNull();
    for (const cookies of [
      null,
      '',
      '__Secure-neon-auth.session_token=customer',
      'better-auth.session_data=abc',
      'better-auth.two_factor=abc',
      'better-auth.session_token=',
    ])
      expect(missingTeamSessionHint(cookies, true), String(cookies)).toBeNull();
  });
});

describe('the page proxy', () => {
  it('appends the marker on a page for a team session from before the marker, and nothing otherwise', async () => {
    // `next` is installed for the app, not at the root: load it the way the app does.
    const { NextRequest } = createRequire(resolve('apps/web/package.json'))('next/server') as {
      NextRequest: new (url: string, init?: { headers?: Record<string, string> }) => Request;
    };
    const { proxy } = (await import('../../apps/web/proxy')) as unknown as {
      proxy: (request: Request) => Response;
    };
    const page = (cookie?: string) =>
      new NextRequest('http://127.0.0.1:3100/about', {
        headers: cookie ? { cookie } : {},
      });
    const hinted = proxy(page('better-auth.session_token=abc'));
    expect(hinted.headers.getSetCookie()).toEqual([
      'corridra-team=1; Path=/; Max-Age=86400; SameSite=Lax',
    ]);
    expect(proxy(page()).headers.getSetCookie()).toEqual([]);
    expect(
      proxy(page('better-auth.session_token=abc; corridra-team=1')).headers.getSetCookie(),
    ).toEqual([]);
  });
});
