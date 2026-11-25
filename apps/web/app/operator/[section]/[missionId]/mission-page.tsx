'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { StageBar } from '../../../../components/mr/stage-bar';
import { mrLabels } from '../../../../components/mr/labels';
import { statusToRoadStep } from '../../../../components/mr/road-status';
import { CorridraIcon } from '../../../../components/corridra-icon';
import { Dialog } from '../../../../components/ux/dialog';
import { Flagged, placeMark } from '../../../../components/ux/flag';
import { StatusChip } from '../../../../components/ux/status-chip';
import { formatDate, formatDateTime } from '../../../../lib/ux/format';
import { formatMoney } from '../../../../lib/ux/money';
import { operatorSectionPath } from '../../../../lib/operator-urls';
import { CommercialMission } from '../../commercial-mission';
import { DeliveryExperience } from '../../delivery-experience';
import { ShowMore } from '../../show-more';
import { MissionMoves } from '../../mission-moves';
import { MissionQuotes } from '../../mission-quotes';
import { MissionReplies } from '../../mission-replies';
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
  stepStatement,
  type CustomerView,
} from './mission-labels';
import { bodyNotAvailable } from '../../../../lib/body-access';
import { useOperatorFlags } from '../../operator-flags';
import { useMissionTitle } from './mission-title';
import { RouteState, RouteWords } from './route-words';

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
type Panel = 'action' | 'route' | 'reply' | 'move' | 'offer' | null;
const panelTitles: Record<Exclude<Panel, 'action' | null>, string> = {
  route: 'Assign Route',
  reply: 'Reply to the Customer',
  move: "Set the Customer's Next Move",
  offer: 'Record or Revise a Supplier Offer',
};

/**
 * Team desk v4.1: with section addresses on, a link from the mission page opens the section at its own address
 * (`/operator/research?...`), so the section opens as a page and nothing takes focus on load. Otherwise the link
 * is the `#workspace-...` address it always was.
 */
const SectionAddresses = createContext(false);
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
  sectionAddresses = false,
}: {
  tenant: string;
  workspaceName: string;
  missionId: string;
  /** A reviewed supplier reply to prepare an offer from (ADR-081), from the link the reply card gives. */
  replyId?: string;
  moveRecords: boolean;
  /** CORRIDRA_UX_OPERATOR_URLS, read on the server: each section has its own address. */
  sectionAddresses?: boolean;
}) {
  // Team desk v4.1, units D6 and D7 (`CORRIDRA_UX_TEAM_DESK_V41`, read on the server and handed down by
  // OperatorFlags): the stage bar, the Next step card, the customer panel and actions in the centred dialog.
  // Off, the page is exactly what it was.
  const { teamDeskV41: desk } = useOperatorFlags();
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
    tabRow = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null),
    sending = useRef(false);
  const real = desk && sectionAddresses;
  const wide = useWide(root, data !== null);
  useMissionTitle(desk ? (data?.missions[0]?.brief.company ?? null) : null);
  useScrollCue(tabRow, desk && data !== null, tab);
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
      <div className="mission-page" ref={root}>
        {desk && <MissionCrumb tenant={tenant} workspaceName={workspaceName} real={real} />}
        <p role={failure ? 'alert' : 'status'}>{failure || 'Loading the mission…'}</p>
        {!desk && (
          <a className="text-link" href={sectionHref(tenant, 'missions')}>
            Back to all missions
          </a>
        )}
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
  const market = <Flagged code={placeMark(m.brief.market)}>{m.brief.market}</Flagged>;
  return (
    <SectionAddresses.Provider value={real}>
      <div className="mission-page" ref={root} data-tab={tab} data-wide={wide ? 'yes' : 'no'}>
        {desk ? (
          <MissionCrumb tenant={tenant} workspaceName={workspaceName} real={real} />
        ) : (
          <nav aria-label="Breadcrumb">
            <a className="text-link" href={sectionHref(tenant, 'missions')}>
              All missions
            </a>{' '}
            · {workspaceName}
          </nav>
        )}
        <header className="mission-page-summary">
          {/* Desk: the customer's name is the page title (the shell's h1), so it is not repeated here. */}
          {!desk && <h2>{m.brief.company}</h2>}
          <p>
            {m.brief.objective} · {desk ? market : m.brief.market}
          </p>
          <p>
            <StatusChip status={stageChip(m.status, overdue)} /> · Owner{' '}
            {ownerName(data.owners, m.owner_id)} · Due {formatDate(m.due_at)} · Route{' '}
            {desk ? (
              <RouteWords label={m.route_label} none="not assigned yet" />
            ) : (
              (m.route_label ?? 'not assigned yet')
            )}
          </p>
          {!desk && <p>Next action: {m.next_action || 'Not recorded'}</p>}
          <WithdrawalNote tenant={tenant} missionId={m.id} role={data.role} />
        </header>
        {desk && (
          <div className="mission-desk">
            <StageBar status={m.status} name={`Stage of ${m.brief.company}`} variant="room" />
            <section className="mission-next" aria-labelledby="mission-next-heading">
              <h3 id="mission-next-heading" tabIndex={-1}>
                Next step
              </h3>
              <p>{step && open ? step.lead : restingLine(m.status)}</p>
              {!panel && tab === 'overview' && feedback}
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
                    <summary aria-label={`More actions for ${m.brief.company}`}>
                      More Actions
                      <CorridraIcon name="chevron" size={16} className="mission-more-chevron" />
                    </summary>
                    <div className="mission-actions" aria-label="More mission actions">
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
                        Reply to the Customer
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
              wide={wide}
            />
          </div>
        )}
        {desk && (
          <Dialog
            open={panel !== null}
            onClose={() => {
              setPanel(null);
              // A Move set in the dialog is read again by the customer panel.
              if (panel === 'move') setRevision((v) => v + 1);
            }}
            title={panel === 'action' ? actionTitle(stepAction) : panelTitles[panel ?? 'route']}
            locked={busy}
            returnFocusTo={() =>
              document.getElementById('mission-next-heading') ??
              document.getElementById(`mission-tab-${tab}`)
            }
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
                  if (body)
                    void act(
                      'mission',
                      body,
                      `${actionTitle(stepAction)} saved. ${stepStatement(stepAction, m.status, customerView).customer}`,
                    );
                }}
              />
            )}
            {panel === 'route' && (
              <>
                <p>
                  This records the reviewed route and mission job for this mission. The stage the
                  customer sees stays the same.
                </p>
                <RouteState label={m.route_label} />
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
                <RouteState label={m.route_label} />
                <p>
                  This sends one reply. The customer reads it on their own request page, exactly as
                  written.
                </p>
                {feedback}
                <ReplyForm
                  desk
                  busy={busy}
                  onSend={(body, replyId) =>
                    act('mission-reply', { id: m.id, body, replyId }, 'Reply posted.')
                  }
                />
              </>
            )}
            {panel === 'move' && (
              <>
                <RouteState label={m.route_label} />
                <MissionMoves tenant={tenant} missionId={m.id} />
              </>
            )}
            {panel === 'offer' && (
              <CommercialMission
                offerOnly
                tenant={tenant}
                missionId={m.id}
                onChanged={() => {
                  // A recorded offer closes its dialog; the Quotes tab reads the list again and says so.
                  setRevision((v) => v + 1);
                  setPanel(null);
                  setMessage({
                    kind: 'status',
                    text: 'Offer recorded. The customer is not shown it.',
                  });
                }}
              />
            )}
          </Dialog>
        )}
        {(() => {
          const row = (
            <div
              className={desk ? 'mission-tabs mission-tabs-row' : 'mission-tabs'}
              role="tablist"
              aria-label="Mission sections"
              ref={tabRow}
            >
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
          );
          // Desk: the row sits in a frame that carries the scroll cue at either edge. Off, the row is as it was.
          return desk ? (
            <div className="mission-tabs-wrap">
              {row}
              <span className="mission-tabs-cue is-start" aria-hidden="true">
                <CorridraIcon name="chevron" size={16} />
              </span>
              <span className="mission-tabs-cue is-end" aria-hidden="true">
                <CorridraIcon name="chevron" size={16} />
              </span>
            </div>
          ) : (
            row
          );
        })()}
        <div className="mission-layout" data-panel={panel ? 'open' : 'closed'}>
          <section
            role="tabpanel"
            id={`mission-tabpanel-${tab}`}
            aria-labelledby={`mission-tab-${tab}`}
            tabIndex={0}
          >
            {!panel && (!desk || tab !== 'overview') && feedback}
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
            {tab === 'quotes' && desk && (
              <MissionQuotes
                tenant={tenant}
                missionId={m.id}
                role={data.role}
                brief={m.brief}
                revision={revision}
                canRecord={manage}
                onRecord={(from) => openPanel('offer', from)}
                moneyHref={sectionHref(tenant, 'commercial', m.id, real)}
                reportsHref={sectionHref(tenant, 'delivery', m.id, real)}
              />
            )}
            {tab === 'quotes' && !desk && (
              <Quotes
                tenant={tenant}
                missionId={m.id}
                revision={revision}
                onRecord={() => choose('requirements')}
              />
            )}
            {tab === 'meetings' && <Meetings tenant={tenant} missionId={m.id} />}
            {tab === 'delivery' && <Delivery tenant={tenant} missionId={m.id} />}
            {tab === 'replies' && desk && (
              <MissionReplies
                missionId={m.id}
                replies={data.replies}
                canReply={manage}
                busy={busy}
                onSend={(body, replyId) =>
                  act('mission-reply', { id: m.id, body, replyId }, 'Reply posted.')
                }
              />
            )}
            {tab === 'replies' && !desk && (
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
    </SectionAddresses.Provider>
  );
}

/**
 * One tab row that scrolls sideways when it does not fit, never a second row. `data-more` says which edge has
 * more tabs past it, so the cue is drawn there; the chosen tab is brought into view.
 */
function useScrollCue(row: RefObject<HTMLDivElement | null>, on: boolean, chosen: string) {
  useEffect(() => {
    const el = row.current;
    if (!on || !el) return;
    const mark = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      el.setAttribute('data-more', start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
    };
    mark();
    el.addEventListener('scroll', mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', mark);
      observer.disconnect();
    };
  }, [row, on]);
  useEffect(() => {
    const el = row.current;
    if (!on || !el) return;
    const tab = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tab) return;
    // Sideways only: the page itself never jumps when a tab is chosen.
    const left = tab.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft) el.scrollTo({ left });
    else if (left + tab.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollTo({ left: left + tab.offsetWidth - el.clientWidth });
  }, [row, on, chosen]);
}

/**
 * Team desk v4.1, unit D6: what the customer can read about this mission today, built only from reads this
 * page already makes (the stage, the receipt replies and, where Move records are on, the open Moves).
 * Read-only: it holds no control that changes anything and sends nothing. Under 1024 px it is a closed
 * disclosure whose summary already says the stage, so the page stays short on a phone.
 */
function CustomerSees({
  tenant,
  missionId,
  status,
  replies,
  moveRecords,
  revision,
  wide,
}: {
  tenant: string;
  missionId: string;
  status: string;
  replies: Queue['replies'];
  moveRecords: boolean;
  revision: number;
  /** The desk has room for its columns, so the panel is open; otherwise it is a closed disclosure. */
  wide: boolean;
}) {
  const view = customerView(status);
  const latest = replies[0];
  const facts = (
    <>
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
    </>
  );
  return (
    <aside className="mission-customer" aria-labelledby="mission-customer-heading">
      {wide ? (
        <>
          <h3 id="mission-customer-heading">What the customer sees</h3>
          {facts}
        </>
      ) : (
        <details>
          <summary>
            <span>
              <span id="mission-customer-heading">What the customer sees</span>:{' '}
              {view.step ? `${view.step}. ` : ''}
              {view.words}
            </span>
            <CorridraIcon name="chevron" size={16} className="mission-more-chevron" />
          </summary>
          {facts}
        </details>
      )}
    </aside>
  );
}

/** The window width, and the page width in rem, from which the desk draws its columns. Both are in mission-page.css. */
const wideWindow = '(min-width: 1024px)';
const wideFromRem = 40;

/**
 * True while the desk has its columns: the window is at least 1024 px and the mission page at least `wideFromRem`
 * wide. The second is measured on the page itself and in rem, so text set to 200% gets the one-column desk.
 */
function useWide(page: RefObject<HTMLDivElement | null>, loaded: boolean) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    const media = window.matchMedia(wideWindow);
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(media.matches && el.clientWidth >= wideFromRem * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
    // The page element is replaced when the mission arrives, so it is measured again then.
  }, [page, loaded]);
  return wide;
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

/**
 * Team desk v4.1 (owner rule, 24 Nov 2026: no navigation link twice on one screen): the mission page is one
 * level under Missions, so it has one crumb, and that crumb is the page's only link to the list. It stands in
 * every state of the page, so no "Back to" link repeats it.
 */
function MissionCrumb({
  tenant,
  workspaceName,
  real,
}: {
  tenant: string;
  workspaceName: string;
  real: boolean;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mission-crumb">
      <a className="text-link" href={sectionHref(tenant, 'missions', undefined, real)}>
        Missions
      </a>{' '}
      · {workspaceName}
    </nav>
  );
}

/**
 * Where the work of a tab is done when that place is in the menu. On the team desk v4.1 the menu is the one
 * path to a place, so the tab names the place in words; off, it is the link it always was.
 */
function MenuPlace({
  tenant,
  slug,
  label,
  words,
}: {
  tenant: string;
  slug: string;
  label: string;
  words: string;
}) {
  const { teamDeskV41 } = useOperatorFlags();
  return teamDeskV41 ? (
    <p className="guide-hint" data-menu-place={slug}>
      {words}
    </p>
  ) : (
    <SectionLink tenant={tenant} slug={slug} label={label} />
  );
}

function Loading({ error, children }: { error: string; children?: ReactNode }) {
  return <p role={error ? 'alert' : 'status'}>{error || children || 'Loading…'}</p>;
}

/** The full workspace section, which works whether or not section addresses are switched on. */
function sectionHref(tenant: string, slug: string, missionId?: string, real = false) {
  // W5: the research and commercial sections open on this mission. The mission is only a hint to pick
  // from what the section already lists; the section still ignores it when it is not in that list.
  const mission = missionId ? `&mission=${encodeURIComponent(missionId)}` : '';
  const page = real ? operatorSectionPath(`workspace-${slug}`) : null;
  return page
    ? `${page}?workspace=${encodeURIComponent(tenant)}${mission}`
    : `/operator?workspace=${encodeURIComponent(tenant)}${mission}#workspace-${slug}`;
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
  const real = useContext(SectionAddresses);
  return (
    <a className="text-link" href={sectionHref(tenant, slug, missionId, real)}>
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
                {m.starts_at
                  ? ` · ${formatDateTime(String(m.starts_at))}`
                  : ['CANCELLED', 'DECLINED'].includes(String(m.status))
                    ? ''
                    : ' · not scheduled'}
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
      <MenuPlace
        tenant={tenant}
        slug="meetings"
        label="Introductions and meetings"
        words="Schedule and record meetings under Meetings in the menu."
      />
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
      <MenuPlace
        tenant={tenant}
        slug="delivery"
        label="Write, approve and share a report"
        words="Write, approve and share a report under Reports in the menu."
      />
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
