import { formEn, type FormKey } from './en';

// The request form keeps every message in English in its state, exactly as before, and translates it only when it
// is shown. A message is matched to its key by its English text; `{name}` in a key's English matches a variable
// part. Sentences that must stay English are listed separately, so they are shown as written and marked English.

/** How the form joins several problems with one field into one message. */
export const issueSeparator = '. ';

/**
 * Messages that reach the form and stay English: how long information is kept, and consent. A consent message is
 * led by a translated instruction, so a person always knows what to do, and the English consent wording is kept.
 */
export const englishOnlyMessages: Readonly<Record<string, FormKey | null>> = {
  'Drafts expire after 24 hours.': null,
  'Your request is saved for 24 hours.': null,
  'No real customer mission has been accepted.': null,
  'Read and acknowledge the test intake notice': 'form.message.consentLead',
  'Read and acknowledge the request privacy notice': 'form.message.consentLead',
};

/** One part of a message: a known message with its variable parts, or a sentence that stays English. */
export type MessagePart =
  { key: FormKey; values: Record<string, string> } | { english: string; lead: FormKey | null };

const messageKeys = (Object.keys(formEn) as FormKey[]).filter((key) =>
  key.startsWith('form.message.'),
);
const exact = new Map<string, FormKey>(
  messageKeys.filter((key) => !/\{\w+\}/.test(formEn[key])).map((key) => [formEn[key], key]),
);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = messageKeys
  .filter((key) => /\{\w+\}/.test(formEn[key]))
  .map((key) => ({
    key,
    names: [...formEn[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]),
    pattern: new RegExp(`^${escape(formEn[key]).replace(/\\\{\w+\\\}/g, '(.+?)')}$`),
  }));

function readOne(text: string): MessagePart | null {
  const key = exact.get(text);
  if (key) return { key, values: {} };
  for (const { key, names, pattern } of patterns) {
    const match = pattern.exec(text);
    if (match)
      return { key, values: Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) };
  }
  if (Object.hasOwn(englishOnlyMessages, text))
    return { english: text, lead: englishOnlyMessages[text] };
  return null;
}

/**
 * Reads a message the form shows into parts, or null when any part of it is not known. A message can be one known
 * message, or several joined sentence by sentence (the form joins problems with `issueSeparator`); the longest known
 * run of sentences is taken first, and a sentence ending is read with or without its full stop.
 */
export function readFormMessage(text: string): MessagePart[] | null {
  const sentences = text.split(/(?<=\.) /);
  const parts: MessagePart[] = [];
  let start = 0;
  while (start < sentences.length) {
    let found: MessagePart | null = null;
    let end = sentences.length;
    while (end > start) {
      const run = sentences.slice(start, end).join(' ');
      found = readOne(run) ?? (run.endsWith('.') ? readOne(run.slice(0, -1)) : null);
      if (found) break;
      end -= 1;
    }
    if (!found) return null;
    parts.push(found);
    start = end;
  }
  return parts;
}
