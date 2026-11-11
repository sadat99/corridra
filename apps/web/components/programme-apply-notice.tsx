'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { pp } from '../lib/i18n/programme-pages';
import { type ApplyIntent, clearApplyIntent, readApplyIntent } from '../lib/programme-apply-intent';

/**
 * Shown on the account pages only when this browser remembers a programme the person chose to apply to before
 * signing in. Nothing is sent until they open the application and send it themselves.
 */
export function ProgrammeApplyNotice() {
  const [intent, setIntent] = useState<ApplyIntent | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() => {
      const found = readApplyIntent();
      if (found) setIntent(found);
    });
  }, []);
  if (!intent) return null;
  return (
    <div className="ux-draft-notice" data-programme-apply-notice>
      <span>{pp('pp.notice.text', { title: intent.title })} </span>
      <Link
        className="text-link"
        prefetch={false}
        href={`/account/delegations?apply=${intent.address}`}
      >
        {pp('pp.notice.continue')}
      </Link>{' '}
      <button
        type="button"
        className="text-link"
        onClick={() => {
          clearApplyIntent();
          setIntent(null);
        }}
      >
        {pp('pp.notice.dismiss')}
      </button>
    </div>
  );
}
