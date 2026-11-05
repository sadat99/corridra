import Link from 'next/link';

/** The one dark card with one light button. One per screen, always first on Home. */
export function NextStepCard({
  label = 'YOUR NEXT STEP',
  title,
  text,
  action,
  href,
}: {
  label?: string;
  title: string;
  text: string;
  action: string;
  href: string;
}) {
  return (
    <section className="guide-band guide-next" aria-labelledby="next-step-title">
      <div>
        <p className="label">{label}</p>
        <h2 id="next-step-title">{title}</h2>
        <p>{text}</p>
      </div>
      <Link prefetch={false} className="primary-link" href={href}>
        {action}
      </Link>
    </section>
  );
}
