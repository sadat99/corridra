import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { AccessCard, AccessPage, accessDoorMetadata } from '../../../components/access-page';
import { customerDoorPage as page } from '../../../lib/access-doors';

// The sign-in and programme words depend on settings read when the page is asked for.
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return accessDoorMetadata('customer', page.title, page.lead);
}

export default function Page() {
  const { create, signIn } = page.panels;
  const signInAvailable = readNeonAuthConfig() !== null;
  const cards = page.otherWays.cards.filter(
    (card) =>
      card.gate === null ||
      (card.gate === 'participants' ? customerParticipantsEnabled() : customerProgrammesEnabled()),
  );
  return (
    <AccessPage id="customer" eyebrow={page.eyebrow} title={page.title} lead={page.lead}>
      <div className="access-panels">
        <section className="access-panel" aria-labelledby="access-new">
          <h2 id="access-new">{create.heading}</h2>
          <p>{create.text}</p>
          <Link prefetch={false} className="button" href={create.primary.href}>
            {create.primary.text}
          </Link>
          <Link prefetch={false} className="text-link" href={create.textLink.href}>
            {create.textLink.text}
          </Link>
        </section>
        <section className="access-panel" aria-labelledby="access-existing">
          <h2 id="access-existing">{signIn.heading}</h2>
          <p>{signInAvailable ? signIn.text : signIn.unavailableText}</p>
          <Link prefetch={false} className="button-secondary" href={signIn.secondary.href}>
            {signIn.secondary.text}
          </Link>
        </section>
      </div>
      <section aria-labelledby="access-other">
        <h2 id="access-other">{page.otherWays.heading}</h2>
        <div className="access-cards access-cards--three">
          {cards.map((card) => (
            <AccessCard key={card.id} icon={card.icon} title={card.title}>
              <p>{card.text}</p>
              <Link prefetch={false} className="button-secondary" href={card.action.href}>
                {card.action.text}
              </Link>
            </AccessCard>
          ))}
        </div>
      </section>
    </AccessPage>
  );
}
