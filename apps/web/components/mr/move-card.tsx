import Link from 'next/link';
import './move-card.css';
import './scripts.css';
import { HolderBadge, type Holder } from './holder-badge';
import { mrLabels, movePhrase, type MrLabels } from './labels';

import type { MoveVerb } from './types';
export { moveVerbs, type MoveVerb } from './types';

/**
 * One thing a person must do next, drawn as a card. The date is shown only when a real, already
 * formatted date is passed in: there is no streak, no badge and no invented urgency. The action
 * appears only for a holder who can take it (`href` is omitted otherwise).
 */
export function MoveCard({
  verb,
  object,
  holder,
  context,
  due,
  href,
  action,
  labels = mrLabels,
}: {
  verb: MoveVerb;
  /** What the verb is about, in a few plain words ("your import licence number"). */
  object: string;
  holder: Holder;
  /** The request or company this Move belongs to. */
  context?: string;
  /** An already formatted real date. Leave out when there is none. */
  due?: string | null;
  href?: string;
  action?: string;
  labels?: Pick<MrLabels, 'holder' | 'move'>;
}) {
  return (
    <article className="mr-move" data-holder={holder}>
      <div className="mr-move-body">
        <p className="mr-move-kind">{labels.move.verbs[verb]}</p>
        <h3>{movePhrase(labels.move.phrase, labels.move.verbs[verb], object)}</h3>
        {context ? <p className="mr-move-context">{context}</p> : null}
        <p className="mr-move-meta">
          <HolderBadge holder={holder} labels={labels.holder} />
          {due ? (
            <span className="mr-move-due">
              {labels.move.due} <time>{due}</time>
            </span>
          ) : null}
        </p>
      </div>
      {href && action ? (
        <Link prefetch={false} className="button mr-move-action" href={href}>
          {action}
        </Link>
      ) : null}
    </article>
  );
}
