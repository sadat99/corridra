/**
 * "What happens when you send this" words (visual grammar PR 5, V3-05-033). English is the source. The bn, zh, es, ar,
 * fr and de words are in lang/<code>.ts. Every line states only what the
 * database enforces for an evidence response (apps/web/lib/consequence-preview.ts names the migration lines).
 */
export const consequenceEn = {
  'consequence.heading': 'What happens when you press Send response',
  'consequence.what': 'What is sent',
  'consequence.whatBody':
    'The text you typed in the response box, recorded as your own declaration. One response is kept for each request, and a different one cannot be sent afterwards.',
  'consequence.whatSent':
    'The text you typed in the response box, recorded as your own declaration.',
  'consequence.oneResponse':
    'One response is kept for each request, and a different one cannot be sent afterwards.',
  'beforeSend.tick': 'Tick this box to send.',
  'consequence.until': 'Until when',
  'consequence.untilBody': 'At most until the link expires or is withdrawn. This link expires on',
  'privacy.reader.anyoneWithThisLink': 'Anyone with this link',
} as const;
