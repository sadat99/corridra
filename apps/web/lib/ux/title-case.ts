// English button and action labels are written in Title Case (owner rule, 5 Nov 2026): every word starts with a
// capital except these minor words, which stay lowercase unless they come first. The text itself is written this
// way; no stylesheet changes the case. Words that already start with a capital, a digit or a symbol are left
// alone (names, acronyms such as PDF, "Sign In"). Only the first letter of a word is touched, so "Follow-up"
// and "e-mail" keep their own spelling after the first letter.
export const minorWords = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'by',
  'at',
]);

const startsLower = (word: string) => /^[a-z]/.test(word);

export function titleCase(text: string): string {
  let first = true;
  return text.replace(/\S+/g, (word) => {
    const lead = word.match(/^[^A-Za-z0-9]*/)?.[0] ?? '';
    const rest = word.slice(lead.length);
    // A placeholder such as {count} is filled in later and is never changed.
    if (lead.includes('{')) return word;
    const isFirst = first;
    first = false;
    if (!startsLower(rest)) return word;
    const bare = rest.toLowerCase().replace(/[^a-z]/g, '');
    if (!isFirst && minorWords.has(bare)) return word;
    return lead + rest[0].toUpperCase() + rest.slice(1);
  });
}

export const isTitleCase = (text: string) => titleCase(text) === text;
