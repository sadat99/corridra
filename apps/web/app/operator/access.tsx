'use client';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  contactPurpose,
  meetingTransitions,
  localWallTime,
  type Introduction,
  type MeetingStatus,
} from '@corridra/domain/access';
type Policy = {
  id: string;
  jurisdiction: string;
  channel: string;
  contact_purpose: string;
  version: number;
  enabled: boolean;
  valid_until: string;
  basis: string;
};
type Template = { id: string; name: string; version: number; contact_purpose: string };
type Message = {
  id: string;
  link_id: string;
  presentation: Introduction;
  channel: string;
  decision: string | null;
  response_id: string | null;
  delivery_status: string;
  attempts: number;
  revoked: boolean;
  expires_at: string;
};
type Comms = {
  role: string;
  policies: Policy[];
  templates: Template[];
  targets: { id: string; name: string; supplier: string; relationship_id: string }[];
  contacts: { id: string; name: string; email: string; relationship_id: string }[];
  messages: Message[];
  optouts: { id: string; contact_id: string; reason: string }[];
  attempts: { id: string; message_id: string; status: string; reason: string }[];
};
type Owner = { user_id: string; name: string };
type Meeting = {
  id: string;
  message_id: string;
  title: string;
  brief: string;
  status: MeetingStatus;
  version: number;
  owner_id: string;
  next_action: string;
  due_at: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  local_start: string | null;
  local_end: string | null;
  location: string | null;
};
type Meetings = {
  role: string;
  owners: Owner[];
  meetings: Meeting[];
  participants: { id: string; meeting_id: string; name: string }[];
  outcomes: { id: string; meeting_id: string; status: string; summary: string }[];
  followups: {
    id: string;
    meeting_id: string;
    owner_id: string;
    next_action: string;
    due_at: string;
    status: string;
    version: number;
  }[];
  history: {
    id: string;
    meeting_id: string;
    action: string;
    details: { command: { reason: string }; previous?: { startsAt: string; timezone: string } };
  }[];
};
const utcField = (v = new Date(Date.now() + 86400000).toISOString()) =>
  new Date(v).toISOString().slice(0, 16);
const field = (f: FormData, name: string) => String(f.get(name) ?? '');
const timestamp = (f: FormData, name: string) => new Date(field(f, name) + 'Z').toISOString();
function PurposeSelect() {
  return (
    <label className="field">
      Contact purpose
      <select name="contactPurpose">
        {contactPurpose.options.map((p) => (
          <option key={p} value={p}>
            {p.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}
function Ownership({ owners, meeting }: { owners: Owner[]; meeting?: Meeting }) {
  const [defaultDue] = useState(() => utcField());
  return (
    <>
      <label className="field">
        Meeting or follow-up owner
        <select name="ownerId" required defaultValue={meeting?.owner_id}>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Meeting next action
        <input
          name="nextAction"
          required
          minLength={3}
          maxLength={300}
          defaultValue={meeting?.next_action}
        />
      </label>
      <label className="field">
        Meeting next-action deadline (UTC)
        <input
          name="dueAt"
          type="datetime-local"
          required
          defaultValue={meeting?.due_at ? utcField(meeting.due_at) : defaultDue}
        />
      </label>
      <label className="field">
        Meeting command reason
        <textarea name="reason" required minLength={3} maxLength={500} />
      </label>
    </>
  );
}
export function ControlledAccess({ tenant, revision }: { tenant: string; revision: number }) {
  const [comms, setComms] = useState<Comms | null>(null),
    [meetings, setMeetings] = useState<Meetings | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [buyerPath, setBuyerPath] = useState(''),
    [target, setTarget] = useState('');
  const retry = useRef(new Map<string, string>());
  const [defaults] = useState(() => ({
    tomorrow: utcField(),
    week: utcField(new Date(Date.now() + 7 * 86400000).toISOString()),
    now: Date.now(),
  }));
  async function request(action: string, body?: unknown) {
    const r = await fetch(
      `/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}`,
      body === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    return result;
  }
  async function refresh() {
    const [c, m] = await Promise.all([request('communications'), request('meetings')]);
    setComms(c);
    setMeetings(m);
  }
  useEffect(() => {
    let active = true;
    Promise.all(
      ['communications', 'meetings'].map(async (action) => {
        const r = await fetch(`/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}`, {
          cache: 'no-store',
        });
        const v = await r.json();
        if (!r.ok) throw new Error(v.error);
        return v;
      }),
    )
      .then(([c, m]) => {
        if (active) {
          setComms(c);
          setMeetings(m);
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [tenant, revision]);
  async function act(endpoint: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    const signature = JSON.stringify({ endpoint, body });
    const commandId = retry.current.get(signature) ?? crypto.randomUUID();
    retry.current.set(signature, commandId);
    try {
      const result = await request(endpoint, {
        ...body,
        ...(endpoint === 'dispatch' ? {} : { commandId }),
      });
      if (result.buyerPath) setBuyerPath(window.location.origin + result.buyerPath);
      await refresh();
      retry.current.delete(signature);
      setMessage(
        endpoint === 'dispatch' ? 'Delivery work started. Refresh to see its result.' : 'Saved.',
      );
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function submit(
    e: FormEvent<HTMLFormElement>,
    build: (f: FormData) => Record<string, unknown>,
    endpoint = 'communication',
  ) {
    e.preventDefault();
    try {
      void act(endpoint, build(new FormData(e.currentTarget)));
    } catch {
      setMessage('Check the dates and submitted values.');
    }
  }
  if (!comms || !meetings)
    return (
      <section data-operator-workbench className="operator-section">
        <h2>Introductions and meetings</h2>
        <OperatorWorkbench
          label="Introduction and meeting sections"
          sections={[
            { label: 'Introductions', heading: 'Introductions and replies' },
            { label: 'Meetings', heading: 'Meeting itinerary' },
            { label: 'Follow-up', heading: 'Owned follow-up' },
          ]}
        />
        <p role="status" aria-label="Access status">
          {message || 'Loading controlled access…'}
        </p>
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void refresh()
              .then(() => setMessage(''))
              .catch((e) => setMessage(e.message))
          }
        >
          Retry this section
        </button>
        <a href="#workspace-authenticator">Verify current access</a>
      </section>
    );
  const manage = ['owner', 'admin', 'operator'].includes(comms.role),
    approve = ['owner', 'admin'].includes(comms.role),
    selected = comms.targets.find((t) => t.id === target);
  return (
    <section className="operator-section">
      <div className="section-heading">
        <p className="label">CONTROLLED ACCESS</p>
        <h2>Introductions and meetings</h2>
        <p>Give the buyer a reason to respond. Keep the meeting and its next step owned.</p>
      </div>
      <p role="status" aria-live="polite" aria-label="Access status">
        {message}
      </p>
      <button
        className="text-link"
        disabled={busy}
        onClick={() => void refresh().catch((e) => setMessage(e.message))}
      >
        Refresh access and meetings
      </button>
      <p>
        Invented records only. Synthetic delivery sends no email. Manual delivery records a human
        handoff. Owners must enable introductions and dispatch in Workspace controls.
      </p>
      <details>
        <summary>Approved communication policy and templates</summary>
        <ul>
          {comms.policies.map((p) => (
            <li key={p.id}>
              {p.jurisdiction} / {p.channel} / {p.contact_purpose.replaceAll('_', ' ')}: version{' '}
              {p.version}, {p.enabled ? 'enabled' : 'disabled'}, expires{' '}
              {new Date(p.valid_until).toLocaleString()}. {p.basis}
            </li>
          ))}
        </ul>
        {approve && (
          <div className="detail-grid">
            <form
              className="operator-form"
              aria-label="Approve communication policy"
              onSubmit={(e) =>
                submit(e, (f) => ({
                  action: 'policy',
                  jurisdiction: field(f, 'jurisdiction'),
                  channel: field(f, 'channel'),
                  contactPurpose: field(f, 'contactPurpose'),
                  basis: field(f, 'basis'),
                  validUntil: timestamp(f, 'validUntil'),
                  enabled: f.get('enabled') === 'on',
                }))
              }
            >
              <h3>Approve a policy version</h3>
              <p>
                This approves an invented demonstration. It does not establish a legal basis for
                real outreach. Fresh MFA is required.
              </p>
              <label className="field">
                Recipient jurisdiction
                <select name="jurisdiction">
                  {['ES', 'BD', 'DE', 'OTHER'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Delivery channel
                <select name="channel">
                  <option value="SYNTHETIC">Synthetic receipt</option>
                  <option value="MANUAL">Manual handoff</option>
                </select>
              </label>
              <PurposeSelect />
              <label className="field">
                Policy basis
                <textarea name="basis" required minLength={3} maxLength={1000} />
              </label>
              <label className="field">
                Policy validity deadline (UTC)
                <input
                  name="validUntil"
                  type="datetime-local"
                  required
                  defaultValue={defaults.week}
                />
              </label>
              <label className="check-field">
                <input type="checkbox" name="enabled" defaultChecked />
                Enable this policy version
              </label>
              <button className="primary-link" disabled={busy}>
                Approve policy
              </button>
            </form>
            <form
              className="operator-form"
              aria-label="Approve communication template"
              onSubmit={(e) =>
                submit(e, (f) => ({
                  action: 'template',
                  name: field(f, 'name'),
                  contactPurpose: field(f, 'contactPurpose'),
                  body: field(f, 'body'),
                }))
              }
            >
              <h3>Approve an introduction template</h3>
              <label className="field">
                Template name
                <input name="name" required minLength={3} maxLength={120} />
              </label>
              <PurposeSelect />
              <label className="field">
                Approved introduction text
                <textarea name="body" required minLength={3} maxLength={1500} />
              </label>
              <button className="primary-link" disabled={busy}>
                Approve template
              </button>
            </form>
          </div>
        )}
      </details>
      {manage && (
        <form
          className="operator-form detail-card"
          aria-label="Create private introduction"
          onSubmit={(e) =>
            submit(e, (f) => ({
              action: 'introduce',
              targetId: field(f, 'targetId'),
              contactId: field(f, 'contactId'),
              policyId: field(f, 'policyId'),
              templateId: field(f, 'templateId'),
              expiresAt: timestamp(f, 'expiresAt'),
              introduction: Object.fromEntries(
                [
                  'company',
                  'country',
                  'capability',
                  'fit',
                  'evidence',
                  'uncertainty',
                  'conversationPurpose',
                  'availableDates',
                ].map((k) => [k, field(f, k)]),
              ),
            }))
          }
        >
          <h3>Review and create a private introduction</h3>
          <label className="field">
            Introduction target
            <select
              name="targetId"
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose a mission target</option>
              {comms.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.supplier} to {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Introduction recipient
            <select name="contactId" required key={target}>
              <option value="">Choose a contact for this target</option>
              {comms.contacts
                .filter((c) => c.relationship_id === selected?.relationship_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.email})
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Approved policy
            <select name="policyId" required>
              <option value="">Choose a current policy</option>
              {comms.policies
                .filter((p) => p.enabled)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jurisdiction} / {p.channel} / {p.contact_purpose.replaceAll('_', ' ')} v
                    {p.version}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Approved template
            <select name="templateId" required>
              <option value="">Choose a template</option>
              {comms.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} v{t.version}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Introduced company
            <input
              name="company"
              required
              minLength={3}
              maxLength={160}
              key={`company-${target}`}
              defaultValue={selected?.supplier}
            />
          </label>
          <label className="field">
            Introduced company country
            <select name="country">
              {['BD', 'ES', 'DE', 'OTHER'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {(
            [
              ['capability', 'Relevant capability', 600],
              ['fit', 'Reason there may be a fit', 1000],
              ['evidence', 'Evidence highlights for the buyer', 1000],
              ['uncertainty', 'What remains unverified for the buyer', 1000],
              ['conversationPurpose', 'Proposed conversation purpose', 600],
              ['availableDates', 'Available conversation dates', 300],
            ] as const
          ).map(([name, label, max]) => (
            <label key={name} className="field">
              {label}
              <textarea name={name} required minLength={3} maxLength={max} />
            </label>
          ))}
          <label className="field">
            Private link expiry (UTC)
            <input
              name="expiresAt"
              type="datetime-local"
              required
              defaultValue={defaults.tomorrow}
            />
          </label>
          <label className="check-field">
            <input type="checkbox" required />I reviewed this introduction and approve the displayed
            context for this recipient.
          </label>
          <button className="primary-link" disabled={busy}>
            Create private introduction
          </button>
        </form>
      )}
      {buyerPath && (
        <div className="detail-card">
          <label className="field">
            New private buyer link
            <input value={buyerPath} readOnly />
          </label>
          <a className="text-link" href={buyerPath} target="_blank" rel="noreferrer">
            Open reviewed buyer page
          </a>
          <p>Keep this link private. It permits one response to this introduction.</p>
        </div>
      )}
      <h3>Introductions and replies</h3>
      <p>
        Latest 50 introductions. A receipt shows delivery through the selected demonstration
        channel, not a held meeting or commercial result.
      </p>
      {manage && (
        <button className="secondary-link" disabled={busy} onClick={() => void act('dispatch', {})}>
          Dispatch pending introductions
        </button>
      )}
      {comms.messages.map((m) => (
        <article className="detail-card introduction-card" key={m.id}>
          <h4>{m.presentation.company}</h4>
          <p>
            {m.channel}: {m.delivery_status}. Attempts: {m.attempts}. Buyer response:{' '}
            {m.decision ?? 'Awaiting response'}. {m.revoked ? 'Link revoked.' : ''}
          </p>
          <p>Link expires {new Date(m.expires_at).toLocaleString()}.</p>
          {manage && !m.revoked && (
            <form
              className="operator-form"
              aria-label={`Revoke introduction ${m.id}`}
              onSubmit={(e) =>
                submit(e, (f) => ({
                  action: 'revoke',
                  linkId: m.link_id,
                  reason: field(f, 'reason'),
                }))
              }
            >
              <label className="field">
                Link revocation reason
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="text-link" disabled={busy}>
                Revoke buyer link
              </button>
            </form>
          )}
          {manage && ['DEAD', 'SUPPRESSED'].includes(m.delivery_status) && (
            <form
              className="operator-form"
              aria-label={`Retry introduction ${m.id}`}
              onSubmit={(e) =>
                submit(e, (f) => ({ action: 'retry', messageId: m.id, reason: field(f, 'reason') }))
              }
            >
              <label className="field">
                Delivery retry reason
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="text-link" disabled={busy}>
                Requeue failed delivery
              </button>
            </form>
          )}
          <details>
            <summary>Delivery history</summary>
            <ul>
              {comms.attempts
                .filter((a) => a.message_id === m.id)
                .map((a) => (
                  <li key={a.id}>
                    {a.status}: {a.reason}
                  </li>
                ))}
            </ul>
          </details>
        </article>
      ))}
      <details>
        <summary>Recipient opt-outs</summary>
        <ul>
          {comms.optouts.map((o) => (
            <li key={o.id}>{o.reason}</li>
          ))}
        </ul>
        {manage && (
          <form
            className="operator-form"
            onSubmit={(e) =>
              submit(e, (f) => ({
                action: 'optout',
                contactId: field(f, 'contactId'),
                reason: field(f, 'reason'),
              }))
            }
          >
            <label className="field">
              Contact to stop contacting
              <select name="contactId" required>
                {comms.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Opt-out reason
              <input name="reason" required minLength={3} maxLength={500} />
            </label>
            <button className="text-link" disabled={busy}>
              Record recipient opt-out
            </button>
          </form>
        )}
      </details>
      {manage && (
        <form
          className="operator-form detail-card"
          aria-label="Propose meeting"
          onSubmit={(e) =>
            submit(
              e,
              (f) => ({
                action: 'propose',
                messageId: field(f, 'messageId'),
                title: field(f, 'title'),
                brief: field(f, 'brief'),
                participants: field(f, 'participants')
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
                ownerId: field(f, 'ownerId'),
                nextAction: field(f, 'nextAction'),
                dueAt: timestamp(f, 'dueAt'),
                reason: field(f, 'reason'),
              }),
              'meeting',
            )
          }
        >
          <h3>Propose a meeting</h3>
          <label className="field">
            Meeting introduction
            <select name="messageId" required>
              {comms.messages.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.presentation.company} ({m.decision ?? 'no response'})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Meeting title
            <input name="title" required minLength={3} maxLength={160} />
          </label>
          <label className="field">
            Meeting brief
            <textarea name="brief" required minLength={3} maxLength={2000} />
          </label>
          <label className="field">
            Meeting participants, one per line
            <textarea name="participants" required maxLength={1200} />
          </label>
          <Ownership owners={meetings.owners} />
          <button className="primary-link" disabled={busy}>
            Propose meeting
          </button>
        </form>
      )}
      <h3>Meeting itinerary</h3>
      <p>
        Times below show both the meeting timezone and your browser timezone. Briefs and outcomes
        stay private to authorized operators.
      </p>
      {meetings.meetings.map((m) => (
        <MeetingCard
          key={`${m.id}-${m.version}`}
          meeting={m}
          data={meetings}
          response={comms.messages.find((c) => c.id === m.message_id)}
          manage={manage}
          busy={busy}
          submit={submit}
        />
      ))}
      <h3>Owned follow-up</h3>
      {meetings.followups.map((f) => (
        <article key={f.id} className="detail-card">
          <h4>{f.next_action}</h4>
          <p>
            {f.status}. Owner:{' '}
            {meetings.owners.find((o) => o.user_id === f.owner_id)?.name ?? f.owner_id}. Due{' '}
            {new Date(f.due_at).toLocaleString()}.{' '}
            {f.status === 'OPEN' && new Date(f.due_at).getTime() < defaults.now ? 'Overdue.' : ''}
          </p>
          {manage && f.status === 'OPEN' && (
            <form
              className="operator-form"
              onSubmit={(e) =>
                submit(
                  e,
                  (form) => ({
                    action: 'followup',
                    id: f.id,
                    version: f.version,
                    status: field(form, 'status'),
                    reason: field(form, 'reason'),
                  }),
                  'meeting',
                )
              }
            >
              <label className="field">
                Follow-up result
                <select name="status">
                  <option>COMPLETED</option>
                  <option>CANCELLED</option>
                </select>
              </label>
              <label className="field">
                Follow-up result note
                <textarea name="reason" required minLength={3} maxLength={1000} />
              </label>
              <button className="secondary-link" disabled={busy}>
                Record follow-up result
              </button>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
function MeetingCard({
  meeting: m,
  data,
  response,
  manage,
  busy,
  submit,
}: {
  meeting: Meeting;
  data: Meetings;
  response?: Message;
  manage: boolean;
  busy: boolean;
  submit: (
    e: FormEvent<HTMLFormElement>,
    build: (f: FormData) => Record<string, unknown>,
    endpoint?: string,
  ) => void;
}) {
  const transitions = meetingTransitions[m.status],
    [status, setStatus] = useState<MeetingStatus>(transitions[0] ?? m.status);
  return (
    <article className="detail-card meeting-card">
      <h4>{m.title}</h4>
      <p>
        State: {m.status}. Version {m.version}.
      </p>
      <p>{m.brief}</p>
      <p>
        Participants:{' '}
        {data.participants
          .filter((p) => p.meeting_id === m.id)
          .map((p) => p.name)
          .join(', ')}
      </p>
      {m.starts_at && m.ends_at && m.timezone && (
        <p>
          {localWallTime(m.starts_at, m.timezone)} to {localWallTime(m.ends_at, m.timezone)} (
          {m.timezone}). Your time: {new Date(m.starts_at).toLocaleString()} to{' '}
          {new Date(m.ends_at).toLocaleString()}. Location: {m.location}.
        </p>
      )}
      {data.outcomes
        .filter((o) => o.meeting_id === m.id)
        .map((o) => (
          <p key={o.id}>
            Operator-observed {o.status}: {o.summary}
          </p>
        ))}
      {manage && transitions.length > 0 && (
        <form
          className="operator-form"
          aria-label={`Update meeting ${m.title}`}
          onSubmit={(e) =>
            submit(
              e,
              (f) => ({
                action: 'transition',
                id: m.id,
                version: m.version,
                status,
                reason: field(f, 'reason'),
                ownerId: field(f, 'ownerId'),
                nextAction: field(f, 'nextAction'),
                dueAt: timestamp(f, 'dueAt'),
                ...(status === 'ACCEPTED'
                  ? {
                      acceptance: field(f, 'acceptance'),
                      ...(f.get('useResponse') === 'on' && response?.response_id
                        ? { responseId: response.response_id }
                        : {}),
                    }
                  : {}),
                ...(status === 'SCHEDULED'
                  ? {
                      schedule: {
                        startsAt: field(f, 'startsAt'),
                        endsAt: field(f, 'endsAt'),
                        localStart: field(f, 'localStart'),
                        localEnd: field(f, 'localEnd'),
                        timezone: field(f, 'timezone'),
                        location: field(f, 'location'),
                      },
                    }
                  : {}),
                ...(['HELD', 'NO_SHOW'].includes(status) ? { outcome: field(f, 'outcome') } : {}),
              }),
              'meeting',
            )
          }
        >
          <label className="field">
            Next meeting state
            <select value={status} onChange={(e) => setStatus(e.target.value as MeetingStatus)}>
              {transitions.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <Ownership owners={data.owners} meeting={m} />
          {status === 'ACCEPTED' && (
            <>
              <label className="field">
                Acceptance source
                <textarea
                  name="acceptance"
                  required
                  minLength={3}
                  maxLength={1000}
                  defaultValue={
                    response?.decision === 'INTERESTED'
                      ? 'Buyer selected Interested on this private introduction.'
                      : ''
                  }
                />
              </label>
              {response?.decision === 'INTERESTED' && (
                <label className="check-field">
                  <input type="checkbox" name="useResponse" defaultChecked />
                  Attribute acceptance to this buyer response
                </label>
              )}
            </>
          )}
          {status === 'SCHEDULED' && (
            <>
              <p>
                Enter local wall times and absolute timestamps with explicit offsets. They must
                agree with the selected timezone. For repeated daylight-saving times, the offset
                selects the intended occurrence.
              </p>
              <label className="field">
                Meeting timezone
                <input name="timezone" required defaultValue={m.timezone ?? 'Europe/Madrid'} />
              </label>
              <label className="field">
                Local meeting start
                <input
                  name="localStart"
                  type="datetime-local"
                  required
                  defaultValue={m.local_start ?? ''}
                />
              </label>
              <label className="field">
                Local meeting end
                <input
                  name="localEnd"
                  type="datetime-local"
                  required
                  defaultValue={m.local_end ?? ''}
                />
              </label>
              <label className="field">
                Meeting start with UTC offset
                <input
                  name="startsAt"
                  required
                  placeholder="2026-11-01T10:00:00+01:00"
                  defaultValue={m.starts_at ?? ''}
                />
              </label>
              <label className="field">
                Meeting end with UTC offset
                <input
                  name="endsAt"
                  required
                  placeholder="2026-11-01T10:30:00+01:00"
                  defaultValue={m.ends_at ?? ''}
                />
              </label>
              <label className="field">
                Meeting location
                <input
                  name="location"
                  required
                  minLength={3}
                  maxLength={500}
                  defaultValue={m.location ?? ''}
                />
              </label>
            </>
          )}
          {['HELD', 'NO_SHOW'].includes(status) && (
            <label className="field">
              Observed meeting outcome
              <textarea name="outcome" required minLength={3} maxLength={2000} />
            </label>
          )}
          <button className="primary-link" disabled={busy}>
            Record meeting change
          </button>
        </form>
      )}
      <details>
        <summary>Meeting history</summary>
        <ul>
          {data.history
            .filter((h) => h.meeting_id === m.id)
            .map((h) => (
              <li key={h.id}>
                {h.action}: {h.details.command.reason}
                {h.details.previous?.startsAt
                  ? ` Previous schedule: ${h.details.previous.startsAt} (${h.details.previous.timezone}).`
                  : ''}
              </li>
            ))}
        </ul>
      </details>
    </article>
  );
}
