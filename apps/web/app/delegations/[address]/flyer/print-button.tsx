'use client';
import { pp } from '../../../../lib/i18n/programme-pages';

/** Opens the browser's own print dialog. Nothing is sent anywhere. */
export function PrintButton() {
  return (
    <button type="button" className="primary-link" onClick={() => window.print()}>
      {pp('pp.flyer.print')}
    </button>
  );
}
