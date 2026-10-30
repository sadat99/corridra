'use client';
import './form-languages.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PublicShell } from '../../components/public-shell';
import { useLanguage } from '../../components/language-provider';
import { loadFormWords } from '../../lib/i18n/form-words/load';
import { defaultLocale, type Locale } from '../../lib/i18n/locales';
import { FormWordsProvider, type FormWords } from './form-words';

const english: FormWords = { locale: defaultLocale, words: null };

/**
 * The main region of the request page. Its words follow the chosen language only where the owner has released
 * that language for the form (`CORRIDRA_LANGUAGES_FORM`, read by the page when it is built). The chosen language
 * comes from the language chip, which offers reviewed languages only, so the form never adds a language. The
 * page is built in English; a released language's words are fetched after load, and until they arrive, or if they
 * cannot be fetched, the form stays English and says so.
 */
export function FormMain({
  released,
  className,
  children,
}: {
  released: readonly Locale[];
  className: string;
  children: ReactNode;
}) {
  const { locale } = useLanguage();
  // English is the source, never a released language.
  const wanted = locale === 'en' || !released.includes(locale) ? null : locale;
  const [loaded, setLoaded] = useState<FormWords>(english);
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    loadFormWords(wanted).then(
      (words) => {
        if (active) setLoaded({ locale: wanted, words });
      },
      () => {
        // The form stays English and works; the next load of the page tries again.
      },
    );
    return () => {
      active = false;
    };
  }, [wanted]);
  const shown = useMemo(
    () => (wanted && loaded.locale === wanted ? loaded : english),
    [wanted, loaded],
  );
  return (
    <FormWordsProvider value={shown}>
      <PublicShell className={className} translated language={shown.locale}>
        {children}
      </PublicShell>
    </FormWordsProvider>
  );
}
