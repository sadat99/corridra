// A page section shown in one journey (docs/revamp/specs/journey-modes.md 3.7): the quiet "Showing Sourcing. Show
// Everything" line above it. With no journey chosen (Everything, or journey modes off) it returns the section itself
// and nothing else, so the page is drawn exactly as it was, down to the ids React gives its parts.
import type { ReactNode } from 'react';
import type { JourneyOfMode } from '../../lib/ux/journey-mode';
import { JourneyShowing } from './journey-note';

export function JourneyScoped({
  mode,
  children,
}: {
  mode: JourneyOfMode | null;
  children: ReactNode;
}) {
  if (!mode) return children;
  return (
    <>
      <JourneyShowing mode={mode} />
      {children}
    </>
  );
}
