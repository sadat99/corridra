'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  defaultLocale,
  isLocale,
  languageStorageKey,
  localeMeta,
  negotiate,
  type Locale,
  type OfferedLanguage,
} from '../lib/i18n/locales';
import { translate, type MessageKey } from '../lib/i18n/messages';

type LanguageState = {
  locale: Locale;
  offered: readonly OfferedLanguage[];
  choose: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const english: readonly OfferedLanguage[] = [{ code: defaultLocale, draft: false }];
const Context = createContext<LanguageState>({
  locale: defaultLocale,
  offered: english,
  choose: () => {},
  t: (key) => translate(defaultLocale, key),
});

function stored(): string | null {
  try {
    return window.localStorage.getItem(languageStorageKey);
  } catch {
    return null;
  }
}

// The choice lives in this browser. Where storage is blocked, full or read-only it is kept for this visit only, and
// that in-memory choice is the one that counts. Another tab's change (a storage event) clears it so the tabs agree.
let remembered: string | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === languageStorageKey) remembered = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The remembered language if it is offered; on a first visit the browser's own language if offered. */
function resolve(codes: readonly Locale[]): Locale {
  const choice = remembered ?? stored();
  if (choice === null) return negotiate(navigator.languages ?? [], codes) ?? defaultLocale;
  return isLocale(choice) && codes.includes(choice) ? choice : defaultLocale;
}

/**
 * Pages are built in English and stay static. After the page loads, the remembered language (or, on
 * a first visit, the browser's own language when it is offered) is applied: text, the page language
 * and its direction. Nothing about the person is sent anywhere; the choice stays in this browser.
 * The main content of a page is still English until a page is on message files, so each page's main
 * region says lang="en" dir="ltr" itself and only the translated chrome follows the choice.
 */
export function LanguageProvider({
  offered,
  children,
}: {
  offered: readonly OfferedLanguage[];
  children: React.ReactNode;
}) {
  const codes = useMemo(() => offered.map((item) => item.code), [offered]);
  const locale = useSyncExternalStore(
    subscribe,
    () => resolve(codes),
    () => defaultLocale,
  );

  useEffect(() => {
    const { html, dir } = localeMeta[locale];
    document.documentElement.lang = html;
    document.documentElement.dir = dir;
  }, [locale]);

  const choose = useCallback(
    (next: Locale) => {
      if (!codes.includes(next)) return;
      remembered = next;
      try {
        window.localStorage.setItem(languageStorageKey, next);
      } catch {
        /* The choice still applies to this visit. */
      }
      listeners.forEach((listener) => listener());
    },
    [codes],
  );

  const value = useMemo<LanguageState>(
    () => ({ locale, offered, choose, t: (key) => translate(locale, key) }),
    [locale, offered, choose],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage() {
  return useContext(Context);
}

export function useT() {
  return useContext(Context).t;
}

/** Text for a server component. The page is built in English; the browser swaps it after load. */
export function T({ k }: { k: MessageKey }) {
  return <>{useT()(k)}</>;
}
