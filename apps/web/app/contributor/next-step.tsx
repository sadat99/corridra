import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import './next-step.css';

// The helper's one next step (UI/UX.v4.1 L9): a card with one primary action. The page gives it the way in it
// already had; a quiet link may sit beside the action. It is a link to a page that exists and decides no access.
export function NextStep({
  title,
  line,
  href,
  action,
  children,
}: {
  /** The name of the step, when it has one of its own. Without it the label names the region. */
  title?: string;
  line?: string;
  href: string;
  /** The words of the one primary action, in Title Case. */
  action: string;
  /** A quiet link beside the action. */
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="helper-next" aria-labelledby={id}>
      {title ? (
        <>
          <p className="label">Your next step</p>
          <h2 id={id}>{title}</h2>
        </>
      ) : (
        <p className="label" id={id}>
          Your next step
        </p>
      )}
      {line ? <p>{line}</p> : null}
      <div className="helper-next-actions">
        <Link prefetch={false} className="primary-link" href={href}>
          {action}
        </Link>
        {children}
      </div>
    </section>
  );
}
