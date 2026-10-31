import 'server-only';
import type { InboxContext, NotificationType, RecipientKind } from '@corridra/communications/inbox';
import { foundations } from './foundations';
import { uxSwitchOn } from './ux-switches';

// One notification service for every hand-off (commercial readiness program, D7 and 5.2).
// Producers (WS-B, WS-C, WS-D) call notify(); WS-E owns the internals. Wave 0 writes the inbox row;
// WS-E adds sending through the existing mission email provider when the person's email choice allows.
// A failed notification never breaks the action that caused it: the result says what happened.

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
};

export type NotifyResult = {
  inbox: 'recorded' | 'off' | 'failed';
  email: 'sent' | 'not_chosen' | 'not_sent' | 'off';
  id?: string;
};

export function notificationsOn(env: NodeJS.ProcessEnv = process.env) {
  return uxSwitchOn('CORRIDRA_NOTIFICATIONS_V2', env);
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  if (!notificationsOn()) return { inbox: 'off', email: 'off' };
  const s = foundations();
  if (!s) return { inbox: 'failed', email: 'not_sent' };
  try {
    await s.ready;
    const id = await s.inbox.record(input.writer, {
      recipientKind: input.recipientKind,
      recipientAccountId: input.recipientAccountId,
      tenantId: input.tenantId ?? null,
      type: input.type,
      payload: input.payload,
    });
    return { inbox: 'recorded', email: 'not_sent', id };
  } catch {
    console.error(JSON.stringify({ event: 'notification_record_failed', type: input.type }));
    return { inbox: 'failed', email: 'not_sent' };
  }
}
