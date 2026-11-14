import Link from 'next/link';
import { AccessCard, AccessPage, accessDoorMetadata } from '../../../components/access-page';
import { teamDoorPage as page } from '../../../lib/access-doors';

// The search-engine setting follows the switch as it is when the page is asked for.
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return accessDoorMetadata('team', page.title, page.lead);
}

export default function Page() {
  return (
    <AccessPage id="team" eyebrow={page.eyebrow} title={page.title} lead={page.lead}>
      <p>{page.note}</p>
      <div className="access-cards">
        {page.cards.map((card) => (
          <AccessCard key={card.id} icon={card.icon} title={card.title} level={2}>
            <p>{card.text}</p>
            <Link
              prefetch={false}
              className={card.actionKind === 'primary' ? 'button' : 'button-secondary'}
              href={card.action.href}
            >
              {card.action.text}
            </Link>
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
    </AccessPage>
  );
}
