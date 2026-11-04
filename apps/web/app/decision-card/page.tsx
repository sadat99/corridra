import type { Metadata } from 'next';
import { DecisionCardView } from './decision-card-view';

// A page for someone without an account who holds a private link. Nothing about it may be indexed, passed on
// in a referrer or cached, and it reads no session: the header, footer and help dock do not render here
// (lib/ux/bare-pages.ts).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Shared decision | Corridra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return <DecisionCardView />;
}
