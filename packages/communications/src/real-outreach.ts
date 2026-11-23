import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabasePool } from '@corridra/db';

// ADR-090. The real email lane for introductions. Off unless the switch is exactly 'true'. Test mode unless the mode is
// exactly 'live'. In test mode a message leaves only for an address on the test list; every other message goes to a sink
// that makes no network call. Any missing setting closes the lane. No address, key or provider answer is ever logged.

export type OutreachConfig =
  | { state: 'off' }
  | { state: 'unconfigured' }
  | {
      state: 'on';
      mode: 'test' | 'live';
      key: string;
      from: string;
      replyTo: string;
      origin: string;
      testRecipients: ReadonlySet<string>;
      workspaceLimit: number;
      globalLimit: number;
    };

const address = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
const limit = (value: string | undefined, fallback: number, max: number) =>
  value && /^[1-9][0-9]{0,3}$/.test(value) && Number(value) <= max ? Number(value) : fallback;

/** The secret that signs provider notices, or null when it is not usable. */
export function outreachWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  const value = env.REAL_OUTREACH_WEBHOOK_SECRET ?? '';
  return /^whsec_[A-Za-z0-9+/=]{16,}$/.test(value) ? value : null;
}

export function realOutreachConfig(env: NodeJS.ProcessEnv = process.env): OutreachConfig {
  if (env.CORRIDRA_REAL_OUTREACH !== 'true') return { state: 'off' };
  const key = env.REAL_OUTREACH_MAIL_KEY ?? '',
    from = env.REAL_OUTREACH_MAIL_FROM ?? '',
    replyTo = env.REAL_OUTREACH_MAIL_REPLY_TO ?? '',
    origin = env.APP_ORIGIN ?? '';
  if (
    key.length < 16 ||
    !address.test(from) ||
    !address.test(replyTo) ||
    !/^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/.test(origin) ||
    !outreachWebhookSecret(env)
  )
    return { state: 'unconfigured' };
  return {
    state: 'on',
    mode: env.CORRIDRA_REAL_OUTREACH_MODE === 'live' ? 'live' : 'test',
    key,
    from,
    replyTo,
    origin,
    testRecipients: new Set(
      (env.CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => address.test(entry)),
    ),
    workspaceLimit: limit(env.CORRIDRA_REAL_OUTREACH_DAILY_WORKSPACE_LIMIT, 20, 200),
    globalLimit: limit(env.CORRIDRA_REAL_OUTREACH_DAILY_GLOBAL_LIMIT, 100, 1000),
  };
}

/** The opt-out token of one message. It opens nothing else: the reply link is a different token. */
export const unsubscribeToken = (secret: string, messageId: string) =>
  createHmac('sha256', secret).update(`outreach:unsubscribe:${messageId}`).digest('hex');
const replyToken = (secret: string, messageId: string) =>
  createHmac('sha256', secret).update(`part06:buyer:${messageId}`).digest('hex');

type Payload = {
  email: string;
  name: string;
  template: string;
  presentation: Record<string, string>;
};
const plain = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The reviewed template and the eight reviewed introduction lines, the private reply link and the opt-out link. */
export function renderOutreachMail(
  payload: Payload,
  links: { reply: string; optOut: string },
  test: boolean,
) {
  const p = payload.presentation;
  const lines: [string, string][] = [
    ['Company', p.company],
    ['Country', p.country],
    ['What they need', p.capability],
    ['Why we are writing to you', p.fit],
    ['What we know', p.evidence],
    ['What is not confirmed', p.uncertainty],
    ['Purpose of a conversation', p.conversationPurpose],
    ['Dates', p.availableDates],
  ].map(([label, value]) => [label, plain(value ?? '')]);
  const subject =
    `${test ? '[Test] ' : ''}Introduction from Corridra: ${plain(p.company ?? '')}`.slice(0, 200);
  const optOutLine = 'If you do not want emails like this from Corridra, stop them here:';
  const text = [
    `Hello ${plain(payload.name)},`,
    '',
    plain(payload.template),
    '',
    ...lines.map(([label, value]) => `${label}: ${value}`),
    '',
    'Read the introduction and reply on your private page:',
    links.reply,
    '',
    'Replying does not add you to a mailing list.',
    optOutLine,
    links.optOut,
    '',
    'Corridra team',
  ].join('\n');
  const html = [
    `<p>Hello ${escapeHtml(plain(payload.name))},</p>`,
    `<p>${escapeHtml(plain(payload.template))}</p>`,
    `<table>${lines.map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`,
    `<p><a href="${escapeHtml(links.reply)}">Read the Introduction and Reply</a></p>`,
    `<p>Replying does not add you to a mailing list. ${escapeHtml(optOutLine)} <a href="${escapeHtml(links.optOut)}">Stop These Emails</a></p>`,
    '<p>Corridra team</p>',
  ].join('');
  return { subject, text, html };
}

/** Resend over HTTPS. The answer can hold private addresses, so it is never read or logged. */
async function sendWithResend(
  config: Extract<OutreachConfig, { state: 'on' }>,
  mail: { id: string; to: string; subject: string; text: string; html: string; oneClick: string },
) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': mail.id,
    },
    body: JSON.stringify({
      from: `Corridra <${config.from}>`,
      reply_to: config.replyTo,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: {
        'List-Unsubscribe': `<${mail.oneClick}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [{ name: 'corridra_message', value: mail.id }],
    }),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Real outreach delivery failed');
}

export class RealEmailChannel {
  readonly email = true;
  constructor(
    private pool: DatabasePool,
    private secret: string,
    private env: () => NodeJS.ProcessEnv = () => process.env,
  ) {}
  async deliver(effect: { id: string; capabilityHash: string; leaseId: string }) {
    const config = realOutreachConfig(this.env());
    if (config.state === 'off') throw new Error('Real outreach is off');
    if (config.state === 'unconfigured') throw new Error('Real outreach is not set up');
    const lease = [effect.id, effect.capabilityHash, effect.leaseId];
    // The database gives the address only to the holder of the live lease of a message that may still be sent.
    const payload = (
      await this.pool.query('SELECT app.outreach_real_payload($1,$2,$3) AS payload', lease)
    ).rows[0].payload as Payload;
    const taken = (
      await this.pool.query('SELECT app.outreach_rate_take($1,$2,$3,$4,$5) AS ok', [
        ...lease,
        config.workspaceLimit,
        config.globalLimit,
      ])
    ).rows[0].ok as boolean;
    if (!taken) throw new Error('Real outreach limit reached');
    const live = config.mode === 'live';
    const leaves = live || config.testRecipients.has(payload.email.toLowerCase());
    if (leaves) {
      const token = unsubscribeToken(this.secret, effect.id);
      const mail = renderOutreachMail(
        payload,
        {
          reply: `${config.origin}/buyer#${replyToken(this.secret, effect.id)}`,
          optOut: `${config.origin}/buyer/unsubscribe#${token}`,
        },
        !live,
      );
      await sendWithResend(config, {
        id: effect.id,
        to: payload.email,
        ...mail,
        oneClick: `${config.origin}/api/outreach/unsubscribe?t=${token}`,
      });
    }
    return (
      await this.pool.query('SELECT app.deliver_real_email($1,$2,$3,$4,$5) AS receipt', [
        ...lease,
        live ? 'email' : 'email_test',
        `${leaves ? 'resend' : 'sink'}:${effect.id}`,
      ])
    ).rows[0].receipt as string;
  }
}

/** Svix-style signature check for provider notices: current within five minutes, constant-time, closed without a secret. */
export function verifyOutreachWebhook(
  secret: string | null | undefined,
  headers: Headers,
  body: string,
  now = Date.now(),
) {
  if (!secret || !/^whsec_[A-Za-z0-9+/=]{16,}$/.test(secret)) return false;
  const id = headers.get('svix-id'),
    timestamp = headers.get('svix-timestamp'),
    signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures || !/^[0-9]{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type OutreachEvent = {
  messageId: string;
  kind: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED';
  hard: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Reads only the notice type, the bounce kind and our own message tag. Addresses in the notice are never kept. */
export function outreachEventFrom(notice: unknown): OutreachEvent | null {
  if (!notice || typeof notice !== 'object') return null;
  const { type, data } = notice as { type?: unknown; data?: unknown };
  if (!data || typeof data !== 'object') return null;
  const { tags, bounce } = data as { tags?: unknown; bounce?: unknown };
  const messageId =
    tags && typeof tags === 'object' ? (tags as Record<string, unknown>).corridra_message : null;
  if (typeof messageId !== 'string' || !uuid.test(messageId)) return null;
  if (type === 'email.delivered') return { messageId, kind: 'DELIVERED', hard: false };
  if (type === 'email.complained') return { messageId, kind: 'COMPLAINED', hard: true };
  if (type === 'email.bounced')
    return {
      messageId,
      kind: 'BOUNCED',
      hard:
        !!bounce &&
        typeof bounce === 'object' &&
        (bounce as { type?: unknown }).type === 'Permanent',
    };
  return null;
}
