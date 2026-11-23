/**
 * One Listen for the whole app. The top bar, the floating dock, the account and Help menus and the drawer all start
 * and stop the same speech synthesizer, so they all read their state from here: a reading started from any of them
 * shows as speaking in every other, and any of them can stop it. A reading belongs to the page and language it
 * started on; when either changes it stops, so it is never left running with no way to stop it.
 */
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
export function subscribeSupport(onChange: () => void) {
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
export function canSpeak() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined')
    return false;
  const language = contentLanguage().slice(0, 2).toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  // Voices load late in some browsers. Until they are listed, trust English only.
  if (voices.length === 0) return language === 'en';
  // D-058: some browsers list a voice that names no language. It cannot read the page and is passed over.
  return voices.some((voice) => (voice.lang ?? '').toLowerCase().startsWith(language));
}

let speaking = false;
let current: SpeechSynthesisUtterance | null = null;
let stopWatching: (() => void) | null = null;
const listeners = new Set<() => void>();

function setSpeaking(next: boolean) {
  if (speaking === next) return;
  speaking = next;
  for (const listener of listeners) listener();
}

export function subscribeSpeaking(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSpeaking() {
  return speaking;
}

export function stopReading() {
  stopWatching?.();
  stopWatching = null;
  current = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  setSpeaking(false);
}

/** Starts reading the main region, or stops the reading that is running. */
export function toggleReading() {
  if (speaking) {
    stopReading();
    return;
  }
  const text = document.getElementById('main')?.innerText.trim();
  if (!text) return;
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = contentLanguage();
  const done = () => {
    // An older reading ending after a newer one started must not switch the newer one off.
    if (current === utterance) stopReading();
  };
  utterance.onend = done;
  utterance.onerror = done;
  current = utterance;
  synth.cancel();
  stopWatching?.();
  stopWatching = watchContent(stopReading);
  synth.speak(utterance);
  setSpeaking(true);
}
