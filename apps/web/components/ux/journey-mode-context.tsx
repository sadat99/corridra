'use client';
// The current journey mode for client pages, set by the customer frame from the cookie the server read, so nothing
// reads `document.cookie` while rendering and the first paint matches the server. Null means the switch is off.
// This file also holds the one place the cookie is written.
import { createContext, useContext, type ReactNode } from 'react';
import { journeyCookieString, type JourneyMode } from '../../lib/ux/journey-mode';

const JourneyModeContext = createContext<JourneyMode | null>(null);

export function JourneyModeProvider({
  mode,
  children,
}: {
  mode: JourneyMode;
  children: ReactNode;
}) {
  return <JourneyModeContext.Provider value={mode}>{children}</JourneyModeContext.Provider>;
}

/** The mode the page was drawn in, or null where journey modes are off. */
export function useJourneyMode(): JourneyMode | null {
  return useContext(JourneyModeContext);
}

/** Writes the choice. Call it from an event or an effect, never while rendering. A blocked cookie is not an error. */
export function rememberJourneyMode(mode: JourneyMode) {
  try {
    document.cookie = journeyCookieString(mode, window.location.protocol === 'https:');
  } catch {
    /* The choice still applies to this page through its address. */
  }
}
