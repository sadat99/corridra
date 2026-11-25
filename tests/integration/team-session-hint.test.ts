import { describe, expect, it } from 'vitest';
import { teamSessionHinted, withTeamSessionHint } from '../../apps/web/lib/team-session-hint';

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
