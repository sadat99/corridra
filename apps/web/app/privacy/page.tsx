import Link from 'next/link';
import { customerRealInvoicingEnabled } from '@corridra/auth/customer-invoicing-real';
import { customerSimulatedPaymentsEnabled } from '@corridra/auth/customer-payments-simulated';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { PublicShell } from '../../components/public-shell';

export const metadata = {
  title: 'Privacy notice | Corridra',
  description:
    'Who is responsible for your information, what Corridra collects and why, who it is shared with, where it is stored, how long it is kept and how to use your rights.',
};
export default function Page() {
  const real = realUseEnabled();
  // The first mission email says what it does only while it can actually be sent.
  const missionEmail = real && process.env.CORRIDRA_MISSION_EMAIL_ENABLED === 'true';
  // Email about what needs a person (Pulse) is described only while it can actually be sent.
  const pulseEmail = real && process.env.CORRIDRA_PULSE_ENABLED === 'true';
  // Billing records are described only while invoices can actually be issued; the practice payment flow only while it exists.
  const invoicing = real && customerRealInvoicingEnabled();
  const practicePayments = invoicing && customerSimulatedPaymentsEnabled();
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
          <p className="label">PRIVACY NOTICE</p>
          <h1>{real ? 'Your information, clearly explained.' : 'Use test details for now.'}</h1>
          <p className="guide-lead">
            {real
              ? 'What we save, why we need it, who can access it and how to ask for help.'
              : 'Mission intake is available for testing. Use invented names, companies and requests, with an email ending in @example.invalid. Do not submit real customer details or confidential documents.'}
          </p>
          <p className="guide-hint">
            Updated 24 October 2026. Request notice version:{' '}
            {real ? 'real-intake-2026-10-21-v1' : 'synthetic-intake-2026-10-05-v1'}.
          </p>
        </div>
      </section>
      <section className="guide-doc" aria-label="How Corridra handles information">
        <article id="summary">
          <h2>In short</h2>
          <div>
            <ul>
              <li>We collect only what is needed to run your account and handle your requests.</li>
              <li>
                We do not sell personal information and we do not run advertising or tracking.
              </li>
              <li>
                Your information is stored in Frankfurt, Germany. Only the service providers listed
                below handle it for us.
              </li>
              <li>
                Request information is not automatically sent to AI, outreach or payment providers.
              </li>
              <li>
                You can ask to see, correct or delete your information at any time. See your rights
                below.
              </li>
            </ul>
          </div>
        </article>
        <article id="contact">
          <h2>Who is responsible</h2>
          <div>
            <p>
              Corridra is operated by Corridra Pte Ltd, 101 Robinson Road, Singapore 180239, with
              operations in Gulshan, Dhaka, Bangladesh. Corridra Pte Ltd decides why and how
              personal information in this service is used. In data protection terms it is the
              organisation responsible for that information (the controller under the GDPR, the
              organisation under Singapore’s Personal Data Protection Act).
            </p>
            <p>
              For account help, privacy questions, corrections, a deletion request or to contact our
              data protection contact, write to{' '}
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
        <article id="purposes">
          <h2>What we collect and why</h2>
          <div>
            <ul>
              <li>
                <strong>Account information</strong> (name, email address, sign-in and session
                details). To create and secure your account and let you sign in. Basis: providing
                the service you asked for, and keeping it secure.
              </li>
              <li>
                <strong>Request and company information</strong> (what you submit about your
                business, market, requirements and contacts). To review your request, do the work
                and keep a record of it. Basis: providing the service you asked for.
              </li>
              <li>
                <strong>Workspace and team information</strong> (workspace names, members, roles,
                invitations). To let the right people in your organisation work together. Basis:
                providing the service, and the legitimate interest of the organisation that invited
                you.
              </li>
              <li>
                <strong>Technical and security records</strong> (event and audit history, request
                identifiers, and short-lived abuse-limit counters that hold a keyed hash of your
                network address, not the address itself). To keep the service secure, prevent abuse
                and show who did what. Basis: our legitimate interest in security and
                accountability.
              </li>
              <li>
                <strong>Messages you send us</strong> (support and privacy requests). To reply and
                keep a record. Basis: our legitimate interest in answering you, or the law where it
                requires a record.
              </li>
              {invoicing && (
                <li>
                  <strong>Billing records</strong> (the company name and address you ask us to
                  invoice, invoice and credit note numbers, amounts, and the payments our team
                  records as received, with a bank reference). To issue invoices and keep accounting
                  records. Basis: providing the service you asked for, and our legal duty to keep
                  accounting records. We do not collect card or bank account details through this
                  service. Billing records are kept for as long as accounting law requires, which is
                  longer than the request retention window below, and are not deleted on request
                  while that duty applies.
                </li>
              )}
            </ul>
            <p>
              Under Singapore’s Personal Data Protection Act we rely on your consent, including
              consent given by taking the step of making a request or using a feature, on what is
              necessary to provide the service you asked for, and on the other grounds that Act
              allows. Where we process information because the law requires it, we say so at the
              point it applies. You may withdraw consent at any time by contacting us. This may mean
              we can no longer provide part of the service.
            </p>
            <p>
              We do not make decisions about people based only on automated processing and we do not
              build advertising profiles.
            </p>
            {practicePayments && (
              <p>
                The practice payment flow on the billing page is a simulation with made-up details
                (madeup). It asks for no card or bank details, moves no money and does not change an
                invoice. It records that an attempt was made, its amount and its made-up reference.
              </p>
            )}
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
            {!real && (
              <p>
                If you send a request without signing in, a private code for it is kept in your
                browser on this device so you can check its status later. You can remove it at any
                time with Forget this request on this device. The device forgets it after 30 days.
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
        <article id="sharing">
          <h2>Who we share information with</h2>
          <div>
            <p>
              We do not sell personal information. We use these service providers to run Corridra:
            </p>
            <ul>
              <li>Neon: database hosting and customer account services, in Frankfurt, Germany.</li>
              <li>Vercel: application hosting, in the Frankfurt region.</li>
              <li>Resend: verification and password recovery emails, sent from Ireland.</li>
            </ul>
            <p>
              They process information for us under their own terms and only for these purposes. We
              share information with others only when you ask us to, when a workflow you use says so
              (for example a programme or delivery you have joined), or when the law requires it.
              Corridra staff see the records they need to deliver and support the work, and no more.
            </p>
          </div>
        </article>
        <article id="storage">
          <h2>Cookies and browser storage</h2>
          <div>
            <p>
              Corridra does not use advertising, analytics or tracking cookies. It uses only what
              the service needs:
            </p>
            <ul>
              <li>Necessary session cookies from the account provider keep you signed in.</li>
              {real && (
                <li>
                  A private cookie carries a possession token for a pending request while you create
                  or activate your account. It lasts at most 24 hours.
                </li>
              )}
              <li>
                Your browser tab keeps form drafts and short-lived working state in session storage.
                It is removed when you close the tab.
              </li>
              <li>
                If you choose a language, your browser remembers the choice in local storage. It is
                not sent to us and you can clear it in your browser settings at any time.
              </li>
            </ul>
            <p>
              Because these items are needed to provide what you asked for, they do not need a
              consent banner. You can block them in your browser, but sign-in and forms will then
              not work.
            </p>
          </div>
        </article>
        <article id="transfers">
          <h2>Where information is stored</h2>
          <div>
            <p>
              Application data and customer accounts are stored in Frankfurt, Germany. Corridra
              staff in Singapore and Bangladesh can reach that data to provide and support the
              service, so information may be accessed from outside the country where you live. If
              you are in the European Economic Area or the United Kingdom and want to know what
              safeguards apply to that access, contact us.
            </p>
          </div>
        </article>
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
        <article id="rights">
          <h2>Your rights</h2>
          <div>
            <p>You can ask us to:</p>
            <ul>
              <li>tell you what personal information we hold about you and give you a copy;</li>
              <li>correct information that is wrong or incomplete;</li>
              <li>delete your information, subject to records we must keep;</li>
              <li>
                stop or limit how we use it, or object to a use based on our legitimate interest;
              </li>
              <li>give you your information in a common format so you can move it;</li>
              <li>withdraw a consent you gave.</li>
            </ul>
            <p>
              Write to <a href="mailto:sadat@obsidianglobal.studio">sadat@obsidianglobal.studio</a>
              from the email address on your account so we can confirm it is you. We aim to respond
              within 30 days and will tell you if we need longer or cannot act on a request, and
              why. There is no charge for a reasonable request.
            </p>
            <p>
              If you are not satisfied with our answer you can complain to the data protection
              authority where you live. In Singapore this is the Personal Data Protection Commission
              (pdpc.gov.sg). In the European Economic Area it is your national supervisory
              authority. We would like the chance to put things right first.
            </p>
          </div>
        </article>
        <article id="security">
          <h2>How we protect information</h2>
          <div>
            <p>
              Connections use HTTPS. Passwords are handled by the account provider and stored as
              hashes. Private links and possession tokens are stored as hashes, not in readable
              form. Access follows roles and workspace permissions, enforced in the database as well
              as in the application. Staff use a separate identity with an authenticator. Important
              changes are recorded in an event history.
            </p>
            <p>
              No system is perfectly secure. If a breach of personal information is likely to harm
              you, we will tell you and the authority concerned as the law requires.
            </p>
          </div>
        </article>
        <article id="children">
          <h2>Children</h2>
          <div>
            <p>
              Corridra is a business service. It is not intended for anyone under 18 and we do not
              knowingly collect information from children. If you think a child has given us
              information, contact us and we will delete it.
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
            {missionEmail && (
              <p>
                We email the verified address on your account when we receive your request. Each of
                these emails has a link to mute messages about that request and a link to your
                account. We keep the address used for sending in the Frankfurt application database
                for at most 24 hours, only to send the email, and we do not share it with anyone
                else. These emails are sent through Resend, like account verification emails.
                Sign-in and password emails are separate.
              </p>
            )}
            {pulseEmail && (
              <p>
                If you switch on email about your requests, we email the verified address on your
                account when something needs you. Email is off until you switch it on, and you can
                switch it off at any time on the Email choices page. We read the address from your
                account at the moment we send and do not store it. Each email shows only a plain
                title and a date, with a link to your request and a link to mute messages about that
                request, and is sent through Resend, like account verification emails. We keep your
                email choices, with the time you made them, and a record of each message (its title,
                date and status, never your address) in the Frankfurt application database as part
                of your request history.
              </p>
            )}
            <p>
              We update this notice when handling changes and show the date at the top. A new
              request records the notice version acknowledged at submission. If anything is unclear,
              contact us before adding sensitive information.
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
