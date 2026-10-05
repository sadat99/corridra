import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createIdentity } from '../../packages/auth/src/index';
import { AccessService } from '../../packages/auth/src/access';
import { fixture, sandbox } from './support';
import { hashPassword } from '../../packages/auth/src/bootstrap';
let f: Awaited<ReturnType<typeof fixture>>, identity: ReturnType<typeof createIdentity>;
const password = randomBytes(24).toString('base64url');
const origin = 'http://localhost:4100';
const jar = new Map<string, string>();
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function request(path: string, body?: unknown, requestOrigin = origin) {
  const response = await identity.handler(
    new Request(origin + '/api/auth' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: cookies() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const at = pair.indexOf('=');
    const name = pair.slice(0, at),
      value = pair.slice(at + 1);
    if (header.includes('Max-Age=0')) jar.delete(name);
    else jar.set(name, value);
  }
  return { response, data: await response.json() };
}
beforeAll(async () => {
  f = await fixture();
  const uid = f.users.owner.identityId;
  await f.owner.query('DELETE FROM identity.session WHERE "userId"=$1', [uid]);
  await f.owner.query('UPDATE identity."user" SET "twoFactorEnabled"=false WHERE id=$1', [uid]);
  await f.owner.query(
    'INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',
    [randomUUID(), uid, await hashPassword(password)],
  );
  identity = createIdentity({ pool: f.auth, baseURL: origin, secret: sandbox.authSecret });
});
afterAll(async () => {
  await f?.close();
});
test('public registration and cross-origin sign-in are rejected', async () => {
  const signup = await request('/sign-up/email', {
    email: 'attacker@example.invalid',
    name: 'Synthetic',
    password,
  });
  expect(signup.response.ok).toBe(false);
  const cross = await request(
    '/sign-in/email',
    { email: 'owner@example.invalid', password },
    'https://untrusted.invalid',
  );
  expect(cross.response.status).toBe(403);
});
test('a password-only session cannot access any tenant', async () => {
  const r = await request('/sign-in/email', { email: 'owner@example.invalid', password });
  expect(r.response.ok, JSON.stringify({ status: r.response.status, code: r.data.code })).toBe(
    true,
  );
  const session = await identity.provider.getSession(new Headers({ Cookie: cookies() }));
  expect(session).not.toBeNull();
  expect(await new AccessService(f.runtime).tenants(session!.token)).toEqual([]);
});
test('real TOTP enrollment creates strong assurance; failed codes cannot refresh it', async () => {
  const enrollment = await request('/two-factor/enable', { password });
  expect(
    enrollment.response.ok,
    JSON.stringify({ status: enrollment.response.status, code: enrollment.data.code }),
  ).toBe(true);
  expect(enrollment.data.totpURI).toBeTypeOf('string');
  const secret = new URL(enrollment.data.totpURI).searchParams.get('secret')!;
  const code = { code: totp(secret) };
  const verified = await request('/two-factor/verify-totp', {
    code: code.code,
    trustDevice: false,
  });
  expect(
    verified.response.ok,
    JSON.stringify({ status: verified.response.status, code: verified.data.code }),
  ).toBe(true);
  const session = await identity.provider.getSession(new Headers({ Cookie: cookies() }));
  expect(session).not.toBeNull();
  expect((await new AccessService(f.runtime).tenants(session!.token)).map((t) => t.id)).toContain(
    f.tenantA,
  );
  const old = (
    await f.owner.query(
      'SELECT verified_at FROM identity.assurance a JOIN identity.session s ON s.id=a.session_id WHERE s.token=$1',
      [session!.token],
    )
  ).rows[0].verified_at;
  const invalid = await request('/two-factor/verify-totp', {
    code: 'not-a-code',
    trustDevice: false,
  });
  expect(invalid.response.ok).toBe(false);
  expect(
    (
      await f.owner.query(
        'SELECT verified_at FROM identity.assurance a JOIN identity.session s ON s.id=a.session_id WHERE s.token=$1',
        [session!.token],
      )
    ).rows[0].verified_at,
  ).toEqual(old);
});
test('sign-out revokes the database session and cascading MFA grant', async () => {
  const session = await identity.provider.getSession(new Headers({ Cookie: cookies() }));
  expect(session).not.toBeNull();
  const result = await request('/sign-out', {});
  expect(result.response.ok).toBe(true);
  expect(await identity.provider.getSession(new Headers({ Cookie: cookies() }))).toBeNull();
  expect(await new AccessService(f.runtime).tenants(session!.token)).toEqual([]);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int AS n FROM identity.security_event WHERE action='session.delete'",
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
});

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
