'use client';
// The quiet line for a list a journey cannot sort (docs/revamp/specs/journey-modes.md 3.7). It lives in its own file
// and reads only the mode, with no router, so the Reports tabs can draw it wherever they are drawn.
import './journey-note.css';
import { useJourneyMode } from './journey-mode-context';

/**
 * Above a list that has no request to sort it by: while a journey is chosen it is still shown whole, and says so.
 * Nothing in Everything or while journey modes are off.
 */
export function NotSortedByJourney({ what }: { what: string }) {
  const mode = useJourneyMode();
  if (!mode || mode === 'all') return null;
  return (
    <p className="ux-journey-note" lang="en">
      {what} are not sorted by journey.
    </p>
  );
}
