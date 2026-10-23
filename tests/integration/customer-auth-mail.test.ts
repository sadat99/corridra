import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthMailError,
  handleCustomerAuthMail,
  maxWebhookBytes,
  readAuthMailConfig,
  resetAuthMailCaches,
  type MailSender,
} from '../../packages/auth/src/customer-auth-mail';
import {
  authMailCatalog,
  authMailColours,
  authMailPlaceholders,
  contrastRatio,
  directionOf,
  escapeHtml,
  expiryWords,
  renderAuthMail,
  type AuthMailKind,
} from '../../packages/auth/src/customer-auth-mail-templates';

const kid = '01dec52b-4666-40f7-87ed-6423552eecaf';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const jwk = { ...publicKey.export({ format: 'jwk' }), kid };
const jwks = async () => ({ keys: [jwk] });
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const now = Date.parse('2026-10-23T12:00:00.000Z');

const env: NodeJS.ProcessEnv = {
  CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED: 'true',
  CUSTOMER_AUTH_MAIL_KEY: 'test-provider-key-0123456789',
  CUSTOMER_AUTH_MAIL_FROM: 'sadat@c.example.invalid',
  CUSTOMER_AUTH_MAIL_REPLY_TO: 'sadat@reply.example.invalid',
  NEON_AUTH_BASE_URL: 'https://ep-test.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
  APP_ORIGIN: 'https://corridra.example.invalid',
};

function otp(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    event_type: 'send.otp',
    timestamp: new Date(now - 1000).toISOString(),
    context: { endpoint_id: 'ep-test', project_name: 'Corridra' },
    user: { id: 'u1', email: 'person@example.invalid', name: 'Jane Smith' },
    event_data: {
      otp_code: '123456',
      otp_type: 'sign-in',
      expires_at: new Date(now + 600000).toISOString(),
      ip_address: '192.0.2.1',
      user_agent: 'test',
      ...data,
    },
    ...over,
  };
}
const link = (data: Record<string, unknown> = {}, user: Record<string, unknown> = {}) => ({
  event_id: '660e8400-e29b-41d4-a716-446655440001',
  event_type: 'send.magic_link',
  timestamp: new Date(now - 1000).toISOString(),
  context: { endpoint_id: 'ep-test', project_name: 'Corridra' },
  user: { email: 'person@example.invalid', name: 'Jane Smith', ...user },
  event_data: {
    link_type: 'forget-password',
    link_url:
      'https://ep-test.neonauth.eu-central-1.aws.neon.tech/neondb/auth/reset-password/abc?callbackURL=https%3A%2F%2Fcorridra.example.invalid%2Freset-password',
    token: 'raw-token-value',
    expires_at: new Date(now + 3600000).toISOString(),
    ...data,
  },
});

/** Signs the way the provider does: detached JWS over double base64url encoding. */
function signed(
  payload: unknown,
  opts: { key?: KeyObject; alg?: string; timestamp?: number; kidHeader?: string; id?: string } = {},
) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(opts.timestamp ?? now);
  const header = b64(JSON.stringify({ alg: opts.alg ?? 'EdDSA', typ: 'JWS', kid }));
  const input = `${header}.${b64(`${timestamp}.${b64(rawBody)}`)}`;
  const signature = sign(null, Buffer.from(input), opts.key ?? privateKey).toString('base64url');
  const headers = new Headers({
    'content-type': 'application/json',
    'x-neon-signature': `${header}..${signature}`,
    'x-neon-signature-kid': opts.kidHeader ?? kid,
    'x-neon-timestamp': timestamp,
    'x-neon-event-id': opts.id ?? (payload as { event_id: string }).event_id,
  });
  return new Request('https://corridra.example.invalid/api/auth-mail', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

let send: ReturnType<typeof vi.fn<MailSender>>;
const run = (request: Request, over: Partial<NodeJS.ProcessEnv> = {}) =>
  handleCustomerAuthMail(request, { env: { ...env, ...over }, jwks, send, now: () => now });

beforeEach(() => {
  resetAuthMailCaches();
  send = vi.fn<MailSender>(async () => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('the webhook receiver', () => {
  it('sends the sign-in code and answers 200 for a correctly signed event', async () => {
    const response = await run(signed(otp()));
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.to).toBe('person@example.invalid');
    expect(call.idempotencyKey).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(call.message.subject).toBe('Your Corridra code: 123456');
    expect(call.config.from).toBe('"Sadat, Corridra" <sadat@c.example.invalid>');
    expect(call.config.replyTo).toBe('sadat@reply.example.invalid');
  });
  it.each([
    ['sign-in', 'Your code to sign in:'],
    ['email-verification', 'Your code to confirm your email address:'],
    ['forget-password', 'Your code to reset your password:'],
  ])('maps the %s code type to its message', async (type, lead) => {
    await run(signed(otp({}, { otp_type: type })));
    expect(send.mock.calls[0][0].message.text).toContain(lead);
  });
  it('sends the password reset link message with the person name and expiry', async () => {
    const response = await run(signed(link()));
    expect(response.status).toBe(200);
    const { message } = send.mock.calls[0][0];
    expect(message.subject).toBe('Reset your Corridra password');
    expect(message.text).toContain('Hi Jane Smith,');
    expect(message.text).toContain('expires in 1 hour');
    expect(message.html).toContain('Choose a new password');
  });
  it('rejects a forged signature', async () => {
    const response = await run(signed(otp(), { key: other.privateKey }));
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a body changed after signing', async () => {
    const request = signed(otp());
    const changed = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(otp({}, { otp_code: '999999' })),
    });
    expect((await run(changed)).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects an algorithm other than EdDSA', async () => {
    for (const alg of ['none', 'HS256', 'RS256']) {
      const response = await run(signed(otp(), { alg }));
      expect(response.status, alg).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects an unknown key id', async () => {
    const response = await run(signed(otp(), { kidHeader: 'not-a-key' }));
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects an event older than five minutes and one far in the future', async () => {
    expect((await run(signed(otp(), { timestamp: now - 5 * 60 * 1000 - 1 }))).status).toBe(401);
    expect((await run(signed(otp(), { timestamp: now + 5 * 60 * 1000 }))).status).toBe(401);
    expect((await run(signed(otp(), { timestamp: now - 4 * 60 * 1000 }))).status).toBe(200);
  });
  it('sends once when the same event id is delivered again', async () => {
    const payload = otp();
    expect((await run(signed(payload))).status).toBe(200);
    const again = await run(signed(payload));
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not remember an event whose first delivery failed, so a retry can send', async () => {
    send.mockRejectedValueOnce(new AuthMailError(503, 'delivery_failed'));
    expect((await run(signed(otp()))).status).toBe(503);
    expect((await run(signed(otp()))).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('rejects a header event id that differs from the signed body', async () => {
    const response = await run(signed(otp(), { id: '00000000-0000-4000-8000-000000000000' }));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects event types it does not send', async () => {
    for (const type of ['user.created', 'user.before_create', 'phone_number.verified'])
      expect((await run(signed({ ...otp(), event_type: type }))).status, type).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('refuses sms delivery, a sign-in link, and a link to another host', async () => {
    expect((await run(signed(otp({}, { delivery_preference: 'sms' })))).status).toBe(400);
    expect((await run(signed(link({ link_type: 'sign-in' })))).status).toBe(400);
    expect(
      (await run(signed(link({ link_url: 'https://evil.example.invalid/reset?token=x' })))).status,
    ).toBe(400);
    expect(
      (await run(signed(link({ link_url: 'http://corridra.example.invalid/x' })))).status,
    ).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a code that is not six digits', async () => {
    expect((await run(signed(otp({}, { otp_code: '12345' })))).status).toBe(400);
    expect((await run(signed(otp({}, { otp_code: '12345a' })))).status).toBe(400);
  });
  it('rejects an oversize body, declared or streamed, before reading it all', async () => {
    const big = { ...otp(), padding: 'x'.repeat(maxWebhookBytes) };
    const base = signed(big);
    const copy = (extra: Record<string, string>) => {
      const headers = new Headers(extra);
      base.headers.forEach((value, key) => headers.set(key, value));
      return new Request(base.url, { method: 'POST', headers, body: JSON.stringify(big) });
    };
    // A declared length is refused without reading the body.
    expect((await run(copy({ 'content-length': String(maxWebhookBytes + 100) }))).status).toBe(413);
    // A body with no declared length is cut off as it streams.
    expect((await run(copy({}))).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a request that is not a POST', async () => {
    const response = await run(
      new Request('https://corridra.example.invalid/api/auth-mail', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
  });
  it('does not exist while the switch is off, whatever else is set', async () => {
    for (const value of [undefined, '', '1', 'TRUE', 'false']) {
      const response = await run(signed(otp()), { CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED: value });
      expect(response.status, String(value)).toBe(404);
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('fails safely and sends nothing when a required setting is missing or invalid', async () => {
    for (const name of [
      'CUSTOMER_AUTH_MAIL_KEY',
      'CUSTOMER_AUTH_MAIL_FROM',
      'CUSTOMER_AUTH_MAIL_REPLY_TO',
      'NEON_AUTH_BASE_URL',
      'APP_ORIGIN',
    ]) {
      const response = await run(signed(otp()), { [name]: undefined });
      expect(response.status, name).toBe(503);
    }
    expect((await run(signed(otp()), { CUSTOMER_AUTH_MAIL_REPLY_TO: 'not-an-email' })).status).toBe(
      503,
    );
    expect((await run(signed(otp()), { CUSTOMER_AUTH_MAIL_KEY: 'short' })).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  it('answers 503 when the mail provider fails, and returns nothing from it', async () => {
    send.mockRejectedValueOnce(new Error('provider said person@example.invalid is bad'));
    const response = await run(signed(otp()));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain('person@example.invalid');
    expect(text).not.toContain('123456');
  });
  it('writes nothing to the console, so no address or code can be logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    await run(signed(otp()));
    await run(signed(otp(), { key: other.privateKey }));
    send.mockRejectedValueOnce(new Error('boom'));
    await run(signed(link()));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
  it('uses a separate settings check from the provider key and never reads it into a response', async () => {
    const response = await run(signed(otp()));
    expect(await response.text()).not.toContain(env.CUSTOMER_AUTH_MAIL_KEY as string);
  });
  it('derives the key address and honours an explicit one', () => {
    expect(readAuthMailConfig(env)?.jwksUrl).toBe(
      'https://ep-test.neonauth.eu-central-1.aws.neon.tech/neondb/auth/.well-known/jwks.json',
    );
    expect(
      readAuthMailConfig({
        ...env,
        CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL: 'https://keys.example.invalid/jwks.json',
      })?.jwksUrl,
    ).toBe('https://keys.example.invalid/jwks.json');
    expect(
      readAuthMailConfig({
        ...env,
        CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL: 'http://keys.example.invalid/jwks.json',
      }),
    ).toBeNull();
  });
});

describe('the email templates', () => {
  const cases: { kind: AuthMailKind; input: Parameters<typeof renderAuthMail>[0] }[] = [
    { kind: 'sign-in-code', input: { kind: 'sign-in-code', code: '482913' } },
    { kind: 'verify-code', input: { kind: 'verify-code', code: '482913' } },
    { kind: 'reset-code', input: { kind: 'reset-code', code: '482913' } },
    {
      kind: 'reset-link',
      input: {
        kind: 'reset-link',
        name: 'Jane',
        expiry: '1 hour',
        linkUrl: 'https://corridra.example.invalid/reset-password?token=abc',
      },
    },
  ];
  it.each(cases)('renders the $kind message with matching html and text', ({ input }) => {
    const mail = renderAuthMail(input);
    for (const part of [mail.subject, mail.preheader, mail.html, mail.text]) {
      expect(part).not.toMatch(/[{}]/);
      expect(part).not.toMatch(/[–—]/);
      expect(part).not.toContain('undefined');
    }
    // The text part says the same words as the html part. Each text line must appear, escaped the
    // way the layout escapes it, inside the html. No tag stripping is needed to prove it.
    for (const line of mail.text.split('\n\n')) {
      const button = /^(Choose a new password): (https:\/\/\S+)$/.exec(line);
      for (const piece of button ? [button[1], button[2]] : [line])
        expect(mail.html, piece).toContain(escapeHtml(piece));
    }
    expect(mail.html).toContain('Sent by Corridra.');
    expect(mail.text.trim().endsWith('Sent by Corridra.')).toBe(true);
  });
  it('uses exactly the agreed words for each message', () => {
    expect(renderAuthMail({ kind: 'sign-in-code', code: '482913' })).toMatchObject({
      subject: 'Your Corridra code: 482913',
      preheader: 'It works once and it expires soon.',
      text: [
        'Your code to sign in:',
        '482913',
        'Type it where you asked for it. It works once and it expires soon.',
        "If you didn't ask for it, ignore this email. Nothing on your account has changed.",
        'Sent by Corridra.',
      ].join('\n\n'),
    });
    expect(renderAuthMail({ kind: 'verify-code', code: '482913' }).text).toBe(
      [
        'Your code to confirm your email address:',
        '482913',
        'Type it where you asked for it. It works once and it expires soon.',
        "If you didn't ask for it, ignore this email. No account will be created.",
        'Sent by Corridra.',
      ].join('\n\n'),
    );
    expect(renderAuthMail({ kind: 'reset-code', code: '482913' }).text).toContain(
      "If you didn't ask for it, ignore this email. Your password stays as it is.",
    );
    expect(
      renderAuthMail({
        kind: 'reset-link',
        name: 'Jane',
        expiry: '1 hour',
        linkUrl: 'https://corridra.example.invalid/r?token=a',
      }),
    ).toMatchObject({
      subject: 'Reset your Corridra password',
      preheader: 'The link works once.',
      text: [
        'Hi Jane,',
        'Someone asked to reset the password on your Corridra account. If that was you, use the button.',
        'Choose a new password: https://corridra.example.invalid/r?token=a',
        "The link works once and expires in 1 hour. If it wasn't you, do nothing. Your password stays as it is.",
        'Sent by Corridra.',
      ].join('\n\n'),
    });
  });
  it('starts the reset message with "Hi," when the name is empty', () => {
    for (const name of [undefined, null, '', '   ']) {
      const mail = renderAuthMail({
        kind: 'reset-link',
        name,
        expiry: '1 hour',
        linkUrl: 'https://corridra.example.invalid/r?token=a',
      });
      expect(mail.text.startsWith('Hi,\n\n')).toBe(true);
    }
  });
  it('escapes a hostile name and never turns it into markup', () => {
    const mail = renderAuthMail({
      kind: 'reset-link',
      name: '<script>alert(1)</script>&"',
      expiry: '1 hour',
      linkUrl: 'https://corridra.example.invalid/r?token=a',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&amp;');
  });
  it('refuses a bad code, a missing link, or an unsafe link instead of sending a broken mail', () => {
    expect(() => renderAuthMail({ kind: 'sign-in-code', code: '12' })).toThrow();
    expect(() => renderAuthMail({ kind: 'sign-in-code' })).toThrow();
    expect(() => renderAuthMail({ kind: 'reset-link', expiry: '1 hour' })).toThrow();
    expect(() =>
      renderAuthMail({ kind: 'reset-link', expiry: '1 hour', linkUrl: 'javascript:alert(1)' }),
    ).toThrow();
    expect(() =>
      renderAuthMail({
        kind: 'reset-link',
        expiry: '1 hour',
        linkUrl: 'http://corridra.example/x',
      }),
    ).toThrow();
  });
  it('has only the agreed placeholders in every catalog text', () => {
    const texts = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : Object.values(value as Record<string, unknown>).flatMap(texts);
    const found = new Set<string>();
    for (const catalog of Object.values(authMailCatalog))
      for (const text of texts(catalog))
        for (const match of text.match(/[{}][^{}]*[{}]?/g) ?? []) found.add(match);
    expect(found.size).toBeGreaterThan(0);
    for (const placeholder of found) {
      expect(placeholder).toMatch(/^\{[a-z_]+\}$/);
      expect(authMailPlaceholders as readonly string[]).toContain(placeholder.slice(1, -1));
    }
  });
  it('keeps the layout light, table based and free of images, tracking and rewritten links', () => {
    const html = renderAuthMail({ kind: 'sign-in-code', code: '482913' }).html;
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('max-width:560px');
    expect(html).not.toMatch(/<img|<script|<link |<iframe|url\(|@import/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('lang="en" dir="ltr"');
  });
  it('sets the button and text to the agreed size, shape and colour', () => {
    const html = renderAuthMail({
      kind: 'reset-link',
      name: 'Jane',
      expiry: '1 hour',
      linkUrl: 'https://corridra.example.invalid/r?token=a',
    }).html;
    expect(html).toContain('background:#2856C5');
    expect(html).toContain('color:#FFFFFF');
    expect(html).toContain('min-height:48px');
    expect(html).toContain('border-radius:8px');
    expect(html).toMatch(/font-size:16px;line-height:24px/);
    expect(html).toMatch(/font-size:12px;line-height:18px/);
    const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes.filter((size) => size > 1))).toBeGreaterThanOrEqual(12);
  });
  it('shows the code large, centred, monospaced with tabular figures and selectable', () => {
    const html = renderAuthMail({ kind: 'sign-in-code', code: '482913' }).html;
    expect(html).toMatch(/text-align:center[^"]*font-family:ui-monospace/);
    expect(html).toContain('font-size:32px');
    expect(html).toContain('font-variant-numeric:tabular-nums');
    expect(html).toContain('user-select:all');
  });
  it('meets contrast: footer text at least 4.5 to 1, button text at least 4.5 to 1', () => {
    const c = authMailColours;
    expect(contrastRatio(c.muted, c.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.ink, c.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.navy, c.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onAction, c.action)).toBeGreaterThanOrEqual(4.5);
  });
  it('falls back to English and knows which scripts run right to left', () => {
    expect(renderAuthMail({ kind: 'sign-in-code', code: '482913', locale: 'bn' }).locale).toBe(
      'en',
    );
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-SA')).toBe('rtl');
    expect(directionOf('bn')).toBe('ltr');
    expect(directionOf('zh-CN')).toBe('ltr');
  });
  it('writes the expiry in plain words from the provider times', () => {
    const at = Date.parse('2026-10-23T12:00:00.000Z');
    const plus = (minutes: number) => new Date(at + minutes * 60000).toISOString();
    expect(expiryWords(plus(1), at)).toBe('1 minute');
    expect(expiryWords(plus(10), at)).toBe('10 minutes');
    expect(expiryWords(plus(60), at)).toBe('1 hour');
    expect(expiryWords(plus(180), at)).toBe('3 hours');
    expect(() => expiryWords(plus(-5), at)).toThrow();
    expect(() => expiryWords('not a date', at)).toThrow();
  });
});
