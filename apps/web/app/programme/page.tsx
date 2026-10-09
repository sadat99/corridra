import type { Metadata } from 'next';
import { DeliveryView } from '../delivery-view';
export const metadata: Metadata = {
  title: 'Programme outcomes | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function ProgrammePage() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero">
        <p className="label">Private programme report</p>
        <h1>From participation to commercial progress</h1>
        <DeliveryView audience="INSTITUTION_REPORT" />
      </section>
    </main>
  );
}
