import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { z } from 'zod';
import { expiryWords, renderAuthMail, type RenderedAuthMail } from './customer-auth-mail-templates';

// Branded customer identity mail. Neon Auth calls this endpoint instead of sending its own email
// once the webhook is registered. Authenticity comes from the Ed25519 signature, not from a browser
// origin. Identity mail is separate from mission communications and never enables outreach.
//
// While the webhook is registered, Neon does not fall back to its own email if this fails. A
// failure here stops sign-in codes, email confirmation and password reset on that branch.

export const maxWebhookBytes = 32 * 1024;
export const maxEventAgeMs = 5 * 60 * 1000;
const futureSkewMs = 60 * 1000;

export class AuthMailError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export function customerAuthMailEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED === 'true';
}

const configSchema = z.object({
  CUSTOMER_AUTH_MAIL_KEY: z.string().min(16),
  CUSTOMER_AUTH_MAIL_FROM: z.email(),
  CUSTOMER_AUTH_MAIL_REPLY_TO: z.email(),
  NEON_AUTH_BASE_URL: z.url(),
  APP_ORIGIN: z.url(),
  CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL: z.url().optional(),
});

export type AuthMailConfig = {
  key: string;
  from: string;
  replyTo: string;
  jwksUrl: string;
  linkOrigins: string[];
};

/** Null when any required setting is missing or invalid. Nothing is sent without all of them. */
export function readAuthMailConfig(env: NodeJS.ProcessEnv = process.env): AuthMailConfig | null {
  const parsed = configSchema.safeParse({
    ...env,
    CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL: env.CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL || undefined,
  });
  if (!parsed.success) return null;
  const c = parsed.data;
  const base = new URL(c.NEON_AUTH_BASE_URL);
  const jwks = c.CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL
    ? new URL(c.CUSTOMER_AUTH_MAIL_WEBHOOK_JWKS_URL)
    : new URL(base.href.replace(/\/+$/, '') + '/.well-known/jwks.json');
  if (jwks.protocol !== 'https:' || jwks.username || jwks.password) return null;
  return {
    key: c.CUSTOMER_AUTH_MAIL_KEY,
    // The comma in the display name needs quotes to stay one name.
    from: `"Sadat, Corridra" <${c.CUSTOMER_AUTH_MAIL_FROM}>`,
    replyTo: c.CUSTOMER_AUTH_MAIL_REPLY_TO,
    jwksUrl: jwks.href,
    linkOrigins: [...new Set([base.origin, new URL(c.APP_ORIGIN).origin])],
  };
}

type Jwks = { keys: (JsonWebKey & { kid?: string })[] };
export type JwksSource = (url: string, force: boolean) => Promise<Jwks>;

const keyCache = new Map<string, { keys: Jwks['keys']; at: number; lastRefresh: number }>();
const keyTtlMs = 5 * 60 * 1000;
const refreshGapMs = 60 * 1000;

/** Fetches the signing keys. Cached briefly. An unknown key id may trigger one refresh a minute. */
export const defaultJwksSource: JwksSource = async (url, force) => {
  const cached = keyCache.get(url);
  const now = Date.now();
  if (cached && now - cached.at < keyTtlMs && !force) return { keys: cached.keys };
  if (cached && force && now - cached.lastRefresh < refreshGapMs) return { keys: cached.keys };
  const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new AuthMailError(503, 'keys_unavailable');
  const text = await response.text();
  if (text.length > 64 * 1024) throw new AuthMailError(503, 'keys_unavailable');
  const body = JSON.parse(text) as Jwks;
  if (!Array.isArray(body.keys)) throw new AuthMailError(503, 'keys_unavailable');
  keyCache.set(url, { keys: body.keys, at: now, lastRefresh: now });
  return body;
};

export function resetAuthMailCaches() {
  keyCache.clear();
  sent.clear();
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** Standard detached JWS check from the provider's documentation. Throws AuthMailError. */
export async function verifyWebhook(
  rawBody: string,
  headers: Headers,
  config: AuthMailConfig,
  source: JwksSource = defaultJwksSource,
  now = Date.now(),
) {
  const signature = headers.get('x-neon-signature');
  const kid = headers.get('x-neon-signature-kid');
  const timestamp = headers.get('x-neon-timestamp');
  if (!signature || !kid || !timestamp) throw new AuthMailError(400, 'missing_headers');
  if (!/^[0-9]{10,16}$/.test(timestamp)) throw new AuthMailError(400, 'bad_timestamp');
  const [headerB64, middle, signatureB64, ...rest] = signature.split('.');
  if (!headerB64 || middle !== '' || !signatureB64 || rest.length)
    throw new AuthMailError(400, 'bad_signature_format');
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    throw new AuthMailError(400, 'bad_signature_format');
  }
  // Only EdDSA. Never let the message pick a weaker algorithm.
  if (header.alg !== 'EdDSA') throw new AuthMailError(401, 'wrong_algorithm');
  if (header.kid !== undefined && header.kid !== kid) throw new AuthMailError(401, 'bad_signature');
  let jwks = await source(config.jwksUrl, false);
  let jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) {
    jwks = await source(config.jwksUrl, true);
    jwk = jwks.keys.find((key) => key.kid === kid);
  }
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519')
    throw new AuthMailError(401, 'unknown_key');
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = `${headerB64}.${b64(`${timestamp}.${b64(rawBody)}`)}`;
  const valid = verify(
    null,
    Buffer.from(signingInput),
    publicKey,
    Buffer.from(signatureB64, 'base64url'),
  );
  if (!valid) throw new AuthMailError(401, 'bad_signature');
  const age = now - Number(timestamp);
  if (age > maxEventAgeMs || age < -futureSkewMs) throw new AuthMailError(401, 'stale_event');
}

const userSchema = z.object({ email: z.email(), name: z.string().max(200).nullish() });
const otpEvent = z.object({
  event_id: z.string().min(8).max(100),
  event_type: z.literal('send.otp'),
  timestamp: z.string(),
  user: userSchema,
  event_data: z.object({
    otp_code: z.string().regex(/^[0-9]{6}$/),
    otp_type: z.enum(['sign-in', 'email-verification', 'forget-password']),
    delivery_preference: z.enum(['email', 'sms']).optional(),
    expires_at: z.string(),
  }),
});
const linkEvent = z.object({
  event_id: z.string().min(8).max(100),
  event_type: z.literal('send.magic_link'),
  timestamp: z.string(),
  user: userSchema,
  event_data: z.object({
    link_type: z.enum(['sign-in', 'email-verification', 'forget-password']),
    link_url: z.url(),
    expires_at: z.string(),
  }),
});

export type AuthMailEvent = z.infer<typeof otpEvent> | z.infer<typeof linkEvent>;

export function parseAuthMailEvent(payload: unknown): AuthMailEvent {
  const type = (payload as { event_type?: unknown } | null)?.event_type;
  const result =
    type === 'send.otp'
      ? otpEvent.safeParse(payload)
      : type === 'send.magic_link'
        ? linkEvent.safeParse(payload)
        : null;
  if (!result) throw new AuthMailError(400, 'unsupported_event');
  if (!result.success) throw new AuthMailError(400, 'bad_event');
  return result.data;
}

/** Chooses the message for an event. Anything this system does not send is refused, not guessed. */
export function messageFor(event: AuthMailEvent, config: AuthMailConfig): RenderedAuthMail {
  const eventTime = Date.parse(event.timestamp);
  if (event.event_type === 'send.otp') {
    const { otp_code, otp_type, delivery_preference } = event.event_data;
    if (delivery_preference === 'sms') throw new AuthMailError(400, 'unsupported_channel');
    return renderAuthMail({
      kind:
        otp_type === 'sign-in'
          ? 'sign-in-code'
          : otp_type === 'email-verification'
            ? 'verify-code'
            : 'reset-code',
      code: otp_code,
    });
  }
  const { link_type, link_url, expires_at } = event.event_data;
  if (link_type !== 'forget-password') throw new AuthMailError(400, 'unsupported_link');
  const target = new URL(link_url);
  // The link must point at the identity provider or this application, over https.
  if (target.protocol !== 'https:' || !config.linkOrigins.includes(target.origin))
    throw new AuthMailError(400, 'bad_link');
  let expiry: string;
  try {
    expiry = expiryWords(expires_at, eventTime);
  } catch {
    throw new AuthMailError(400, 'bad_event');
  }
  return renderAuthMail({
    kind: 'reset-link',
    linkUrl: link_url,
    expiry,
    name: event.user.name,
  });
}

// Duplicate deliveries share one event id. This memory covers a warm instance. The provider's
// own idempotency key (the event id) covers the rest.
const sent = new Map<string, number>();
const sentTtlMs = 24 * 60 * 60 * 1000;
function remember(id: string, now: number) {
  for (const [key, at] of sent) if (now - at > sentTtlMs) sent.delete(key);
  // Oldest first, so the memory never grows without bound.
  while (sent.size >= 2000) sent.delete(sent.keys().next().value as string);
  sent.set(id, now);
}

export type MailSender = (mail: {
  config: AuthMailConfig;
  to: string;
  message: RenderedAuthMail;
  idempotencyKey: string;
}) => Promise<void>;

/** Resend over HTTPS. The response body can hold private addresses, so it is never read or logged. */
export const sendWithResend: MailSender = async ({ config, to, message, idempotencyKey }) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: config.from,
      reply_to: config.replyTo,
      to: [to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    // Shorter than the provider's default per-attempt wait of five seconds.
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new AuthMailError(503, 'delivery_failed');
};

export type AuthMailDeps = {
  env?: NodeJS.ProcessEnv;
  jwks?: JwksSource;
  send?: MailSender;
  now?: () => number;
};

async function readCapped(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxWebhookBytes) throw new AuthMailError(413, 'too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxWebhookBytes) {
      await reader.cancel();
      throw new AuthMailError(413, 'too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

/**
 * One POST from the identity provider. Never logs an address, a code or a provider body.
 * 404 while the switch is off, 503 with nothing sent while a setting is missing.
 */
export async function handleCustomerAuthMail(request: Request, deps: AuthMailDeps = {}) {
  const env = deps.env ?? process.env;
  if (!customerAuthMailEnabled(env)) return reply(404, { error: 'Not found' });
  try {
    if (request.method !== 'POST') throw new AuthMailError(405, 'method_not_allowed');
    const config = readAuthMailConfig(env);
    if (!config) throw new AuthMailError(503, 'not_configured');
    const rawBody = await readCapped(request);
    const now = deps.now?.() ?? Date.now();
    await verifyWebhook(rawBody, request.headers, config, deps.jwks, now);
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new AuthMailError(400, 'bad_event');
    }
    const event = parseAuthMailEvent(payload);
    // The signed header and the body must name the same event.
    if (request.headers.get('x-neon-event-id') !== event.event_id)
      throw new AuthMailError(400, 'bad_event');
    if (sent.has(event.event_id)) return reply(200, { ok: true, duplicate: true });
    const message = messageFor(event, config);
    await (deps.send ?? sendWithResend)({
      config,
      to: event.user.email,
      message,
      idempotencyKey: event.event_id,
    });
    remember(event.event_id, now);
    return reply(200, { ok: true });
  } catch (error) {
    if (error instanceof AuthMailError) return reply(error.status, { error: error.code });
    // A network or provider fault. Retryable, and nothing about the request is returned.
    return reply(503, { error: 'delivery_failed' });
  }
}
