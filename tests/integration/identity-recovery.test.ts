import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createIdentity } from '../../packages/auth/src/index';
import { operatorRecoveryMailer } from '../../packages/auth/src/recovery-mail';
import { AccessService } from '../../packages/auth/src/access';
import { hashPassword } from '../../packages/auth/src/bootstrap';
import { fixture, sandbox } from './support';

const origin = 'http://localhost:4100';
const password = randomBytes(24).toString('base64url');
const replacement = randomBytes(24).toString('base64url');
let f: Awaited<ReturnType<typeof fixture>>;
let identity: ReturnType<typeof createIdentity>;
const mail: { email: string; url: string }[] = [];
const jar = new Map<string, string>();
const cookies = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
async function request(path: string, body?: unknown, requestOrigin = origin) {
  const response = await identity.handler(
    new Request(`${origin}/api/operator-auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: requestOrigin, 'Content-Type': 'application/json', Cookie: cookies() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const at = pair.indexOf('=');
    if (header.includes('Max-Age=0')) jar.delete(pair.slice(0, at));
    else jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return { response, data: await response.json() };
}
const ask = (email = 'owner@example.invalid') =>
  request('/request-password-reset', { email, redirectTo: `${origin}/operator/reset-password` });
const token = () => new URL(mail.at(-1)!.url).pathname.split('/').at(-1)!;
beforeAll(async () => {
  f = await fixture();
  await f.owner.query('UPDATE identity."user" SET "twoFactorEnabled"=false WHERE id=$1', [
    f.users.owner.identityId,
  ]);
  await f.owner.query(
    'INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',
    [randomUUID(), f.users.owner.identityId, await hashPassword(password)],
  );
  identity = createIdentity({
    pool: f.auth,
    baseURL: origin,
    basePath: '/api/operator-auth',
    secret: sandbox.authSecret,
    sendPasswordRecovery: async (message) => {
      mail.push(message);
    },
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await f?.close();
});

test('reset revokes existing sessions, keeps real TOTP and permissions, consumes once and rejects the old password', async () => {
  expect(
    (await request('/sign-in/email', { email: 'owner@example.invalid', password })).response.ok,
  ).toBe(true);
  const enrol = await request('/two-factor/enable', { password });
  expect(enrol.response.ok).toBe(true);
  const secret = new URL(enrol.data.totpURI).searchParams.get('secret')!;
  expect(
    (await request('/two-factor/verify-totp', { code: totp(secret), trustDevice: false })).response
      .ok,
  ).toBe(true);
  const old = await identity.provider.getSession(new Headers({ Cookie: cookies() }));
  expect((await new AccessService(f.runtime).tenants(old!.token)).length).toBeGreaterThan(0);
  const mfa = (
    await f.owner.query('SELECT * FROM identity."twoFactor" WHERE "userId"=$1', [
      f.users.owner.identityId,
    ])
  ).rows;
  const membership = (
    await f.owner.query('SELECT * FROM app.membership WHERE user_id=$1', [f.users.owner.id])
  ).rows;
  expect((await ask()).response.status).toBe(200);
  expect(mail).toHaveLength(1);
  const resetToken = token();
  expect(
    (await request('/reset-password', { token: resetToken, newPassword: replacement })).response.ok,
  ).toBe(true);
  expect(await new AccessService(f.runtime).tenants(old!.token)).toEqual([]);
  expect(await identity.provider.getSession(new Headers({ Cookie: cookies() }))).toBeNull();
  expect(
    (
      await f.owner.query('SELECT * FROM identity."twoFactor" WHERE "userId"=$1', [
        f.users.owner.identityId,
      ])
    ).rows,
  ).toEqual(mfa);
  expect(
    (await f.owner.query('SELECT * FROM app.membership WHERE user_id=$1', [f.users.owner.id])).rows,
  ).toEqual(membership);
  expect(
    (await request('/reset-password', { token: resetToken, newPassword: password })).response.ok,
  ).toBe(false);
  expect(
    (await request('/sign-in/email', { email: 'owner@example.invalid', password })).response.ok,
  ).toBe(false);
  const signin = await request('/sign-in/email', {
    email: 'owner@example.invalid',
    password: replacement,
  });
  expect(signin.data.twoFactorRedirect).toBe(true);
  expect(await identity.provider.getSession(new Headers({ Cookie: cookies() }))).toBeNull();
  expect(
    (
      await f.owner.query(
        "SELECT action FROM identity.security_event WHERE identity_id=$1 AND action='credential.password.changed'",
        [f.users.owner.identityId],
      )
    ).rowCount,
  ).toBe(1);
});

test('unknown, suspended and unverified accounts have the same response without delivery or activation', async () => {
  const baseline = await ask('unknown@example.invalid');
  await f.owner.query('UPDATE identity.principal SET disabled_at=now() WHERE id=$1', [
    f.users.owner.id,
  ]);
  const suspended = await ask();
  await f.owner.query('UPDATE identity.principal SET disabled_at=NULL WHERE id=$1', [
    f.users.owner.id,
  ]);
  await f.owner.query('UPDATE identity."user" SET "emailVerified"=false WHERE id=$1', [
    f.users.owner.identityId,
  ]);
  const unverified = await ask();
  await f.owner.query('UPDATE identity."user" SET "emailVerified"=true WHERE id=$1', [
    f.users.owner.identityId,
  ]);
  expect(baseline.response.status).toBe(200);
  expect(suspended.data).toEqual(baseline.data);
  expect(unverified.data).toEqual(baseline.data);
  expect(mail).toHaveLength(1);
});

test('expiry, cross-origin requests, unapproved callbacks and recovery rate limits deny access', async () => {
  await f.owner.query('DELETE FROM identity."rateLimit"');
  expect((await ask()).response.ok).toBe(true);
  const resetToken = token();
  await f.owner.query(
    'UPDATE identity.verification SET "expiresAt"=now()-interval \'1 minute\' WHERE identifier=$1',
    [`reset-password:${resetToken}`],
  );
  expect(
    (await request('/reset-password', { token: resetToken, newPassword: password })).response.ok,
  ).toBe(false);
  expect(
    (
      await request(
        '/request-password-reset',
        { email: 'owner@example.invalid', redirectTo: `${origin}/operator/reset-password` },
        'https://untrusted.invalid',
      )
    ).response.status,
  ).toBe(403);
  expect(
    (
      await request('/request-password-reset', {
        email: 'owner@example.invalid',
        redirectTo: 'https://untrusted.invalid/reset',
      })
    ).response.status,
  ).toBe(400);
  expect(
    (
      await request('/request-password-reset', {
        email: 'owner@example.invalid',
        redirectTo: `${origin}/account`,
      })
    ).response.status,
  ).toBe(400);
  const sent = mail.length;
  for (let i = 0; i < 5; i++) await ask('unknown@example.invalid');
  expect((await ask()).response.status).toBe(429);
  expect(mail).toHaveLength(sent);
});

test('named membership directory retains workspace authorization and last-owner protection', async () => {
  const access = new AccessService(f.runtime, f.auth);
  const members = await access.members(f.users.other.ctx);
  expect(members.map((member) => member.name)).toContain('Synthetic other');
  expect(members.map((member) => member.name)).not.toContain('Synthetic owner');
  await expect(access.members(f.users.viewer.ctx)).rejects.toThrow();
  await expect(access.members({ ...f.users.other.ctx, tenantId: f.tenantA })).rejects.toThrow();
  await expect(
    access.changeMember(f.users.other.ctx, {
      userId: f.users.other.id,
      role: 'viewer',
      revoked: true,
    }),
  ).rejects.toThrow();
});

test('identity mail is opt-in, uses the fixed provider and excludes redirected or malformed links', async () => {
  expect(operatorRecoveryMailer({})).toBeUndefined();
  expect(operatorRecoveryMailer({ CORRIDRA_OPERATOR_RECOVERY_ENABLED: 'true' })).toBeUndefined();
  const send = operatorRecoveryMailer({
    APP_ORIGIN: origin,
    CORRIDRA_OPERATOR_RECOVERY_ENABLED: 'true',
    OPERATOR_RECOVERY_EMAIL_KEY: randomBytes(24).toString('hex'),
    OPERATOR_RECOVERY_EMAIL_FROM: 'identity@example.invalid',
  })!;
  const transport = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
  await expect(
    send({ email: 'owner@example.invalid', url: 'https://untrusted.invalid/reset' }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  await send({
    email: 'owner@example.invalid',
    url: `${origin}/api/operator-auth/reset-password/abcdefghijklmnopqrstuvwx?callbackURL=${encodeURIComponent(origin + '/operator/reset-password')}`,
  });
  expect(transport.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  vi.unstubAllGlobals();
});

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '')]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  return ((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0');
}
