import type { Metadata } from 'next';
import { BuyerIntroduction } from './introduction';
import Link from 'next/link';
export const metadata: Metadata = {
  title: 'Private introduction | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function BuyerPage() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero">
        <p className="label">Private introduction from Corridra</p>
        <h1>Would this company be relevant to you?</h1>
        <BuyerIntroduction />
        <nav className="access-options" aria-label="Private introduction help">
          <Link className="text-link" href="/workspace">
            Workspace and invitation help
          </Link>
          <Link className="text-link" href="/">
            Back to Corridra
          </Link>
        </nav>
      </section>
    </main>
  );
}
