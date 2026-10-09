import type { Metadata } from 'next';
import { DeliveryView } from '../delivery-view';
export const metadata: Metadata = {
  title: 'Your mission | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function ClientPage() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero">
        <p className="label">Private mission progress</p>
        <h1>Your next commercial step</h1>
        <DeliveryView audience="CLIENT_PROGRESS" />
      </section>
    </main>
  );
}
