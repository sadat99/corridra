import { notFound } from 'next/navigation';
import {
  customerNotificationsEnabled,
  customerNotificationWithdrawalEnabled,
} from '@corridra/auth/customer-notifications';
import { defaultNotificationPreferences, emailIsOn } from '@corridra/domain/notifications';
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
  return (
    <CustomerShell tab="more" eyebrow="EMAIL CHOICES" title="Choose what we email you.">
      <NotificationsForm initial={initial} unavailable={unavailable} />
    </CustomerShell>
  );
}
