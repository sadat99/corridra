'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { StageBar } from '../../../../components/mr/stage-bar';
import { mrLabels } from '../../../../components/mr/labels';
import { statusToRoadStep } from '../../../../components/mr/road-status';
import { Dialog } from '../../../../components/ux/dialog';
import { StatusChip } from '../../../../components/ux/status-chip';
import { formatDate, formatDateTime } from '../../../../lib/ux/format';
import { formatMoney } from '../../../../lib/ux/money';
import { CommercialMission } from '../../commercial-mission';
import { DeliveryExperience } from '../../delivery-experience';
import { ShowMore } from '../../show-more';
import { MissionMoves } from '../../mission-moves';
import { WithdrawalNote } from '../../mission-withdrawal-note';
import {
  MissionActionForm,
  MissionFacts,
  MissionHistory,
  MissionStepForm,
  ReplyForm,
  canManage,
  missionCommandBody,
  missionRequest,
  ownerName,
  type Queue,
} from '../../missions';
import {
  actionTitle,
  canPause,
  isOverdue,
  nextStep,
  plainCode,
  restingLine,
  stageChip,
  type CustomerView,
} from './mission-labels';
import { bodyNotAvailable } from '../../../../lib/body-access';

// D15: one mission, seven tabs plus replies (CQ-40), and one side panel where actions open one at a time.
// Every action here posts to the same reviewed workspace endpoints as the queue cards, so nothing gains
// authority by moving. The full sections stay reachable from each tab.
const tabs = [
  ['overview', 'Overview'],
  ['requirements', 'Requirements'],
  ['companies', 'Companies'],
  ['quotes', 'Quotes'],
  ['meetings', 'Meetings'],
  ['delivery', 'Delivery'],
  ['replies', 'Replies'],
  ['history', 'History'],
] as const;
type Tab = (typeof tabs)[number][0];
type Panel = 'action' | 'route' | 'reply' | 'move' | null;
type Row = Record<string, unknown> & { id: string };

/** What a customer reads for a stage: the Road step and its line, in the words their own page uses. */
function customerView(stage: string): CustomerView {
  const road = mrLabels.road;
  const marker = statusToRoadStep(stage);
  if (marker.kind === 'aside')
    return {
      step: null,
      words:
        marker.reason === 'unknown'
          ? `${road.asides.unknown} ${plainCode(stage).toLowerCase()}`
          : road.asides[marker.reason],
    };
  return {
    step: road.steps[marker.step],
    words: (road.sublines as Record<string, string>)[marker.status] ?? '',
  };
}

async function read<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? 'Could not load this part.');
  return body as T;
}

export function MissionPage({
  tenant,
  workspaceName,
  missionId,
  replyId,
  moveRecords,
  desk = false,
}: {
  tenant: string;
  workspaceName: string;
  missionId: string;
  /** A reviewed supplier reply to prepare an offer from (ADR-081), from the link the reply card gives. */
  replyId?: string;
  moveRecords: boolean;
  /**
   * Team desk v4.1, units D6 and D7 (`CORRIDRA_UX_TEAM_DESK_V41`, read on the server): the stage bar, the Next
   * step card, the customer panel and actions in the centred dialog. Off, the page is exactly what it was.
   */
  desk?: boolean;
}) {
  const [data, setData] = useState<Queue | null>(null),
    [failure, setFailure] = useState(''),
    [message, setMessage] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<Tab>(replyId ? 'requirements' : 'overview'),
    [panel, setPanel] = useState<Panel>(null),
    // The mission command the dialog is open on (desk only): the stage's next step, or assign, pause, cancel.
    [stepAction, setStepAction] = useState('assign'),
    [revision, setRevision] = useState(0);
  const panelHeading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null),
    sending = useRef(false);
  const q = `tenant=${encodeURIComponent(tenant)}`;
  const load = useCallback(
    () => read<Queue>(`/api/team-work/mission?${q}&id=${missionId}`),
    [q, missionId],
  );
  useEffect(() => {
    let active = true;
    load()
      .then((v) => active && setData(v))
      .catch((e) => active && setFailure(e.message));
    return () => {
      active = false;
    };
  }, [load, revision]);
  useEffect(() => {
    // A link to #quotes (or any tab) opens that tab.
    const fromHash = () => {
      const wanted = window.location.hash.slice(1);
      if (tabs.some(([key]) => key === wanted)) setTab(wanted as Tab);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  useEffect(() => {
    if (panel && !desk) panelHeading.current?.focus();
  }, [panel, desk]);
  function choose(next: Tab) {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  }
  function openPanel(next: Panel, from: HTMLButtonElement) {
    trigger.current = from;
    setMessage(null);
    setPanel(next);
  }
  function closePanel() {
    setPanel(null);
    trigger.current?.focus();
  }
  async function act(action: string, body: unknown, done: string) {
    // One change at a time (unit D2): a second submit while the first is still out, or while the
    // authenticator check is open, is ignored. missionRequest asks for the code in place and retries once.
    if (sending.current) return false;
    sending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await missionRequest(tenant, action, body);
      setData(await load());
      setMessage({ kind: 'status', text: done });
      // Desk: a saved action closes its dialog, and the page says what was saved.
      if (desk) setPanel(null);
      return true;
    } catch (e) {
      setMessage({ kind: 'alert', text: e instanceof Error ? e.message : 'Unable to save' });
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="mission-page">
        <p role={failure ? 'alert' : 'status'}>{failure || 'Loading the mission…'}</p>
        <a className="text-link" href={sectionHref(tenant, 'missions')}>
          Back to all missions
        </a>
      </div>
    );
  const m = data.missions[0]!;
  const manage = canManage(data.role);
  const open = !['CANCELLED', 'CLOSED'].includes(m.status);
  const overdue = isOverdue(m.due_at, m.status);
  const step = nextStep(m.status);
  const feedback = message && (
    <p role={message.kind} className={message.kind === 'alert' ? 'ux-error-summary' : undefined}>
      {message.text}
    </p>
  );
  return (
    <div className="mission-page">
      <nav aria-label="Breadcrumb">
        <a className="text-link" href={sectionHref(tenant, 'missions')}>
          All missions
        </a>{' '}
        · {workspaceName}
      </nav>
      <header className="mission-page-summary">
        <h2>{m.brief.company}</h2>
        <p>
          {m.brief.objective} · {m.brief.market}
        </p>
        <p>
          <StatusChip status={stageChip(m.status, overdue)} /> · Owner{' '}
          {ownerName(data.owners, m.owner_id)} · Due {formatDate(m.due_at)} · Route{' '}
          {m.route_label ?? 'not assigned yet'}
        </p>
        <p>Next action: {m.next_action || 'Not recorded'}</p>
        <WithdrawalNote tenant={tenant} missionId={m.id} />
      </header>
      {desk && (
        <div className="mission-desk">
          <StageBar status={m.status} name={`Stage of ${m.brief.company}`} named />
          <section className="mission-next" aria-labelledby="mission-next-heading">
            <h3 id="mission-next-heading" tabIndex={-1}>
              Next step
            </h3>
            <p>{step && open ? step.lead : restingLine(m.status)}</p>
            {!panel && feedback}
            {manage ? (
              <>
                {step && open && (
                  <button
                    type="button"
                    className="primary-link"
                    onClick={(e) => {
                      setStepAction(step.action);
                      openPanel('action', e.currentTarget);
                    }}
                  >
                    {step.label}
                  </button>
                )}
                <details className="mission-more">
                  <summary>Other Actions</summary>
                  <div className="mission-actions" aria-label="Other mission actions">
                    {open &&
                      ['assign', ...(canPause(m.status) ? ['pause'] : []), 'cancel'].map(
                        (action) => (
                          <button
                            key={action}
                            type="button"
                            className="secondary-link"
                            onClick={(e) => {
                              setStepAction(action);
                              openPanel('action', e.currentTarget);
                            }}
                          >
                            {actionTitle(action)}
                          </button>
                        ),
                      )}
                    {data.role === 'owner' && (
                      <button
                        type="button"
                        className="secondary-link"
                        onClick={(e) => openPanel('route', e.currentTarget)}
                      >
                        Assign Route
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-link"
                      onClick={(e) => openPanel('reply', e.currentTarget)}
                    >
                      Reply on the Receipt
                    </button>
                    {moveRecords && (
                      <button
                        type="button"
                        className="secondary-link"
                        onClick={(e) => openPanel('move', e.currentTarget)}
                      >
                        Set the Customer&apos;s Next Move
                      </button>
                    )}
                  </div>
                </details>
              </>
            ) : (
              <p className="guide-hint">
                Your role can read this mission. An owner, admin or operator makes changes.
              </p>
            )}
          </section>
          <CustomerSees
            tenant={tenant}
            missionId={m.id}
            status={m.status}
            replies={data.replies}
            moveRecords={moveRecords}
            revision={revision}
          />
          <Dialog
            open={panel !== null}
            onClose={() => {
              setPanel(null);
              // A Move set in the dialog is read again by the customer panel.
              if (panel === 'move') setRevision((v) => v + 1);
            }}
            title={
              panel === 'action'
                ? actionTitle(stepAction)
                : panel === 'route'
                  ? 'Assign Route'
                  : panel === 'reply'
                    ? 'Reply on the Receipt'
                    : "Set the Customer's Next Move"
            }
            locked={busy}
            returnFocusTo={() => document.getElementById('mission-next-heading')}
          >
            {panel === 'action' && (
              <MissionStepForm
                m={m}
                owners={data.owners}
                action={stepAction}
                submitLabel={actionTitle(stepAction)}
                customer={customerView}
                busy={busy}
                feedback={feedback}
                onSubmit={(e) => {
                  const body = missionCommandBody(e, m, (text) =>
                    setMessage({ kind: 'alert', text }),
                  );
                  if (body) void act('mission', body, 'Mission saved.');
                }}
              />
            )}
            {panel === 'route' && (
              <>
                <p>
                  This records the reviewed route and mission job for this mission. The stage the
                  customer sees stays the same.
                </p>
                <p data-step-route>
                  {m.route_label ? `Route: ${m.route_label}.` : 'Route: not assigned yet.'}
                </p>
                {feedback}
                <AssignRoute
                  tenant={tenant}
                  missionId={m.id}
                  busy={busy}
                  onAssign={(body) => act('mission-route', body, 'Route assigned.')}
                />
              </>
            )}
            {panel === 'reply' && (
              <>
                <p>
                  This posts one reply. The customer will read it on their private receipt, exactly
                  as written.
                </p>
                {feedback}
                <ReplyForm
                  busy={busy}
                  onSend={(body, replyId) =>
                    act('mission-reply', { id: m.id, body, replyId }, 'Reply posted.')
                  }
                />
              </>
            )}
            {panel === 'move' && <MissionMoves tenant={tenant} missionId={m.id} />}
          </Dialog>
        </div>
      )}
      <div className="mission-tabs" role="tablist" aria-label="Mission sections">
        {tabs.map(([key, label], index) => (
          <button
            key={key}
            role="tab"
            id={`mission-tab-${key}`}
            aria-controls={tab === key ? `mission-tabpanel-${key}` : undefined}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            type="button"
            onClick={() => choose(key)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!step && e.key !== 'Home' && e.key !== 'End') return;
              e.preventDefault();
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? tabs.length - 1
                    : (index + step + tabs.length) % tabs.length;
              choose(tabs[next]![0]);
              document.getElementById(`mission-tab-${tabs[next]![0]}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mission-layout" data-panel={panel ? 'open' : 'closed'}>
        <section
          role="tabpanel"
          id={`mission-tabpanel-${tab}`}
          aria-labelledby={`mission-tab-${tab}`}
          tabIndex={0}
        >
          {!panel && !desk && feedback}
          {tab === 'overview' && (
            <>
              <h3>Overview</h3>
              {manage && !desk && (
                <div className="mission-actions" aria-label="Mission actions">
                  {open && (
                    <button
                      type="button"
                      className="secondary-link"
                      aria-expanded={panel === 'action'}
                      onClick={(e) => openPanel('action', e.currentTarget)}
                    >
                      Change Stage, Owner or Next Action
                    </button>
                  )}
                  {data.role === 'owner' && (
                    <button
                      type="button"
                      className="secondary-link"
                      aria-expanded={panel === 'route'}
                      onClick={(e) => openPanel('route', e.currentTarget)}
                    >
                      Assign Route
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-link"
                    aria-expanded={panel === 'reply'}
                    onClick={(e) => openPanel('reply', e.currentTarget)}
                  >
                    Reply on the Receipt
                  </button>
                  {moveRecords && (
                    <button
                      type="button"
                      className="secondary-link"
                      aria-expanded={panel === 'move'}
                      onClick={(e) => openPanel('move', e.currentTarget)}
                    >
                      Set the Customer&apos;s Next Move
                    </button>
                  )}
                </div>
              )}
              <MissionFacts
                m={m}
                owners={data.owners}
                history={data.history.filter((h) => h.mission_id === m.id)}
              />
            </>
          )}
          {tab === 'requirements' && (
            <>
              <h3>Requirements</h3>
              <p>
                Requirements, supplier offers, comparison and visits. Choose one task at a time
                under Next task.
              </p>
              <CommercialMission
                tenant={tenant}
                missionId={m.id}
                replyId={replyId}
                onChanged={() => setRevision((v) => v + 1)}
              />
            </>
          )}
          {tab === 'companies' && <Companies tenant={tenant} missionId={m.id} />}
          {tab === 'quotes' && (
            <Quotes
              tenant={tenant}
              missionId={m.id}
              revision={revision}
              onRecord={() => choose('requirements')}
            />
          )}
          {tab === 'meetings' && <Meetings tenant={tenant} missionId={m.id} />}
          {tab === 'delivery' && <Delivery tenant={tenant} missionId={m.id} />}
          {tab === 'replies' && (
            <>
              <h3>Replies</h3>
              <h4>Receipt replies to the customer</h4>
              {data.replies.length ? (
                <ul>
                  {data.replies.map((r) => (
                    <li key={r.id}>
                      {r.body}
                      {r.created_at ? ` · ${formatDateTime(r.created_at)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No receipt replies yet.</p>
              )}
              <SupplierReplies tenant={tenant} missionId={m.id} />
            </>
          )}
          {tab === 'history' && (
            <>
              <h3>History</h3>
              <MissionHistory history={data.history} owners={data.owners} />
            </>
          )}
        </section>
        {panel && !desk && (
          <aside className="mission-panel" aria-labelledby="mission-panel-heading">
            <div className="mission-panel-head">
              <h3 id="mission-panel-heading" ref={panelHeading} tabIndex={-1}>
                {panel === 'action'
                  ? 'Change stage, owner or next action'
                  : panel === 'route'
                    ? 'Assign route'
                    : panel === 'reply'
                      ? 'Reply on the receipt'
                      : "Customer's next move"}
              </h3>
              <button type="button" className="text-link" onClick={closePanel}>
                Close Panel
              </button>
            </div>
            {feedback}
            {panel === 'action' && (
              <MissionActionForm
                m={m}
                owners={data.owners}
                busy={busy}
                onSubmit={(e) => {
                  const body = missionCommandBody(e, m, (text) =>
                    setMessage({ kind: 'alert', text }),
                  );
                  if (body) void act('mission', body, 'Mission saved.');
                }}
              />
            )}
            {panel === 'route' && (
              <AssignRoute
                tenant={tenant}
                missionId={m.id}
                busy={busy}
                onAssign={(body) => act('mission-route', body, 'Route assigned.')}
              />
            )}
            {panel === 'reply' && (
              <ReplyForm
                busy={busy}
                onSend={(body, replyId) =>
                  act('mission-reply', { id: m.id, body, replyId }, 'Reply posted.')
                }
              />
            )}
            {panel === 'move' && <MissionMoves tenant={tenant} missionId={m.id} />}
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Team desk v4.1, unit D6: what the customer can read about this mission today, built only from reads this
 * page already makes (the stage, the receipt replies, the approved reports and, where Move records are on, the
 * open Moves). Read-only: it holds no control and sends nothing.
 */
function CustomerSees({
  tenant,
  missionId,
  status,
  replies,
  moveRecords,
  revision,
}: {
  tenant: string;
  missionId: string;
  status: string;
  replies: Queue['replies'];
  moveRecords: boolean;
  revision: number;
}) {
  const view = customerView(status);
  const delivery = useDelivery(tenant);
  const reports = (delivery.value?.publications ?? []).filter(
    (p) => p.mission_id === missionId && !p.revoked,
  );
  const latest = replies[0];
  return (
    <aside className="mission-customer" aria-labelledby="mission-customer-heading">
      <h3 id="mission-customer-heading">What the customer sees</h3>
      <dl>
        <dt>Stage</dt>
        <dd data-customer-stage>
          {view.step ? <b>{view.step}. </b> : null}
          {view.words}
        </dd>
        <dt>Receipt replies</dt>
        <dd data-customer-replies>
          {latest
            ? `${replies.length} posted. Latest${latest.created_at ? `, ${formatDateTime(latest.created_at)}` : ''}: ${latest.body}`
            : 'None posted yet.'}
        </dd>
        <dt>Reports</dt>
        <dd data-customer-reports>
          {!delivery.value
            ? delivery.error
              ? 'Reports could not be read.'
              : 'Reading reports…'
            : reports.length
              ? `${reports.length} approved for the customer.`
              : 'None approved yet.'}
        </dd>
        {moveRecords && (
          <>
            <dt>Open Moves</dt>
            <dd data-customer-moves>
              <CustomerMoves tenant={tenant} missionId={missionId} revision={revision} />
            </dd>
          </>
        )}
      </dl>
      <p className="guide-hint">Read from this mission&apos;s records. Nothing here is sent.</p>
    </aside>
  );
}

function CustomerMoves({
  tenant,
  missionId,
  revision,
}: {
  tenant: string;
  missionId: string;
  revision: number;
}) {
  const { value, error } = useRead<{ moves?: Row[] }>(
    `/api/move/staff?tenant=${encodeURIComponent(tenant)}&mission=${encodeURIComponent(missionId)}`,
    revision,
  );
  if (!value) return <>{error ? 'Moves could not be read.' : 'Reading Moves…'}</>;
  const open = (value.moves ?? []).filter((move) => !move.closed);
  if (!open.length) return <>No open Moves.</>;
  return (
    <>
      {open
        .map(
          (move) =>
            `${String(move.verb)} ${String(move.object)}${move.dueOn ? `, due ${String(move.dueOn)}` : ''}`,
        )
        .join(' · ')}
    </>
  );
}

function useRead<T>(url: string, revision = 0) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    read<T>(url)
      .then((v) => active && setValue(v))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [url, revision]);
  return { value, error };
}

function Loading({ error, children }: { error: string; children?: ReactNode }) {
  return <p role={error ? 'alert' : 'status'}>{error || children || 'Loading…'}</p>;
}

/** The full workspace section, which works whether or not section addresses are switched on. */
function sectionHref(tenant: string, slug: string, missionId?: string) {
  // W5: the research and commercial sections open on this mission. The mission is only a hint to pick
  // from what the section already lists; the section still ignores it when it is not in that list.
  const mission = missionId ? `&mission=${encodeURIComponent(missionId)}` : '';
  return `/operator?workspace=${encodeURIComponent(tenant)}${mission}#workspace-${slug}`;
}

function SectionLink({
  tenant,
  slug,
  label,
  missionId,
}: {
  tenant: string;
  slug: string;
  label: string;
  missionId?: string;
}) {
  return (
    <a className="text-link" href={sectionHref(tenant, slug, missionId)}>
      {label}
    </a>
  );
}

/** CQ-09: lists the reviewed route packs; the workspace API repeats the owner and version checks. */
function AssignRoute({
  tenant,
  missionId,
  busy,
  onAssign,
}: {
  tenant: string;
  missionId: string;
  busy: boolean;
  onAssign: (body: unknown) => Promise<boolean>;
}) {
  const q = `tenant=${encodeURIComponent(tenant)}&mission=${missionId}`;
  const catalogue = useRead<{ packs: Row[]; types: Row[] }>(
    `/api/workspace/mission-catalogue?${q}`,
  );
  const current = useRead<{ assignments: Row[] }>(`/api/workspace/commercial-mission?${q}`);
  const [pack, setPack] = useState('');
  if (!catalogue.value || !current.value)
    return <Loading error={catalogue.error || current.error} />;
  const packs = catalogue.value.packs.filter((p) =>
    ['TESTING', 'LIMITED', 'ACTIVE'].includes(String(p.status)),
  );
  const chosen = packs.find((p) => p.id === pack);
  const types = catalogue.value.types.filter((t) =>
    (chosen?.configuration as { missionTypes?: string[] } | undefined)?.missionTypes?.includes(
      String(t.key),
    ),
  );
  if (!packs.length)
    return (
      <p>
        No reviewed route packs yet. An owner adds one under Routes and settings, then it shows
        here.
      </p>
    );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      id = form.dataset.commandId ?? (form.dataset.commandId = crypto.randomUUID());
    void onAssign({
      id,
      missionId,
      packId: pack,
      missionTypeId: String(f.get('missionTypeId') ?? ''),
      version: (Number(current.value?.assignments[0]?.version) || 0) + 1,
      reason: String(f.get('reason') ?? ''),
    }).then((saved) => {
      if (saved) delete form.dataset.commandId;
    });
  }
  return (
    <form className="operator-form" onSubmit={submit}>
      <label className="field">
        Reviewed route
        <select value={pack} onChange={(e) => setPack(e.target.value)} required>
          <option value="">Choose a route</option>
          {packs.map((p) => (
            <option value={p.id} key={p.id}>
              {String(p.origin_market)} to {String(p.destination_market)}, version{' '}
              {String(p.version)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Mission job
        <select name="missionTypeId" required disabled={!pack}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {String(t.description)}, version {String(t.version)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Reason
        <textarea name="reason" required minLength={3} maxLength={500} />
      </label>
      <button className="primary-link" disabled={busy || !pack || !types.length}>
        Assign Route
      </button>
    </form>
  );
}

function Companies({ tenant, missionId }: { tenant: string; missionId: string }) {
  const { value, error } = useRead<{ targets: Row[]; total: number }>(
    `/api/workspace/shortlist?tenant=${encodeURIComponent(tenant)}&mission=${missionId}`,
  );
  const rows = value?.targets ?? [];
  return (
    <>
      <h3>Companies</h3>
      {!value ? (
        <Loading error={error} />
      ) : rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              {String(r.organisation_name ?? 'Company')}
              {r.fit ? ` · fit: ${plainCode(String(r.fit))}` : ' · not yet assessed'}
            </li>
          ))}
        </ul>
      ) : (
        <p>No companies on this mission&apos;s shortlist yet.</p>
      )}
      <SectionLink
        tenant={tenant}
        slug="research"
        label="Find and add companies"
        missionId={missionId}
      />
    </>
  );
}

function Quotes({
  tenant,
  missionId,
  revision,
  onRecord,
}: {
  tenant: string;
  missionId: string;
  revision: number;
  onRecord: () => void;
}) {
  const { value, error } = useRead<{ quotations: Row[]; targets: { id: string; name: string }[] }>(
    `/api/workspace/commercial-mission?tenant=${encodeURIComponent(tenant)}&mission=${missionId}`,
    revision,
  );
  return (
    <>
      <h3>Quotes</h3>
      <p>
        Original supplier offers in their own currency, every revision kept. A quote is not an
        order, a contract or a payment.
      </p>
      {!value ? (
        <Loading error={error} />
      ) : value.quotations.length ? (
        <ul>
          {value.quotations.map((quote) => {
            const terms = (quote.terms ?? {}) as Record<string, string>;
            const total = terms.totalPriceMinor ?? terms.unitPriceMinor;
            return (
              <li key={quote.id}>
                {value.targets.find((t) => t.id === quote.target_id)?.name ?? 'Supplier'} · revision{' '}
                {String(quote.revision)}
                {/* ADR-087 U1q: a staff viewer receives the quotation with its terms null. */}
                {quote.terms === null ? ` · ${String(quote.currency)} · ${bodyNotAvailable}` : ''}
                {total ? ` · ${safeMoney(total, String(quote.currency))}` : ''}
                {terms.totalPriceMinor ? ' total' : total ? ' per unit' : ''}
                {quote.created_at ? ` · recorded ${formatDateTime(String(quote.created_at))}` : ''}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No supplier offers recorded yet.</p>
      )}
      <button type="button" className="text-link" onClick={onRecord}>
        Record or Revise a Supplier Offer
      </button>{' '}
      <SectionLink tenant={tenant} slug="commercial" label="Money" missionId={missionId} />
    </>
  );
}

function safeMoney(minor: string, currency: string) {
  try {
    return formatMoney(minor, currency);
  } catch {
    return `${currency} (amount kept as recorded)`;
  }
}

function Meetings({ tenant, missionId }: { tenant: string; missionId: string }) {
  const base = `/api/workspace/meetings?tenant=${encodeURIComponent(tenant)}&missionId=${encodeURIComponent(missionId)}`;
  const first = useRead<{ meetings: Row[]; meetingsTotal: number | null; next: string | null }>(
    base,
  );
  // Extra pages belong to the first read they continue: when that read changes (another mission, or a
  // fresh read), they are dropped instead of being shown under the wrong list (G12 follow-up).
  const [more, setMore] = useState<{ of: unknown; rows: Row[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const { value, error } = first;
  const extra = more && more.of === value ? more : null;
  const rows = [...(value?.meetings ?? []), ...(extra?.rows ?? [])];
  const next = extra ? extra.next : (value?.next ?? null);
  // A continuation carries no total; the first page's stands.
  const total = value?.meetingsTotal ?? null;
  async function showMore() {
    if (!next || busy) return;
    const of = value;
    setBusy(true);
    setFailure('');
    try {
      const page = await read<{ meetings: Row[]; next: string | null }>(
        `${base}&after=${encodeURIComponent(next)}`,
      );
      setMore((old) => ({
        of,
        rows: [
          ...(old && old.of === of ? old.rows : []),
          ...page.meetings.filter((m) => !rows.some((r) => r.id === m.id)),
        ],
        next: page.next,
      }));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The next page could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>Meetings</h3>
      <p>A held meeting is a meeting, not a sale.</p>
      {!value ? (
        <Loading error={error} />
      ) : rows.length ? (
        <>
          <ul>
            {rows.map((m) => (
              <li key={m.id}>
                {String(m.title)} · {plainCode(String(m.status))}
                {m.starts_at ? ` · ${formatDateTime(String(m.starts_at))}` : ' · not scheduled'}
              </li>
            ))}
          </ul>
          <ShowMore
            shown={rows.length}
            total={total}
            next={next}
            busy={busy}
            label="Meetings"
            onMore={() => void showMore()}
          />
          {failure && <p role="alert">{failure}</p>}
        </>
      ) : (
        <p>No meetings for this mission yet.</p>
      )}
      <SectionLink tenant={tenant} slug="meetings" label="Introductions and meetings" />
    </>
  );
}

type DeliverySnapshot = {
  role: string;
  participants: { id: string; mission_id: string; company: string }[];
  publications: {
    id: string;
    mission_id: string;
    copy: { title: string; company: string };
    revoked: boolean;
    created_at?: string;
  }[];
  owners: { user_id: string; name: string }[];
};

function useDelivery(tenant: string) {
  return useRead<DeliverySnapshot>(`/api/workspace/delivery?tenant=${encodeURIComponent(tenant)}`);
}

function Delivery({ tenant, missionId }: { tenant: string; missionId: string }) {
  const { value, error } = useDelivery(tenant);
  const rows = value?.publications.filter((p) => p.mission_id === missionId) ?? [];
  return (
    <>
      <h3>Delivery</h3>
      {!value ? (
        <Loading error={error} />
      ) : rows.length ? (
        <ul>
          {rows.map((p) => (
            <li key={p.id}>
              {p.copy.title} · {p.revoked ? 'withdrawn' : 'approved for the customer'}
              {p.created_at ? ` · ${formatDateTime(p.created_at)}` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p>No reports approved for this mission yet.</p>
      )}
      <SectionLink tenant={tenant} slug="delivery" label="Write, approve and share a report" />
    </>
  );
}

/** CQ-40: supplier replies for this mission, with the review controls where reply review is switched on. */
function SupplierReplies({ tenant, missionId }: { tenant: string; missionId: string }) {
  const { value, error } = useDelivery(tenant);
  if (!value) return <Loading error={error} />;
  return (
    <DeliveryExperience
      role={value.role}
      tenant={tenant}
      programme=""
      mission={missionId}
      participants={value.participants}
      publications={value.publications}
      owners={value.owners}
    />
  );
}
