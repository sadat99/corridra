import { PublicShell } from '../../components/public-shell';
import Link from 'next/link';

export const metadata = {
  title: 'Test intake notice | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Test intake notice</span>
          </nav>
          <p className="label">TEST INTAKE NOTICE</p>
          <h1>Use test details for now.</h1>
          <p className="guide-lead">
            Mission intake is available for testing. Please use invented names, companies and
            briefs, with an email ending in @example.invalid. Do not submit customer details,
            confidential documents or personal information.
          </p>
        </div>
      </section>
      <section className="guide-doc" aria-label="What this notice covers">
        <article>
          <h2>Account details</h2>
          <div>
            <p>
              Corridra is operated by Sadat in Gulshan, Dhaka. Customer account names, email
              addresses, password hashes and sessions are stored through Neon Auth in Frankfurt,
              Germany. Verification and password recovery emails use Resend, with sending configured
              in Ireland. Account creation does not grant workspace access.
            </p>
            <p>
              Invited staff use a separate operator identity in the Frankfurt application database.
              An explicit owner invitation is required. First-password setup checks your verified
              customer identity, and workspace access still requires an authenticator. This does not
              enable real customer mission processing.
            </p>
            <p>
              Account records remain until an administrator removes them. Automatic account deletion
              is not available. For account help or a deletion request, contact{' '}
              <a href="mailto:sadat@obsidianglobal.studio">sadat@obsidianglobal.studio</a>. The test
              intake restrictions and retention details below apply separately to mission briefs.
            </p>
          </div>
        </article>
        <article>
          <h2>What is saved</h2>
          <div>
            <p>
              Your brief, test response details, visit dates and acknowledgement of notice version
              synthetic-intake-2026-10-05-v1 are saved in Frankfurt, Germany. Authorized Corridra
              operators can review these records. Submitted information remains self-declared. It is
              not used by AI or sent to an email provider.
            </p>
          </div>
        </article>
        <article>
          <h2>Your receipt and replies</h2>
          <div>
            <p>
              Keep your private receipt code to check the mission status and read operator replies
              at /plan. No account is required. Mission reply emails are not sent. A receipt expires
              after 30 days.
            </p>
          </div>
        </article>
        <article>
          <h2>Retention and customer opening</h2>
          <div>
            <p>
              The recorded test intake retention window is 30 days. Automatic deletion is not
              operational yet, so records may remain until an administrator removes them. Real
              customer intake will open after the responsible legal entity, privacy contact,
              response delivery and retention controls are confirmed.
            </p>
          </div>
        </article>
      </section>
    </PublicShell>
  );
}
