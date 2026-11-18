'use client';
// The top bar tools (UI/UX.v4 row "Top bar", board screen 10): Listen and the language as its short code, each an
// icon plus a word at 44 px. Menu stays where it is. Under 360 px the same two controls render inside the drawer
// instead (variant "drawer"), so one set of components serves both places.
import './top-bar.css';
import { CorridraIcon } from '../corridra-icon';
import { useListenControl } from '../corner-dock';
import { LanguageButton } from './language-sheet';

/** Listen: icon plus the word. Hidden, never broken, where this browser has no voice for the page language. */
export function ListenButton({ className = 'top-bar-tool' }: { className?: string }) {
  const { supported, speaking, toggle } = useListenControl();
  if (!supported) return null;
  return (
    <button
      type="button"
      className={className}
      data-active={speaking}
      aria-pressed={speaking}
      aria-label={speaking ? 'Stop Reading' : 'Listen to This Page'}
      onClick={toggle}
    >
      <CorridraIcon name={speaking ? 'stop' : 'listen'} size={20} />
      <span aria-hidden="true" lang="en">
        {speaking ? 'Stop' : 'Listen'}
      </span>
    </button>
  );
}

export function TopBarTools({ variant = 'bar' }: { variant?: 'bar' | 'drawer' }) {
  return (
    <div className={variant === 'bar' ? 'top-bar-tools' : 'top-bar-tools top-bar-tools-drawer'}>
      <ListenButton className={variant === 'bar' ? 'top-bar-tool' : 'top-bar-tool top-bar-row'} />
      <LanguageButton className={variant === 'bar' ? 'top-bar-tool' : 'top-bar-tool top-bar-row'} />
    </div>
  );
}
