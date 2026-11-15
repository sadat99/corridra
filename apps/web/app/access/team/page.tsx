import Link from 'next/link';
import { AccessCard, AccessPage, accessDoorMetadata } from '../../../components/access-page';
import { HelperInterestForm } from '../../../components/helper-interest-form';
import { helperInterestCopy as interest, teamDoorPage as page } from '../../../lib/access-doors';
import { foundations } from '../../../lib/foundations';
import { CountryOptions } from '../../operator/country-options';
import { helperInterestEnabled } from '@corridra/auth/helper-interest';

// The form is offered only while both of its switches are on and the register is installed and open; any failure to find
// that out means it is not shown, and the page is exactly what it was.
async function interestOffered() {
  if (!helperInterestEnabled()) return false;
  try {
    const s = foundations();
    if (!s) return false;
    await s.ready;
    return await s.helperInterest.offered();
  } catch {
    return false;
  }
}

// The search-engine setting follows the switch as it is when the page is asked for.
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return accessDoorMetadata('team', page.title, page.lead);
}

export default async function Page() {
  const offerInterest = await interestOffered();
  return (
    <AccessPage id="team" eyebrow={page.eyebrow} title={page.title} lead={page.lead}>
      <p>{page.note}</p>
      <div className="access-cards">
        {page.cards.map((card) => (
          <AccessCard key={card.id} icon={card.icon} title={card.title} level={2}>
            <p>{card.text}</p>
            {card.action.plainAnchor ? (
              <a
                className={card.actionKind === 'primary' ? 'button' : 'button-secondary'}
                href={card.action.href}
              >
                {card.action.text}
              </a>
            ) : (
              <Link
                prefetch={false}
                className={card.actionKind === 'primary' ? 'button' : 'button-secondary'}
                href={card.action.href}
              >
                {card.action.text}
              </Link>
            )}
            <Link prefetch={false} className="text-link" href={card.textLink.href}>
              {card.textLink.text}
            </Link>
          </AccessCard>
        ))}
      </div>
      <section aria-labelledby="access-first">
        <h2 id="access-first">{page.steps.heading}</h2>
        <ol className="access-steps">
          {page.steps.items.map((item, index) => (
            <li key={item}>
              <span className="guide-step-number" aria-hidden="true">
                {index + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
        <Link prefetch={false} className="text-link" href={page.steps.more.href}>
          {page.steps.more.text}
        </Link>
      </section>
      {offerInterest && (
        <section aria-labelledby="access-interest" className="access-interest">
          <details>
            <summary>
              <h2 id="access-interest">{interest.heading}</h2>
            </summary>
            <p>{interest.lead}</p>
            <p>{interest.notice}</p>
            <HelperInterestForm copy={interest}>
              <CountryOptions />
            </HelperInterestForm>
            <Link prefetch={false} className="text-link" href={interest.privacy.href}>
              {interest.privacy.text}
            </Link>
          </details>
        </section>
      )}
    </AccessPage>
  );
}
