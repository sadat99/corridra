import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { AccessCard, AccessPage, accessDoorMetadata } from '../../../components/access-page';
import { CreatePanel } from './create-panel';
import { customerDoorPage as page, customerDoorView } from '../../../lib/access-doors';

// The sign-in and programme words depend on settings read when the page is asked for.
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return accessDoorMetadata('customer', page.title, page.lead);
}

export default function Page() {
  const { signIn } = page.panels;
  const view = customerDoorView({
    signInAvailable: readNeonAuthConfig() !== null,
    workspaces: customerWorkspacesEnabled(),
    participants: customerParticipantsEnabled(),
    programmes: customerProgrammesEnabled(),
  });
  return (
    <AccessPage id="customer" eyebrow={page.eyebrow} title={page.title} lead={page.lead}>
      <div className="access-panels">
        <CreatePanel text={view.createText} button={view.createButton} />
        <section className="access-panel" aria-labelledby="access-existing">
          <h2 id="access-existing">{signIn.heading}</h2>
          <p>{view.signInText}</p>
          {view.signInButton && (
            <Link prefetch={false} className="button-secondary" href={signIn.secondary.href}>
              {signIn.secondary.text}
            </Link>
          )}
        </section>
      </div>
      {view.cards.length > 0 && (
        <section aria-labelledby="access-other">
          <h2 id="access-other">{page.otherWays.heading}</h2>
          <div
            className={
              view.cards.length === 3 ? 'access-cards access-cards--three' : 'access-cards'
            }
          >
            {view.cards.map((card) => (
              <AccessCard key={card.id} icon={card.icon} title={card.title}>
                <p>{card.text}</p>
                <Link prefetch={false} className="button-secondary" href={card.action.href}>
                  {card.action.text}
                </Link>
              </AccessCard>
            ))}
          </div>
        </section>
      )}
    </AccessPage>
  );
}
