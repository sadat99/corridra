'use client';
import { PhoneFold } from '../../components/phone-fold';
import Link from 'next/link';
import { OperatorIcon } from '../../components/operator-icon';
import { ReviewSettings } from './review-settings';
import { WorkspaceControls } from './workspace-controls';
import { WorkspaceAudit } from './workspace-audit';
import { PanelHeading } from './panel-heading';
import { Operations } from './operations';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AccessState, StatusBadge } from '../../components/access-state';
import { RoleNavigation } from '../../components/role-navigation';
import { WorkspaceAreaBar, panelFor } from '../../components/workspace-area-bar';
import { identityClient } from '@corridra/auth/client';
import { Counterparties } from './counterparties';
import { CompanyLinkReview } from './company-link-review';
import { Missions } from './missions';
import { TodayPanel } from './today';
import { CommercialProgress } from './opportunities';
import { ControlledAccess } from './access';
import { GovernedAssistance } from './intelligence';
import { ExecutionNetwork } from './network';
import { Delivery } from './delivery';
import { workspaceSections } from '../../lib/workspace-navigation';
import { fragmentFor, operatorSectionPath } from '../../lib/operator-urls';
import { authenticatorReturnTarget } from '../../lib/authenticator-check';
import { AuthenticatorCheck } from './authenticator-check';
type RecordRow = {
  id: string;
  statement?: string;
  locator?: string;
  status?: string;
  scan_status?: string;
  mime?: string;
  role?: string;
  user_id?: string;
  name?: string | null;
  revoked_at?: string | null;
  type?: string;
  occurred_at?: string;
  aggregate_type?: string;
  aggregate_id?: string;
  actor_id?: string;
  correlation_id?: string;
  version?: number;
  key?: string;
  value?: { enabled: boolean };
};
type Snapshot = {
  purpose?: string;
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
  ownerPage = false,
  moveRecords = false,
  initialSection = '',
}: {
  tenants: Tenant[];
  initialTenant: string;
  ownerPage?: boolean;
  moveRecords?: boolean;
  /** The section named by the address (Lane 9), used when the address has no `#` part. */
  initialSection?: string;
}) {
  const router = useRouter();
  const [tenant, setTenant] = useState(initialTenant);
  function switchTenant(next: string) {
    setTenant(next);
    // On a section address the person stays on it; everywhere else this is the address it always was.
    const base = (initialSection && operatorSectionPath(initialSection)) || '/operator';
    router.replace(base + '?workspace=' + encodeURIComponent(next) + window.location.hash, {
      scroll: false,
    });
  }
  return (
    <TenantWorkspace
      key={tenant}
      tenants={tenants}
      tenant={tenant}
      switchTenant={switchTenant}
      ownerPage={ownerPage}
      moveRecords={moveRecords}
      initialSection={initialSection}
    />
  );
}
function TenantWorkspace({
  tenants,
  tenant,
  switchTenant,
  ownerPage,
  moveRecords,
  initialSection,
}: {
  tenants: Tenant[];
  tenant: string;
  switchTenant: (next: string) => void;
  ownerPage: boolean;
  moveRecords: boolean;
  initialSection: string;
}) {
  const router = useRouter();
  const edited = useRef(false);
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [missionRevision, setMissionRevision] = useState(0);
  const [readFailure, setReadFailure] = useState<'denied' | 'unavailable'>('unavailable');
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
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
  const realWorkspace = data?.purpose === 'commercial_qualification';
  // The section before the current one is kept so the authenticator panel can offer a way back.
  const [nav, setNav] = useState({ fragment: '', previous: '' });
  const fragment = nav.fragment;
  useEffect(() => {
    if (!loaded) return;
    // A `#` part always wins, so the old links keep working on a section address too.
    const read = () =>
      setNav((current) => {
        const next = fragmentFor(window.location.hash, initialSection);
        return next === current.fragment ? current : { fragment: next, previous: current.fragment };
      });
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [loaded, initialSection]);
  const sectionAllowed = workspaceSections.some(
    (section) =>
      section.id === fragment && (section.roles as readonly string[]).includes(currentRole ?? ''),
  );
  // One panel is in view at a time. Every panel stays mounted so entries survive a switch.
  const view = sectionAllowed ? panelFor(fragment) : 'overview';
  const unavailableSection =
    !!fragment && fragment !== 'main' && fragment !== 'workspace-navigation' && !sectionAllowed;
  useEffect(() => {
    if (!loaded) return;
    const allowed = fragment === 'main' || fragment === 'workspace-navigation' || sectionAllowed;
    const target = allowed ? document.getElementById(fragment) : null;
    const destination =
      target ?? (fragment ? document.getElementById('workspace-navigation') : null);
    if (destination?.id === 'workspace-navigation') {
      const directory = destination.querySelector('details');
      if (directory) directory.open = true;
    }
    destination?.scrollIntoView();
    destination?.focus({ preventScroll: true });
  }, [loaded, fragment, sectionAllowed]);
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
  // True once the work is done and the records are refreshed; callers that only need the shared
  // status line ignore it.
  async function act(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
      setMessage('Saved.');
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
      return false;
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
        purpose: data?.purpose ?? 'synthetic_validation',
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
            id="operator-workspace-select"
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
        <Link className="text-link" href="/workspace">
          <OperatorIcon name="help" /> All workspaces and access help
        </Link>
        <button className="text-link" disabled={busy} onClick={signOut}>
          <OperatorIcon name="exit" /> Sign out
        </button>
      </div>
      {data &&
        (realWorkspace ? (
          <p role="note" className="operator-scope-note">
            <OperatorIcon name="lock" /> Use authorized records for this workspace.{' '}
            {data.scanMode === 'bypass'
              ? 'Evidence scanning is deferred; unscanned files are marked as bypassed.'
              : 'Evidence follows this workspace’s scanning controls.'}
          </p>
        ) : (
          <p className="ux-testmode" role="note">
            Test mode: use invented records only while customer data controls are completed.
          </p>
        ))}
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
          <div hidden={view === 'overview'}>
            <WorkspaceAreaBar role={data.role} fragment={fragment} />
          </div>
          <div className="ux-panel ux-overview" hidden={view !== 'overview'}>
            <TodayPanel key={`today-${tenant}`} tenant={tenant} revision={missionRevision} />
            <section className="workspace-panel workspace-start" aria-label="Workspace overview">
              <div className="operator-start-heading">
                <StatusBadge tone={realWorkspace ? 'positive' : 'caution'}>
                  {realWorkspace ? 'Operational workspace' : 'Synthetic workspace'}
                </StatusBadge>
                <span className="operator-access">
                  <OperatorIcon name="shield" /> Your access: <strong>{data.role}</strong>
                </span>
              </div>
              <h2>Start with a mission.</h2>
              <p>
                Open a mission, find the right companies, arrange the next conversation, then record
                progress and share an approved view. Actions depend on your role, a current
                authenticator check and approved scope.
              </p>
              <RoleNavigation role={data.role} shortcuts />
              {unavailableSection && (
                <p role="alert">
                  This section is unavailable for your current workspace role or the link is
                  outdated. Choose an available tool above, or ask your workspace owner to review
                  your membership.
                </p>
              )}
            </section>
            {['owner', 'admin'].includes(data.role) && (
              <details className="ux-journey-disclosure operator-management">
                <summary>
                  <OperatorIcon name="settings" />
                  <span>Manage this workspace</span>
                  <OperatorIcon name="chevron" className="operator-disclosure-arrow" />
                </summary>
                <nav className="workspace-navigation" aria-label="Administration">
                  <a href="#ops-center" aria-describedby="operator-admin-hint-ops-center">
                    <OperatorIcon name="settings" />
                    <span>
                      <span>Control Center</span>
                      <small id="operator-admin-hint-ops-center" aria-hidden="true">
                        Operational configuration.
                      </small>
                    </span>
                    <OperatorIcon name="chevron" className="operator-nav-arrow" />
                  </a>
                  <a
                    href="#workspace-settings"
                    aria-describedby="operator-admin-hint-workspace-settings"
                  >
                    <OperatorIcon name="shield" />
                    <span>
                      <span>Corridors and policies</span>
                      <small id="operator-admin-hint-workspace-settings" aria-hidden="true">
                        Scope, rules and guardrails.
                      </small>
                    </span>
                    <OperatorIcon name="chevron" className="operator-nav-arrow" />
                  </a>
                  <a href="#workspace-audit" aria-describedby="operator-admin-hint-workspace-audit">
                    <OperatorIcon name="people" />
                    <span>
                      <span>Access and audit</span>
                      <small id="operator-admin-hint-workspace-audit" aria-hidden="true">
                        Access, permissions and activity.
                      </small>
                    </span>
                    <OperatorIcon name="chevron" className="operator-nav-arrow" />
                  </a>
                  {data.role === 'owner' && (
                    <a
                      href="#workspace-controls"
                      aria-describedby="operator-admin-hint-workspace-controls"
                    >
                      <OperatorIcon name="people" />
                      <span>
                        <span>People and workspace controls</span>
                        <small id="operator-admin-hint-workspace-controls" aria-hidden="true">
                          Manage members and settings.
                        </small>
                      </span>
                      <OperatorIcon name="chevron" className="operator-nav-arrow" />
                    </a>
                  )}
                  <a href="#ops-gates" aria-describedby="operator-admin-hint-ops-gates">
                    <OperatorIcon name="shield" />
                    <span>
                      <span>Production readiness</span>
                      <small id="operator-admin-hint-ops-gates" aria-hidden="true">
                        Review configuration, membership records and launch requirements.
                      </small>
                    </span>
                    <OperatorIcon name="chevron" className="operator-nav-arrow" />
                  </a>
                </nav>
                {ownerPage && (
                  <Link className="text-link" href="/operator/owner">
                    What is on and off
                  </Link>
                )}
                <p>
                  Review operational configuration, membership records and launch requirements.
                  Sensitive changes still require the existing approvals and fresh authenticator
                  verification.
                </p>
              </details>
            )}

            <RoleNavigation role={data.role} />
          </div>
          <div
            id="workspace-missions"
            tabIndex={-1}
            className="workspace-panel ux-panel"
            hidden={view !== 'workspace-missions'}
          >
            <Missions
              key={tenant}
              tenant={tenant}
              onChanged={() => setMissionRevision((v) => v + 1)}
              moveRecords={moveRecords}
            />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div
            id="workspace-research"
            tabIndex={-1}
            className="workspace-panel ux-panel"
            hidden={view !== 'workspace-research'}
          >
            <Counterparties
              purpose={data.purpose ?? 'synthetic_validation'}
              key={`research-${tenant}`}
              tenant={tenant}
              missionRevision={missionRevision}
            />
            {['owner', 'admin', 'reviewer'].includes(data.role) && (
              <CompanyLinkReview key={`links-${tenant}`} tenant={tenant} />
            )}
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div
            id="workspace-meetings"
            tabIndex={-1}
            className="workspace-panel ux-panel"
            hidden={view !== 'workspace-meetings'}
          >
            <ControlledAccess key={`access-${tenant}`} tenant={tenant} revision={missionRevision} />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div
            id="workspace-commercial"
            tabIndex={-1}
            className="workspace-panel ux-panel"
            hidden={view !== 'workspace-commercial'}
          >
            <CommercialProgress
              key={`commercial-${tenant}`}
              tenant={tenant}
              revision={missionRevision}
            />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          <div
            id="workspace-delivery"
            tabIndex={-1}
            className="workspace-panel ux-panel"
            hidden={view !== 'workspace-delivery'}
          >
            <Delivery key={`delivery-${tenant}`} tenant={tenant} revision={missionRevision} />
            <a className="text-link" href="#workspace-navigation">
              Back to workspace sections
            </a>
          </div>
          {['owner', 'admin', 'operator'].includes(data.role) && (
            <div className="ux-panel" hidden={view !== 'workspace-operations'}>
              <Operations
                key={`operations-${tenant}`}
                tenant={tenant}
                role={data.role}
                section={fragment}
                purpose={data.purpose}
              />
            </div>
          )}
          {data.role !== 'viewer' && (
            <>
              <div
                id="workspace-ai"
                tabIndex={-1}
                className="workspace-panel ux-panel"
                hidden={view !== 'workspace-ai'}
              >
                <GovernedAssistance key={`ai-${tenant}`} tenant={tenant} role={data.role} />
                <a className="text-link" href="#workspace-navigation">
                  Back to workspace sections
                </a>
              </div>
              <div
                id="workspace-network"
                tabIndex={-1}
                className="workspace-panel ux-panel"
                hidden={view !== 'workspace-network'}
              >
                <ExecutionNetwork
                  key={`network-${tenant}`}
                  tenant={tenant}
                  role={data.role}
                  workspaceName={tenants.find((item) => item.id === tenant)?.name}
                  onChooseWorkspace={() => {
                    const selector = document.getElementById('operator-workspace-select');
                    selector?.scrollIntoView({ block: 'center', behavior: 'instant' });
                    selector?.focus();
                  }}
                />
                <a className="text-link" href="#workspace-navigation">
                  Back to workspace sections
                </a>
              </div>
            </>
          )}
          <div
            id="workspace-sources"
            tabIndex={-1}
            className="detail-grid workspace-panel ux-panel"
            hidden={view !== 'workspace-sources'}
          >
            <div className="ux-sources-heading">
              <PanelHeading
                title="Sources and claims"
                icon="document"
                description="Record where information came from, review its claims and keep verified facts separate."
              />
            </div>
            <section className="detail-card">
              <h3>Sources</h3>
              <ul>
                {data.sources.map((r) => (
                  <li key={r.id}>
                    {r.locator}
                    <details>
                      <summary>Source reference</summary>
                      <p>Source reference: {r.id}</p>
                    </details>
                  </li>
                ))}
              </ul>
              {data.role !== 'viewer' && (
                <PhoneFold summary="Record a new source (4 fields)">
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
                </PhoneFold>
              )}
            </section>
            <section className="detail-card">
              <h3>Claims</h3>
              <ul>
                {data.claims.map((r) => (
                  <li key={r.id}>
                    {r.statement} <span className="evidence-label">Self-declared</span>
                    <details>
                      <summary>Claim reference</summary>
                      <p>Claim reference: {r.id}</p>
                    </details>
                  </li>
                ))}
              </ul>
              {data.role !== 'viewer' && (
                <PhoneFold summary="Record a new claim (2 fields)">
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
                </PhoneFold>
              )}
            </section>
            <section className="detail-card">
              <h3>Verified facts</h3>
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
            className="operator-section workspace-panel ux-panel"
            hidden={view !== 'workspace-authenticator'}
          >
            <AuthenticatorCheck
              busy={busy}
              act={act}
              returnTo={authenticatorReturnTarget(nav.previous, currentRole)}
              tenant={tenant}
            />
          </section>
          {['owner', 'admin'].includes(data.role) && (
            <div className="ux-panel" hidden={view !== 'workspace-settings'}>
              <ReviewSettings key={`settings-${tenant}`} tenant={tenant} role={data.role} />
            </div>
          )}
          {['owner', 'admin'].includes(data.role) && (
            <section
              id="workspace-audit"
              tabIndex={-1}
              className="operator-section workspace-panel ux-panel"
              hidden={view !== 'workspace-audit'}
            >
              <WorkspaceAudit
                members={members}
                events={audit}
                loaded={auditLoaded}
                busy={busy}
                onLoad={() =>
                  void act(async () => {
                    const [currentMembers, currentAudit] = await Promise.all([
                      request('members'),
                      request('audit'),
                    ]);
                    setMembers(currentMembers);
                    setMembersLoaded(true);
                    setAudit(currentAudit);
                    setAuditLoaded(true);
                  })
                }
              />
            </section>
          )}
          {data.role === 'owner' && (
            <section
              id="workspace-controls"
              tabIndex={-1}
              className="operator-section workspace-panel ux-panel"
              hidden={view !== 'workspace-controls'}
            >
              <WorkspaceControls
                workspaceName={tenants.find((item) => item.id === tenant)?.name ?? 'this workspace'}
                members={members}
                membersLoaded={membersLoaded}
                busy={busy}
                enabled={enabled}
                onLoadMembers={() =>
                  void act(async () => {
                    setMembers(await request('members'));
                    setMembersLoaded(true);
                  })
                }
                onUpdateMember={(value) =>
                  void act(async () => {
                    await request('member', value);
                    setMembers(await request('members'));
                    setMembersLoaded(true);
                  })
                }
                onChangeFeature={(key, value) =>
                  void act(() => request('config', { key, enabled: value }))
                }
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
