'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {};
  window.speechSynthesis.addEventListener('voiceschanged', onChange);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange);
}

/** True only when this browser can speak the page language. Otherwise the button is not shown. */
function canSpeak() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined')
    return false;
  const language = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  // Voices load late in some browsers. Until they are listed, trust English only.
  if (voices.length === 0) return language === 'en';
  return voices.some((voice) => voice.lang.toLowerCase().startsWith(language));
}

/** Reads the visible text of the main content aloud. Hidden, not broken, where speech is missing. */
export function ListenButton({ className = 'listen-button' }: { className?: string }) {
  const supported = useSyncExternalStore(subscribe, canSpeak, () => false);
  const [speaking, setSpeaking] = useState(false);
  const spoken = useRef<SpeechSynthesisUtterance | null>(null);
  if (!supported) return null;
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
    utterance.lang = document.documentElement.lang || 'en';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    spoken.current = utterance;
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  }
  return (
    <button type="button" className={className} aria-pressed={speaking} onClick={toggle}>
      <svg
        className="listen-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H2v6h4l5 4z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M19 5a9 9 0 0 1 0 14" />
      </svg>
      <span>{speaking ? 'Stop' : 'Listen'}</span>
      <span className="sr-only">{speaking ? ' reading this page' : ' to this page'}</span>
    </button>
  );
}
