import { notFound } from 'next/navigation';
import {
  customerNotificationsEnabled,
  customerNotificationWithdrawalEnabled,
  type MailMute,
} from '@corridra/auth/customer-notifications';
import { defaultNotificationPreferences, emailIsOn } from '@corridra/domain/notifications';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { customerPageSession } from '../../../lib/customer-page-session';
import { foundations } from '../../../lib/foundations';
import { NotificationsForm } from './notifications-form';
import { MutedRequests } from './muted-requests';
import { mutedRequestLabels } from './muted-labels';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Email choices | Corridra',
  robots: { index: false, follow: false },
};

/**
 * What the person is emailed, when, and in which language. Behind `CORRIDRA_PULSE_ENABLED`: with the switch
 * off this address does not exist, except for a signed-in person who already said yes: saying no never depends
 * on a switch, so they get the form in its paused mode (switching off only). Saving needs the database control
 * to be open as well; until then the page says so plainly and saves nothing but a withdrawal.
 */
export default async function Page() {
  const dark = !customerNotificationsEnabled();
  if (dark && !customerNotificationWithdrawalEnabled()) notFound();
  const session = await customerPageSession();
  if (!session.ok) {
    if (dark) notFound();
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Email choices are unavailable." compact>
        <p role="status">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  }
  const services = foundations();
  let initial = { ...defaultNotificationPreferences, version: 0, open: false, synthetic: false };
  let unavailable = false;
  try {
    if (!services) throw new Error('unavailable');
    await services.ready;
    initial = await services.customerNotifications.read(session.subject, session.issuer);
  } catch {
    unavailable = true;
  }
  if (dark) {
    // Only a person with a saved yes sees the page while the switch is off, and only to switch email off.
    if (unavailable || initial.version === 0 || !emailIsOn(initial)) notFound();
    initial = { ...initial, open: false };
  }
  // The requests the person stopped emails about, with a way back. Read only for the lit page: a person on the
  // paused page can still switch email off but is not offered anything that turns email on. A problem here never
  // hides the choices above; the list is simply left out.
  let mutes: MailMute[] = [];
  const titles: Record<string, string> = {};
  if (!dark && !unavailable && services)
    try {
      mutes = await services.customerNotifications.mutes(session.subject, session.issuer);
      if (mutes.length > 0) {
        const page = (await services.customerRequests.list(
          { pageSize: 100 },
          session.subject,
          session.issuer,
        )) as { requests?: { id: string; createdAt?: string | null }[] };
        Object.assign(titles, mutedRequestLabels(page.requests ?? []));
      }
    } catch {
      /* The titles or the list are not available just now; the choices above still work. */
    }
  return (
    <CustomerShell tab="more" eyebrow="EMAIL CHOICES" title="Choose what we email you.">
      <NotificationsForm initial={initial} unavailable={unavailable} />
      <MutedRequests
        initial={mutes}
        titles={titles}
        canResume={initial.open}
        subject={session.subject}
        issuer={session.issuer}
      />
    </CustomerShell>
  );
}
