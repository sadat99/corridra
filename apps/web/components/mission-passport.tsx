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
      <dl>
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
      <section className="ux-next-action" aria-label="Approved next action">
        <h3>Next action</h3>
        <p>{m.nextAction}</p>
        <p>Due {displayDate(m.dueAt)}</p>
      </section>
    </header>
  );
}
