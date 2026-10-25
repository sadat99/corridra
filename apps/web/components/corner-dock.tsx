'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CorridraIcon } from './corridra-icon';

/** What Listen reads: the main region and its language. A change in either means support must be asked again. */
function contentSignature() {
  const main = document.getElementById('main');
  return { main, language: main?.lang || document.documentElement.lang || 'en' };
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
    if (now.main === seen.main && now.language === seen.language) return;
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
 * Two small icon buttons in the bottom-right corner of every page: Listen reads the page aloud,
 * Help opens a short sheet. Listen is hidden, never broken, where the browser has no voice.
 */
export function CornerDock() {
  const supported = useSyncExternalStore(subscribe, canSpeak, () => false);
  const [speaking, setSpeaking] = useState(false);
  const [open, setOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // A reading belongs to the page and language it started on. When either changes it stops, so it is never left
  // running with no way to stop it (Listen may not be offered for the new page's language).
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    return watchContent(() => {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    });
  }, []);

  function toggleListen() {
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
      className="corner-dock"
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
          id="help-sheet"
          className="dock-sheet"
          role="dialog"
          aria-label="Need a hand?"
        >
          <p>Need a hand?</p>
          <Link prefetch={false} href="/how-it-works" onClick={() => closeHelp(false)}>
            See how it works
          </Link>
          {supported && (
            <button
              type="button"
              onClick={() => {
                closeHelp(true);
                if (!speaking) toggleListen();
              }}
            >
              Listen to this page
            </button>
          )}
          <Link prefetch={false} href="/plan" onClick={() => closeHelp(false)}>
            Start a request
          </Link>
        </div>
      )}
      <button
        ref={helpButton}
        type="button"
        className="dock-button"
        data-tip="Help"
        aria-label="Help"
        aria-expanded={open}
        aria-controls={open ? 'help-sheet' : undefined}
        onClick={() => setOpen(!open)}
      >
        <CorridraIcon name="help" />
      </button>
      {supported && (
        <button
          type="button"
          className="dock-button"
          data-active={speaking}
          data-tip={speaking ? 'Stop reading' : 'Listen to this page'}
          aria-label={speaking ? 'Stop reading' : 'Listen to this page'}
          aria-pressed={speaking}
          onClick={toggleListen}
        >
          <CorridraIcon name={speaking ? 'stop' : 'listen'} />
        </button>
      )}
    </div>
  );
}
