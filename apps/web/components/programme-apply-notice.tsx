'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
      <span>You chose to apply to {intent.title}. Your application has not been sent yet. </span>
      <Link
        className="text-link"
        prefetch={false}
        href={`/account/delegations?apply=${intent.address}`}
      >
        Continue Your Application
      </Link>{' '}
      <button
        type="button"
        className="text-link"
        onClick={() => {
          clearApplyIntent();
          setIntent(null);
        }}
      >
        Not Now
      </button>
    </div>
  );
}
