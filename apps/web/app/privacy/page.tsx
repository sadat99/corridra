import Link from 'next/link';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { PublicShell } from '../../components/public-shell';

export const metadata = {
  title: 'Privacy and request notice | Corridra',
  description:
    'How Corridra handles account information, mission requests, private access and retention.',
};
export default function Page() {
  const real = realUseEnabled();
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Privacy</span>
          </nav>
          <p className="label">PRIVACY AND REQUEST NOTICE</p>
          <h1>{real ? 'Your information, clearly explained.' : 'Use test details for now.'}</h1>
          <p className="guide-lead">
            {real
              ? 'What we save, why we need it, who can access it and how to ask for help.'
              : 'Mission intake is available for testing. Use invented names, companies and requests, with an email ending in @example.invalid. Do not submit real customer details or confidential documents.'}
          </p>
          <p className="guide-hint">
            Updated 21 October 2026. Request notice version:{' '}
            {real ? 'real-intake-2026-10-21-v1' : 'synthetic-intake-2026-10-05-v1'}.
          </p>
        </div>
      </section>
      <section className="guide-doc" aria-label="How Corridra handles information">
        <article id="contact">
          <h2>Who is responsible</h2>
          <div>
            <p>
              Corridra is operated by Sadat in Gulshan, Dhaka. For account help, privacy questions,
              corrections or a deletion request, contact{' '}
              <a href="mailto:sadat@obsidianglobal.studio">sadat@obsidianglobal.studio</a>.
            </p>
            <p>
              This notice describes the application’s current handling of information. A programme
              may also have its own terms and participation choices. Those terms do not replace this
              notice.
            </p>
          </div>
        </article>
        <article id="accounts">
          <h2>Your account</h2>
          <div>
            <p>
              Customer account names, email addresses, password hashes and sessions are stored
              through Neon Auth in Frankfurt, Germany. Verification and password recovery emails use
              Resend, with sending configured in Ireland.
            </p>
            <p>
              Your password goes to the account provider. It is not saved in mission requests,
              request drafts, receipts or application events. Necessary session cookies keep account
              access working.
            </p>
            <p>
              {real
                ? 'You can create an account before starting a request or at the final contact step. Verify your email and sign in to submit a saved request and access it privately.'
                : 'Account creation is separate from workspace and mission access. The test-intake restrictions on this page still apply.'}
            </p>
            <p>
              Invited staff use a separate operator identity and an authenticator. A customer
              account does not grant staff access.
            </p>
          </div>
        </article>
        <article id="requests">
          <h2>What a request contains</h2>
          <div>
            <p>
              We save the information you submit: your objective, company and contact details,
              target market, timing, product or service requirements, desired outcomes and any
              optional notes or budget details.
            </p>
            <p>
              We also record the notice version you acknowledge, submission time and identifiers
              needed to handle retries, ownership and request history. Submitted business
              information remains self-declared.
            </p>
            <p>
              Request records are stored in the Frankfurt application database. Authorized Corridra
              operators use them to review the request, clarify the work and record progress and
              replies. Request information is not automatically sent to AI or outreach providers.
            </p>
          </div>
        </article>
        <article id="drafts">
          <h2>Drafts and account activation</h2>
          <div>
            <p>
              This browser tab can keep a request draft so you can return to the form. Drafts expire
              in the interface after 24 hours. Passwords are kept out of that draft.
            </p>
            {real ? (
              <>
                <p>
                  At the final step, we save a pending request while you create or activate your
                  account. A private browser cookie carries a possession token; the database keeps
                  its hash. Claiming the request also requires a fresh, verified account matching
                  the contact email.
                </p>
                <p>
                  A pending handoff expires after 24 hours. Expiry stops the handoff from being
                  used; it does not mean the stored record has been automatically deleted. If it
                  expires, start a new request or contact us.
                </p>
              </>
            ) : (
              <p>
                For test submissions, keep your private receipt code. Anyone with that code can read
                the associated status and replies at <Link href="/plan">the request page</Link>. A
                receipt expires after 30 days.
              </p>
            )}
          </div>
        </article>
        <article id="access">
          <h2>Who can see the work</h2>
          <div>
            <p>
              Your account and workspace permissions control customer access. Team members receive
              only the access their role and the specific sharing workflow allow. Programme
              participation does not grant unrestricted access to another company’s private work.
            </p>
            <p>
              Authorized operators can access the records needed to deliver and support the work.
              Information shared through an explicit programme, company or delivery workflow follows
              that workflow’s scope.
            </p>
            <p>
              Account verification confirms control of an account email. It does not verify a
              company, a commercial claim or supporting evidence.
            </p>
          </div>
        </article>
        {process.env.CORRIDRA_NETWORK_ENABLED === 'true' && (
          <article id="contributors">
            <h2>Invited contributor work</h2>
            <div>
              <p>
                An authorized owner or administrator records a contributor’s name, email and
                operating country when preparing a reviewed invitation. The invited person verifies
                their customer account email before setting a separate work password and enrolling
                an authenticator. Work password hashes, authenticator credentials, recovery codes
                and sessions are stored separately from customer accounts in the application
                database.
              </p>
              <p>
                Eligibility records, assigned task instructions, submissions, evidence review,
                contribution assessments and reward decisions are private work records. Contributors
                receive only their assigned task disclosures, not full mission or team access.
                Authorized staff review submissions within their existing permissions. A recorded
                reward does not mean a payment has been made; automated payouts are not available.
              </p>
              <p>
                Pending invitations expire after seven days and can be cancelled before acceptance.
                Expiry or cancellation does not delete invitation or work history. Accepted access
                can be suspended through eligibility controls. Contact us about corrections or
                retention; automatic deletion of these records is not operational.
              </p>
              <p>
                <Link className="text-link" prefetch={false} href="/network">
                  How invited contributor access works
                </Link>
              </p>
            </div>
          </article>
        )}
        <article id="files">
          <h2>Files and deferred scanning</h2>
          <div>
            <p>
              The public request form does not accept file uploads. Where an authorized workflow
              allows files, private access, integrity checks and evidence-review rules still apply.
            </p>
            <p>
              {real
                ? 'Scanning and additional security integrations are deferred by the operator’s explicit decision. An unscanned file must be identified as bypassed, never as clean or independently verified. Do not assume a file is safe merely because it is available in Corridra.'
                : 'Test-only file workflows remain subject to their configured scanning rules. A scan bypass is recorded separately from a clean scan.'}
            </p>
          </div>
        </article>
        <article id="retention">
          <h2>Retention and deletion requests</h2>
          <div>
            <p>
              The recorded mission-intake retention window is 30 days. Automatic deletion is not
              operational yet, so records may remain until an administrator removes them. Account
              records remain until an administrator removes them.
            </p>
            <p>
              Expiry of a draft, handoff, receipt or shared view limits access through that
              mechanism. It does not erase the underlying record. Permissions, corrections and audit
              history are handled separately.
            </p>
            <p>
              Contact us to ask about access, corrections or deletion. We review requests manually,
              including any records that must be kept for the history and accountability of the
              work. Self-service account deletion is not available.
            </p>
          </div>
        </article>
        <article id="updates">
          <h2>Replies and next steps</h2>
          <div>
            <p>
              {real
                ? 'Read request updates and replies in your signed-in account. Account verification and recovery emails are separate from mission updates.'
                : 'Keep your private receipt to read test request status and replies. No account is required for the existing receipt workflow.'}{' '}
              Mission reply emails are not sent.
            </p>
            <p>
              We update this notice when handling changes. A new request records the notice version
              acknowledged at submission. If anything is unclear, contact us before adding sensitive
              information.
            </p>
            <p>
              <Link className="text-link" prefetch={false} href="/about">
                Understand Corridra
              </Link>
            </p>
          </div>
        </article>
      </section>
    </PublicShell>
  );
}
