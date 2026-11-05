import { RowLink, RowList } from '../../components/ux/row-list';

/**
 * Home's one next step, as a single row where the whole row is the link. It is not a second primary button:
 * the header already holds the page's one filled action (New request). The heading is plain sentence case,
 * never a mono-capital label.
 */
export function HomeNextStep({ title, text, href }: { title: string; text: string; href: string }) {
  return (
    <section aria-labelledby="next-step-title" className="home-next">
      <h2 id="next-step-title">Your next step</h2>
      <RowList label="Your next step">
        <RowLink href={href} title={title} cells={[{ name: 'About', value: text }]} />
      </RowList>
    </section>
  );
}
