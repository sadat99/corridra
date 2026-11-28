import '../../../components/ux/row-list.css';
import '../calm-lists.css';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { CustomerShell } from '../../../components/customer-shell';
import { uxSwitchOn } from '../../../lib/ux-switches';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Delegations | Corridra',
  robots: { index: false, follow: false },
};

type Choice = {
  title: string;
  words: string;
  href?: string;
  action: string;
};

/**
 * Delegations (customer account v18): one page for the three things a person does with a delegation. Organise and
 * Participate open the pages that already exist; Ask Corridra to Run One has no server yet, so it is plain text
 * tagged Coming soon, never a link that does nothing.
 */
export default function Page() {
  // Customer account v18 (live by default); set to "false", this page does not exist, as before.
  if (!uxSwitchOn('CORRIDRA_UX_ACCOUNT_V18')) notFound();
  const choices: Choice[] = [
    {
      title: 'Organise',
      words:
        'Set up a delegation you lead: choose the place and dates, invite people, publish the link and run the room.',
      href: customerProgrammesEnabled() ? '/account/delegations/organise' : undefined,
      action: 'Open Organise',
    },
    {
      title: 'Participate',
      words: 'Join a delegation with its link or code, and follow your registrations and results.',
      href: customerParticipantsEnabled() ? '/account/delegations' : undefined,
      action: 'Open Participate',
    },
    {
      title: 'Ask Corridra to Run One',
      words: 'Corridra organises the delegation for you and you approve each step.',
      action: 'Coming soon',
    },
  ];
  return (
    <CustomerShell tab="delegations" eyebrow="DELEGATIONS" title="Delegations">
      <section className="ux-rows guide-area" aria-label="Delegations">
        <ul>
          {choices.map((choice) => (
            <li key={choice.title} className="ux-row">
              {choice.href ? (
                <Link prefetch={false} className="ux-row-link" href={choice.href}>
                  <span className="ux-row-title">{choice.title}</span>
                  <span className="ux-row-cell">{choice.words}</span>
                  <span className="ux-row-cell">{choice.action}</span>
                </Link>
              ) : (
                <div className="ux-row-link" aria-disabled="true">
                  <span className="ux-row-title">{choice.title}</span>
                  <span className="ux-row-cell">{choice.words}</span>
                  <span className="ux-badge">Coming soon</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </CustomerShell>
  );
}
