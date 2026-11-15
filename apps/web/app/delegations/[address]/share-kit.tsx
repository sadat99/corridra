import type { ReactNode } from 'react';
import Link from 'next/link';
import { pp } from '../../../lib/i18n/programme-pages';
import './share-kit.css';

/** The pieces of the share kit, drawn by the server and placed by the page. The actions wait behind one closed button beside
 * the share heading, which takes no room of its own, and the attribution replaces a sentence with one quiet link on a line of
 * its own (the one place the page grows, by that line less the sentence it replaces). */
export type ShareKitParts = {
  /** The actions behind the share row's "More" button. */
  more: ReactNode;
  /** The one quiet link, on a line of its own, that takes the place of the sentence "Corridra provides the tools the organiser uses". */
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
