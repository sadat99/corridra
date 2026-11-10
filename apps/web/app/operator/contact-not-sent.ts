/**
 * CRUD G11: true only for a message the send-time check stopped (DEAD with PERMANENT, which for messages only that
 * check writes) because its contact was withdrawn or hidden. Any other stop keeps its own status words, and a
 * corrected or opted-out contact is not described as withdrawn or hidden.
 */
export function notSentForContact(m: {
  delivery_status?: string | null;
  last_error?: string | null;
  contact_status?: string | null;
}) {
  return (
    m.delivery_status === 'DEAD' &&
    m.last_error === 'PERMANENT' &&
    ['WITHDRAWN', 'HIDDEN'].includes(m.contact_status ?? '')
  );
}
