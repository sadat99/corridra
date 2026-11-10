import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { meetingCard, requestTitleFallback } from '../../../lib/meetings/cards';
import { groupMeetings, serverNowMs } from '../../../lib/meetings/group';
import { loadMeetings, meetingReportCap } from '../../../lib/meetings/load';
import { meetingsPartial, requestsMayBeMissing } from '../../../lib/meetings/notice';
import { neonAuth } from '../../../lib/neon-auth';
import { customerTabs } from '../../../lib/ux/customer-navigation';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { loadWorkItems } from '../../../lib/work-items/load';
import { MeetingsList, RequestsSection, type MeetingGroup } from './meetings-list';
import { MeetingsTabs } from './meetings-tabs';
import '../rooms/[requestId]/room-view.css';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Meetings | Corridra',
  robots: { index: false, follow: false },
};

// Navigation v1, the Meetings tab. One list of every meeting and visit in the reports the person has saved, grouped
// by when they start, each opening in its Request. It is read only: the same list of requests the Requests page
// reads, the same assignments and saved reports the Room reads (up to meetingReportCap of them), with the same
// session proof, so it shows nothing the person could not already open. A changed schedule is shown without its old
// details, and nothing is claimed as empty that was not read to the end. The page is two tabs (Meetings, Your
// Requests) so it fits the layout budget; the partial notice sits above the tabs because it concerns both lists.
export default async function Page() {
  // The Meetings tab exists only with the shells switch, so the page does too: without it the address answers 404.
  if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2')) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  const session = await auth?.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!issuer || !session || session.error)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Meetings" compact>
        <p role="alert">Your account could not be checked. Return to your account and try again.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  if (!session.data?.user) redirect(`/signin?next=${encodeURIComponent('/account/meetings')}`);
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  const list = await loadWorkItems(session.data.user.id, issuer, {
    rooms: uxSwitchOn('CORRIDRA_UX_ROAD'),
  });
  const requests = list.items.filter((item) => item.kind === 'request');
  // The list is read only where the workspaces and requests modules are on. Where they are not, nothing was read, so
  // the page must not say there are no requests.
  const readable = customerWorkspacesEnabled() && customerRequestsEnabled();
  const meetings = await loadMeetings(session.data.user.id, issuer, requests);
  const partial = meetingsPartial(list, meetings);
  const switches = {
    trip: uxSwitchOn('CORRIDRA_UX_TRIP'),
    road: uxSwitchOn('CORRIDRA_UX_ROAD'),
    lenses: uxSwitchOn('CORRIDRA_UX_LENSES'),
  };
  const grouped = groupMeetings(meetings.rows, serverNowMs());
  const groups: MeetingGroup[] = (['upcoming', 'past', 'undated', 'changed'] as const).map(
    (key) => ({
      key,
      cards: grouped[key].map((row, index) => meetingCard(row, index, switches)),
    }),
  );
  const shown = meetings.rows.length;
  const libraryHref = customerTabs({ companies: false, move: false }).find(
    (tab) => tab.key === 'reports',
  )?.href;
  const intro =
    'This page lists every meeting and visit the Corridra team has set up for your requests.';
  // With nothing shown, What Happens Next is the only explanation of the page, so it starts open.
  const whatNext = (
    <details className="ux-journey-disclosure" open={shown === 0}>
      <summary>What Happens Next</summary>
      <p>{intro} Each one is a step between your request and your decision.</p>
      {shown > 0 ? <p>Open a meeting in its Request to see what to do next.</p> : null}
      <p>
        Dates and places appear after the Corridra team reviews them. If a time changes, you see a
        notice. The old time stays hidden until a new one is reviewed. Nothing is booked or changed
        from this page.
      </p>
    </details>
  );
  const notSavedSentence =
    meetings.notSaved === 1
      ? '1 of your requests has a report that is not saved yet. Save it from your Library to see its meetings here.'
      : `${meetings.notSaved} of your requests have a report that is not saved yet. Save them from your Library to see their meetings here.`;
  const openLibrary = (
    <Link className="text-link" prefetch={false} href={libraryHref ?? '/account'}>
      Open Library
    </Link>
  );
  // With the meetings panel on show and the partial notice also showing, the three notices are one, above the tabs: the
  // page stays within the layout budget at 1440 and nothing is dropped. The cap sentence is true on both tabs there.
  const meetingsShown = readable && !(meetings.reportsOff && requests.length > 0);
  const oneNotice = partial && meetingsShown;
  const meetingsPanel = (
    <div className="room">
      {whatNext}
      {meetings.capped && !oneNotice ? (
        <p role="status">
          We show meetings from the first {meetingReportCap} reports only. Some meetings may be
          missing. Open a request in the Your Requests tab to see all of its meetings.
        </p>
      ) : null}
      {meetings.notSaved > 0 && !oneNotice ? (
        <p className="ux-draft-notice">
          {notSavedSentence} {openLibrary}
        </p>
      ) : null}
      {requests.length === 0 && !requestsMayBeMissing(list) ? (
        <p role="status">
          You have no requests yet.{' '}
          <Link className="text-link" prefetch={false} href="/plan">
            Start a Request
          </Link>
        </p>
      ) : null}
      {requests.length > 0 && !partial && !meetings.capped && shown === 0 ? (
        <p className="ux-empty">
          No meetings or visits are ready to show yet. They appear here after the Corridra team
          reviews them. You can open any request in the Your Requests tab.
        </p>
      ) : null}
      {shown > 0 ? <MeetingsList groups={groups} /> : null}
    </div>
  );
  const requestsPanel =
    requests.length > 0 ? (
      <RequestsSection
        withMeetings={shown > 0}
        requests={requests.map((request) => ({
          key: request.key,
          title: request.title ?? requestTitleFallback,
          href: request.href,
        }))}
      />
    ) : null;
  return (
    <CustomerShell tab="meetings" eyebrow="YOUR ACCOUNT" title="Meetings">
      {readable ? null : <p>{intro}</p>}
      <div className="room">
        {partial ? (
          <p role="status">
            We could not check all your requests just now. Some meetings may be missing.{' '}
            <Link className="text-link" prefetch={false} href="/account/meetings">
              Try Again
            </Link>
            {oneNotice && meetings.capped ? (
              <>
                {' '}
                We show meetings from the first {meetingReportCap} reports only. Open a request to
                see all of its meetings.
              </>
            ) : null}
            {oneNotice && meetings.notSaved > 0 ? (
              <>
                {' '}
                {notSavedSentence} {openLibrary}
              </>
            ) : null}
          </p>
        ) : null}
        {!readable ? <p role="status">Your requests list is not available here yet.</p> : null}
        {readable && !meetingsShown ? (
          <>
            {whatNext}
            <p role="status">
              Meetings and visits are not available here yet. Your requests are listed below.
            </p>
            {requestsPanel}
          </>
        ) : null}
        {meetingsShown ? <MeetingsTabs meetings={meetingsPanel} requests={requestsPanel} /> : null}
      </div>
    </CustomerShell>
  );
}
