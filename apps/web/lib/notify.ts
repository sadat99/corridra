import 'server-only';
import type { InboxContext, NotificationType, RecipientKind } from '@corridra/communications/inbox';
import { readAuthMailConfig, sendWithResend } from '@corridra/auth/customer-auth-mail';
import { missionMailApplicationEnabled } from '@corridra/auth/mission-mail';
import { foundations } from './foundations';
import { uxSwitchOn } from './ux-switches';
import { buildNotificationEmail, emailDecision, inboxSafePayload } from './ux/notify-mail';

// One notification service for every hand-off (commercial readiness program, D7 and 5.2).
// Producers (WS-B, WS-C, WS-D) call notify(); WS-E owns the internals. It writes the inbox row and
// sends the email through the existing mission email provider when the person's email choice allows
// and that provider is configured and switched on. A failed notification never breaks the action
// that caused it: the result says what happened. Nothing here logs an address or message text.

export type NotifyInput = {
  recipientAccountId: string;
  recipientKind: RecipientKind;
  recipientEmail?: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  locale: string;
  tenantId?: string | null;
  /** Who is acting: the team session or the customer proof. Needed for the database checks. */
  writer: InboxContext;
  /**
   * The person's email choice when the producer knows it. False keeps the email back (an
   * invitation still goes, since the person cannot have chosen yet). Absent means no choice saved.
   */
  emailChoice?: boolean;
  /**
   * Lines for the email only, such as an invitation code. They are never stored in the inbox, and
   * secret-looking keys in `payload` are dropped from the inbox item too.
   */
  emailOnly?: { lines?: string[]; link?: string };
};

export type NotifyResult = {
  inbox: 'recorded' | 'off' | 'failed';
  email: 'sent' | 'not_chosen' | 'not_sent' | 'off';
  id?: string;
};

export function notificationsOn(env: NodeJS.ProcessEnv = process.env) {
  return uxSwitchOn('CORRIDRA_NOTIFICATIONS_V2', env);
}

/** The provider is ready only with the mission email switch on and its settings complete. */
export function notificationEmailReady(env: NodeJS.ProcessEnv = process.env) {
  return notificationsOn(env) && missionMailApplicationEnabled(env) && !!readAuthMailConfig(env);
}

async function sendEmail(input: NotifyInput, key: string): Promise<NotifyResult['email']> {
  const decision = emailDecision({
    type: input.type,
    recipientEmail: input.recipientEmail,
    emailChoice: input.emailChoice,
    providerReady: notificationEmailReady(),
  });
  if (decision !== 'send') return decision;
  const config = readAuthMailConfig();
  if (!config || !process.env.APP_ORIGIN) return 'not_sent';
  try {
    const message = buildNotificationEmail({
      type: input.type,
      origin: process.env.APP_ORIGIN,
      title: typeof input.payload.title === 'string' ? input.payload.title : undefined,
      link:
        input.emailOnly?.link ??
        (typeof input.payload.href === 'string' ? input.payload.href : undefined),
      lines: input.emailOnly?.lines,
    });
    await sendWithResend({
      config,
      to: input.recipientEmail!,
      message,
      idempotencyKey: `notify:${input.type}:${key}`,
    });
    return 'sent';
  } catch {
    console.error(JSON.stringify({ event: 'notification_email_failed', type: input.type }));
    return 'not_sent';
  }
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  if (!notificationsOn()) return { inbox: 'off', email: 'off' };
  const s = foundations();
  if (!s) return { inbox: 'failed', email: 'not_sent' };
  let id: string | undefined;
  let inbox: NotifyResult['inbox'] = 'failed';
  try {
    await s.ready;
    id = await s.inbox.record(input.writer, {
      recipientKind: input.recipientKind,
      recipientAccountId: input.recipientAccountId,
      tenantId: input.tenantId ?? null,
      type: input.type,
      payload: inboxSafePayload(input.payload),
    });
    inbox = 'recorded';
  } catch {
    console.error(JSON.stringify({ event: 'notification_record_failed', type: input.type }));
  }
  // The email does not depend on the inbox row: an invitation still reaches the person.
  const email = await sendEmail(input, id ?? `${input.recipientAccountId}:${Date.now()}`);
  return id ? { inbox, email, id } : { inbox, email };
}
