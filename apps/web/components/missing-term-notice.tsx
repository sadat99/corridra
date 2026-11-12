// One plain sentence above the comparison when a current quote leaves out a term the comparison engine needs. It
// adds no verdict of its own: the missing terms are exactly the engine's (`compareExperienceOffers`), the supplier
// names and their words are as written, and amounts stay in their original currency and exact minor units. It
// never converts, ranks or recommends.
import type { ReactNode } from 'react';
import type { MissionExperience } from '@corridra/delivery/report';
import { missingTermNotice } from '../lib/room';
import './missing-term-notice.css';

export function MissingTermNotice({
  experience,
  action,
}: {
  experience: MissionExperience;
  /** The existing question action, placed beside the notice by the caller only where it is allowed. */
  action?: ReactNode;
}) {
  const view = missingTermNotice(experience);
  if (!view) return null;
  return (
    <section className="missing-term-notice" aria-labelledby="missing-term-notice-title">
      <div className="missing-term-notice-words">
        <h3 id="missing-term-notice-title">{view.title}</h3>
        {view.lines.map((line) => (
          <p key={line.key}>
            <span lang={line.lang} dir="auto">
              {line.supplier}
            </span>{' '}
            {line.words}
          </p>
        ))}
        {view.samePrice ? <p>{view.samePrice}</p> : null}
      </div>
      {action ? <div className="missing-term-notice-action">{action}</div> : null}
    </section>
  );
}
