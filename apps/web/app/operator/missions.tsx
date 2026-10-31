'use client';
import { OperatorWorkbench, useFormChangeGuard } from '../../components/operator-workbench';
import { useEffect, useState, type FormEvent } from 'react';
import { AccessState, StatusBadge } from '../../components/access-state';
import { StatusChip } from '../../components/ux/page-header';
import type { MissionBrief } from '@corridra/domain/missions';
import { CommercialMission } from './commercial-mission';
import { MissionMoves } from './mission-moves';
import { CountryOptions } from './country-options';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { missionStatus } from '@corridra/domain/missions';
import { formatDate, formatDateTime } from '../../lib/ux/format';
import './[section]/[missionId]/mission-page.css';
import {
  actionLabel,
  isOverdue,
  missionHref,
  sourceLabel,
  stageChip,
  stageLabel,
} from './[section]/[missionId]/mission-labels';
export type Mission = {
  id: string;
  status: string;
  version: number;
  owner_id: string;
  next_action: string;
  due_at: string;
  reason: string;
  brief: MissionBrief;
  notice_version: string;
  acknowledged_at: string;
  source_kind: string;
  claim_status: string;
  country_code: string | null;
  target_profile: string | null;
  route_label?: string | null;
};
export type Owner = { user_id: string; role: string; name: string };
export type HistoryEntry = {
  id: string;
  mission_id: string;
  action: string;
  details: {
    ownerId: string;
    nextAction: string;
    dueAt: string;
    marketCode: string;
    targetProfile: string;
  };
  reason: string;
  resulting_version: number;
  created_at: string;
};
export type Queue = {
  total: number;
  role: string;
  missions: Mission[];
  owners: Owner[];
  history: HistoryEntry[];
  replies: { id: string; mission_id: string; body: string; created_at?: string }[];
};
type RouteOption = { id: string; label: string };
const routeOptions = (catalogue: {
  routes?: { id: string; origin_market: string; destination_market: string }[];
  packs: { route_id: string; origin_market: string; destination_market: string }[];
}): RouteOption[] =>
  // CQ-09: the filter lists every route in the workspace, not only routes with a published pack.
  catalogue.routes?.length
    ? catalogue.routes.map((r) => ({
        id: r.id,
        label: `${r.origin_market} → ${r.destination_market}`,
      }))
    : catalogue.packs.map((p) => ({
        id: p.route_id,
        label: `${p.origin_market} → ${p.destination_market}`,
      }));
export const canManage = (role: string | undefined) =>
  !!role && ['owner', 'admin', 'operator'].includes(role);
export const ownerName = (owners: Owner[], id: string | null | undefined) =>
  owners.find((o) => o.user_id === id)?.name ?? (id ? 'Former team member' : 'Not assigned');

/** POSTs one mission command to the existing workspace API and throws the server's message. */
export async function missionRequest(tenant: string, action: string, body: unknown) {
  const r = await fetch(`/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}

/** Builds the mission command from the action form. Returns null (and says why) for an invalid date. */
export function missionCommandBody(
  e: FormEvent<HTMLFormElement>,
  m: Mission,
  fail: (message: string) => void,
) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const due = new Date(String(f.get('dueAt')) + 'Z');
  if (Number.isNaN(due.getTime())) {
    fail('Enter a valid due date');
    return null;
  }
  return {
    id: m.id,
    version: m.version,
    commandId:
      e.currentTarget.dataset.commandId ??
      (e.currentTarget.dataset.commandId = crypto.randomUUID()),
    action: f.get('action'),
    reason: f.get('reason'),
    ownerId: f.get('owner'),
    nextAction: f.get('nextAction'),
    dueAt: due.toISOString(),
    marketCode: f.get('marketCode'),
    targetProfile: f.get('targetProfile'),
  };
}

export function MissionFacts({ m, owners }: { m: Mission; owners: Owner[] }) {
  return (
    <>
      <dl>
        <dt>Owner</dt>
        <dd>{ownerName(owners, m.owner_id)}</dd>
        <dt>Next action</dt>
        <dd>{m.next_action || 'Not recorded'}</dd>
        <dt>Due</dt>
        <dd>
          <time dateTime={m.due_at}>{formatDate(m.due_at)}</time>
          {isOverdue(m.due_at, m.status) ? ' · Overdue' : ''}
        </dd>
        <dt>Route</dt>
        <dd>{m.route_label ?? 'No route assigned yet'}</dd>
        <dt>Offer / requirement</dt>
        <dd>{m.brief.offer}</dd>
        <dt>Desired outcomes</dt>
        <dd>{m.brief.outcomes.join(', ')}</dd>
        <dt>Visit window</dt>
        <dd>
          {m.brief.attendance === 'Yes'
            ? `${m.brief.startDate} to ${m.brief.endDate} (${m.brief.timezone})`
            : m.brief.attendance}
        </dd>
        <dt>Response details</dt>
        <dd>
          {m.brief.name} · {m.brief.email}
        </dd>
        <dt>Source</dt>
        <dd>{sourceLabel(m.source_kind, m.claim_status)}</dd>
        <dt>Privacy notice accepted</dt>
        <dd>
          {formatDateTime(m.acknowledged_at)}
          <details>
            <summary>Record details</summary>
            <p>Notice version {m.notice_version}</p>
          </details>
        </dd>
      </dl>
      {m.brief.website && (
        <p>
          Submitted URL:{' '}
          <a href={m.brief.website} target="_blank" rel="noopener noreferrer">
            {m.brief.website}
          </a>
        </p>
      )}
      {m.brief.notes && <p>Additional context: {m.brief.notes}</p>}
    </>
  );
}

export function MissionActionForm({
  m,
  owners,
  busy,
  onSubmit,
}: {
  m: Mission;
  owners: Owner[];
  busy: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form key={m.version} className="operator-form" onSubmit={onSubmit}>
      <label className="field">
        Mission action
        <select name="action">
          <option value="assign">Update ownership and next action</option>
          {m.status === 'DRAFT' && <option value="qualify">Begin qualification</option>}
          {m.status === 'QUALIFICATION' && <option value="activate">Activate mission</option>}
          {m.status === 'ACTIVE' && <option value="targeting">Begin counterparty targeting</option>}
          {m.status === 'TARGETING' && <option value="outreach">Begin controlled outreach</option>}
          {m.status === 'OUTREACH' && <option value="meetings">Begin meeting delivery</option>}
          {m.status === 'FOLLOW_UP' && <option value="pipeline">Begin commercial pipeline</option>}
          {m.status === 'COMMERCIAL_PIPELINE' && (
            <option value="close">Close resolved mission</option>
          )}
          {m.status === 'MEETINGS' && <option value="followup">Begin owned follow-up</option>}
          {[
            'QUALIFICATION',
            'ACTIVE',
            'TARGETING',
            'OUTREACH',
            'MEETINGS',
            'FOLLOW_UP',
            'COMMERCIAL_PIPELINE',
          ].includes(m.status) && <option value="pause">Pause mission</option>}
          {m.status === 'ON_HOLD' && <option value="resume">Resume mission</option>}
          <option value="cancel">Cancel mission</option>
        </select>
      </label>
      <label className="field">
        Assigned owner
        <select name="owner" defaultValue={m.owner_id}>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.name} · {o.role}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Next action
        <input
          name="nextAction"
          required
          minLength={3}
          maxLength={300}
          defaultValue={m.next_action}
        />
      </label>
      <label className="field">
        Due at (UTC)
        <input name="dueAt" type="datetime-local" required defaultValue={m.due_at.slice(0, 16)} />
      </label>
      <label className="field">
        Structured market
        <select name="marketCode" defaultValue={m.country_code ?? 'OTHER'}>
          <CountryOptions />
          <option value="OTHER">Other / needs classification</option>
        </select>
      </label>
      <label className="field">
        Target profile
        <textarea
          name="targetProfile"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={m.target_profile ?? ''}
        />
      </label>
      <label className="field">
        Reason for change
        <textarea name="reason" required minLength={3} maxLength={500} />
      </label>
      <button className="primary-link" disabled={busy}>
        Save mission action
      </button>
    </form>
  );
}

export function MissionHistory({ history, owners }: { history: HistoryEntry[]; owners: Owner[] }) {
  if (!history.length) return <p>No changes recorded yet.</p>;
  return (
    <ul>
      {history.map((h) => (
        <li key={h.id}>
          {actionLabel(h.action)} · version {h.resulting_version} · {h.reason} ·{' '}
          {formatDateTime(h.created_at)}
          <details>
            <summary>Recorded action details</summary>
            <p>Owner: {ownerName(owners, h.details.ownerId)}</p>
            <p>
              Next action: {h.details.nextAction} · due {formatDateTime(h.details.dueAt)}
            </p>
            <p>
              Market: {h.details.marketCode} · target profile: {h.details.targetProfile}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function ReplyForm({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (body: string, replyId: string) => Promise<boolean>;
}) {
  return (
    <form
      className="operator-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const replyId = form.dataset.replyId ?? (form.dataset.replyId = crypto.randomUUID());
        void onSend(String(f.get('body') ?? ''), replyId).then((saved) => {
          if (saved) {
            form.reset();
            delete form.dataset.replyId;
          }
        });
      }}
    >
      <label className="field">
        Reply visible on the private receipt
        <textarea name="body" required minLength={3} maxLength={2000} />
      </label>
      <button className="primary-link" disabled={busy}>
        Post receipt reply
      </button>
    </form>
  );
}

export function Missions({
  tenant,
  onChanged,
  moveRecords = false,
}: {
  tenant: string;
  onChanged?: () => void;
  /** UX update (`CORRIDRA_UX_MOVE_RECORDS`, read on the server): the panel for setting a Move. Off adds nothing. */
  moveRecords?: boolean;
}) {
  const { ref: formRootRef, onChangeCapture, onResetCapture, confirmChange } = useFormChangeGuard();
  const [queue, setQueue] = useState<Queue | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('open'),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState({ route: '', job: '', owner: '', stage: '' }),
    [routes, setRoutes] = useState<RouteOption[]>([]),
    // D15: the compact queue with one page per mission. Read from the server; off keeps the cards below.
    [compact, setCompact] = useState(false);
  const query = new URLSearchParams({
    tenant,
    filter,
    offset: String(offset),
    ...selected,
  }).toString();
  async function request(action: string, body?: unknown) {
    const r = await fetch(
      `/api/workspace/${action}?${query}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/workspace/missions?${query}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) setQueue(data);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [query]);
  useEffect(() => {
    let active = true;
    fetch('/api/team-work/flags')
      .then(async (r) => (r.ok ? r.json() : { missionsV2: false }))
      .then((v: { missionsV2?: boolean }) => {
        if (active) setCompact(v.missionsV2 === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    fetch(`/api/workspace/mission-catalogue?tenant=${encodeURIComponent(tenant)}`)
      .then(async (r) => {
        if (!r.ok) return;
        const v = await r.json();
        if (active) setRoutes(routeOptions(v));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tenant]);
  async function act(action: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      await request(action, body);
      setQueue(await request('missions'));
      setMessage('Mission saved.');
      onChanged?.();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function command(e: FormEvent<HTMLFormElement>, m: Mission) {
    const body = missionCommandBody(e, m, setMessage);
    if (body) void act('mission', body);
  }
  const manage = queue && canManage(queue.role);
  return (
    <section
      className="missions-home"
      data-operator-workbench
      ref={formRootRef}
      onChangeCapture={onChangeCapture}
      onResetCapture={onResetCapture}
    >
      <div className="section-heading">
        <p className="label">OPS HOME</p>
        <h2>Mission review queue</h2>
        <p>Start with the request. Give each mission an owner and a clear next step.</p>
      </div>
      <OperatorWorkbench
        label="Mission queue sections"
        sections={[{ label: 'Queue and filters', heading: 'Mission review queue' }]}
      />
      <p aria-live="polite">{message}</p>
      <div className="hero-actions">
        {(['route', 'job', 'owner', 'stage'] as const).map((key) => (
          <label className="field" key={key}>
            Filter by {key}
            <select
              disabled={busy}
              value={selected[key]}
              onChange={(e) => {
                if (busy || !confirmChange()) return;
                setSelected((v) => ({ ...v, [key]: e.target.value }));
                setOffset(0);
              }}
            >
              <option value="">All {key}s</option>
              {(key === 'route'
                ? routes
                : key === 'job'
                  ? missionCatalogue.map((t) => ({ id: t.key, label: t.label }))
                  : key === 'owner'
                    ? (queue?.owners.map((o) => ({ id: o.user_id, label: o.name })) ?? [])
                    : missionStatus.options.map((s) => ({ id: s, label: stageLabel(s) }))
              ).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="field">
          Show missions
          <select
            disabled={busy}
            value={filter}
            onChange={(e) => {
              if (busy || !confirmChange()) return;
              setFilter(e.target.value);
              setOffset(0);
            }}
          >
            <option value="open">Open</option>
            <option value="all">All</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <button
          className="text-link"
          type="button"
          disabled={busy}
          onClick={() => {
            void Promise.all([request('missions'), request('mission-catalogue')])
              .then(([missions, catalogue]) => {
                setQueue(missions);
                setRoutes(routeOptions(catalogue));
              })
              .catch((e) => setMessage(e.message));
          }}
        >
          Refresh missions
        </button>
      </div>
      <div className="hero-actions" aria-label="Mission focus views">
        {[
          { label: 'Awaiting qualification', stage: 'QUALIFICATION', job: '', direction: '' },
          { label: 'China sourcing', stage: '', job: 'sourcing', direction: 'BD → CN' },
          {
            label: 'China machinery',
            stage: '',
            job: 'machinery_procurement',
            direction: 'BD → CN',
          },
          { label: 'Spain buyer access', stage: '', job: 'buyers', direction: 'BD → ES' },
          { label: 'Delegation portfolio', stage: '', job: 'delegations', direction: '' },
        ].map((view) => (
          <button
            key={view.label}
            disabled={busy || (!!view.direction && !routes.some((r) => r.label === view.direction))}
            type="button"
            onClick={() => {
              if (busy || !confirmChange()) return;
              setOffset(0);
              setFilter('open');
              setSelected({
                owner: '',
                stage: view.stage,
                job: view.job,
                route: routes.find((r) => r.label === view.direction)?.id ?? '',
              });
            }}
          >
            {view.label}
          </button>
        ))}
      </div>
      {queue && (
        <div className="hero-actions">
          <p>
            {queue.total} matching missions · showing {queue.missions.length ? offset + 1 : 0} to{' '}
            {offset + queue.missions.length}
          </p>
          <button
            type="button"
            className="text-link"
            disabled={busy || offset === 0}
            onClick={() => {
              if (confirmChange()) setOffset((v) => Math.max(0, v - 100));
            }}
          >
            Previous missions
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy || offset + 100 >= queue.total}
            onClick={() => {
              if (confirmChange()) setOffset((v) => v + 100);
            }}
          >
            Next missions
          </button>
        </div>
      )}
      {!queue ? (
        <p>
          {message
            ? 'Missions could not be loaded. Verify current access, then retry.'
            : 'Loading missions…'}
        </p>
      ) : queue.missions.length === 0 ? (
        <AccessState kind="empty">
          <p>No mission requests yet.</p>
          <p>
            No matching accessible records are shown. Change the filters or refresh; this does not
            establish an outcome of zero.
          </p>
        </AccessState>
      ) : compact ? (
        <CompactQueue queue={queue} tenant={tenant} />
      ) : (
        queue.missions.map((m) => (
          <article className="detail-card mission-card" key={m.id}>
            <header className="ux-mission-passport">
              <p className="label">
                {stageLabel(m.status)} · version {m.version}
              </p>
              <h3>{m.brief.company}</h3>
              <p>
                {m.brief.objective} · {m.brief.market}
              </p>
              <StatusBadge tone="unknown">Self-declared</StatusBadge>
              <p className="ux-scope-note">
                Private workspace record · Original request · No independent verification implied
              </p>
            </header>
            <CommercialMission tenant={tenant} missionId={m.id} onChanged={onChanged} />
            <MissionFacts m={m} owners={queue.owners} />
            {manage && !['CANCELLED', 'CLOSED'].includes(m.status) && (
              <MissionActionForm
                m={m}
                owners={queue.owners}
                busy={busy}
                onSubmit={(e) => command(e, m)}
              />
            )}
            <h4>Change history</h4>
            <MissionHistory
              history={queue.history.filter((h) => h.mission_id === m.id)}
              owners={queue.owners}
            />
            <h4>Receipt replies</h4>
            {queue.replies
              .filter((r) => r.mission_id === m.id)
              .map((r) => (
                <p key={r.id}>{r.body}</p>
              ))}
            {manage && (
              <ReplyForm
                busy={busy}
                onSend={(body, replyId) => act('mission-reply', { id: m.id, body, replyId })}
              />
            )}
            {manage && moveRecords && <MissionMoves tenant={tenant} missionId={m.id} />}
          </article>
        ))
      )}
    </section>
  );
}

/** D15 queue: one row per mission. Every action lives on the mission's own page. */
function CompactQueue({ queue, tenant }: { queue: Queue; tenant: string }) {
  return (
    <div className="mission-queue" role="region" aria-label="Missions" tabIndex={0}>
      <table>
        <caption className="sr-only">
          Missions, one row each. Open a mission to see its tabs and actions.
        </caption>
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">Route</th>
            <th scope="col">Stage</th>
            <th scope="col">Owner</th>
            <th scope="col">Due</th>
            <th scope="col">Next action</th>
          </tr>
        </thead>
        <tbody>
          {queue.missions.map((m) => {
            const overdue = isOverdue(m.due_at, m.status);
            return (
              <tr key={m.id} data-mission-row>
                <th scope="row">
                  <a href={missionHref(m.id, tenant)}>{m.brief.company}</a>
                </th>
                <td>{m.route_label ?? 'No route yet'}</td>
                <td>
                  <StatusChip status={stageChip(m.status, overdue)} />
                </td>
                <td>{ownerName(queue.owners, m.owner_id)}</td>
                <td>
                  <time dateTime={m.due_at}>{formatDate(m.due_at)}</time>
                </td>
                <td>{m.next_action || 'Not recorded'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
