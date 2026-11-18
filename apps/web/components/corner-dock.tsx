'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { CorridraIcon } from './corridra-icon';
import { useLanguage } from './language-provider';
import { isBarePublicPage } from '../lib/ux/bare-pages';

/** What Listen reads: the main region and its language. A change in either means support must be asked again. */
function contentSignature() {
  const main = document.getElementById('main');
  return {
    main,
    language: main?.lang || document.documentElement.lang || 'en',
    choice: document.documentElement.lang || 'en',
  };
}

/**
 * Calls `changed` when what Listen would read changes: the main region is replaced (a link opened another page)
 * or its language changes (the person's choice is applied on the client after the page has loaded). The dock
 * stays through both. One lookup, at most once per frame.
 */
function watchContent(changed: () => void) {
  let seen = contentSignature();
  let frame = 0;
  const recheck = () => {
    frame = 0;
    const now = contentSignature();
    if (now.main === seen.main && now.language === seen.language && now.choice === seen.choice)
      return;
    seen = now;
    changed();
  };
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(recheck);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['lang'],
  });
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}

/** Listen asks again whether the browser can speak what is now on the page. */
function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {};
  window.speechSynthesis.addEventListener('voiceschanged', onChange);
  const stopWatching = watchContent(onChange);
  return () => {
    window.speechSynthesis.removeEventListener('voiceschanged', onChange);
    stopWatching();
  };
}

/** The language of what Listen reads: the main region's own language, not the chrome around it. */
function contentLanguage() {
  return document.getElementById('main')?.lang || document.documentElement.lang || 'en';
}

/** True only when this browser can speak the page language. Otherwise Listen is not shown. */
function canSpeak() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined')
    return false;
  const language = contentLanguage().slice(0, 2).toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  // Voices load late in some browsers. Until they are listed, trust English only.
  if (voices.length === 0) return language === 'en';
  return voices.some((voice) => voice.lang.toLowerCase().startsWith(language));
}

/**
 * Hides the corner buttons while the page scrolls down on a wide screen, so they never sit on top of
 * what is being read, and brings them back on the way up or once scrolling stops (UX-15).
 */
export function useScrollHide(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    let timer = 0;
    function onScroll() {
      const now = window.scrollY;
      if (now > last + 4 && now > 80) setHidden(true);
      else if (now < last - 4) setHidden(false);
      last = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHidden(false), 1200);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
    };
  }, [enabled]);
  return hidden;
}

/**
 * Two small icon buttons in the end corner of every page: Listen reads the page aloud, Help opens a
 * short sheet. Listen is hidden, never broken, where the browser has no voice. On phones the corner
 * buttons give way to one Help button in the header (`variant="header"`), whose sheet also offers
 * Listen, so nothing covers the page or right-to-left text (UX-15).
 */
/** Not shown on a bare page. The check sits outside the dock so its hooks always run in the same order. */
export function CornerDock({
  variant = 'corner',
}: {
  variant?: 'corner' | 'header' | 'rail' | 'drawer';
}) {
  const pathname = usePathname();
  return isBarePublicPage(pathname) ? null : <CornerDockView variant={variant} />;
}

/**
 * What Listen needs, shared by the corner dock, the top bar and the drawer: whether this browser can speak the page
 * language, whether it is speaking, and a toggle that starts or stops the reading. A reading belongs to the page and
 * language it started on; when either changes it stops, so it is never left running with no way to stop it.
 */
export function useListenControl() {
  const supported = useSyncExternalStore(subscribe, canSpeak, () => false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    return watchContent(() => {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    });
  }, []);
  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const text = document.getElementById('main')?.innerText.trim();
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = contentLanguage();
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  }
  return { supported, speaking, toggle };
}

function CornerDockView({ variant }: { variant: 'corner' | 'header' | 'rail' | 'drawer' }) {
  const { supported, speaking, toggle: toggleListen } = useListenControl();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const sheetId = `help-sheet-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // 'rail': one Help item at the foot of the signed-in left bar; its sheet also offers Listen.
  const rail = variant === 'rail';
  // 'drawer': the last row of the public drawer (UI/UX.v4 screen 10); the sheet opens inline under the row.
  const drawer = variant === 'drawer';
  const header = variant === 'header' || rail || drawer;
  const scrolledAway = useScrollHide(!header);

  function closeHelp(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) helpButton.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>('a, button')?.focus();
    function outside(event: MouseEvent) {
      const target = event.target as Node;
      if (!sheet.current?.contains(target) && !helpButton.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  return (
    <div
      className={
        rail
          ? 'corner-dock rail-help'
          : drawer
            ? 'corner-dock header-help drawer-help'
            : header
              ? 'corner-dock header-help'
              : 'corner-dock'
      }
      data-hidden={!header && scrolledAway && !open ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          closeHelp(true);
        }
      }}
    >
      {open && (
        <div
          ref={sheet}
          id={sheetId}
          className="dock-sheet"
          role="dialog"
          aria-label="Need a hand?"
        >
          <p>Need a hand?</p>
          <Link prefetch={false} href="/how-it-works" onClick={() => closeHelp(false)}>
            See How It Works
          </Link>
          {supported && (
            // A toggle, so a sheet whose dock has no separate Listen button (header and rail) can also stop it.
            <button
              type="button"
              aria-pressed={speaking}
              onClick={() => {
                closeHelp(true);
                toggleListen();
              }}
            >
              {speaking ? 'Stop Reading' : 'Listen to This Page'}
            </button>
          )}
          <Link prefetch={false} href="/plan" onClick={() => closeHelp(false)}>
            Start a request
          </Link>
          {/* The one place installing is offered: a link in Help, never a banner or a dialog on a page. */}
          <Link prefetch={false} href="/install" onClick={() => closeHelp(false)}>
            Install Corridra
          </Link>
        </div>
      )}
      <button
        ref={helpButton}
        type="button"
        className={variant === 'corner' ? 'dock-button dock-help' : 'dock-button'}
        data-tip={variant === 'header' ? t('header.help') : undefined}
        aria-label={t('header.help')}
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        onClick={() => setOpen(!open)}
      >
        <CorridraIcon name="help" />
        {/* UI/UX.v4 principle 5: no icon stands alone. Only the phone header icon (contributor) keeps its tooltip. */}
        {variant === 'header' ? null : <span aria-hidden="true">{t('header.help')}</span>}
      </button>
      {supported && !header && (
        <button
          type="button"
          className="dock-button dock-listen"
          data-active={speaking}
          data-tip={speaking ? 'Stop Reading' : 'Listen to This Page'}
          aria-label={speaking ? 'Stop Reading' : 'Listen to This Page'}
          aria-pressed={speaking}
          onClick={toggleListen}
        >
          <CorridraIcon name={speaking ? 'stop' : 'listen'} />
        </button>
      )}
    </div>
  );
}
