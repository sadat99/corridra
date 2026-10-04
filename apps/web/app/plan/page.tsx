import { Arrow } from '../../components/arrow';
import Link from 'next/link';
export const metadata = {
  title: 'Mission planning is coming soon. | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero status-page">
        <p className="label">COMING SOON</p>
        <h1>Mission planning is coming soon.</h1>
        <p className="page-description">
          Intake is not open yet. You cannot submit a mission here today. We’re preparing the first
          Bangladesh to Spain/EU corridor and the safeguards needed to handle your information.
        </p>
        <div className="hero-actions">
          <Link prefetch={false} className="primary-link" href="/how-it-works">
            See how Corridra will work{' '}
            <span aria-hidden="true">
              <Arrow />
            </span>
          </Link>
          <Link prefetch={false} className="text-link" href="/">
            Back to Corridra
          </Link>
        </div>
      </section>
    </main>
  );
}
