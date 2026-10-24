import { notFound } from 'next/navigation';
import { customerNotificationsEnabled } from '@corridra/auth/customer-notifications';
import { defaultNotificationPreferences } from '@corridra/domain/notifications';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { customerPageSession } from '../../../lib/customer-page-session';
import { foundations } from '../../../lib/foundations';
import { NotificationsForm } from './notifications-form';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Email choices | Corridra',
  robots: { index: false, follow: false },
};

/**
 * What the person is emailed, when, and in which language. Behind `CORRIDRA_PULSE_ENABLED`: with the switch
 * off this address does not exist. Saving needs the database control to be open as well; until then the
 * page says so plainly and saves nothing.
 */
export default async function Page() {
  if (!customerNotificationsEnabled()) notFound();
  const session = await customerPageSession();
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Email choices are unavailable." compact>
        <p role="status">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
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
  return (
    <CustomerShell tab="more" eyebrow="EMAIL CHOICES" title="Choose what we email you.">
      <NotificationsForm initial={initial} unavailable={unavailable} />
    </CustomerShell>
  );
}
