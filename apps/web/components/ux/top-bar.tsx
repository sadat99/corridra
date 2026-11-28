'use client';
// The top bar tools (UI/UX.v4 row "Top bar", board screen 10): Listen and the language as its short code, each an
// icon plus a word at 44 px. Menu stays where it is. Under 360 px the same two controls render inside the drawer
// instead (variant "drawer"), so one set of components serves both places.
import './top-bar.css';
import { useSyncExternalStore } from 'react';
import {
  readCustomerAccountV18,
  readServerCustomerAccountV18,
  subscribeCustomerNote,
} from './customer-bar-store';
import { CorridraIcon } from '../corridra-icon';
import { useListenControl } from '../corner-dock';
import { useLanguage } from '../language-provider';
import { LanguageButton } from './language-sheet';

/** Listen: icon plus the word. Hidden, never broken, where this browser has no voice for the page language. */
export function ListenButton({ className = 'top-bar-tool' }: { className?: string }) {
  const { supported, speaking, toggle } = useListenControl();
  const { t } = useLanguage();
  const v18 = useSyncExternalStore(
    subscribeCustomerNote,
    readCustomerAccountV18,
    readServerCustomerAccountV18,
  );
  if (!supported || v18) return null;
  return (
    <button
      type="button"
      className={className}
      data-active={speaking}
      aria-pressed={speaking}
      aria-label={speaking ? t('header.listenStopLabel') : t('header.listenLabel')}
      onClick={toggle}
    >
      <CorridraIcon name={speaking ? 'stop' : 'listen'} size={20} />
      <span aria-hidden="true">{speaking ? t('header.listenStop') : t('header.listen')}</span>
    </button>
  );
}

/**
 * Listen and the language. "bar" shows the language as its code (phones and tablets); "wide" shows its own name,
 * for the wide bar's order Listen, English, Sign In, Start a Request; "drawer" is the group under 360 px.
 */
export function TopBarTools({ variant = 'bar' }: { variant?: 'bar' | 'wide' | 'drawer' }) {
  const row = variant === 'drawer' ? 'top-bar-tool top-bar-row' : 'top-bar-tool';
  return (
    <div className={variant === 'drawer' ? 'top-bar-tools top-bar-tools-drawer' : 'top-bar-tools'}>
      <ListenButton className={row} />
      <LanguageButton className={row} showName={variant === 'wide'} />
    </div>
  );
}
