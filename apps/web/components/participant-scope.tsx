import { displayDate } from '@corridra/domain/locale';
import { StatusBadge } from './access-state';
export function ParticipantScope({
  purpose,
  expiresAt,
  generatedAt,
  audience,
}: {
  purpose: string;
  expiresAt: string;
  generatedAt?: string;
  audience: string;
}) {
  return (
    <aside className="ux-participant-scope" aria-label="Approved access scope">
      <h2 className="label">Approved sharing scope</h2>
      <StatusBadge tone="info">Private approved scope</StatusBadge>
      <p>{audience}. This link grants only the reviewed information and actions shown here.</p>
      <dl>
        <div>
          <dt>Purpose</dt>
          <dd>{purpose}</dd>
        </div>
        <div>
          <dt>Link expires</dt>
          <dd>{displayDate(expiresAt)}</dd>
        </div>
        {generatedAt && (
          <div>
            <dt>View updated</dt>
            <dd>{displayDate(generatedAt)}</dd>
          </div>
        )}
      </dl>
      <p>
        Publication, verification, a confirmed meeting and recorded payment are separate decisions.
      </p>
    </aside>
  );
}
