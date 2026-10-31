import { SCANNER_LINE } from '@corridra/auth/deferred-controls';
import type { OperatorRecordRow, OperatorSnapshot } from './workspace-types';

const mimeLabels: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
};
const statusLabels: Record<string, string> = {
  SUBMITTED: 'Waiting for file checks',
  UNDER_REVIEW: 'Waiting for another reviewer',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};
const scanLabels: Record<string, string> = {
  PENDING: 'Not checked yet',
  CLEAN: 'Checked, clean',
  BYPASSED: 'Not scanned',
  INFECTED: 'Blocked by the check',
  ERROR: 'Check failed, retry',
};
type EvidenceRow = OperatorRecordRow & { claim_id?: string; created_by?: string };

// Evidence review (moved from workspace.tsx in Wave 0; WS-D owns it). The decision has no default
// (CQ-79). The uploader sees their own submissions (CQ-81) and can never review them; the server
// refuses self-review too. The scanner line is the deferred control D01 (CQ-35).
export function EvidencePanel({
  data,
  view,
  busy,
  tenant,
  flags,
  act,
  request,
}: {
  data: OperatorSnapshot;
  view: string;
  busy: boolean;
  tenant: string;
  flags: OperatorRecordRow[];
  act: (work: () => Promise<unknown>) => Promise<boolean>;
  request: (action: string, body?: unknown) => Promise<unknown>;
}) {
  const actorId = (data as OperatorSnapshot & { actorId?: string }).actorId;
  const evidence = data.evidence as EvidenceRow[];
  const claimText = (id?: string) => data.claims.find((c) => c.id === id)?.statement ?? 'a claim';
  const describe = (r: EvidenceRow) =>
    `${mimeLabels[r.mime ?? ''] ?? 'File'} for ${claimText(r.claim_id)}`;
  const mine = actorId ? evidence.filter((r) => r.created_by === actorId) : [];
  return (
    <section
      id="workspace-evidence"
      tabIndex={-1}
      className="operator-section workspace-panel ux-panel"
      hidden={view !== 'workspace-evidence'}
    >
      <h2>Evidence review</h2>
      <p>
        {data.scanMode === 'bypass'
          ? 'Validated files are marked not scanned. Verification still needs a different reviewer and a fresh authenticator check.'
          : 'Files stay in quarantine until the checks finish. Verification needs a different reviewer and a fresh authenticator check.'}
      </p>
      <p className="ux-scanner-line">{SCANNER_LINE}</p>
      {mine.length > 0 && (
        <section aria-labelledby="my-evidence-heading" className="ux-my-evidence">
          <h3 id="my-evidence-heading">My submitted evidence</h3>
          <ul>
            {mine.map((r) => (
              <li key={r.id}>
                <strong>{describe(r)}</strong>
                <span> · {statusLabels[r.status ?? ''] ?? r.status}</span>
              </li>
            ))}
          </ul>
          <p>
            Someone else on the team must review your evidence. You cannot verify your own files.
          </p>
        </section>
      )}
      {evidence.map((r) => (
        <div className="evidence-row" key={r.id}>
          <span>
            {describe(r)} · {statusLabels[r.status ?? ''] ?? r.status} · File check:{' '}
            {scanLabels[r.scan_status ?? ''] ?? r.scan_status}
          </span>
          {(r.scan_status === 'CLEAN' ||
            (r.scan_status === 'BYPASSED' &&
              data.scanMode === 'bypass' &&
              flags.some((f) => f.key === 'evidence.scan_bypass' && f.value?.enabled))) && (
            <a
              className="text-link"
              href={`/api/workspace/download?${new URLSearchParams({ tenant, id: r.id })}`}
            >
              {r.scan_status === 'BYPASSED' ? 'Download unscanned evidence' : 'Download evidence'}
            </a>
          )}
          {(r.status === 'SUBMITTED' ||
            (r.scan_status === 'BYPASSED' &&
              ['UNDER_REVIEW', 'VERIFIED'].includes(r.status ?? '') &&
              data.scanMode === 'required')) &&
            data.role !== 'viewer' && (
              <button onClick={() => act(() => request('scan', { id: r.id }))} disabled={busy}>
                Run validation
              </button>
            )}
        </div>
      ))}
      {data.role !== 'viewer' && (
        <form
          className="operator-form"
          onSubmit={(event) => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            const file = f.get('file') as File;
            void act(async () => {
              const r = await fetch(
                `/api/workspace/upload?tenant=${tenant}&claim=${f.get('claim')}`,
                { method: 'POST', headers: { 'Content-Type': file.type }, body: file },
              );
              const d = await r.json();
              if (!r.ok) throw new Error(d.error);
            });
          }}
        >
          <label className="field">
            Claim
            <select name="claim" required>
              <option value="">Choose a claim</option>
              {data.claims.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.statement}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Evidence file
            <input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required />
          </label>
          <p>PDF, PNG or JPEG. Maximum 4 MiB. Files are kept in private storage. {SCANNER_LINE}</p>
          <button
            className="primary-link"
            disabled={
              busy ||
              !data.uploadsConfigured ||
              !flags.some((f) => f.key === 'evidence.uploads' && f.value?.enabled)
            }
          >
            Submit for validation
          </button>
        </form>
      )}
      {['owner', 'admin', 'reviewer'].includes(data.role) && (
        <form
          className="operator-form"
          onSubmit={(event) => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            void act(() =>
              request('verify', {
                id: f.get('evidence'),
                decision: f.get('decision'),
                method: f.get('method'),
                scope: f.get('scope'),
                validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
              }),
            );
          }}
        >
          <label className="field">
            Evidence to review
            <select name="evidence" required>
              <option value="">Choose evidence</option>
              {evidence
                .filter((r) => r.status === 'UNDER_REVIEW' && r.created_by !== actorId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {describe(r)}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Decision
            <select name="decision" required defaultValue="">
              <option value="" disabled>
                Choose a decision
              </option>
              <option value="VERIFIED">Verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <label className="field">
            Method
            <input name="method" minLength={3} maxLength={300} required />
          </label>
          <label className="field">
            Scope and limits
            <textarea name="scope" minLength={3} maxLength={1000} required />
          </label>
          <p>Recorded decisions have a 30-day validity window.</p>
          <button
            className="primary-link"
            disabled={
              busy || !flags.some((f) => f.key === 'evidence.verification' && f.value?.enabled)
            }
          >
            Record decision
          </button>
        </form>
      )}
    </section>
  );
}
