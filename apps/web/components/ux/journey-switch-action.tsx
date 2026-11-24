'use client';
// The frame's side of the "Switch to" line (docs/revamp/specs/journey-modes.md 3.9): it holds the router, so the
// pages that draw the line do not. Switching writes the cookie and draws the same page again where it is; it never
// navigates.
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { JourneySwitchContext, rememberJourneyMode } from './journey-mode-context';
import type { JourneyMode } from '../../lib/ux/journey-mode';

export function JourneySwitchAction({ children }: { children: ReactNode }) {
  const router = useRouter();
  const switchTo = (mode: JourneyMode) => {
    rememberJourneyMode(mode);
    router.refresh();
  };
  return <JourneySwitchContext.Provider value={switchTo}>{children}</JourneySwitchContext.Provider>;
}
