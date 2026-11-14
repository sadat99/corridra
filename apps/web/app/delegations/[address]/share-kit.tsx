import type { ReactNode } from 'react';
import Link from 'next/link';
import { pp } from '../../../lib/i18n/programme-pages';
import './share-kit.css';

/** The pieces of the share kit, drawn by the server and placed by the page. They add no height to the page as it first
 * shows: the actions wait behind one closed button in the existing share row, and the attribution replaces a sentence. */
export type ShareKitParts = {
  /** The actions behind the share row's "More" button. */
  more: ReactNode;
  /** The one quiet line: a link that takes the place of the sentence "Corridra provides the tools the organiser uses". */
  attribution: ReactNode;
};

/**
 * The share kit of a public programme page (ADR-084 S1): a printable flyer (which carries the QR code), a calendar file when
 * the organiser stated the days, and one quiet line saying where the page was made. Every action is started by the person
 * pressing it. Nothing here sends anything, counts a visit, carries a referral code or reads more than the published words.
 */
export function shareKitParts({
  address,
  calendar,
}: {
  address: string;
  calendar: boolean;
}): ShareKitParts {
  return {
    more: (
      <>
        <a
          className="text-link"
          href={`/delegations/${address}/flyer`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pp('pp.kit.flyer')}
        </a>
        {calendar && (
          <a className="text-link" href={`/delegations/${address}/calendar.ics`} download>
            {pp('pp.kit.calendar')}
          </a>
        )}
      </>
    ),
    attribution: (
      <Link
        prefetch={false}
        className="programme-kit-attribution"
        href="/trade-missions#organise-entry-title"
      >
        {pp('pp.kit.attribution')}
      </Link>
    ),
  };
}
