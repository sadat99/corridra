import type { ReactNode } from 'react';
import Link from 'next/link';
import { pp } from '../../../lib/i18n/programme-pages';
import { QrCode } from './qr-code';
import './share-kit.css';

/** The pieces of the share kit, drawn by the server and placed by the share row. */
export type ShareKitParts = {
  /** Links that sit in the same row as Copy Link and the two share actions. */
  links: ReactNode;
  /** The QR code, shown when the person presses Show QR Code. */
  qr: ReactNode;
  /** The one quiet line under the row. */
  after: ReactNode;
};

/**
 * The share kit of a public programme page (ADR-084 S1): a printable flyer, a calendar file when the organiser stated the
 * days, a QR code, and one quiet line saying where the page was made. Every action is started by the person pressing it.
 * Nothing here sends anything, counts a visit, carries a referral code or reads more than the published words.
 */
export function shareKitParts({
  address,
  url,
  title,
  calendar,
}: {
  address: string;
  url: string;
  title: string;
  calendar: boolean;
}): ShareKitParts {
  return {
    links: (
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
    qr: (
      <div className="programme-kit-qr">
        <QrCode text={url} label={pp('pp.kit.qr.label', { title })} />
        <p className="programme-public-note">{pp('pp.kit.qr.hint')}</p>
      </div>
    ),
    after: (
      <p className="programme-public-note programme-kit-attribution">
        <Link prefetch={false} className="text-link" href="/trade-missions#organise-entry-title">
          {pp('pp.kit.attribution')}
        </Link>
      </p>
    ),
  };
}
