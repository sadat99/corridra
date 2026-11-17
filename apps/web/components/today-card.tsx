import Link from 'next/link';
import './today-card.css';
import { HolderBadge, type Holder } from './mr/holder-badge';

/**
 * The Today card: the one most important open Move, drawn once at the top of Your Move as its lead card (the navy
 * next-step card, one light button). It is presentation only. The server picks the Move (`pickTodayMove`) and the caller passes words
 * already in the person's language; a field with no real value is simply left out, never replaced by a guess.
 */
export function TodayCard({
  heading,
  title,
  titleLang,
  context,
  holder,
  holderLabel,
  holderWords,
  dueLabel,
  due,
  href,
  action,
}: {
  heading: string;
  title: string;
  titleLang?: string;
  context?: string;
  /** Who holds the request this Move belongs to; omitted when the status is not known. */
  holder?: Holder;
  holderLabel?: string;
  holderWords?: Record<Holder, string>;
  dueLabel?: string;
  /** An already formatted real date, never a relative word. */
  due?: string | null;
  href: string;
  action: string;
}) {
  return (
    <section className="today-card" aria-labelledby="today-title" data-testid="today-card">
      <div className="today-head">
        <h3 id="today-title" className="today-heading">
          {heading}
        </h3>
        {holder ? (
          <span className="today-holder">
            {holderLabel ? `${holderLabel} ` : null}
            <HolderBadge holder={holder} labels={holderWords} />
          </span>
        ) : null}
        {due ? (
          <span className="today-due">
            {dueLabel} <time>{due}</time>
          </span>
        ) : null}
      </div>
      <p className="today-move" lang={titleLang} dir="auto">
        {title}
      </p>
      {context ? <p className="today-context">{context}</p> : null}
      <Link prefetch={false} className="primary-link today-action" href={href}>
        {action}
      </Link>
    </section>
  );
}
