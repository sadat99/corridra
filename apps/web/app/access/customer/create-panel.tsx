import Link from 'next/link';
import { customerDoorPage } from '../../../lib/access-doors';

/**
 * The "New to Corridra" panel of the customer door. Its two actions sit in one action group, which carries the
 * shared action-row class, so the global sibling margin does not push the second action sideways: both start at
 * the same left edge. Kept in its own file so a test can draw it on its own.
 */
export function CreatePanel({ text, button }: { text: string | null; button: boolean }) {
  const { create } = customerDoorPage.panels;
  return (
    <section className="access-panel" aria-labelledby="access-new">
      <h2 id="access-new">{create.heading}</h2>
      {text && <p>{text}</p>}
      <div className="ux-state-actions access-panel-actions">
        {button && (
          <Link prefetch={false} className="button" href={create.primary.href}>
            {create.primary.text}
          </Link>
        )}
        <Link prefetch={false} className="text-link" href={create.textLink.href}>
          {create.textLink.text}
        </Link>
      </div>
    </section>
  );
}
