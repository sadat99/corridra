'use client';
// React side of the reading comfort choices (lib/ux/comfort.ts). The choice lives on <html>, so every
// component that reads it, and the CSS, always agree. The server render always shows the defaults.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  applyStoredComfort,
  chooseContrast,
  chooseLessMovement,
  chooseTextSize,
  currentContrast,
  currentLessMovement,
  currentNoteFilled,
  currentSystemSetting,
  currentTextSize,
  subscribeComfort,
  watchComfortStorage,
  type Contrast,
  type LessMovement,
  type TextSize,
} from '../../lib/ux/comfort';

/** The text size now in force and the way to change it. `set` returns false when this browser would not save it. */
export function useTextSize(): [TextSize, (size: TextSize) => boolean] {
  const size = useSyncExternalStore(subscribeComfort, currentTextSize, () => 'normal' as const);
  return [size, chooseTextSize];
}

/** Whether Less Movement is on and the way to change it. `set` returns false when this browser would not save it. */
export function useLessMovement(): [LessMovement, (value: LessMovement) => boolean] {
  const value = useSyncExternalStore(subscribeComfort, currentLessMovement, () => 'off' as const);
  return [value, chooseLessMovement];
}

/** Whether Stronger Colours was chosen and the way to change it. `set` returns false when this browser would not save it. */
export function useContrast(): [Contrast, (value: Contrast) => boolean] {
  const value = useSyncExternalStore(subscribeComfort, currentContrast, () => 'normal' as const);
  return [value, chooseContrast];
}

/**
 * Whether the device itself asks for an effect (a media query such as systemContrastQuery), followed live. The server
 * render and the first client render say no, so the page agrees with what was sent.
 */
export function useSystemSetting(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let list: MediaQueryList;
      try {
        list = window.matchMedia(query);
      } catch {
        return () => {};
      }
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => currentSystemSetting(query),
    () => false,
  );
}

/**
 * Whether the one save-failed note is filled: while any choice this browser refused to keep is still unsaved, and
 * emptied for a moment when a further refusal comes, so it is announced again. Shared by every comfort control.
 */
export function useSaveNoteFilled(): boolean {
  return useSyncExternalStore(subscribeComfort, currentNoteFilled, () => false);
}

/**
 * Renders nothing. Puts the saved choices on the page when it loads (the boot file can be an older copy) and
 * again when another tab changes one of them (a change to any other saved value leaves the page alone).
 */
export function ComfortSync() {
  useEffect(() => {
    applyStoredComfort();
    return watchComfortStorage();
  }, []);
  return null;
}
