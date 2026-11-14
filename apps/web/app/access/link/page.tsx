import { AccessCard, AccessPage, accessDoorMetadata } from '../../../components/access-page';
import { linkDoorPage as page } from '../../../lib/access-doors';

// The search-engine setting follows the switch as it is when the page is asked for.
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return accessDoorMetadata('link', page.title, page.lead);
}

export default function Page() {
  return (
    <AccessPage id="link" eyebrow={page.eyebrow} title={page.title} lead={page.lead}>
      <p>{page.note}</p>
      <div className="access-cards">
        {page.cards.map((card) => (
          <AccessCard key={card.id} icon={card.icon} title={card.title} level={2}>
            <p>{card.text}</p>
          </AccessCard>
        ))}
      </div>
      <section aria-labelledby="access-trouble">
        <h2 id="access-trouble">{page.trouble.heading}</h2>
        <p>{page.trouble.text}</p>
      </section>
    </AccessPage>
  );
}
