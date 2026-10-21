'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { currencies, formatMoney, parseMoney } from '@corridra/domain/opportunities';

type Code = keyof typeof currencies;
type Kind =
  | 'PARTICIPANT_FEE'
  | 'PARTICIPANT_PAYMENT'
  | 'ORGANISER_EXPENSE'
  | 'ORGANISER_OBLIGATION'
  | 'CORRIDRA_SERVICE_FEE';
type Entry = {
  id: string;
  seq: number;
  kind: Kind;
  costBasis: 'PLANNED' | 'ACTUAL' | null;
  registrationLabel: string | null;
  amountMinor: string;
  currency: Code;
  occurredOn: string;
  description: string;
  reverseOf: string | null;
  reversedBy: string | null;
};
type Costs = { expenses: string; obligations: string; corridraServiceFees: string; total: string };
type Summary = {
  currencies: {
    currency: Code;
    feesDue: string;
    paymentsRecorded: string;
    outstanding: string;
    plannedCosts: Costs;
    actualCosts: Costs;
    marginIfPlanned: string;
    marginOnActual: string;
    cashMargin: string;
  }[];
  participants: {
    registrationId: string;
    label: string;
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
    amounts: {
      currency: Code;
      due: string;
      recorded: string;
      status: 'NO_FEE' | 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';
    }[];
  }[];
  counts: { registered: number; active: number; withdrawnOrRemoved: number };
};
type Props = { subject: string; issuer: string; workspaceId: string; programmeId: string };

export const kindLabels: Record<Kind, string> = {
  PARTICIPANT_FEE: 'Fee due from a participant',
  PARTICIPANT_PAYMENT: 'Payment you recorded from a participant',
  ORGANISER_EXPENSE: 'Your expense',
  ORGANISER_OBLIGATION: 'Amount you owe (for example a supplier or contributor)',
  CORRIDRA_SERVICE_FEE: 'Corridra service fee you owe under your own agreement',
};
const statusLabels = {
  NO_FEE: 'No fee recorded',
  UNPAID: 'Unpaid',
  PART_PAID: 'Part paid',
  PAID: 'Paid',
  OVERPAID: 'Paid more than due',
};
const kinds = Object.keys(kindLabels) as Kind[];
const costKinds: Kind[] = ['ORGANISER_EXPENSE', 'ORGANISER_OBLIGATION', 'CORRIDRA_SERVICE_FEE'];
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const signed = (v: unknown): v is string => typeof v === 'string' && /^-?[0-9]{1,24}$/.test(v);
const code = (v: unknown): v is Code => typeof v === 'string' && v in currencies;
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const day = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function costs(v: unknown): v is Costs {
  return object(v) && [v.expenses, v.obligations, v.corridraServiceFees, v.total].every(signed);
}
function parseSummary(value: unknown, p: Props): Summary {
  if (
    !object(value) ||
    value.workspaceId !== p.workspaceId ||
    value.programmeId !== p.programmeId ||
    value.collectsPayments !== false ||
    value.verified !== false ||
    !Array.isArray(value.currencies) ||
    !Array.isArray(value.participants) ||
    value.currencies.length > 50 ||
    value.participants.length > 5000 ||
    !object(value.counts)
  )
    throw Error('Invalid summary');
  const seen = new Set<string>();
  const cur = value.currencies.map((c) => {
    if (
      !object(c) ||
      !code(c.currency) ||
      seen.has(c.currency) ||
      ![
        c.feesDue,
        c.paymentsRecorded,
        c.outstanding,
        c.marginIfPlanned,
        c.marginOnActual,
        c.cashMargin,
      ].every(signed) ||
      !costs(c.plannedCosts) ||
      !costs(c.actualCosts)
    )
      throw Error('Invalid currency totals');
    seen.add(c.currency);
    return c as unknown as Summary['currencies'][number];
  });
  const people = value.participants.map((r) => {
    if (
      !object(r) ||
      !uuid(r.registrationId) ||
      !text(r.label, 200) ||
      !['ACTIVE', 'WITHDRAWN', 'REMOVED'].includes(String(r.state)) ||
      !Array.isArray(r.amounts)
    )
      throw Error('Invalid participant');
    for (const a of r.amounts)
      if (
        !object(a) ||
        !code(a.currency) ||
        !signed(a.due) ||
        !signed(a.recorded) ||
        !(String(a.status) in statusLabels)
      )
        throw Error('Invalid participant amount');
    return r as unknown as Summary['participants'][number];
  });
  const n = value.counts;
  if (![n.registered, n.active, n.withdrawnOrRemoved].every((x) => Number.isInteger(x)))
    throw Error('Invalid counts');
  return { currencies: cur, participants: people, counts: n as Summary['counts'] };
}
function parseEntry(e: unknown): Entry {
  if (
    !object(e) ||
    !uuid(e.id) ||
    !Number.isInteger(e.seq) ||
    !kinds.includes(e.kind as Kind) ||
    !(e.costBasis === null || e.costBasis === 'PLANNED' || e.costBasis === 'ACTUAL') ||
    !(e.registrationLabel === null || text(e.registrationLabel, 200)) ||
    !signed(e.amountMinor) ||
    !code(e.currency) ||
    !day(e.occurredOn) ||
    !text(e.description, 300) ||
    !(e.reverseOf === null || uuid(e.reverseOf)) ||
    !(e.reversedBy === null || uuid(e.reversedBy))
  )
    throw Error('Invalid entry');
  return e as unknown as Entry;
}
function parseList(value: unknown, p: Props) {
  if (
    !object(value) ||
    value.workspaceId !== p.workspaceId ||
    value.programmeId !== p.programmeId ||
    !Array.isArray(value.entries) ||
    value.entries.length > 100 ||
    !(value.nextBefore === null || Number.isInteger(value.nextBefore)) ||
    typeof value.expiresAt !== 'string'
  )
    throw Error('Invalid entries');
  return {
    entries: value.entries.map(parseEntry),
    nextBefore: value.nextBefore as number | null,
    expiresAt: Date.parse(value.expiresAt),
  };
}

export function ProgrammeEconomics(props: Props) {
  return (
    <ScopedEconomics
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function ScopedEconomics(props: Props) {
  const { subject, issuer, workspaceId, programmeId } = props;
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied' | 'unavailable'>(
    'loading',
  );
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [kind, setKind] = useState<Kind>('PARTICIPANT_FEE');
  const [registrationId, setRegistrationId] = useState('');
  const [costBasis, setCostBasis] = useState<'PLANNED' | 'ACTUAL'>('PLANNED');
  const [currency, setCurrency] = useState<Code>('BDT');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(today());
  const [description, setDescription] = useState('Synthetic ');
  const [confirm, setConfirm] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [fixDate, setFixDate] = useState(today());
  const [fixText, setFixText] = useState('Synthetic correction of an entry');
  const [fixConfirm, setFixConfirm] = useState(false);
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const headers = useCallback(
    () => ({ 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer }),
    [subject, issuer],
  );
  const scopeQuery = 'workspaceId=' + workspaceId + '&programmeId=' + programmeId;

  const clear = useCallback(() => {
    setSummary(null);
    setEntries([]);
    setNextBefore(null);
    setAmount('');
    setDescription('Synthetic ');
    setConfirm(false);
    setCorrecting(null);
    setFixConfirm(false);
    intent.current = null;
  }, []);
  const lose = useCallback(
    (to: 'denied' | 'failed' | 'unavailable', message: string) => {
      if (timer.current) clearTimeout(timer.current);
      clear();
      setStatus(to);
      setNotice(message);
    },
    [clear],
  );
  const load = useCallback(
    async (keepNotice = false) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      if (!keepNotice) setNotice('');
      try {
        const options = {
          cache: 'no-store' as const,
          credentials: 'same-origin' as const,
          headers: headers(),
          signal: controller.signal,
        };
        const [s, l] = await Promise.all([
          fetch('/api/customer-programme-economics?view=summary&' + scopeQuery, options),
          fetch(
            '/api/customer-programme-economics?view=entries&pageSize=25&' + scopeQuery,
            options,
          ),
        ]);
        if (controller.signal.aborted || !active.current) return;
        if ([s, l].some((r) => [401, 403, 409].includes(r.status)))
          return lose(
            'denied',
            'Account or programme access changed. Private details were cleared.',
          );
        if ([s, l].some((r) => r.status === 503))
          return lose('unavailable', 'Sample delegation finances are unavailable.');
        if (!s.ok || !l.ok) throw Error('read failed');
        const scope = { subject, issuer, workspaceId, programmeId };
        const parsedSummary = parseSummary(await s.json(), scope);
        const list = parseList(await l.json(), scope);
        if (controller.signal.aborted || !active.current) return;
        setSummary(parsedSummary);
        setEntries(list.entries);
        setNextBefore(list.nextBefore);
        setCurrency((c) => (parsedSummary.currencies[0]?.currency ?? c) as Code);
        if (timer.current) clearTimeout(timer.current);
        const wait = list.expiresAt - Date.now();
        if (!(wait > 0))
          return lose('failed', 'This private view expired. Reload to check access again.');
        timer.current = setTimeout(
          () => lose('failed', 'This private view expired. Reload to check access again.'),
          wait,
        );
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted && active.current)
          lose('failed', 'Finances could not be loaded. Reload to check access and try again.');
      }
    },
    [headers, lose, scopeQuery, subject, issuer, workspaceId, programmeId],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
      task.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (busy || amount || description.trim() !== 'Synthetic') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [busy, amount, description]);

  async function older() {
    if (nextBefore === null || busy) return;
    setBusy(true);
    try {
      const r = await fetch(
        '/api/customer-programme-economics?view=entries&pageSize=25&beforeSeq=' +
          nextBefore +
          '&' +
          scopeQuery,
        { cache: 'no-store', credentials: 'same-origin', headers: headers() },
      );
      if ([401, 403, 409].includes(r.status))
        return lose('denied', 'Account or programme access changed. Private details were cleared.');
      if (!r.ok) throw Error('read failed');
      const list = parseList(await r.json(), props);
      setEntries((old) => [...old, ...list.entries.filter((e) => !old.some((o) => o.id === e.id))]);
      setNextBefore(list.nextBefore);
    } catch {
      setError('Older entries could not be loaded. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function post(entry: Record<string, unknown>, done: () => void) {
    if (writing.current) return;
    const signature = JSON.stringify(entry);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/customer-programme-economics', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...headers() },
        body: JSON.stringify({
          commandId: intent.current.commandId,
          workspaceId,
          programmeId,
          entry,
          acknowledged: true,
        }),
      });
      const body: unknown = await r.json().catch(() => null);
      const changed =
        r.status === 409 &&
        object(body) &&
        typeof body.error === 'string' &&
        body.error.includes('account changed');
      if ([401, 403].includes(r.status) || changed)
        return lose('denied', 'Account or programme access changed. Private details were cleared.');
      if (!r.ok) {
        setError(
          r.status === 409
            ? 'This record conflicts with an earlier one. Change a field or reload.'
            : r.status === 400
              ? 'Some details are not valid. Check the amount, date and wording.'
              : 'The record could not be saved. Your details are kept; try again.',
        );
        return;
      }
      if (!object(body) || !object(body.entry)) throw Error('Unconfirmed record');
      parseEntry(body.entry);
      intent.current = null;
      done();
      setNotice('Recorded as your own entry. No payment was collected, held or sent.');
      await load(true);
    } catch {
      setError('The record could not be confirmed. Your details are kept; try again.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function submit() {
    setError('');
    setNotice('');
    let amountMinor: string;
    try {
      amountMinor = parseMoney(amount, currency);
    } catch {
      return setError('Enter a positive amount using the currency’s decimal places.');
    }
    const participant = kind.startsWith('PARTICIPANT_');
    if (participant && !uuid(registrationId)) return setError('Choose a participant.');
    if (!/^Synthetic .{3,}/.test(description.trim()))
      return setError('Start the description with the word Synthetic and add a few words.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return setError('Choose a date.');
    if (!confirm) return setError('Confirm that this is a record you are entering yourself.');
    void post(
      {
        kind,
        costBasis: costKinds.includes(kind) ? costBasis : null,
        registrationId: participant ? registrationId : null,
        amountMinor,
        currency,
        occurredOn,
        description: description.trim(),
      },
      () => {
        setAmount('');
        setDescription('Synthetic ');
        setConfirm(false);
      },
    );
  }
  function correct(id: string) {
    setError('');
    if (!/^Synthetic .{3,}/.test(fixText.trim()))
      return setError('Start the reason with the word Synthetic and add a few words.');
    if (!fixConfirm) return setError('Confirm the correction.');
    void post({ reverseOf: id, occurredOn: fixDate, description: fixText.trim() }, () => {
      setCorrecting(null);
      setFixConfirm(false);
    });
  }

  const money = (v: string, c: Code) => formatMoney(v, c);
  const people = summary?.participants ?? [];
  const participant = kind.startsWith('PARTICIPANT_');

  return (
    <section
      className="detail-card"
      aria-label="Sample programme finances"
      aria-busy={busy || status === 'loading'}
    >
      <h4>Sample programme finances</h4>
      <p>
        This is your own bookkeeping, entered by you and not verified by Corridra. Corridra does not
        collect, hold or send any money. Each currency is shown separately and nothing is converted.
      </p>
      {status === 'loading' && <p role="status">Loading sample finances…</p>}
      {status === 'unavailable' && <p role="status">{notice}</p>}
      {(status === 'denied' || status === 'failed') && (
        <>
          <p role="alert">{notice}</p>
          {status === 'failed' && (
            <button type="button" className="text-link" onClick={() => void load()}>
              Reload finances
            </button>
          )}
        </>
      )}
      {status === 'ready' && summary && (
        <>
          {notice && <p role="status">{notice}</p>}
          <h5>Totals by currency</h5>
          {summary.currencies.length === 0 ? (
            <p className="ux-empty">No sample amounts recorded yet.</p>
          ) : (
            summary.currencies.map((c) => (
              <table key={c.currency}>
                <caption>{c.currency}</caption>
                <tbody>
                  <tr>
                    <th scope="row">Fees due from participants</th>
                    <td>{money(c.feesDue, c.currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Payments you recorded</th>
                    <td>{money(c.paymentsRecorded, c.currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Still outstanding</th>
                    <td>{money(c.outstanding, c.currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Planned costs</th>
                    <td>
                      {money(c.plannedCosts.total, c.currency)} (expenses{' '}
                      {money(c.plannedCosts.expenses, c.currency)}, owed{' '}
                      {money(c.plannedCosts.obligations, c.currency)}, Corridra service fee{' '}
                      {money(c.plannedCosts.corridraServiceFees, c.currency)})
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Actual costs</th>
                    <td>
                      {money(c.actualCosts.total, c.currency)} (expenses{' '}
                      {money(c.actualCosts.expenses, c.currency)}, owed{' '}
                      {money(c.actualCosts.obligations, c.currency)}, Corridra service fee{' '}
                      {money(c.actualCosts.corridraServiceFees, c.currency)})
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Margin if costs are as planned</th>
                    <td>{money(c.marginIfPlanned, c.currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Margin on actual costs</th>
                    <td>{money(c.marginOnActual, c.currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Cash margin (payments recorded less actual costs)</th>
                    <td>{money(c.cashMargin, c.currency)}</td>
                  </tr>
                </tbody>
              </table>
            ))
          )}
          <h5>Participants</h5>
          <p>
            {summary.counts.registered} registered · {summary.counts.active} active ·{' '}
            {summary.counts.withdrawnOrRemoved} withdrawn or removed
          </p>
          {people.length === 0 ? (
            <p className="ux-empty">No registered participants yet.</p>
          ) : (
            <ul>
              {people.map((r) => (
                <li key={r.registrationId}>
                  <strong>{r.label}</strong>
                  {r.state !== 'ACTIVE' ? ' · ' + r.state.toLowerCase() : ''}
                  {r.amounts.length === 0 ? (
                    <span> · No fee recorded</span>
                  ) : (
                    r.amounts.map((a) => (
                      <span key={a.currency}>
                        {' '}
                        · {statusLabels[a.status]}: due {money(a.due, a.currency)}, recorded{' '}
                        {money(a.recorded, a.currency)}
                      </span>
                    ))
                  )}
                </li>
              ))}
            </ul>
          )}

          <form
            className="operator-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <h5>Record an amount</h5>
            <label className="field">
              What are you recording?
              <select
                value={kind}
                disabled={busy}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabels[k]}
                  </option>
                ))}
              </select>
            </label>
            {participant && (
              <label className="field">
                Participant
                <select
                  value={registrationId}
                  disabled={busy}
                  onChange={(e) => setRegistrationId(e.target.value)}
                >
                  <option value="">Choose a participant</option>
                  {people.map((r) => (
                    <option key={r.registrationId} value={r.registrationId}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!participant && (
              <fieldset>
                <legend>Is this cost planned or has it happened?</legend>
                {(['PLANNED', 'ACTUAL'] as const).map((b) => (
                  <label key={b} className="check-field">
                    <input
                      type="radio"
                      name="cost-basis"
                      checked={costBasis === b}
                      disabled={busy}
                      onChange={() => setCostBasis(b)}
                    />
                    {b === 'PLANNED' ? 'Planned (expected)' : 'Actual (incurred)'}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="field">
              Currency
              <select
                value={currency}
                disabled={busy}
                onChange={(e) => setCurrency(e.target.value as Code)}
              >
                {(Object.keys(currencies) as Code[]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Amount ({currencies[currency]} decimal places)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                disabled={busy}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="field">
              Date
              <input
                type="date"
                value={occurredOn}
                min="2000-01-01"
                max={kind === 'PARTICIPANT_PAYMENT' ? today() : '2100-01-01'}
                disabled={busy}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            </label>
            <label className="field">
              Description (start with Synthetic)
              <input
                type="text"
                maxLength={300}
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={confirm}
                disabled={busy}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              I am entering this myself. It is a sample record, it is not verified, and no payment
              is collected or sent.
            </label>
            {error && <p role="alert">{error}</p>}
            <button type="submit" className="primary-link" disabled={busy}>
              {busy ? 'Saving…' : 'Record amount'}
            </button>
          </form>

          <h5>Entries, newest first</h5>
          {entries.length === 0 ? (
            <p className="ux-empty">No entries yet.</p>
          ) : (
            <ol reversed className="ux-plain-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <strong>#{e.seq}</strong> · {kindLabels[e.kind]}
                  {e.costBasis ? ' (' + e.costBasis.toLowerCase() + ')' : ''}
                  {e.registrationLabel ? ' · ' + e.registrationLabel : ''} ·{' '}
                  {money(e.amountMinor, e.currency)} · {e.occurredOn}
                  <br />
                  {e.description}
                  {e.reverseOf && <span> · Correction of an earlier entry</span>}
                  {e.reversedBy && <span> · Corrected by a later entry</span>}
                  {!e.reverseOf && !e.reversedBy && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setCorrecting(correcting === e.id ? null : e.id);
                          setFixConfirm(false);
                        }}
                      >
                        {correcting === e.id ? 'Cancel correction' : 'Correct this entry'}
                      </button>
                    </>
                  )}
                  {correcting === e.id && (
                    <div className="operator-form">
                      <p>
                        A correction adds an entry that cancels this one exactly. Nothing is edited
                        or deleted.
                      </p>
                      <label className="field">
                        Date of correction
                        <input
                          type="date"
                          value={fixDate}
                          min="2000-01-01"
                          max="2100-01-01"
                          disabled={busy}
                          onChange={(ev) => setFixDate(ev.target.value)}
                        />
                      </label>
                      <label className="field">
                        Reason (start with Synthetic)
                        <input
                          type="text"
                          maxLength={300}
                          value={fixText}
                          disabled={busy}
                          onChange={(ev) => setFixText(ev.target.value)}
                        />
                      </label>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={fixConfirm}
                          disabled={busy}
                          onChange={(ev) => setFixConfirm(ev.target.checked)}
                        />
                        I confirm this correction.
                      </label>
                      <button
                        type="button"
                        className="primary-link"
                        disabled={busy}
                        onClick={() => correct(e.id)}
                      >
                        Add correction
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {nextBefore !== null && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void older()}
            >
              Show older entries
            </button>
          )}
        </>
      )}
    </section>
  );
}
