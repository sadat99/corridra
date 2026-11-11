import { fill } from './fill';
import { translate } from './messages';
import type { Locale } from './locales';
import { programmePagesWords } from './programme-pages-words';

export type ProgrammePagesKey = keyof typeof programmePagesWords;
// The programme page screens are shown in English until each language has a recorded native review (the
// English-first release rule). This is the one place that changes when a reviewed language is released for them.
export const programmePagesLocale: Locale = 'en';

/** One line of the programme page words, with `{name}` values filled in. */
export function pp(key: ProgrammePagesKey, values?: Record<string, string | number>): string {
  const pattern = translate(programmePagesLocale, key);
  return values ? fill(pattern, values) : pattern;
}
