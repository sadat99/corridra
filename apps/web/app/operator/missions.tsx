'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { MissionBrief } from '@corridra/domain/missions';
import { CommercialMission } from './commercial-mission';
import { CountryOptions } from './country-options';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { missionStatus } from '@corridra/domain/missions';
type Mission = {
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
};
type Queue = {
  total: number;
  role: string;
  missions: Mission[];
  owners: { user_id: string; role: string; name: string }[];
  history: {
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
  }[];
  replies: { id: string; mission_id: string; body: string }[];
};
export function Missions({ tenant, onChanged }: { tenant: string; onChanged?: () => void }) {
  const [queue, setQueue] = useState<Queue | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('open'),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState({ route: '', job: '', owner: '', stage: '' }),
    [routes, setRoutes] = useState<{ id: string; label: string }[]>([]);
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
    fetch(`/api/workspace/mission-catalogue?tenant=${encodeURIComponent(tenant)}`)
      .then(async (r) => {
        if (!r.ok) return;
        const v = await r.json();
        if (active)
          setRoutes(
            v.packs.map(
              (p: { route_id: string; origin_market: string; destination_market: string }) => ({
                id: p.route_id,
                label: `${p.origin_market} → ${p.destination_market}`,
              }),
            ),
          );
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
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const due = new Date(String(f.get('dueAt')) + 'Z');
    if (Number.isNaN(due.getTime())) {
      setMessage('Enter a valid due date');
      return;
    }
    void act('mission', {
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
    });
  }
  const manage = queue && ['owner', 'admin', 'operator'].includes(queue.role);
  return (
    <section className="missions-home">
      <div className="section-heading">
        <p className="label">OPS HOME</p>
        <h2>Mission review queue</h2>
        <p>Start with the brief. Give each mission an owner and a clear next step.</p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="hero-actions">
        {(['route', 'job', 'owner', 'stage'] as const).map((key) => (
          <label className="field" key={key}>
            Filter by {key}
            <select
              value={selected[key]}
              onChange={(e) => {
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
                    : missionStatus.options.map((s) => ({ id: s, label: s.replaceAll('_', ' ') }))
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
            value={filter}
            onChange={(e) => {
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
            request('missions')
              .then(setQueue)
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
            disabled={!!view.direction && !routes.some((r) => r.label === view.direction)}
            type="button"
            onClick={() => {
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
            onClick={() => setOffset((v) => Math.max(0, v - 100))}
          >
            Previous missions
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy || offset + 100 >= queue.total}
            onClick={() => setOffset((v) => v + 100)}
          >
            Next missions
          </button>
        </div>
      )}
      {!queue ? (
        <p>Loading missions…</p>
      ) : queue.missions.length === 0 ? (
        <p>No mission briefs yet.</p>
      ) : (
        queue.missions.map((m) => (
          <article className="detail-card mission-card" key={m.id}>
            <header>
              <p className="label">
                {m.status.replaceAll('_', ' ')} · VERSION {m.version}
              </p>
              <h3>{m.brief.company}</h3>
              <p>
                {m.brief.objective} · {m.brief.market}
              </p>
              <span className="evidence-label">Self-declared</span>
            </header>
            <CommercialMission tenant={tenant} missionId={m.id} onChanged={onChanged} />
            <dl>
              <dt>Owner</dt>
              <dd>{queue.owners.find((o) => o.user_id === m.owner_id)?.name ?? m.owner_id}</dd>
              <dt>Next action</dt>
              <dd>{m.next_action}</dd>
              <dt>Due</dt>
              <dd>
                <time dateTime={m.due_at}>{new Date(m.due_at).toLocaleString()}</time>
                {new Date(m.due_at) < new Date() && !['CANCELLED', 'CLOSED'].includes(m.status)
                  ? ' · Overdue'
                  : ''}
              </dd>
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
              <dd>
                {m.source_kind} · {m.claim_status}
              </dd>
              <dt>Notice acknowledged</dt>
              <dd>
                {m.notice_version} · {new Date(m.acknowledged_at).toLocaleString()}
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
            {manage && !['CANCELLED', 'CLOSED'].includes(m.status) && (
              <form key={m.version} className="operator-form" onSubmit={(e) => command(e, m)}>
                <label className="field">
                  Mission action
                  <select name="action">
                    <option value="assign">Update ownership and next action</option>
                    {m.status === 'DRAFT' && <option value="qualify">Begin qualification</option>}
                    {m.status === 'QUALIFICATION' && (
                      <option value="activate">Activate mission</option>
                    )}
                    {m.status === 'ACTIVE' && (
                      <option value="targeting">Begin counterparty targeting</option>
                    )}
                    {m.status === 'TARGETING' && (
                      <option value="outreach">Begin controlled outreach</option>
                    )}
                    {m.status === 'OUTREACH' && (
                      <option value="meetings">Begin meeting delivery</option>
                    )}
                    {m.status === 'FOLLOW_UP' && (
                      <option value="pipeline">Begin commercial pipeline</option>
                    )}
                    {m.status === 'COMMERCIAL_PIPELINE' && (
                      <option value="close">Close resolved mission</option>
                    )}
                    {m.status === 'MEETINGS' && (
                      <option value="followup">Begin owned follow-up</option>
                    )}
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
                    {queue.owners.map((o) => (
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
                  <input
                    name="dueAt"
                    type="datetime-local"
                    required
                    defaultValue={m.due_at.slice(0, 16)}
                  />
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
            )}
            <h4>Change history</h4>
            <ul>
              {queue.history
                .filter((h) => h.mission_id === m.id)
                .map((h) => (
                  <li key={h.id}>
                    {h.action} · version {h.resulting_version} · {h.reason} ·{' '}
                    {new Date(h.created_at).toLocaleString()}
                    <details>
                      <summary>Recorded action details</summary>
                      <p>
                        Owner:{' '}
                        {queue.owners.find((o) => o.user_id === h.details.ownerId)?.name ??
                          h.details.ownerId}
                      </p>
                      <p>
                        Next action: {h.details.nextAction} · due{' '}
                        {new Date(h.details.dueAt).toLocaleString()}
                      </p>
                      <p>
                        Market: {h.details.marketCode} · target profile: {h.details.targetProfile}
                      </p>
                    </details>
                  </li>
                ))}
            </ul>
            <h4>Receipt replies</h4>
            {queue.replies
              .filter((r) => r.mission_id === m.id)
              .map((r) => (
                <p key={r.id}>{r.body}</p>
              ))}
            {manage && (
              <form
                className="operator-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  const replyId =
                    form.dataset.replyId ?? (form.dataset.replyId = crypto.randomUUID());
                  void act('mission-reply', { id: m.id, body: f.get('body'), replyId }).then(
                    (saved) => {
                      if (saved) {
                        form.reset();
                        delete form.dataset.replyId;
                      }
                    },
                  );
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
            )}
          </article>
        ))
      )}
    </section>
  );
}
