/** What the messages list knows about a message and its contact (CRUD G11). */
export type NotSentFacts = {
  delivery_status?: string | null;
  last_error?: string | null;
  contact_status?: string | null;
  /** Present only when contact changes are installed: an opt-out this reader may read covers the contact's chain. */
  contact_opted_out?: boolean | null;
};

/**
 * CRUD G11: the words for a message the send-time check stopped (DEAD with PERMANENT, which for messages only that
 * check writes), or null for any other message, which keeps its own status words. The true reason wins in the order
 * opted out, hidden, withdrawn, corrected. An opt-out counts only when this reader may read it, so a reader who may
 * not gets the same words whether or not one exists; with no reason this reader may see, the words say only that the
 * contact can no longer be used. Opt-out reasons and hidden text are never part of the words.
 */
export function notSentWords(m: NotSentFacts): string | null {
  if (
    m.delivery_status !== 'DEAD' ||
    m.last_error !== 'PERMANENT' ||
    typeof m.contact_opted_out !== 'boolean'
  )
    return null;
  if (m.contact_opted_out) return 'Not sent: the person opted out. It cannot be sent again.';
  if (m.contact_status === 'HIDDEN') return 'Not sent: contact hidden. It cannot be sent again.';
  if (m.contact_status === 'WITHDRAWN')
    return 'Not sent: contact withdrawn. It cannot be sent again.';
  if (m.contact_status === 'CORRECTED')
    return 'Not sent: the contact was corrected after this introduction was created. It cannot be sent again.';
  return 'Not sent: this contact can no longer be used.';
}
