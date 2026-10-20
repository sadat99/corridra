'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {};
  window.speechSynthesis.addEventListener('voiceschanged', onChange);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange);
}

/** True only when this browser can speak the page language. Otherwise Listen is not shown. */
function canSpeak() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined')
    return false;
  const language = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
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
    utterance.lang = document.documentElement.lang || 'en';
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
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
          <path d="M12 17h.01" />
        </svg>
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
          {speaking ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5 6 9H2v6h4l5 4z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M19 5a9 9 0 0 1 0 14" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
