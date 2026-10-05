'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { identityClient } from '@corridra/auth/client';
import { Missions } from './missions';
type RecordRow = {
  id: string;
  statement?: string;
  locator?: string;
  status?: string;
  scan_status?: string;
  mime?: string;
  role?: string;
  user_id?: string;
  type?: string;
  version?: number;
  key?: string;
  value?: { enabled: boolean };
};
type Snapshot = {
  uploadsConfigured: boolean;
  scanMode: 'required' | 'bypass';
  role: string;
  sources: RecordRow[];
  claims: RecordRow[];
  evidence: RecordRow[];
  facts: RecordRow[];
};
export function Workspace({ tenants }: { tenants: { id: string; name: string; role: string }[] }) {
  const router = useRouter();
  const [tenant, setTenant] = useState(tenants[0].id),
    [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<RecordRow[]>([]),
    [audit, setAudit] = useState<RecordRow[]>([]),
    [flags, setFlags] = useState<RecordRow[]>([]);
  async function request(action: string, body?: unknown) {
    const r = await fetch(
      `/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const result = await r.json();
    if (!r.ok) throw new Error(result.error ?? 'Request failed');
    return result;
  }
  async function refresh() {
    setData(await request('workspace'));
    setFlags(await request('config'));
  }
  useEffect(() => {
    let active = true;
    Promise.all(
      ['workspace', 'config'].map(async (action) => {
        const r = await fetch(`/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}`);
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        return result;
      }),
    )
      .then(([snapshot, config]) => {
        if (active) {
          setData(snapshot);
          setFlags(config);
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [tenant]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
      setMessage('Saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  function source(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void act(() =>
      request('source', {
        kind: 'observation',
        locator: f.get('locator'),
        observedAt: new Date().toISOString(),
        classification: 'INTERNAL',
        purpose: 'synthetic_validation',
        retentionUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        aiPolicy: 'DENY',
      }),
    );
  }
  function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void act(() => request('claim', { sourceId: f.get('source'), statement: f.get('statement') }));
  }
  async function signOut() {
    await identityClient.signOut();
    router.replace('/operator/signin');
    router.refresh();
  }
  return (
    <div>
      <div className="operator-toolbar">
        <label className="field">
          Workspace
          <select
            disabled={busy}
            value={tenant}
            onChange={(e) => {
              setTenant(e.target.value);
              setData(null);
              setMembers([]);
              setAudit([]);
              setFlags([]);
              setMessage('');
            }}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button className="text-link" onClick={signOut}>
          Sign out
        </button>
      </div>
      <p>Use test records while customer data controls are completed.</p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!data ? (
        <p>Loading workspace…</p>
      ) : (
        <>
          <Missions key={tenant} tenant={tenant} />
          <div className="detail-grid">
            <section className="detail-card">
              <h2>Sources</h2>
              <ul>
                {data.sources.map((r) => (
                  <li key={r.id}>{r.locator}</li>
                ))}
              </ul>
              {data.role !== 'viewer' && (
                <form className="operator-form" onSubmit={source}>
                  <label className="field">
                    Source description
                    <input name="locator" required maxLength={500} />
                  </label>
                  <button className="primary-link" disabled={busy}>
                    Record source
                  </button>
                </form>
              )}
            </section>
            <section className="detail-card">
              <h2>Claims</h2>
              <ul>
                {data.claims.map((r) => (
                  <li key={r.id}>
                    {r.statement} <span className="evidence-label">Self-declared</span>
                  </li>
                ))}
              </ul>
              {data.role !== 'viewer' && (
                <form className="operator-form" onSubmit={claim}>
                  <label className="field">
                    Source
                    <select name="source" required>
                      <option value="">Choose a source</option>
                      {data.sources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.locator}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Claim
                    <textarea name="statement" required maxLength={2000} />
                  </label>
                  <button className="primary-link" disabled={busy}>
                    Record claim
                  </button>
                </form>
              )}
            </section>
            <section className="detail-card">
              <h2>Verified facts</h2>
              {data.facts.length ? (
                data.facts.map((r) => <p key={r.id}>{r.statement}</p>)
              ) : (
                <p>No current verified facts.</p>
              )}
            </section>
          </div>
          <section className="operator-section">
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
                  <a
                    className="text-link"
                    href={`/api/workspace/download?tenant=${tenant}&id=${r.id}`}
                  >
                    {r.scan_status === 'BYPASSED'
                      ? 'Download unscanned evidence'
                      : 'Download evidence'}
                  </a>
                )}
                {(r.status === 'SUBMITTED' ||
                  (r.scan_status === 'BYPASSED' &&
                    ['UNDER_REVIEW', 'VERIFIED'].includes(r.status ?? '') &&
                    data.scanMode === 'required')) &&
                  data.role !== 'viewer' && (
                    <button
                      onClick={() => act(() => request('scan', { id: r.id }))}
                      disabled={busy}
                    >
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
                  <input
                    type="file"
                    name="file"
                    accept="application/pdf,image/png,image/jpeg"
                    required
                  />
                </label>
                <p>
                  PDF, PNG or JPEG. Maximum 4 MiB. Private storage, file type, size and integrity
                  checks apply.
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
                    busy ||
                    !flags.some((f) => f.key === 'evidence.verification' && f.value?.enabled)
                  }
                >
                  Record decision
                </button>
              </form>
            )}
          </section>
          <section className="operator-section">
            <h2>Confirm a sensitive action</h2>
            <form
              className="operator-form"
              onSubmit={(event) => {
                event.preventDefault();
                const code = String(new FormData(event.currentTarget).get('code'));
                void act(async () => {
                  const r = await identityClient.twoFactor.verifyTotp({ code, trustDevice: false });
                  if (r.error) throw new Error('Authenticator code was not accepted');
                });
              }}
            >
              <label className="field">
                Current authenticator code
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                />
              </label>
              <button className="primary-link" disabled={busy}>
                Verify again
              </button>
            </form>
          </section>
          {['owner', 'admin'].includes(data.role) && (
            <section className="operator-section">
              <h2>Access and audit</h2>
              <button
                className="text-link"
                onClick={() =>
                  act(async () => {
                    setMembers(await request('members'));
                    setAudit(await request('audit'));
                  })
                }
              >
                Load access and recent changes
              </button>
              <ul>
                {members.map((r) => (
                  <li key={r.user_id}>
                    {r.user_id} · {r.role}
                  </li>
                ))}
              </ul>
              <ul>
                {audit.map((r) => (
                  <li key={r.id}>
                    {r.type} · {r.id}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.role === 'owner' && (
            <section className="operator-section">
              <h2>Workspace controls</h2>
              <form
                className="operator-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const f = new FormData(event.currentTarget);
                  void act(() =>
                    request('member', {
                      userId: f.get('user'),
                      role: f.get('role'),
                      revoked: f.get('revoked') === 'on',
                    }),
                  );
                }}
              >
                <label className="field">
                  Member ID
                  <input name="user" required />
                </label>
                <label className="field">
                  Role
                  <select name="role">
                    {['owner', 'admin', 'operator', 'reviewer', 'viewer'].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="revoked" /> Revoke membership
                </label>
                <button className="primary-link" disabled={busy}>
                  Update membership
                </button>
              </form>
              <p>
                Feature changes append a new version. Disabling a feature preserves its records.
              </p>
              {['evidence.uploads', 'evidence.verification', 'evidence.scan_bypass'].map((key) => (
                <div key={key}>
                  <span>
                    {key}:{' '}
                    {flags.find((f) => f.key === key)?.value?.enabled ? 'enabled' : 'disabled'}
                  </span>
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        request('config', {
                          key,
                          enabled: !flags.find((f) => f.key === key)?.value?.enabled,
                        }),
                      )
                    }
                  >
                    Change {key}
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
