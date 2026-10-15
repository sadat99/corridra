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
          Mission intake is available for testing. Please use invented names, companies and
          requests, with an email ending in @example.invalid. Do not submit customer details,
          confidential documents or personal information.
        </p>
        <div className="detail-card">
          <h2>Account details</h2>
          <p>
            Corridra is operated by Sadat in Gulshan, Dhaka. Customer account names, email
            addresses, password hashes and sessions are stored through Neon Auth in Frankfurt,
            Germany. Verification and password recovery emails use Resend, with sending configured
            in Ireland. Account creation does not grant workspace access.
          </p>
          <p>
            Invited staff use a separate operator identity in the Frankfurt application database. An
            explicit owner invitation is required. First-password setup checks your verified
            customer identity, and workspace access still requires an authenticator. This does not
            enable real customer mission processing.
          </p>
          <p>
            Account records remain until an administrator removes them. Automatic account deletion
            is not available. For account help or a deletion request, contact{' '}
            <a href="mailto:sadat@obsidianglobal.studio">sadat@obsidianglobal.studio</a>. The test
            intake restrictions and retention details below apply separately to mission requests.
          </p>
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
            /plan. No account is required. Mission reply emails are not sent. A receipt expires
            after 30 days.
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
