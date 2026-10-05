export const metadata = {
  title: 'Test intake notice | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero">
        <p className="label">TEST INTAKE NOTICE</p>
        <h1>Use test details for now.</h1>
        <p className="page-description">
          Mission intake is available for testing. Please use invented names, companies and briefs,
          with an email ending in @example.invalid. Do not submit customer details, confidential
          documents or personal information.
        </p>
        <div className="detail-card">
          <h2>What is saved</h2>
          <p>
            Your brief, test response details, visit dates and acknowledgement of notice version
            synthetic-intake-2026-10-05-v1 are saved in Frankfurt, Germany. Authorized Corridra
            operators can review these records. Submitted information remains self-declared. It is
            not used by AI or sent to an email provider.
          </p>
          <h2>Your receipt and replies</h2>
          <p>
            Keep your private receipt code to check the mission status and read operator replies at
            /plan. No account is required. Email delivery is not enabled. A receipt expires after 30
            days.
          </p>
          <h2>Retention and customer opening</h2>
          <p>
            The recorded test intake retention window is 30 days. Automatic deletion is not
            operational yet, so records may remain until an administrator removes them. Real
            customer intake will open after the responsible legal entity, privacy contact, response
            delivery and retention controls are confirmed.
          </p>
        </div>
      </section>
    </main>
  );
}
