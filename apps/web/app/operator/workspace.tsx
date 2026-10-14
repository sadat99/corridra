'use client';
import Link from 'next/link';
import { ReviewSettings } from './review-settings';
import { Operations } from './operations';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AccessState, StatusBadge } from '../../components/access-state';
import { RoleNavigation } from '../../components/role-navigation';
import { identityClient } from '@corridra/auth/client';
import { Counterparties } from './counterparties';
import { Missions } from './missions';
import { CommercialProgress } from './opportunities';
import { ControlledAccess } from './access';
import { GovernedAssistance } from './intelligence';
import { ExecutionNetwork } from './network';
import { Delivery } from './delivery';
import { workspaceSections } from '../../lib/workspace-navigation';
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
type Tenant = { id: string; name: string; role: string };
export function Workspace({
  tenants,
  initialTenant,
}: {
  tenants: Tenant[];
  initialTenant: string;
}) {
  const router = useRouter();
  const [tenant, setTenant] = useState(initialTenant);
  function switchTenant(next: string) {
    setTenant(next);
    router.replace('/operator?workspace=' + encodeURIComponent(next) + window.location.hash, {
      scroll: false,
    });
  }
  return (
    <TenantWorkspace key={tenant} tenants={tenants} tenant={tenant} switchTenant={switchTenant} />
  );
}
function TenantWorkspace({
  tenants,
  tenant,
  switchTenant,
}: {
  tenants: Tenant[];
  tenant: string;
  switchTenant: (next: string) => void;
}) {
  const router = useRouter();
  const edited = useRef(false);
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [missionRevision, setMissionRevision] = useState(0);
  const [unavailableSection, setUnavailableSection] = useState(false);
  const [readFailure, setReadFailure] = useState<'denied' | 'unavailable'>('unavailable');
  const [members, setMembers] = useState<RecordRow[]>([]),
    [audit, setAudit] = useState<RecordRow[]>([]),
    [flags, setFlags] = useState<RecordRow[]>([]);
  const enabled = (key: string) =>
    flags.find((f) => f.key === key)?.value?.enabled ??
    ['research.ingestion', 'research.resolution'].includes(key);
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
    if (!r.ok) {
      if (
        body === undefined &&
        ['workspace', 'config'].includes(action) &&
        [401, 403].includes(r.status)
      ) {
        setData(null);
        setReadFailure('denied');
      }
      throw new Error(result.error ?? 'Request failed');
    }
    return result;
  }
  async function refresh() {
    const [snapshot, config] = await Promise.all([request('workspace'), request('config')]);
    setData(snapshot);
    setFlags(config);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    Promise.all(
      ['workspace', 'config'].map(async (action) => {
        const r = await fetch(`/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const result = await r.json();
        if (!r.ok) throw Object.assign(new Error(result.error), { status: r.status });
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
        if (active) {
          setReadFailure([401, 403].includes(e.status) ? 'denied' : 'unavailable');
          setMessage(e.message);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tenant]);
  const loaded = !!data;
  const currentRole = data?.role;
  useEffect(() => {
    if (!loaded) return;
    function navigate() {
      const fragment = window.location.hash.slice(1);
      const allowed =
        fragment === 'main' ||
        fragment === 'workspace-navigation' ||
        workspaceSections.some(
          (section) =>
            section.id === fragment &&
            (section.roles as readonly string[]).includes(currentRole ?? ''),
        );
      const target = allowed ? document.getElementById(fragment) : null;
      setUnavailableSection(!!fragment && !target);
      const destination =
        target ?? (fragment ? document.getElementById('workspace-navigation') : null);
      destination?.scrollIntoView();
      destination?.focus({ preventScroll: true });
    }
    navigate();
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [loaded, currentRole]);
  async function retryRead() {
    setBusy(true);
    setMessage('');
    try {
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Workspace could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
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
        kind: f.get('kind'),
        locator: f.get('locator'),
        observedAt: new Date().toISOString(),
        classification: f.get('classification'),
        purpose: 'synthetic_validation',
        retentionUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        aiPolicy: f.get('aiPolicy'),
      }),
    );
  }
  function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void act(() => request('claim', { sourceId: f.get('source'), statement: f.get('statement') }));
  }
  async function signOut() {
    setBusy(true);
    try {
      const result = await identityClient.signOut();
      if (result.error) throw new Error('Sign-out could not be confirmed. Please try again.');
      setData(null);
      router.replace('/operator/signin');
      router.refresh();
    } catch {
      setMessage('Sign-out could not be confirmed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="ux-workspace-body"
      onChangeCapture={(event) => {
        if ((event.target as HTMLElement).closest('form')) edited.current = true;
      }}
    >
      <div className="operator-toolbar">
        <label className="field">
          Workspace
          <select
            disabled={busy}
            value={tenant}
            onChange={(e) => {
              if (
                edited.current &&
                !window.confirm(
                  'Switch workspace? Unsaved entries in this workspace will be cleared. Stay here to finish or copy them first.',
                )
              )
                return;
              switchTenant(e.target.value);
            }}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button className="text-link" disabled={busy} onClick={signOut}>
          Sign out
        </button>
      </div>
      <p>Use test records while customer data controls are completed.</p>
      <Link className="text-link" href="/workspace">
        All workspaces and access help
      </Link>
      <p role="status" aria-live="polite" aria-label="Workspace status">
        {message}
      </p>
      {!data ? (
        <AccessState kind={message ? readFailure : 'loading'}>
          <p>{message ? 'Workspace could not be loaded.' : 'Loading workspace…'}</p>
          {message && (
            <button className="text-link" disabled={busy} onClick={() => void retryRead()}>
              Retry workspace
            </button>
          )}
          <Link className="text-link" href="/operator/signin">
            Verify workspace access
          </Link>
          <Link className="text-link" href="/signin">
            Other sign-in options
          </Link>
        </AccessState>
      ) : (
        <>
          <section className="workspace-panel workspace-start" aria-label="Workspace overview">
            <StatusBadge tone="caution">Synthetic workspace</StatusBadge>
            <h2>Your V2 tools</h2>
            <p>
              Your role in this workspace: <strong>{data.role}</strong>. Start with a mission,
              attach source evidence, then follow its requirements, research, delivery and
              commercial progress.
            </p>
            <p>
              AI and contributor execution also require deployment approval. Financial and
              configuration actions need the appropriate role and fresh MFA. Missing data is not a
              zero outcome.
            </p>
            <RoleNavigation role={data.role} shortcuts />
            {unavailableSection && (
              <p role="alert">
                This section is unavailable for your current workspace role or the link is outdated.
                Choose an available tool above, or ask your workspace owner to review your
                membership.
              </p>
            )}
          </section>
          <RoleNavigation role={data.role} />
          <p>
            Choose a section above. Customer sharing and assigned work use their own access links.
          </p>
          {['owner', 'admin', 'operator'].includes(data.role) && (
            <Operations key={`operations-${tenant}`} tenant={tenant} role={data.role} />
          )}
          {data.role !== 'viewer' && (
            <>
              <div id="workspace-ai" tabIndex={-1} className="workspace-panel">
                <GovernedAssistance key={`ai-${tenant}`} tenant={tenant} role={data.role} />
                <a className="text-link" href="#workspace-navigation">
                  Back to workspace sections
                </a>
              </div>
              <div id="workspace-network" tabIndex={-1} className="workspace-panel">
                <ExecutionNetwork key={`network-${tenant}`} tenant={tenant} role={data.role} />
                <a className="text-link" href="#workspace-navigation">
                  Back to workspace sections
                </a>
              </div>
            </>
          )}
          <div id="workspace-missions" tabIndex={-1} className="workspace-panel">
            <Missions
              key={tenant}
              tenant={tenant}
              onChanged={() => setMissionRevision((v) => v + 1)}
            />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div id="workspace-research" tabIndex={-1} className="workspace-panel">
            <Counterparties
              key={`research-${tenant}`}
              tenant={tenant}
              missionRevision={missionRevision}
            />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div id="workspace-meetings" tabIndex={-1} className="workspace-panel">
            <ControlledAccess key={`access-${tenant}`} tenant={tenant} revision={missionRevision} />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div id="workspace-commercial" tabIndex={-1} className="workspace-panel">
            <CommercialProgress
              key={`commercial-${tenant}`}
              tenant={tenant}
              revision={missionRevision}
            />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div id="workspace-delivery" tabIndex={-1} className="workspace-panel">
            <Delivery key={`delivery-${tenant}`} tenant={tenant} revision={missionRevision} />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div id="workspace-sources" tabIndex={-1} className="detail-grid workspace-panel">
            <section className="detail-card">
              <h2>Sources</h2>
              <ul>
                {data.sources.map((r) => (
                  <li key={r.id}>
                    {r.locator}
                    <p>Source reference: {r.id}</p>
                  </li>
                ))}
              </ul>
              {data.role !== 'viewer' && (
                <form className="operator-form" onSubmit={source}>
                  <label className="field">
                    Source type
                    <select name="kind" defaultValue="observation">
                      <option value="observation">Observed information</option>
                      <option value="public_record">Existing public record</option>
                      <option value="self_declaration">Original declaration</option>
                    </select>
                  </label>
                  <label className="field">
                    Source visibility
                    <select name="classification" defaultValue="INTERNAL">
                      <option value="INTERNAL">Internal</option>
                      <option value="PUBLIC">Already public</option>
                    </select>
                  </label>
                  <label className="field">
                    Source AI permission
                    <select name="aiPolicy" defaultValue="DENY">
                      <option value="DENY">Do not use for AI</option>
                      <option value="REVIEW_REQUIRED">Requires a separate rights review</option>
                    </select>
                  </label>
                  <p>
                    Public visibility describes an already public source. A separate rights review
                    and approved provider policy are required before inference.
                  </p>
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
                    <p>Claim reference: {r.id}</p>
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
          <section
            id="workspace-evidence"
            tabIndex={-1}
            className="operator-section workspace-panel"
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
          <section
            id="workspace-authenticator"
            tabIndex={-1}
            className="operator-section workspace-panel"
          >
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
            <ReviewSettings key={`settings-${tenant}`} tenant={tenant} role={data.role} />
          )}
          {['owner', 'admin'].includes(data.role) && (
            <section
              id="workspace-audit"
              tabIndex={-1}
              className="operator-section workspace-panel"
            >
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
            <section
              id="workspace-controls"
              tabIndex={-1}
              className="operator-section workspace-panel"
            >
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
                Deployment approval is separate from these workspace switches. Enabling a workspace
                switch does not activate a disabled deployment.
              </p>
              <p>
                Feature changes append a new version. Disabling a feature preserves its records.
              </p>
              {[
                'evidence.uploads',
                'evidence.verification',
                'evidence.scan_bypass',
                'research.ingestion',
                'research.resolution',
                'communications.introductions',
                'communications.dispatch',
                'opportunities.commands',
                'ai.enabled',
                'network.enabled',
              ].map((key) => (
                <div key={key}>
                  <span>
                    {key}: {enabled(key) ? 'enabled' : 'disabled'}
                  </span>
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        request('config', {
                          key,
                          enabled: !enabled(key),
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
