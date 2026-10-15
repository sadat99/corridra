import type { DeliveryMission } from '@corridra/delivery/report';
import { displayDate } from '@corridra/domain/locale';
import { StatusBadge } from './access-state';
export function MissionPassport({ mission: m }: { mission: DeliveryMission }) {
  return (
    <header className="ux-participant-passport" aria-label="Mission passport">
      <p className="label">MISSION PASSPORT</p>
      <h2>
        {m.company}: {m.title}
      </h2>
      <StatusBadge>{m.status.replaceAll('_', ' ').toLowerCase()}</StatusBadge>
      <p>{m.objective}</p>
      <div className="ux-mission-focus-grid">
        <section className="ux-next-action ux-mission-next" aria-label="Approved next action">
          <p className="label">YOUR NEXT MOVE</p>
          <h3>Next action</h3>
          <p className="ux-mission-decision">{m.nextAction}</p>
          <p>Due {displayDate(m.dueAt)}</p>
          <p className="ux-scope-note">
            Recorded in the approved publication. This is not a confirmed commercial outcome.
          </p>
        </section>
        <aside className="ux-mission-facts" aria-label="Mission at a glance">
          <p className="label">SITUATION AT A GLANCE</p>
          <dl>
            <div>
              <dt>Approved quotations</dt>
              <dd>{m.experience ? m.experience.quotations.length : 'Not included in this view'}</dd>
            </div>
            <div>
              <dt>Held meetings</dt>
              <dd>{m.outcomes.heldMeetings}</dd>
            </div>
            <div>
              <dt>Publication reference</dt>
              <dd>{m.publicationId}</dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{displayDate(m.reviewedAt)}</dd>
            </div>
            <div>
              <dt>Requirement</dt>
              <dd>
                {m.experience?.requirements
                  ? `Version ${m.experience.requirements.version} · ${m.experience.requirements.current ? 'Current requirement' : 'Historical requirement; updated review needed'}`
                  : 'No structured requirement approved'}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </header>
  );
}
