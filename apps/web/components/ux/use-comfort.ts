'use client';
// React side of the reading comfort choices (lib/ux/comfort.ts). The choice lives on <html>, so every
// component that reads it, and the CSS, always agree. The server render always shows the defaults.
import { useEffect, useSyncExternalStore } from 'react';
import {
  applyStoredComfort,
  chooseLessMovement,
  chooseTextSize,
  currentLessMovement,
  currentSaveFailed,
  currentTextSize,
  subscribeComfort,
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

/** True after this browser refused to keep a choice; one flag shared by every comfort control on the page. */
export function useSaveFailed(): boolean {
  return useSyncExternalStore(subscribeComfort, currentSaveFailed, () => false);
}

/**
 * Renders nothing. Puts the saved choices on the page when it loads (the boot file can be an older copy) and
 * again when another tab changes them.
 */
export function ComfortSync() {
  useEffect(() => {
    applyStoredComfort();
    window.addEventListener('storage', applyStoredComfort);
    return () => window.removeEventListener('storage', applyStoredComfort);
  }, []);
  return null;
}
