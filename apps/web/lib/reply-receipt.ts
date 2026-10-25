// The plain-text receipt a supplier keeps (ADR-069). It is built from what was recorded, in the page's
// language, and holds nothing the supplier did not type: no reference to anyone else, no contact, no
// price that was not theirs. Pure; the page only shows, copies or downloads the text.
import { displayDate, displayMoney } from '@corridra/domain/locale';
import { replyFields } from './reply-terms';
import { fillReply, type ReplyWords } from './reply-words';

export type RecordedReply = {
  body: string;
  meetingInterest: boolean;
  quotation: null | { currency: string; terms: Record<string, string>; uncertainties: string };
};

/** One readable value for a recorded term. A term that was not given is "not stated", never zero. */
export function termValue(
  key: string,
  value: string | undefined,
  currency: string,
  words: ReplyWords,
): string {
  if (value === undefined || value === '') return words.notStated;
  if (key.endsWith('Minor')) return displayMoney(value, currency);
  // A day, written the same in every language: the quote holds until the end of that day (UTC).
  if (key === 'validUntil') return value.slice(0, 10);
  if (key === 'shipping')
    return words.shippingValues[value as keyof ReplyWords['shippingValues']] ?? value;
  return value;
}

export function receiptText(reply: RecordedReply, words: ReplyWords, recordedAt: Date): string {
  const lines = [
    words.receiptHeading,
    `${words.receiptRecordedOn}: ${displayDate(recordedAt.toISOString())}`,
    '',
  ];
  lines.push(`${words.checkYourAnswer}:`, reply.body, '');
  if (reply.meetingInterest) lines.push(words.checkMeeting, '');
  if (reply.quotation) {
    const { currency, terms, uncertainties } = reply.quotation;
    lines.push(`${words.checkQuote} (${currency}):`);
    for (const field of replyFields)
      lines.push(
        `${words.fields[field.key]}: ${termValue(field.key, terms[field.key], currency, words)}`,
      );
    lines.push(`${words.uncertainties}: ${uncertainties}`, '');
  } else lines.push(words.checkNoQuote, '');
  lines.push(words.receiptSource);
  return lines.join('\n');
}

export function expiryLine(words: ReplyWords, expiresAt: string) {
  return fillReply(words.expires, { date: displayDate(expiresAt) });
}
