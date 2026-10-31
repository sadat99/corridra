import type { OperatorRecordRow, OperatorSnapshot } from './workspace-types';

// Extracted unchanged from workspace.tsx on 31 Oct 2026 (commercial readiness program, Wave 0) so
// the team-control stream (WS-D) owns this section in its own file.
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
          ? 'Malware scanning is temporarily disabled. Validated files are marked unscanned. Verification still requires a different reviewer and a fresh authenticator check.'
          : 'Files remain quarantined until validation completes. Verification requires a different reviewer and a fresh authenticator check.'}
      </p>
      {data.evidence.map((r) => (
        <div className="evidence-row" key={r.id}>
          <span>
            {r.mime} · {r.status} · Scan:{' '}
            {r.scan_status === 'BYPASSED' ? 'Not scanned' : r.scan_status}
          </span>
          {(r.scan_status === 'CLEAN' ||
            (r.scan_status === 'BYPASSED' &&
              data.scanMode === 'bypass' &&
              flags.some((f) => f.key === 'evidence.scan_bypass' && f.value?.enabled))) && (
            <a className="text-link" href={`/api/workspace/download?tenant=${tenant}&id=${r.id}`}>
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
          <p>
            PDF, PNG or JPEG. Maximum 4 MiB. Private storage, file type, size and integrity checks
            apply.
            {data.scanMode === 'bypass'
              ? ' Malware scanning is temporarily disabled.'
              : ' A configured scanner is required.'}
          </p>
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
              {data.evidence
                .filter((r) => r.status === 'UNDER_REVIEW')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Decision
            <select name="decision">
              <option>VERIFIED</option>
              <option>REJECTED</option>
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
