'use client';
import Link from 'next/link';
import { OperatorIcon } from '../../components/operator-icon';
import { ReviewSettings } from './review-settings';
import { WorkspaceControls } from './workspace-controls';
import { WorkspaceAudit } from './workspace-audit';
import { Operations } from './operations';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AccessState, StatusBadge } from '../../components/access-state';
import { RoleNavigation } from '../../components/role-navigation';
import { WorkspaceAreaBar, panelFor } from '../../components/workspace-area-bar';
import { identityClient } from '@corridra/auth/client';
import { Counterparties } from './counterparties';
import { CompanyLinkReview } from './company-link-review';
import { ErasureQueue } from './erasure-queue';
import { ProblemReportQueue } from './problem-report-queue';
import { ProgrammeApplicationQueue } from './programme-application-queue';
import { problemReportQueueFragment } from '../../lib/problem-report-queue';
import { applicationQueueFragment } from '../../lib/programme-application-queue';
import { Missions } from './missions';
import { TodayPanel } from './today';
import { CommercialProgress } from './opportunities';
import { ControlledAccess } from './access';
import { GovernedAssistance } from './intelligence';
import { ExecutionNetwork } from './network';
import { Delivery } from './delivery';
import {
  operatorSignInPage,
  operatorSignInPath,
  workspaceSections,
} from '../../lib/workspace-navigation';
import {
  addressDestination,
  fragmentFor,
  operatorSectionPath,
  sectionOfFragment,
} from '../../lib/operator-urls';
import { subscribeToHash } from '../../lib/address-store';
import { resolveSubTabsAgain } from '../../components/ux/sub-tabs';
import { authenticatorReturnTarget } from '../../lib/authenticator-check';
import { AuthenticatorCheck } from './authenticator-check';
import { SourcesPanel } from './sources-panel';
import { EvidencePanel } from './evidence-panel';
import { publishTeamContext } from '../../lib/ux/team-context';
import { forgetDeviceRecents } from '../../lib/ux/palette-recents';
import type { MoreKind, OperatorRecordRow, OperatorSnapshot } from './workspace-types';
type RecordRow = OperatorRecordRow;
type Snapshot = OperatorSnapshot;
type Tenant = { id: string; name: string; role: string };
// A closed fold (the phone fold in Delivery) hides what an address names, so a link to a block inside one opens it.
function openFoldsAround(element: Element) {
  for (
    let fold = element.closest('details');
    fold;
    fold = fold.parentElement?.closest('details') ?? null
  )
    fold.open = true;
}
export function Workspace({
  tenants,
  initialTenant,
  ownerPage = false,
  moveRecords = false,
  initialSection = '',
  shellsV2 = false,
  problemReports = false,
  programmeApplications = false,
}: {
  tenants: Tenant[];
  initialTenant: string;
  ownerPage?: boolean;
  moveRecords?: boolean;
  /** The section named by the address (Lane 9), used when the address has no `#` part. */
  initialSection?: string;
  /**
   * `CORRIDRA_UX_SHELLS_V2` (D14): the team sidebar replaces the area bar and the section directory,
   * and only the section in view is rendered. Off, every panel stays mounted as before.
   */
  shellsV2?: boolean;
  /**
   * Whether Report a Problem is offered, as the server decided it (both probes hold). Fail closed: missing means not
   * offered, and then nothing is added to Settings and its address is an unknown fragment.
   */
  problemReports?: boolean;
  /** Whether the staff list of programme applications is offered (switch on and module installed). Fail closed. */
  programmeApplications?: boolean;
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
      shellsV2={shellsV2}
      problemReports={problemReports}
      programmeApplications={programmeApplications}
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
  shellsV2,
  problemReports,
  programmeApplications,
}: {
  tenants: Tenant[];
  tenant: string;
  switchTenant: (next: string) => void;
  ownerPage: boolean;
  moveRecords: boolean;
  initialSection: string;
  shellsV2: boolean;
  problemReports: boolean;
  programmeApplications: boolean;
}) {
  const edited = useRef(false);
  const memberCommand = useRef<{ key: string; id: string } | null>(null);
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
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
  async function request(action: string, body?: unknown, extra = '') {
    const r = await fetch(
      `/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}${extra}`,
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
  /** Appends the next page of sources, claims or evidence below the rows already shown, never twice. */
  async function loadMore(kind: MoreKind) {
    const cursor = data?.[`${kind}Next`];
    if (!cursor) return;
    setBusy(true);
    setMessage('');
    try {
      const page: Snapshot = await request(
        'workspace',
        undefined,
        `&${kind}After=${encodeURIComponent(cursor)}`,
      );
      setData((old) => {
        if (!old) return old;
        const add = (rows: RecordRow[], more: RecordRow[]) => [
          ...rows,
          ...more.filter((m) => !rows.some((r) => r.id === m.id)),
        ];
        return {
          ...old,
          [kind]: add(old[kind], page[kind]),
          // A continuation carries no total; the first page's stands (G12 follow-up).
          [`${kind}Total`]: page[`${kind}Total`] ?? old[`${kind}Total`],
          [`${kind}Next`]: page[`${kind}Next`],
        };
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The next page could not be loaded.');
    } finally {
      setBusy(false);
    }
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
  // The team shell (sidebar and header) follows the loaded workspace and role. Convenience only.
  useEffect(() => {
    publishTeamContext({ tenant, role: currentRole ?? null });
  }, [tenant, currentRole]);
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
  // An address inside a section (a billing block) belongs to that section: the role check and the view
  // follow the section, so the same note shows for a role that may not see it.
  const sectionId = sectionOfFragment(fragment);
  // The queue of problem reports sits inside Settings, so its own address (#problem-report-queue) is allowed for the
  // people who may see Settings, and panelFor puts it in that panel. Not offered, the address is an unknown fragment.
  const reportQueueAddress =
    (problemReports && fragment === problemReportQueueFragment) ||
    (programmeApplications && fragment === applicationQueueFragment);
  const sectionAllowed = workspaceSections.some(
    (section) =>
      (section.id === sectionId || (reportQueueAddress && section.id === 'workspace-settings')) &&
      (section.roles as readonly string[]).includes(currentRole ?? ''),
  );
  // One panel is in view at a time. Every panel stays mounted so entries survive a switch.
  const view = sectionAllowed ? panelFor(sectionId) : 'overview';
  // With the shells switch on only the section in view is rendered (D14); open forms keep their
  // drafts through useFormDraft. Off, every panel stays mounted and is only hidden.
  const shown = (panel: string) => !shellsV2 || view === panel;
  const unavailableSection =
    !!fragment && fragment !== 'main' && fragment !== 'workspace-navigation' && !sectionAllowed;
  useEffect(() => {
    if (!loaded) return;
    const allowed = fragment === 'main' || fragment === 'workspace-navigation' || sectionAllowed;
    const target = allowed ? document.getElementById(fragment) : null;
    // A block inside a section can be missing (its role never gets it) or appear after the section does
    // (its data loads first). The section that holds it is then where the eyes go.
    const holder =
      allowed && !target && sectionId !== fragment ? document.getElementById(sectionId) : null;
    const place = addressDestination({
      fragment,
      sectionId,
      allowed,
      blockExists: !!target,
      holderExists: !!holder,
    });
    const destination =
      place === 'block'
        ? target
        : place === 'section'
          ? holder
          : place === 'directory'
            ? document.getElementById('workspace-navigation')
            : null;
    if (destination?.id === 'workspace-navigation') {
      const directory = destination.querySelector('details');
      if (directory) directory.open = true;
    }
    if (target) openFoldsAround(target);
    const land = () => {
      destination?.scrollIntoView();
      destination?.focus({ preventScroll: true });
    };
    // A hidden tab that holds the block is shown first. React does not flush a forced update from inside an
    // effect, so the tab is shown right after this effect ends and the scroll and focus follow it; the
    // sub-tabs' own effect also scrolls to and focuses the block once its tab shows.
    if (target?.closest<HTMLElement>('[data-subtab]')?.hidden) {
      queueMicrotask(() => {
        resolveSubTabsAgain();
        land();
      });
    } else {
      land();
    }
    // Until the block lands the section is shown and the address waits; the watch ends when the block
    // lands, when the address changes or when the workspace unmounts.
    if (place !== 'section' || !holder) return undefined;
    const watch = new MutationObserver(() => {
      const block = document.getElementById(fragment);
      if (!block) return;
      watch.disconnect();
      resolveSubTabsAgain();
      openFoldsAround(block);
      block.scrollIntoView();
      block.focus({ preventScroll: true });
    });
    watch.observe(holder, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [loaded, fragment, sectionId, sectionAllowed]);
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
      // The command palette's recent items are this person's, on this device: they go with the session.
      forgetDeviceRecents();
      setData(null);
      window.location.replace(operatorSignInPage);
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
        <Link prefetch={false} className="text-link" href="/workspace">
          <OperatorIcon name="help" /> All workspaces and access help
        </Link>
        <button className="text-link" disabled={busy} onClick={signOut}>
          <OperatorIcon name="exit" /> Sign Out
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
            Preview workspace: use made-up records here, never real customer details.
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
              Retry Workspace
            </button>
          )}
          {/* Full page load: drops cached workspace; Next 16.4.3 doubles a # on soft return. */}
          <a
            className="text-link"
            href={operatorSignInPath(tenant, fragmentFor(hash, initialSection))}
          >
            Verify workspace access
          </a>
          <Link prefetch={false} className="text-link" href="/signin">
            Other sign-in options
          </Link>
        </AccessState>
      ) : (
        <>
          {!shellsV2 && (
            <div hidden={view === 'overview'}>
              <WorkspaceAreaBar role={data.role} fragment={sectionId} />
            </div>
          )}
          {shown('overview') && (
            <div className="ux-panel ux-overview" hidden={view !== 'overview'}>
              <TodayPanel
                key={`today-${tenant}`}
                tenant={tenant}
                revision={missionRevision}
                role={data.role}
                problemReports={problemReports}
                start={
                  <section
                    className="workspace-panel workspace-start"
                    aria-label="Workspace overview"
                  >
                    <div className="operator-start-heading">
                      <StatusBadge tone={realWorkspace ? 'positive' : 'caution'}>
                        {realWorkspace ? 'Operational workspace' : 'Preview workspace'}
                      </StatusBadge>
                      <span className="operator-access">
                        <OperatorIcon name="shield" /> Your access: <strong>{data.role}</strong>
                      </span>
                    </div>
                    <h2>Start with a mission.</h2>
                    <p>
                      Open a mission, find the right companies, arrange the next conversation, then
                      record progress and share an approved view. Actions depend on your role, a
                      current authenticator check and approved scope.
                    </p>
                    <RoleNavigation role={data.role} shortcuts />
                    {unavailableSection && (
                      <p role="alert">
                        This section is unavailable for your current workspace role or the link is
                        outdated. Choose an available tool above, or ask your workspace owner to
                        review your membership.
                      </p>
                    )}
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
                          <a
                            href="#workspace-audit"
                            aria-describedby="operator-admin-hint-workspace-audit"
                          >
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
                                <small
                                  id="operator-admin-hint-workspace-controls"
                                  aria-hidden="true"
                                >
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
                          <Link prefetch={false} className="text-link" href="/operator/owner">
                            What is on and off
                          </Link>
                        )}
                        <p>
                          Review operational configuration, membership records and launch
                          requirements. Sensitive changes still require the existing approvals and
                          fresh authenticator verification.
                        </p>
                      </details>
                    )}
                  </section>
                }
              />

              {!shellsV2 && <RoleNavigation role={data.role} />}
            </div>
          )}
          {shown('workspace-missions') && (
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
          )}
          {shown('workspace-research') && (
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
          )}
          {shown('workspace-meetings') && (
            <div
              id="workspace-meetings"
              tabIndex={-1}
              className="workspace-panel ux-panel"
              hidden={view !== 'workspace-meetings'}
            >
              <ControlledAccess
                key={`access-${tenant}`}
                tenant={tenant}
                revision={missionRevision}
              />
              <a className="text-link" href="#workspace-navigation">
                Back to workspace sections
              </a>
            </div>
          )}
          {shown('workspace-commercial') && (
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
          )}
          {shown('workspace-delivery') && (
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
          )}
          {shown('workspace-operations') && ['owner', 'admin', 'operator'].includes(data.role) && (
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
              {shown('workspace-ai') && (
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
              )}
              {shown('workspace-network') && (
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
              )}
            </>
          )}
          {shown('workspace-sources') && (
            <SourcesPanel
              data={data}
              view={view}
              busy={busy}
              source={source}
              claim={claim}
              tenant={tenant}
              act={act}
              request={request}
              more={loadMore}
            />
          )}
          {shown('workspace-evidence') && (
            <EvidencePanel
              data={data}
              view={view}
              busy={busy}
              tenant={tenant}
              flags={flags}
              act={act}
              request={request}
              more={loadMore}
            />
          )}
          {shown('workspace-authenticator') && (
            <section
              id="workspace-authenticator"
              tabIndex={-1}
              className="operator-section workspace-panel ux-panel"
              hidden={view !== 'workspace-authenticator'}
            >
              <AuthenticatorCheck
                busy={busy}
                act={act}
                returnTo={authenticatorReturnTarget(sectionOfFragment(nav.previous), currentRole)}
                tenant={tenant}
              />
            </section>
          )}
          {shown('workspace-settings') && ['owner', 'admin'].includes(data.role) && (
            <div className="ux-panel" hidden={view !== 'workspace-settings'}>
              <ReviewSettings key={`settings-${tenant}`} tenant={tenant} role={data.role} />
              <ErasureQueue
                key={`erasure-${tenant}`}
                tenant={tenant}
                role={data.role}
                problemReports={problemReports}
              />
              {problemReports ? (
                <ProblemReportQueue
                  key={`problem-reports-${tenant}`}
                  tenant={tenant}
                  role={data.role}
                />
              ) : null}
              {programmeApplications ? (
                <ProgrammeApplicationQueue
                  key={`programme-applications-${tenant}`}
                  tenant={tenant}
                  role={data.role}
                />
              ) : null}
            </div>
          )}
          {shown('workspace-audit') && ['owner', 'admin'].includes(data.role) && (
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
          {shown('workspace-controls') && data.role === 'owner' && (
            <section
              id="workspace-controls"
              tabIndex={-1}
              className="operator-section workspace-panel ux-panel"
              hidden={view !== 'workspace-controls'}
            >
              <WorkspaceControls
                tenant={tenant}
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
                onUpdateMember={(value) => {
                  // A retry of the same change after an answer that never arrived reuses its command id, so it is
                  // answered once; a different change, or one made after the list moved on, gets a new one.
                  const key = JSON.stringify(value);
                  if (memberCommand.current?.key !== key)
                    memberCommand.current = { key, id: crypto.randomUUID() };
                  const commandId = memberCommand.current.id;
                  void act(async () => {
                    try {
                      await request('member', { commandId, ...value });
                    } catch (error) {
                      // The list the person saw is out of date: show the current one before they decide again.
                      if (error instanceof Error && /reload and try again/i.test(error.message)) {
                        setMembers(await request('members'));
                        memberCommand.current = null;
                      }
                      throw error;
                    }
                    memberCommand.current = null;
                    setMembers(await request('members'));
                    setMembersLoaded(true);
                  });
                }}
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
