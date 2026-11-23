'use client';
// The "Switch to" line of journey modes (docs/revamp/specs/journey-modes.md 3.9). A request or programme opened
// while another journey is chosen says which journey it is in and offers to switch. It never switches by itself:
// the person presses the button, the cookie is written and the page is drawn again where it is. Nothing is drawn in
// Everything, when the journeys match, for an unsorted request, or while journey modes are off.
import './journey-note.css';
import { useRouter } from 'next/navigation';
import { journeyModeWords, shouldOfferSwitch } from '../../lib/ux/journey-mode';
import type { WorkFamily } from '../../lib/work-items/types';
import { rememberJourneyMode, useJourneyMode } from './journey-mode-context';

export function JourneyMismatchNote({
  family,
  subject = 'request',
}: {
  family: WorkFamily;
  /** A programme room says "This programme"; every other page says "This request". */
  subject?: 'request' | 'programme';
}) {
  const router = useRouter();
  const offer = shouldOfferSwitch(useJourneyMode(), family);
  if (!offer) return null;
  const journey = journeyModeWords[offer];
  return (
    <p className="ux-journey-note" data-journey-mismatch={offer} lang="en">
      This {subject} is in {journey}.{' '}
      <button
        type="button"
        className="text-link ux-journey-note-action"
        onClick={() => {
          rememberJourneyMode(offer);
          router.refresh();
        }}
      >
        Switch to {journey}
      </button>
    </p>
  );
}
