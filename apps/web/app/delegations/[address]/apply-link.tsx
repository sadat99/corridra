'use client';
import Link from 'next/link';
import { saveApplyIntent } from '../../../lib/programme-apply-intent';

/** The one action of the public page. It remembers the programme in this browser first, so a visitor who has to
 * make an account or sign in is brought back to this application afterwards. */
export function ApplyLink({ address, title }: { address: string; title: string }) {
  return (
    <Link
      prefetch={false}
      className="primary-link"
      href={`/account/delegations?apply=${address}`}
      onClick={() => saveApplyIntent({ address, title })}
    >
      Apply for a Place
    </Link>
  );
}
