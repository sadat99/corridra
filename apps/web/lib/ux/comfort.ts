// Reading comfort choices for signed-in people: Text Size (three steps) and Less Movement (on or off).
// Each choice is kept in this browser only, never sent anywhere. The page carries the choice as an
// attribute on <html> (data-text-size, data-less-movement); comfort.css reads those attributes, so the
// attributes are the single source of truth. The boot script below sets them before the first paint,
// as the language boot script does. Owner: W7.

export const textSizeStorageKey = 'corridra.text-size';
export const lessMovementStorageKey = 'corridra.less-movement';

export const textSizes = ['normal', 'large', 'largest'] as const;
export type TextSize = (typeof textSizes)[number];
export type LessMovement = 'on' | 'off';

export const textSizeAttribute = 'data-text-size';
export const lessMovementAttribute = 'data-less-movement';

/** Anything that is not a known step is the default, so an old or damaged saved value is harmless. */
export function parseTextSize(value: unknown): TextSize {
  return value === 'large' || value === 'largest' ? value : 'normal';
}
export function parseLessMovement(value: unknown): LessMovement {
  return value === 'on' ? 'on' : 'off';
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
  } catch {
    return;
  }
  notify();
}

/**
 * Takes a choice for this page first, then tries to keep it. Returns false when the browser would not save
 * it: the choice still holds until the person leaves the page.
 */
export function chooseTextSize(size: TextSize): boolean {
  applyTextSize(size);
  notify();
  return writeStored(textSizeStorageKey, size === 'normal' ? null : size);
}
export function chooseLessMovement(value: LessMovement): boolean {
  applyLessMovement(value);
  notify();
  return writeStored(lessMovementStorageKey, value === 'on' ? 'on' : null);
}

/**
 * The script that runs before the first paint (appended to /language-boot.js). Only constants go into it,
 * and it never contains a closing tag. A browser that cannot read its storage is left at the defaults.
 */
export function comfortBootScript(): string {
  return `(function(){try{var d=document.documentElement,s=null,m=null;try{s=localStorage.getItem(${JSON.stringify(textSizeStorageKey)});m=localStorage.getItem(${JSON.stringify(lessMovementStorageKey)})}catch(e){}if(s==='large'||s==='largest')d.setAttribute(${JSON.stringify(textSizeAttribute)},s);if(m==='on')d.setAttribute(${JSON.stringify(lessMovementAttribute)},'on')}catch(e){}})();`;
}
