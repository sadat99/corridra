import type { Locale } from '../locales';
import type { FormCatalog } from './en';

// Each language's form words are their own file, fetched only when that language is released, chosen and the
// request form is on screen. The imports are written out so the bundler makes one separate file per language.
const loaders = {
  bn: () => import('./bn'),
  zh: () => import('./zh'),
  es: () => import('./es'),
  ar: () => import('./ar'),
  fr: () => import('./fr'),
  de: () => import('./de'),
} satisfies Record<Exclude<Locale, 'en'>, () => Promise<{ words: FormCatalog }>>;

const loaded = new Map<Locale, Promise<FormCatalog>>();

/**
 * The form words of one language. A failed fetch is not kept here; the browser may keep it for the life of the page,
 * so the next load of the page asks again.
 */
export function loadFormWords(locale: Exclude<Locale, 'en'>): Promise<FormCatalog> {
  const known = loaded.get(locale);
  if (known) return known;
  const words = loaders[locale]().then((module) => module.words);
  loaded.set(locale, words);
  words.catch(() => loaded.delete(locale));
  return words;
}
