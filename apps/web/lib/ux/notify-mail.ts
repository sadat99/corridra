// Email side of the notification service (commercial readiness program, D7). Pure helpers so every
// rule is tested without a provider: what may be stored in the inbox, whether an email may go, and
// the message itself. Nothing here sends; lib/notify.ts does, through the existing mission email
// provider, and only when that provider is configured and switched on. Owner: WS-E.
import { safeInternalPath } from './safe-path';

export type NotificationKindName =
  | 'TEAM_INVITE'
  | 'CONTRIBUTOR_INVITE'
  | 'PARTICIPANT_INVITE'
  | 'TASK_ASSIGNED'
  | 'QUOTE_SENT'
  | 'QUOTE_ACCEPTED'
  | 'REPORT_PUBLISHED'
  | 'REQUEST_RECEIVED'
  | 'REPLY_POSTED';

/** Invitations go to people who cannot have set an email choice yet, so they always send. */
const invitations = new Set<NotificationKindName>([
  'TEAM_INVITE',
  'CONTRIBUTOR_INVITE',
  'PARTICIPANT_INVITE',
]);

const subjects: Record<NotificationKindName, string> = {
  TEAM_INVITE: 'You are invited to a Corridra team workspace',
  CONTRIBUTOR_INVITE: 'You are invited to help on a Corridra task',
  PARTICIPANT_INVITE: 'You are invited to a Corridra programme',
  TASK_ASSIGNED: 'A task was assigned to you',
  QUOTE_SENT: 'You have a new quote',
  QUOTE_ACCEPTED: 'Your quote was accepted',
  REPORT_PUBLISHED: 'Your report is ready',
  REQUEST_RECEIVED: 'We received your request',
  REPLY_POSTED: 'There is a new reply',
};

const leads: Record<NotificationKindName, string> = {
  TEAM_INVITE: 'Open the link below to accept the invitation. It expires in 7 days.',
  CONTRIBUTOR_INVITE: 'Open the link below to see the task and accept it.',
  PARTICIPANT_INVITE: 'Open the link below to see the programme and join it.',
  TASK_ASSIGNED: 'Open the link below to see what is needed and when.',
  QUOTE_SENT: 'Open the link below to read the quote and decide.',
  QUOTE_ACCEPTED: 'Open the link below to see the accepted quote and the next step.',
  REPORT_PUBLISHED: 'Open the link below to read the report.',
  REQUEST_RECEIVED: 'We will review it and tell you the next step.',
  REPLY_POSTED: 'Open the link below to read the reply.',
};

/** Keys never stored in an inbox item: codes, tokens and secrets travel only in the email. */
const secretKey = /code|token|secret|password|passphrase|otp|capability|invitation/i;

/** The payload as the inbox may store it: plain values only, no secret-looking keys, no outside link. */
export function inboxSafePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (secretKey.test(key)) continue;
    if (key === 'href') {
      const href = safeInternalPath(value);
      if (href) out.href = href;
      continue;
    }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}

export type EmailRule = {
  type: NotificationKindName;
  recipientEmail?: string;
  /** The person's email choice when the producer knows it. False never sends (except invitations). */
  emailChoice?: boolean;
  /** True when the provider is configured and the email switch is on. */
  providerReady: boolean;
};

/** Whether this hand-off may be emailed, and if not, why. */
export function emailDecision(rule: EmailRule): 'send' | 'not_chosen' | 'not_sent' {
  if (!rule.providerReady) return 'not_sent';
  if (!rule.recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rule.recipientEmail))
    return 'not_sent';
  if (rule.emailChoice === false && !invitations.has(rule.type)) return 'not_chosen';
  return 'send';
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export type NotificationEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  locale: string;
  dir: 'ltr' | 'rtl';
};

/**
 * The message for one hand-off. `link` is a same-site path (made absolute with the application
 * origin) or an absolute link on that origin; anything else is dropped. `lines` are extra plain
 * lines that belong in the email only, such as an invitation code (never stored in the inbox).
 */
export function buildNotificationEmail(input: {
  type: NotificationKindName;
  origin: string;
  title?: string;
  link?: string;
  lines?: string[];
}): NotificationEmail {
  const origin = new URL(input.origin).origin;
  let link: string | null = null;
  if (input.link) {
    const local = safeInternalPath(input.link);
    if (local) link = origin + local;
    else {
      try {
        const url = new URL(input.link);
        if (url.origin === origin) link = url.href;
      } catch {
        link = null;
      }
    }
  }
  const subject = input.title?.trim() || subjects[input.type];
  const lead = leads[input.type];
  const lines = (input.lines ?? []).map((line) => line.trim()).filter(Boolean);
  const text = [subject, '', lead, ...lines, ...(link ? ['', link] : []), '', 'Corridra'].join(
    '\n',
  );
  const html = [
    '<!doctype html><html lang="en" dir="ltr"><body style="font-family:Arial,sans-serif;line-height:1.5">',
    `<p style="font-size:18px;font-weight:bold">${escape(subject)}</p>`,
    `<p>${escape(lead)}</p>`,
    ...lines.map((line) => `<p>${escape(line)}</p>`),
    link ? `<p><a href="${escape(link)}">${escape(link)}</a></p>` : '',
    '<p>Corridra</p></body></html>',
  ].join('');
  return { subject, preheader: lead, html, text, locale: 'en', dir: 'ltr' };
}
