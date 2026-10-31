'use client';
// One canonical link on every page (CQ-17): the owned address plus the page path, without query or
// fragment, whichever host served the page. React places the link in the document head.
// Owner: WS-E.
import { usePathname } from 'next/navigation';
import { canonicalPageUrl } from '../../lib/canonical-origin';

export function CanonicalLink() {
  return <link rel="canonical" href={canonicalPageUrl(usePathname())} />;
}
