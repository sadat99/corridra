import Link from 'next/link';

export const metadata = {
  title: 'Page not found | Corridra',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main id="main" lang="en" dir="ltr" tabIndex={-1} className="ux-public">
      <section className="guide-page-hero guide-lost">
        <div>
          <p className="label">Page not found</p>
          <h1>This page isn’t here.</h1>
          <p className="guide-lead">Go back to the home page, or start a request.</p>
          <div className="guide-page-actions">
            <Link className="primary-link" href="/">
              Back to Corridra
            </Link>
            <Link className="button-secondary" href="/plan">
              Start a request
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
