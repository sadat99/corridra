// Reading comfort choices for signed-in people: Text Size (three steps), Stronger Colours and Less Movement (on or
// off). Each choice is kept in this browser only, never sent anywhere. The page carries the choice as an attribute
// on <html> (data-text-size, data-contrast, data-less-movement); comfort.css reads those attributes, so the
// attributes are the single source of truth. The boot script below sets them before the first paint, as the
// language boot script does. Stronger Colours and Less Movement also follow the device's own setting
// (prefers-contrast, prefers-reduced-motion): the effect is in force when the person chose it or the device asks,
// and a saved Off never lowers it. Owner: W7, W10.

export const textSizeStorageKey = 'corridra.text-size';
export const lessMovementStorageKey = 'corridra.less-movement';
export const contrastStorageKey = 'corridra.contrast';

export const textSizes = ['normal', 'large', 'largest'] as const;
export type TextSize = (typeof textSizes)[number];
export type LessMovement = 'on' | 'off';
export type Contrast = 'more' | 'normal';

export const textSizeAttribute = 'data-text-size';
export const lessMovementAttribute = 'data-less-movement';
export const contrastAttribute = 'data-contrast';

/** The device's own settings that switch the same effects on without a saved choice. */
export const systemContrastQuery = '(prefers-contrast: more)';
export const systemReducedMotionQuery = '(prefers-reduced-motion: reduce)';

/** Said when the device already asks for the effect, so the control reads On and does nothing. */
export const deviceAsksNote = 'Your device asks for this';

/** Said when this browser would not keep a choice. It is true: the choice holds for the open page only. */
export const unsavedChoiceNote =
  'This browser cannot save your choice. It lasts until you reload or close this tab.';

/** Anything that is not a known step is the default, so an old or damaged saved value is harmless. */
export function parseTextSize(value: unknown): TextSize {
  return value === 'large' || value === 'largest' ? value : 'normal';
}
export function parseLessMovement(value: unknown): LessMovement {
  return value === 'on' ? 'on' : 'off';
}

export function parseContrast(value: unknown): Contrast {
  return value === 'more' ? 'more' : 'normal';
}

function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

/** The choice now in force on this page. */
export function currentTextSize(): TextSize {
  return parseTextSize(root()?.getAttribute(textSizeAttribute));
}
export function currentLessMovement(): LessMovement {
  return parseLessMovement(root()?.getAttribute(lessMovementAttribute));
}

export function currentContrast(): Contrast {
  return parseContrast(root()?.getAttribute(contrastAttribute));
}

/** Whether the device asks for this (a query such as systemContrastQuery). Anywhere it cannot be read, it does not. */
export function currentSystemSetting(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function writeStored(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function applyTextSize(size: TextSize) {
  if (size === 'normal') root()?.removeAttribute(textSizeAttribute);
  else root()?.setAttribute(textSizeAttribute, size);
}
function applyLessMovement(value: LessMovement) {
  if (value === 'on') root()?.setAttribute(lessMovementAttribute, 'on');
  else root()?.removeAttribute(lessMovementAttribute);
}
function applyContrast(value: Contrast) {
  if (value === 'more') root()?.setAttribute(contrastAttribute, 'more');
  else root()?.removeAttribute(contrastAttribute);
}

// The choices this browser has refused to keep, one entry per control, so the page shows one note while any is
// unsaved and a save that works clears only its own control. Never set on load.
type Control = 'textSize' | 'lessMovement' | 'contrast';
const unsaved = new Set<Control>();
// Whether the note is filled now. A refusal while it is already filled empties it for a moment and fills it again,
// so assistive technology announces it again.
let noteFilled = false;
export const noteRefillDelayMs = 100;
/** Whether any choice was refused by this browser and is still not kept. */
export function currentSaveFailed(): boolean {
  return unsaved.size > 0;
}
export function currentNoteFilled(): boolean {
  return noteFilled;
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((listener) => listener());
}
/** Calls back when either choice changes on this page or in another tab. Returns the way to stop. */
export function subscribeComfort(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Puts the saved choices on the page. Used on load (a cached boot file can be older than this code) and when
 * another tab changes a choice. A browser that cannot read its storage leaves the page as it is.
 */
export function applyStoredComfort() {
  try {
    applyTextSize(parseTextSize(window.localStorage.getItem(textSizeStorageKey)));
    applyLessMovement(parseLessMovement(window.localStorage.getItem(lessMovementStorageKey)));
    applyContrast(parseContrast(window.localStorage.getItem(contrastStorageKey)));
  } catch {
    return;
  }
  notify();
}

const comfortStorageKeys: readonly string[] = [
  textSizeStorageKey,
  lessMovementStorageKey,
  contrastStorageKey,
];
/** A storage event is ours when it names one of the comfort keys, or no key at all (the whole storage was cleared). */
export function isComfortKey(key: string | null): boolean {
  return key === null || comfortStorageKeys.includes(key);
}
/** Another tab changed the saved choices: take them, but leave the page alone for any other key. */
export function handleComfortStorage(event: Pick<StorageEvent, 'key'>) {
  if (isComfortKey(event.key)) applyStoredComfort();
}
/** Follows the saved choices of other tabs. Returns the way to stop. */
export function watchComfortStorage(): () => void {
  window.addEventListener('storage', handleComfortStorage);
  return () => window.removeEventListener('storage', handleComfortStorage);
}

/**
 * Takes a choice for this page first, then tries to keep it. Returns false when the browser would not save
 * it: the choice still holds until the person leaves the page.
 */
export function chooseTextSize(size: TextSize): boolean {
  applyTextSize(size);
  return finishChoice('textSize', writeStored(textSizeStorageKey, size === 'normal' ? null : size));
}
export function chooseLessMovement(value: LessMovement): boolean {
  applyLessMovement(value);
  return finishChoice(
    'lessMovement',
    writeStored(lessMovementStorageKey, value === 'on' ? 'on' : null),
  );
}
export function chooseContrast(value: Contrast): boolean {
  applyContrast(value);
  return finishChoice(
    'contrast',
    writeStored(contrastStorageKey, value === 'more' ? 'more' : null),
  );
}
function finishChoice(control: Control, saved: boolean): boolean {
  if (saved) {
    unsaved.delete(control);
    noteFilled = unsaved.size > 0;
  } else {
    const showing = noteFilled;
    unsaved.add(control);
    noteFilled = !showing;
    if (showing)
      setTimeout(() => {
        noteFilled = unsaved.size > 0;
        notify();
      }, noteRefillDelayMs);
  }
  notify();
  return saved;
}

/**
 * The script that runs before the first paint (appended to /language-boot.js). It is one fixed piece of text with
 * the storage keys and attribute names written in it, so nothing is built from a value and nothing can close a tag.
 * tests/integration/comfort.test.ts checks the text still names the exported constants. A browser that cannot
 * read its storage is left at the defaults.
 */
export function comfortBootScript(): string {
  return `(function(){try{var d=document.documentElement,s=null,m=null,c=null;try{s=localStorage.getItem("corridra.text-size");m=localStorage.getItem("corridra.less-movement");c=localStorage.getItem("corridra.contrast")}catch(e){}if(s==='large'||s==='largest')d.setAttribute("data-text-size",s);if(m==='on')d.setAttribute("data-less-movement",'on');if(c==='more')d.setAttribute("data-contrast",'more')}catch(e){}})();`;
}
