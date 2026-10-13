'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  currencies,
  formatMoney,
  parseMoney,
  opportunityTransitions,
  type OpportunityStatus,
} from '@corridra/domain/opportunities';
type Owner = { user_id: string; name: string };
type Opportunity = {
  id: string;
  meeting_id: string | null;
  origin_id: string | null;
  mission_id: string;
  title: string;
  status: OpportunityStatus;
  version: number;
  owner_id: string;
  next_action: string;
  due_at: string;
  attribution: string;
  loss_reason: string | null;
};
type CommercialRecord = {
  id: string;
  opportunity_id: string;
  kind: string;
  parent_id: string | null;
  prior_receipt_id: string | null;
  reverse_of: string | null;
  source_id: string;
  evidence_id: string | null;
  occurred_at: string;
  summary: string;
  external_reference: string;
  amount_minor: string | null;
  currency: keyof typeof currencies | null;
};
type Confirmation = {
  id: string;
  record_id: string;
  basis: string;
  occurred_at: string;
  created_by: string;
};
type Source = { id: string; kind: string; locator: string };
type Data = {
  role: string;
  freshMfa: boolean;
  enabled: boolean;
  opportunities: Opportunity[];
  total: number;
  records: CommercialRecord[];
  recordsTruncated: boolean;
  recordCounts: { opportunity_id: string; n: number }[];
  confirmations: Confirmation[];
  owners: Owner[];
  meetings: { id: string; title: string; mission_id: string }[];
  origins: { id: string; mission_id: string; kind: string; summary: string }[];
  missions: { id: string; label: string }[];
  sources: Source[];
  evidence: { id: string; source_id: string; status: string; scan_status: string }[];
  history: {
    id: string;
    opportunity_id: string;
    action: string;
    reason: string;
    created_at: string;
  }[];
  metrics: Record<string, number>;
  activity: Record<string, number>;
  totals: {
    currency: keyof typeof currencies;
    proposal_minor: string;
    commitment_minor: string;
    contract_minor: string;
    invoice_minor: string;
    reported_cash_minor: string;
    confirmed_cash_minor: string;
    repeat_cash_minor: string;
  }[];
  overdue: { id: string; title: string; owner_id: string; next_action: string; due_at: string }[];
  meetingFollowups: { id: string; owner_id: string; next_action: string; due_at: string }[];
};
const fieldDate = (v: string) => new Date(v).toISOString().slice(0, 16);
const fromField = (v: FormDataEntryValue | null) => {
  const d = new Date(String(v) + 'Z');
  if (Number.isNaN(d.getTime())) throw new Error('Enter a valid UTC date');
  return d.toISOString();
};
function Ownership({
  owners,
  opportunity,
  defaultDue,
}: {
  owners: Owner[];
  opportunity?: Opportunity;
  defaultDue: string;
}) {
  return (
    <>
      <label className="field">
        Commercial owner
        <select name="ownerId" required defaultValue={opportunity?.owner_id}>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Commercial next action
        <input
          name="nextAction"
          required
          minLength={3}
          maxLength={300}
          defaultValue={opportunity?.next_action}
        />
      </label>
      <label className="field">
        Commercial deadline (UTC)
        <input
          type="datetime-local"
          name="dueAt"
          required
          defaultValue={opportunity ? fieldDate(opportunity.due_at) : defaultDue}
        />
      </label>
    </>
  );
}
function Observation({ sources, defaultDate }: { sources: Source[]; defaultDate: string }) {
  return (
    <>
      <label className="field">
        Observation source
        <select name="sourceId" required>
          <option value="">Choose a source</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.locator} ({s.kind})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Observed date (UTC)
        <input type="datetime-local" name="occurredAt" required defaultValue={defaultDate} />
      </label>
    </>
  );
}
function Reason() {
  return (
    <label className="field">
      Commercial command reason
      <textarea name="reason" required minLength={3} maxLength={500} />
    </label>
  );
}
function RecordForm({
  data,
  o,
  busy,
  defaultDate,
  submit,
}: {
  data: Data;
  o: Opportunity;
  busy: boolean;
  defaultDate: string;
  submit: (e: FormEvent<HTMLFormElement>, body: (f: FormData) => Record<string, unknown>) => void;
}) {
  const [kind, setKind] = useState('RFQ'),
    [code, setCode] = useState<keyof typeof currencies>('EUR'),
    [source, setSource] = useState('');
  const parentKind = (
    {
      COMMITMENT: 'PROPOSAL',
      CONTRACT: 'COMMITMENT',
      INVOICE: 'CONTRACT',
      CASH_RECEIPT: 'INVOICE',
      REPEAT_ORDER: 'CASH_RECEIPT',
    } as Record<string, string>
  )[kind];
  const valid = data.records.filter(
    (r) =>
      r.opportunity_id === o.id &&
      !r.reverse_of &&
      !data.records.some((rv) => rv.reverse_of === r.id),
  );
  const financial = ['PROPOSAL', 'COMMITMENT', 'CONTRACT', 'INVOICE', 'CASH_RECEIPT'].includes(
    kind,
  );
  return (
    <form
      aria-label={`Record commercial evidence for ${o.title}`}
      className="operator-form"
      onSubmit={(e) =>
        submit(e, (f) => ({
          action: 'record',
          id: o.id,
          kind,
          sourceId: f.get('sourceId'),
          ...(f.get('evidenceId') ? { evidenceId: f.get('evidenceId') } : {}),
          occurredAt: fromField(f.get('occurredAt')),
          summary: f.get('summary'),
          externalReference: f.get('externalReference'),
          ...(parentKind ? { parentId: f.get('parentId') } : {}),
          ...(kind === 'REPEAT_ORDER' ? { priorReceiptId: f.get('priorReceiptId') } : {}),
          ...(financial
            ? { currency: code, amountMinor: parseMoney(String(f.get('amount')), code) }
            : {}),
        }))
      }
    >
      <label className="field">
        Commercial record type
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {[
            'RFQ',
            'SAMPLE',
            'PROPOSAL',
            'COMMITMENT',
            'CONTRACT',
            'INVOICE',
            'CASH_RECEIPT',
            'REPEAT_ORDER',
          ].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      {parentKind && (
        <label className="field">
          Related commercial record
          <select
            key={kind}
            name="parentId"
            required
            onChange={(e) => {
              const p = valid.find((r) => r.id === e.target.value);
              if (p?.currency) setCode(p.currency);
            }}
          >
            <option value="">Choose the {parentKind.toLowerCase().replaceAll('_', ' ')}</option>
            {valid
              .filter((r) => r.kind === parentKind)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.external_reference}
                  {r.amount_minor && r.currency
                    ? ' · ' + formatMoney(r.amount_minor, r.currency)
                    : ''}
                </option>
              ))}
          </select>
        </label>
      )}
      {kind === 'REPEAT_ORDER' && (
        <label className="field">
          Earlier confirmed receipt
          <select name="priorReceiptId" required>
            <option value="">Choose the earlier receipt</option>
            {valid
              .filter(
                (r) =>
                  r.kind === 'CASH_RECEIPT' && data.confirmations.some((a) => a.record_id === r.id),
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.external_reference}
                </option>
              ))}
          </select>
        </label>
      )}
      {financial && (
        <>
          <label className="field">
            Commercial currency
            <select
              value={code}
              onChange={(e) => setCode(e.target.value as keyof typeof currencies)}
            >
              {Object.keys(currencies).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Commercial amount
            <input
              name="amount"
              required
              inputMode="decimal"
              maxLength={22}
              placeholder={currencies[code] ? '120.00' : '120'}
            />
          </label>
          <p>
            {code} uses {currencies[code]} decimal places. Parent and document currencies must
            match.
          </p>
        </>
      )}
      <label className="field">
        Observation source
        <select name="sourceId" required value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Choose a source</option>
          {data.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.locator} ({s.kind})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Supporting file (optional)
        <select key={source} name="evidenceId">
          <option value="">Source observation only</option>
          {data.evidence
            .filter((e) => e.source_id === source)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.status} · {e.scan_status === 'BYPASSED' ? 'Not scanned' : e.scan_status} · {e.id}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        Observed date (UTC)
        <input type="datetime-local" name="occurredAt" required defaultValue={defaultDate} />
      </label>
      <label className="field">
        Commercial observation
        <textarea name="summary" required minLength={3} maxLength={1000} />
      </label>
      <label className="field">
        Commercial external reference
        <input name="externalReference" required minLength={3} maxLength={200} />
      </label>
      <p>
        Use a distinct reference including the issuer or payment account. A reference does not
        confirm payment.
      </p>
      <Reason />
      <button className="primary-link" disabled={busy}>
        Record commercial evidence
      </button>
    </form>
  );
}
export function CommercialProgress({ tenant, revision }: { tenant: string; revision: number }) {
  const [data, setData] = useState<Data | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [mission, setMission] = useState(''),
    [offset, setOffset] = useState(0);
  const keys = useRef(new Map<string, string>());
  const [defaults] = useState(() => ({
    observed: fieldDate(new Date().toISOString()),
    due: fieldDate(new Date(Date.now() + 86400000).toISOString()),
  }));
  const url = `/api/workspace/opportunities?tenant=${encodeURIComponent(tenant)}&offset=${offset}${mission ? '&mission=' + encodeURIComponent(mission) : ''}`;
  async function refresh() {
    const r = await fetch(url, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }
  useEffect(() => {
    let active = true;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) {
          setData(d);
          setMessage('');
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [url, revision]);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    const serialized = JSON.stringify(body);
    let commandId = keys.current.get(serialized);
    if (!commandId) {
      commandId = crypto.randomUUID();
      keys.current.set(serialized, commandId);
    }
    try {
      const r = await fetch(`/api/workspace/opportunity?tenant=${encodeURIComponent(tenant)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, commandId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await refresh();
      keys.current.delete(serialized);
      setMessage('Commercial progress saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save commercial progress');
    } finally {
      setBusy(false);
    }
  }
  async function moreRecords(id: string) {
    if (!data) return;
    setBusy(true);
    setMessage('');
    try {
      const offset = data.records.filter((r) => r.opportunity_id === id).length;
      const r = await fetch(
        `/api/workspace/commercial-records?tenant=${encodeURIComponent(tenant)}&id=${id}&offset=${offset}`,
        { cache: 'no-store' },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData((current) =>
        current
          ? {
              ...current,
              records: [
                ...current.records,
                ...d.records.filter(
                  (r: CommercialRecord) => !current.records.some((old) => old.id === r.id),
                ),
              ],
              confirmations: [
                ...current.confirmations,
                ...d.confirmations.filter(
                  (a: Confirmation) => !current.confirmations.some((old) => old.id === a.id),
                ),
              ],
            }
          : current,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to load evidence');
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>, body: (f: FormData) => Record<string, unknown>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      void act({ ...body(f), reason: f.get('reason') });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Check the submitted values');
    }
  }
  const own = (f: FormData) => ({
    ownerId: f.get('ownerId'),
    nextAction: f.get('nextAction'),
    dueAt: fromField(f.get('dueAt')),
  });
  if (!data)
    return (
      <section className="operator-section">
        <h2>Commercial progress</h2>
        <p role="status" aria-label="Commercial status">
          {message || 'Loading commercial progress…'}
        </p>
      </section>
    );
  const manage = ['owner', 'admin', 'operator'].includes(data.role) && data.enabled,
    accounting = ['owner', 'admin'].includes(data.role) && data.enabled && data.freshMfa;
  const name = (id: string) =>
    data.owners.find((o) => o.user_id === id)?.name ?? 'Owner no longer active';
  return (
    <section className="operator-section" aria-label="Commercial progress">
      <h2>Commercial progress</h2>
      <p>
        Connect held meetings to commercial evidence. Use invented records while customer controls
        are completed.
      </p>
      <p role="status" aria-live="polite" aria-label="Commercial status">
        {message}
      </p>
      <div className="hero-actions">
        <label className="field">
          Commercial report mission
          <select
            disabled={busy}
            value={mission}
            onChange={(e) => {
              setMission(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All accessible missions</option>
            {data.missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            refresh()
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Refresh commercial progress
        </button>
      </div>
      <h3>Mission yield</h3>
      <p>
        Scope: {mission ? 'Selected mission' : 'All accessible missions'}. Attribution is
        association with a mission, not proof of causation. Counts show historical stages attained;
        amounts reflect recorded corrections. Only records you may access are included.
      </p>
      <div className="detail-grid">
        <div className="detail-card">
          <h4>Activity and access</h4>
          <p>
            {data.activity.targets} targets researched · {data.activity.introductions} introductions
          </p>
          <p>
            {data.activity.held_meetings}/{data.activity.accepted_meetings} accepted meetings held
          </p>
          <p>
            {data.activity.rfqs} RFQs · {data.activity.samples} sample records
          </p>
        </div>
        <div className="detail-card">
          <h4>Commercial progression</h4>
          <p>
            {data.metrics.qualified}/{data.metrics.opportunities} opportunities qualified
          </p>
          <p>
            {data.metrics.proposals}/{data.metrics.qualified} qualified opportunities reached
            proposal
          </p>
          <p>
            {data.metrics.contracts}/{data.metrics.proposals} proposal opportunities reached
            contract
          </p>
          <p>
            {data.metrics.cash}/{data.metrics.contracts} contract opportunities reached confirmed
            cash
          </p>
          <p>
            {data.metrics.recurrence}/{data.metrics.cash} cash opportunities reached recurrence ·{' '}
            {data.metrics.lost} lost
          </p>
        </div>
      </div>
      {data.totals.length === 0 ? (
        <p>No commercial amounts recorded.</p>
      ) : (
        data.totals.map((t) => (
          <div
            className="detail-card"
            key={t.currency}
            aria-label={`${t.currency} commercial totals`}
          >
            <h4>{t.currency} amounts</h4>
            <p>
              Proposals: {formatMoney(t.proposal_minor, t.currency)} · Commitments:{' '}
              {formatMoney(t.commitment_minor, t.currency)}
            </p>
            <p>
              Recorded contracts: {formatMoney(t.contract_minor, t.currency)} · Invoiced:{' '}
              {formatMoney(t.invoice_minor, t.currency)}
            </p>
            <p>Reported receipts: {formatMoney(t.reported_cash_minor, t.currency)}</p>
            <p>Confirmed cash: {formatMoney(t.confirmed_cash_minor, t.currency)}</p>
            <p>Repeat cash within confirmed cash: {formatMoney(t.repeat_cash_minor, t.currency)}</p>
          </div>
        ))
      )}
      <p>
        Currencies are shown separately. Repeat cash is already included in confirmed cash. Recorded
        contract and invoice evidence is distinct from independent verification.
      </p>
      <h3>Overdue follow-up</h3>
      {!data.overdue.length && !data.meetingFollowups.length ? (
        <p>No overdue commercial or meeting follow-up in this scope.</p>
      ) : (
        <ul>
          {[...data.overdue, ...data.meetingFollowups].map((f, i) => (
            <li key={`${i}-${f.id}`}>
              {f.next_action} · {name(f.owner_id)} · due{' '}
              {new Date(f.due_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
            </li>
          ))}
        </ul>
      )}
      {!data.enabled && (
        <p>
          Commercial commands are disabled. A workspace owner can enable opportunities.commands in
          feature controls after release acceptance.
        </p>
      )}
      {['owner', 'admin'].includes(data.role) && data.enabled && !data.freshMfa && (
        <p>
          <a href="/operator/signin">Sign in and verify your authenticator again</a> before
          confirming cash, correcting money or rebuilding reports.
        </p>
      )}
      {manage && (
        <details>
          <summary>Create an opportunity from a sourcing observation</summary>
          <form
            className="operator-form"
            aria-label="Create sourcing opportunity"
            onSubmit={(e) =>
              submit(e, (f) => ({
                action: 'createFromOrigin',
                originId: f.get('originId'),
                title: f.get('title'),
                attribution: f.get('attribution'),
                ...own(f),
              }))
            }
          >
            <label className="field">
              Opportunity origin observation
              <select name="originId" required>
                <option value="">Choose a documented observation</option>
                {data.origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.kind.replaceAll('_', ' ')}: {o.summary}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Sourcing opportunity title
              <input name="title" required minLength={3} maxLength={160} />
            </label>
            <label className="field">
              Sourcing attribution and limits
              <textarea name="attribution" required minLength={3} maxLength={1000} />
            </label>
            <Ownership owners={data.owners} defaultDue={defaults.due} />
            <Reason />
            <button className="primary-link" disabled={busy}>
              Create sourcing opportunity
            </button>
          </form>
        </details>
      )}
      {manage && (
        <details>
          <summary>Create an opportunity from a held meeting</summary>
          <form
            className="operator-form"
            aria-label="Create commercial opportunity"
            onSubmit={(e) =>
              submit(e, (f) => ({
                action: 'create',
                meetingId: f.get('meetingId'),
                title: f.get('title'),
                attribution: f.get('attribution'),
                ...own(f),
              }))
            }
          >
            <label className="field">
              Opportunity origin meeting
              <select name="meetingId" required>
                <option value="">Choose a held meeting</option>
                {data.meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Opportunity title
              <input name="title" required minLength={3} maxLength={160} />
            </label>
            <label className="field">
              Mission attribution and limits
              <textarea name="attribution" required minLength={3} maxLength={1000} />
            </label>
            <Ownership owners={data.owners} defaultDue={defaults.due} />
            <Reason />
            <button className="primary-link" disabled={busy}>
              Create commercial opportunity
            </button>
          </form>
        </details>
      )}
      <p>
        {data.opportunities.length} of {data.total} accessible opportunities shown. At most 500
        records are shown on this page.
      </p>
      {data.recordsTruncated && (
        <p>Commercial record display is truncated. Report totals include all accessible records.</p>
      )}
      <div className="hero-actions">
        <button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
          Previous opportunities
        </button>
        <button disabled={busy || offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>
          Next opportunities
        </button>
      </div>
      {data.opportunities.map((o) => {
        const records = data.records.filter((r) => r.opportunity_id === o.id);
        return (
          <article className="detail-card opportunity-card" key={o.id} aria-label={o.title}>
            <h3>{o.title}</h3>
            <p>
              Opportunity state: {o.status} · version {o.version}
            </p>
            <p>{o.attribution}</p>
            <p>
              Next: {o.next_action} · {name(o.owner_id)} · due{' '}
              {new Date(o.due_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
            </p>
            {o.loss_reason && <p>Loss reason: {o.loss_reason}</p>}
            {manage && o.status !== 'LOST' && (
              <>
                <details>
                  <summary>Change opportunity or follow-up</summary>
                  <form
                    key={o.version}
                    className="operator-form"
                    aria-label={`Change opportunity ${o.title}`}
                    onSubmit={(e) =>
                      submit(e, (f) => ({
                        action: f.get('status') === 'followup' ? 'followup' : 'transition',
                        id: o.id,
                        version: o.version,
                        ...own(f),
                        ...(f.get('status') !== 'followup' ? { status: f.get('status') } : {}),
                        ...(f.get('status') === 'LOST' ? { lossReason: f.get('lossReason') } : {}),
                      }))
                    }
                  >
                    <label className="field">
                      Next opportunity action
                      <select name="status">
                        <option value="followup">Update owner and follow-up</option>
                        {opportunityTransitions[o.status].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Opportunity loss reason
                      <textarea name="lossReason" minLength={3} maxLength={500} />
                    </label>
                    <Ownership owners={data.owners} opportunity={o} defaultDue={defaults.due} />
                    <Reason />
                    <button className="primary-link" disabled={busy}>
                      Save opportunity change
                    </button>
                  </form>
                </details>
                <details>
                  <summary>Record RFQ, sample or commercial evidence</summary>
                  <RecordForm
                    data={data}
                    o={o}
                    busy={busy}
                    defaultDate={defaults.observed}
                    submit={submit}
                  />
                </details>
              </>
            )}
            <h4>Evidence and accounting history</h4>
            <p>
              {records.length} of {data.recordCounts.find((c) => c.opportunity_id === o.id)?.n ?? 0}{' '}
              commercial records shown.
            </p>
            {records.length <
              (data.recordCounts.find((c) => c.opportunity_id === o.id)?.n ?? 0) && (
              <button disabled={busy} onClick={() => void moreRecords(o.id)}>
                Load more evidence for {o.title}
              </button>
            )}
            {records.length === 0 ? (
              <p>No commercial evidence recorded.</p>
            ) : (
              records.map((r) => {
                const a = data.confirmations.find((a) => a.record_id === r.id),
                  reversed = records.some((rv) => rv.reverse_of === r.id);
                return (
                  <div
                    className="evidence-row commercial-record"
                    key={r.id}
                    aria-label={r.external_reference}
                  >
                    <div>
                      <strong>
                        {r.kind} · {r.external_reference}
                      </strong>
                      <p>{r.summary}</p>
                      <p>
                        {r.amount_minor && r.currency
                          ? formatMoney(r.amount_minor, r.currency)
                          : 'No monetary amount'}{' '}
                        · observed{' '}
                        {new Date(r.occurred_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
                      </p>
                      <p>
                        {r.reverse_of
                          ? 'Compensating record'
                          : reversed
                            ? 'Compensation recorded'
                            : 'Original record'}{' '}
                        · Source{' '}
                        {data.sources.find((s) => s.id === r.source_id)?.locator ?? r.source_id} ·{' '}
                        {r.evidence_id
                          ? 'Supporting file recorded'
                          : 'Source observation; no supporting file'}
                      </p>
                      {r.kind === 'CASH_RECEIPT' && (
                        <p>
                          {a
                            ? 'Accounting confirmed: ' + a.basis
                            : 'Reported receipt; accounting confirmation pending'}
                        </p>
                      )}
                      {accounting &&
                        r.kind === 'CASH_RECEIPT' &&
                        !a &&
                        (!reversed || r.reverse_of) && (
                          <details>
                            <summary>Confirm this cash observation</summary>
                            <form
                              className="operator-form"
                              aria-label={`Confirm cash ${r.external_reference}`}
                              onSubmit={(e) =>
                                submit(e, (f) => ({
                                  action: 'confirm',
                                  recordId: r.id,
                                  sourceId: f.get('sourceId'),
                                  occurredAt: fromField(f.get('occurredAt')),
                                  basis: f.get('basis'),
                                }))
                              }
                            >
                              <Observation
                                sources={data.sources.filter((s) => s.kind !== 'self_declaration')}
                                defaultDate={defaults.observed}
                              />
                              <label className="field">
                                Accounting confirmation basis
                                <textarea name="basis" required minLength={3} maxLength={1000} />
                              </label>
                              <Reason />
                              <button className="primary-link" disabled={busy}>
                                Confirm observed cash
                              </button>
                            </form>
                          </details>
                        )}
                      {accounting && r.amount_minor && !r.reverse_of && !reversed && (
                        <details>
                          <summary>Correct this amount with full compensation</summary>
                          <form
                            className="operator-form"
                            aria-label={`Compensate ${r.external_reference}`}
                            onSubmit={(e) =>
                              submit(e, (f) => ({
                                action: 'reverse',
                                recordId: r.id,
                                sourceId: f.get('sourceId'),
                                occurredAt: fromField(f.get('occurredAt')),
                              }))
                            }
                          >
                            <p>
                              This records{' '}
                              {formatMoney((-BigInt(r.amount_minor)).toString(), r.currency!)} and
                              preserves the original. Cash compensation requires separate accounting
                              confirmation before changing confirmed totals.
                            </p>
                            <Observation sources={data.sources} defaultDate={defaults.observed} />
                            <Reason />
                            <button className="primary-link" disabled={busy}>
                              Record full compensation
                            </button>
                          </form>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <details>
              <summary>Commercial command history</summary>
              <ul>
                {data.history
                  .filter((h) => h.opportunity_id === o.id)
                  .map((h) => (
                    <li key={h.id}>
                      {h.action} · {h.reason} ·{' '}
                      {new Date(h.created_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
                    </li>
                  ))}
              </ul>
            </details>
          </article>
        );
      })}
      {accounting && (
        <details>
          <summary>Rebuild commercial reports from retained events</summary>
          <form
            className="operator-form"
            aria-label="Rebuild commercial projections"
            onSubmit={(e) => submit(e, () => ({ action: 'rebuild' }))}
          >
            <p>
              Replays retained commercial outcomes for this workspace. Records and financial history
              stay intact.
            </p>
            <Reason />
            <button className="primary-link" disabled={busy}>
              Rebuild commercial reports
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
