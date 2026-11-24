/** What the staff introductions list knows about one message for the real email lane (ADR-090). */
export type OutreachSendFacts = {
  channel?: string | null;
  delivery_status?: string | null;
  /** Present only for a test-mode receipt: one of the two exact notes the list query writes. */
  delivery_note?: string | null;
  /** True when the buyer link of the message is revoked. */
  revoked?: boolean | null;
  /** Present only when contact changes are installed: an opt-out this reader may read covers the contact. */
  contact_opted_out?: boolean | null;
};

const notes = ['Test, not sent', 'Test, sent to a test address only'];

/** The test-mode note of a delivered message, or null. Only the two exact server notes are ever shown. */
export function deliveryNoteWords(m: OutreachSendFacts): string | null {
  return typeof m.delivery_note === 'string' && notes.includes(m.delivery_note)
    ? m.delivery_note
    : null;
}

/**
 * True when the list may offer the one-message send: a real email (policy channel EMAIL) that is still waiting and
 * that the list does not already know is revoked or opted out. The server decides again when the button is used, so
 * a message that is leased or no longer allowed is refused there.
 * Sample and manual messages never get it: they keep the batch dispatch.
 */
export function canSendOne(m: OutreachSendFacts): boolean {
  return (
    m.channel === 'EMAIL' &&
    ['PENDING', 'RUNNING'].includes(m.delivery_status ?? '') &&
    m.revoked !== true &&
    m.contact_opted_out !== true
  );
}

/** The body of one send: exactly one message, named by its id. One click sends one message. */
export function sendOneBody(m: { id: string }): { messageId: string } {
  return { messageId: m.id };
}
