'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useRef, useState } from 'react';
import { currencies, formatMoney } from '@corridra/domain/opportunities';
import {
  addMonths,
  customerHeaders,
  minorText,
  object,
  postJson,
  syntheticOk,
  text,
  useCommandIds,
  usePrivateView,
  uuid,
} from './pricing-client';

type Code = keyof typeof currencies;
type Series = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  retired: boolean;
  templateId: string;
  templateName: string;
  templateVersion: number;
  templateRetired: boolean;
  startDates: string[];
  editions: {
    id: string;
    editionNo: number;
    programmeId: string;
    programmeName: string;
    startDate: string;
  }[];
  nextEditionDate: string | null;
};
type PlanTemplate = { id: string; version: number; name: string; retired: boolean };
type Revenue = {
  expiresAt: string;
  editions: {
    editionNo: number;
    programmeName: string;
    startDate: string;
    registered: number;
    active: number;
    figures: Figures[];
  }[];
  totals: (Figures & { editions: number })[];
};
type Figures = {
  currency: Code;
  feesDue: string;
  paymentsRecorded: string;
  outstanding: string;
  plannedCosts: string;
  actualCosts: string;
  marginOnActual: string;
  cashMargin: string;
  feesDueChange?: string | null;
};
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmes: { id: string; name: string }[];
  onChanged: () => void;
};

const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function checkSeries(s: unknown): Series {
  if (
    !object(s) ||
    !uuid(s.id) ||
    !Number.isInteger(s.version) ||
    !text(s.name, 120) ||
    typeof s.retired !== 'boolean' ||
    !uuid(s.templateId) ||
    !Array.isArray(s.startDates) ||
    s.startDates.length < 1 ||
    s.startDates.length > 24 ||
    !s.startDates.every(date) ||
    !Array.isArray(s.editions) ||
    s.provenance !== 'ORGANISER_RECORDED'
  )
    throw Error('Invalid series');
  for (const e of s.editions)
    if (!object(e) || !uuid(e.programmeId) || !Number.isInteger(e.editionNo) || !date(e.startDate))
      throw Error('Invalid edition');
  return s as unknown as Series;
}
function checkFigures(f: unknown): Figures {
  if (
    !object(f) ||
    typeof f.currency !== 'string' ||
    !(f.currency in currencies) ||
    ![
      f.feesDue,
      f.paymentsRecorded,
      f.outstanding,
      f.plannedCosts,
      f.actualCosts,
      f.marginOnActual,
      f.cashMargin,
    ].every(minorText)
  )
    throw Error('Invalid figures');
  return f as unknown as Figures;
}
const money = (minor: string, code: Code) => formatMoney(minor, code);
const steps = [
  { label: 'Every month', months: 1 },
  { label: 'Every 3 months', months: 3 },
  { label: 'Every year', months: 12 },
];

export function ProgrammeSeries(props: Props) {
  return (
    <ScopedSeries key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function ScopedSeries({ subject, issuer, workspaceId, onChanged }: Props) {
  const headers = customerHeaders(subject, issuer);
  const commands = useCommandIds();
  const [list, reloadList] = usePrivateView(
    '/api/customer-programme-pricing?view=series&workspaceId=' + workspaceId,
    headers,
    (v) => {
      if (
        !object(v) ||
        v.workspaceId !== workspaceId ||
        !Array.isArray(v.series) ||
        typeof v.expiresAt !== 'string'
      )
        throw Error('Invalid list');
      return { expiresAt: v.expiresAt, series: v.series.map(checkSeries) };
    },
    'Series are unavailable.',
  );
  const [plans] = usePrivateView(
    '/api/customer-programme-templates?view=list&pageSize=50&workspaceId=' + workspaceId,
    headers,
    (v) => {
      if (
        !object(v) ||
        v.workspaceId !== workspaceId ||
        !Array.isArray(v.templates) ||
        typeof v.expiresAt !== 'string'
      )
        throw Error('Invalid templates');
      const templates = v.templates.map((t): PlanTemplate => {
        if (
          !object(t) ||
          !uuid(t.id) ||
          !Number.isInteger(t.version) ||
          !text(t.name, 120) ||
          typeof t.retired !== 'boolean'
        )
          throw Error('Invalid template');
        return { id: t.id, version: t.version as number, name: t.name, retired: t.retired };
      });
      return { expiresAt: v.expiresAt, templates };
    },
    'Programme templates are unavailable.',
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const writing = useRef(false);
  const [editing, setEditing] = useState<Series | 'new' | null>(null);
  const [name, setName] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [dates, setDates] = useState<string[]>(['']);
  const [first, setFirst] = useState('');
  const [count, setCount] = useState('4');
  const [step, setStep] = useState(3);
  const [making, setMaking] = useState<Series | null>(null);
  const [editionName, setEditionName] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [revenueFor, setRevenueFor] = useState<string | null>(null);
  const [revenue] = usePrivateView(
    revenueFor
      ? '/api/customer-programme-pricing?view=revenue&workspaceId=' +
          workspaceId +
          '&seriesId=' +
          revenueFor
      : null,
    headers,
    (v) => {
      if (
        !object(v) ||
        v.seriesId !== revenueFor ||
        v.projection !== false ||
        v.verified !== false ||
        !Array.isArray(v.editions) ||
        !Array.isArray(v.totals) ||
        typeof v.expiresAt !== 'string'
      )
        throw Error('Invalid revenue');
      for (const e of v.editions) {
        if (!object(e) || !Array.isArray(e.figures)) throw Error('Invalid edition');
        e.figures.forEach(checkFigures);
      }
      v.totals.forEach(checkFigures);
      return v as unknown as Revenue;
    },
    'Repeat revenue is unavailable.',
  );

  async function guard(work: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch {
      setError('It could not be confirmed. What you typed is kept; try again.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  function startEdit(s: Series | null) {
    setError('');
    setNotice('');
    setMaking(null);
    setEditing(s ?? 'new');
    setName(s ? s.name : realCustomerInput() ? '' : 'Synthetic ');
    setDescription(s?.description ?? '');
    setTemplateId(s ? s.templateId : '');
    setDates(s ? s.startDates : ['']);
  }
  function fill() {
    setError('');
    const n = Number(count);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return setError('Choose the first start date.');
    if (!Number.isInteger(n) || n < 1 || n > 24)
      return setError('Choose between 1 and 24 editions.');
    const out = Array.from({ length: n }, (_, i) => addMonths(first, i * step));
    if (out.some((d) => d > '2100-01-01')) return setError('Those dates run past 2100.');
    setDates(out);
  }
  function save(
    retired = false,
    source: Series | null = editing === 'new' ? null : editing,
    override?: Series,
  ) {
    setError('');
    const input = override
      ? {
          expectedVersion: override.version,
          seriesId: override.id,
          name: override.name,
          description: override.description,
          templateId: override.templateId,
          startDates: override.startDates,
          retired,
        }
      : (() => {
          if (!syntheticOk(name))
            return setError(
              realCustomerInput()
                ? 'Enter a clear description with at least two characters.'
                : 'Start the series name with the word Synthetic and add a few words.',
            );
          if (description.trim() && !syntheticOk(description))
            return setError(
              realCustomerInput()
                ? 'Enter a clear description with at least two characters.'
                : 'Start the description with the word Synthetic, or clear it.',
            );
          if (!templateId)
            return setError('Choose the programme template each edition starts from.');
          const chosen = dates.map((d) => d.trim());
          if (chosen.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))
            return setError('Every start date needs a real date.');
          if (chosen.some((d, i) => i > 0 && d <= chosen[i - 1]!))
            return setError('Start dates must be in order, each later than the one before.');
          return {
            expectedVersion: source ? source.version : 0,
            seriesId: source ? source.id : null,
            name: name.trim(),
            description: description.trim() || null,
            templateId,
            startDates: chosen,
            retired,
          };
        })();
    if (!input) return;
    void guard(async () => {
      const result = await postJson('/api/customer-programme-pricing', headers, {
        action: 'saveSeries',
        input: {
          commandId: commands.forIntent('series' + JSON.stringify(input)),
          workspaceId,
          ...input,
        },
      });
      if (!result.ok) return setError(result.message);
      checkSeries(result.body.series);
      setEditing(null);
      setNotice(retired ? 'Series retired.' : source ? 'Series saved.' : 'Series created.');
      reloadList();
    });
  }
  function startMaking(s: Series) {
    setError('');
    setNotice('');
    setEditing(null);
    setMaking(s);
    setEditionName(
      (realCustomerInput() ? '' : 'Synthetic ') +
        s.name.replace(/^Synthetic /, '') +
        ' edition ' +
        (s.editions.length + 1),
    );
  }
  function createEdition() {
    setError('');
    const s = making;
    if (!s) return;
    if (!syntheticOk(editionName) || editionName.trim().length > 160)
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the edition name with the word Synthetic and add a few words.',
      );
    const input = {
      seriesId: s.id,
      expectedVersion: s.version,
      editionNo: s.editions.length + 1,
      templateVersion: s.templateVersion,
      name: editionName.trim(),
    };
    void guard(async () => {
      const result = await postJson('/api/customer-programme-pricing', headers, {
        action: 'createEdition',
        input: {
          commandId: commands.forIntent('edition' + JSON.stringify(input)),
          workspaceId,
          ...input,
        },
      });
      if (!result.ok) return setError(result.message);
      const edition = result.body.edition;
      if (!object(edition) || !uuid(edition.programmeId) || edition.editionNo !== input.editionNo)
        throw Error('Unconfirmed');
      setMaking(null);
      setNotice(
        'Edition ' +
          input.editionNo +
          ' created with ' +
          result.body.tasksCreated +
          ' task(s) and ' +
          result.body.plannedCostsCreated +
          ' planned cost(s). No participants, fees or payments were copied.',
      );
      commands.clear();
      reloadList();
      onChanged();
    });
  }

  return (
    <div aria-busy={busy || list.status === 'loading'}>
      <h4>Series</h4>
      <p>
        A series repeats a programme on dates you choose. Each new edition starts from a programme
        template (purpose, capacity, tasks and planned costs). Participants, fees and payments are
        never copied.
      </p>
      {list.status === 'loading' && <p role="status">Loading series…</p>}
      {list.status === 'unavailable' && <p role="status">{list.message}</p>}
      {(list.status === 'denied' || list.status === 'failed') && (
        <>
          <p role="alert">{list.message}</p>
          {list.status === 'failed' && (
            <button type="button" className="text-link" onClick={reloadList}>
              Reload series
            </button>
          )}
        </>
      )}
      {list.status === 'ready' && list.data && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          {list.data.series.length === 0 ? (
            <p>No series yet. Save a programme template first, then start a series from it.</p>
          ) : (
            <ul>
              {list.data.series.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> · version {s.version}
                  {s.retired ? ' · retired' : ''}
                  <br />
                  Starts from {s.templateName} (version {s.templateVersion}
                  {s.templateRetired ? ', retired' : ''}). {s.editions.length} of{' '}
                  {s.startDates.length} edition
                  {s.startDates.length === 1 ? '' : 's'} created
                  {s.nextEditionDate
                    ? '; next starts ' + s.nextEditionDate
                    : '; all dates are used'}
                  .
                  {s.editions.length > 0 && (
                    <ul>
                      {s.editions.map((e) => (
                        <li key={e.id}>
                          Edition {e.editionNo}: {e.programmeName} · {e.startDate}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!s.retired && s.nextEditionDate && !s.templateRetired && (
                    <>
                      <button
                        type="button"
                        className="primary-link"
                        disabled={busy}
                        onClick={() => startMaking(s)}
                      >
                        Create the next edition of {s.name}
                      </button>{' '}
                    </>
                  )}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => startEdit(s)}
                  >
                    Edit series {s.name}
                  </button>{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => save(!s.retired, s, s)}
                  >
                    {s.retired ? 'Restore series ' : 'Retire series '}
                    {s.name}
                  </button>{' '}
                  {s.editions.length > 0 && (
                    <button
                      type="button"
                      className="text-link"
                      aria-pressed={revenueFor === s.id}
                      onClick={() => setRevenueFor(revenueFor === s.id ? null : s.id)}
                    >
                      {revenueFor === s.id
                        ? 'Hide repeat revenue for '
                        : 'Show repeat revenue for '}
                      {s.name}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {making && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                createEdition();
              }}
            >
              <h5>
                Edition {making.editions.length + 1} of {making.name}
              </h5>
              <p>
                It starts on {making.nextEditionDate} and is created from {making.templateName},
                version {making.templateVersion}. It appears in your programmes list.
              </p>
              <label className="field">
                {realCustomerInput() ? 'Edition name' : 'Edition name (start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={160}
                  value={editionName}
                  disabled={busy}
                  onChange={(e) => setEditionName(e.target.value)}
                />
              </label>
              <button type="submit" className="primary-link" disabled={busy}>
                Create edition {making.editions.length + 1}
              </button>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setMaking(null);
                  setError('');
                }}
              >
                Cancel
              </button>
            </form>
          )}
          {revenueFor && revenue.status === 'loading' && (
            <p role="status">Loading repeat revenue…</p>
          )}
          {revenueFor &&
            (revenue.status === 'failed' ||
              revenue.status === 'denied' ||
              revenue.status === 'unavailable') && <p role="alert">{revenue.message}</p>}
          {revenueFor && revenue.status === 'ready' && revenue.data && (
            <div>
              <h5>Repeat revenue and margin</h5>
              <p>
                Figures come from the fees, payments and costs you recorded in each edition. They
                are not verified, not a forecast, and each currency stands alone.
              </p>
              {revenue.data.totals.length === 0 ? (
                <p>Nothing has been recorded in these editions yet.</p>
              ) : (
                <div className="delivery-table">
                  <table>
                    <caption>Totals across editions, by currency</caption>
                    <thead>
                      <tr>
                        <th scope="col">Currency</th>
                        <th scope="col">Editions</th>
                        <th scope="col">Fees due</th>
                        <th scope="col">Payments recorded</th>
                        <th scope="col">Outstanding</th>
                        <th scope="col">Actual costs</th>
                        <th scope="col">Margin on actual costs</th>
                        <th scope="col">Cash margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenue.data.totals.map((t) => (
                        <tr key={t.currency}>
                          <th scope="row">{t.currency}</th>
                          <td>{t.editions}</td>
                          <td>{money(t.feesDue, t.currency)}</td>
                          <td>{money(t.paymentsRecorded, t.currency)}</td>
                          <td>{money(t.outstanding, t.currency)}</td>
                          <td>{money(t.actualCosts, t.currency)}</td>
                          <td>{money(t.marginOnActual, t.currency)}</td>
                          <td>{money(t.cashMargin, t.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="delivery-table">
                <table>
                  <caption>Each edition, by currency</caption>
                  <thead>
                    <tr>
                      <th scope="col">Edition</th>
                      <th scope="col">Participants</th>
                      <th scope="col">Currency</th>
                      <th scope="col">Fees due</th>
                      <th scope="col">Change since the edition before</th>
                      <th scope="col">Actual costs</th>
                      <th scope="col">Margin on actual costs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.data.editions.flatMap((e) =>
                      e.figures.length === 0
                        ? [
                            <tr key={e.editionNo}>
                              <th scope="row">
                                {e.editionNo}. {e.programmeName}
                              </th>
                              <td>{e.active} active</td>
                              <td colSpan={5}>Nothing recorded</td>
                            </tr>,
                          ]
                        : e.figures.map((f) => (
                            <tr key={e.editionNo + f.currency}>
                              <th scope="row">
                                {e.editionNo}. {e.programmeName}
                              </th>
                              <td>{e.active} active</td>
                              <td>{f.currency}</td>
                              <td>{money(f.feesDue, f.currency)}</td>
                              <td>
                                {f.feesDueChange == null
                                  ? 'none'
                                  : money(f.feesDueChange, f.currency)}
                              </td>
                              <td>{money(f.actualCosts, f.currency)}</td>
                              <td>{money(f.marginOnActual, f.currency)}</td>
                            </tr>
                          )),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!editing && !making && (
            <button
              type="button"
              className="primary-link"
              disabled={busy}
              onClick={() => startEdit(null)}
            >
              New series
            </button>
          )}
          {editing && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                save(false);
              }}
            >
              <h5>{editing === 'new' ? 'New series' : 'Edit series'}</h5>
              <label className="field">
                {realCustomerInput() ? 'Series name' : 'Series name (start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={120}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                {realCustomerInput()
                  ? 'Description (optional)'
                  : 'Description (optional, start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={500}
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="field">
                Programme template each edition starts from
                <select
                  value={templateId}
                  disabled={busy}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Choose a programme template</option>
                  {(plans.data?.templates ?? [])
                    .filter((t) => !t.retired || t.id === templateId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (version {t.version})
                      </option>
                    ))}
                </select>
              </label>
              {plans.status === 'ready' && plans.data?.templates.length === 0 && (
                <p>There are no programme templates yet. Save one from the planning page first.</p>
              )}
              <h5>Start dates</h5>
              <p>
                {editing !== 'new' && editing.editions.length > 0
                  ? 'Dates of editions that already exist cannot change. You can add later dates.'
                  : 'List each edition’s start date, or fill them in from a pattern.'}
              </p>
              <div className="operator-form">
                <label className="field">
                  First start date
                  <input
                    type="date"
                    min="2000-01-01"
                    max="2100-01-01"
                    value={first}
                    disabled={busy}
                    onChange={(e) => setFirst(e.target.value)}
                  />
                </label>
                <label className="field">
                  How many editions
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={count}
                    disabled={busy}
                    onChange={(e) => setCount(e.target.value)}
                  />
                </label>
                <label className="field">
                  How often
                  <select
                    value={step}
                    disabled={busy}
                    onChange={(e) => setStep(Number(e.target.value))}
                  >
                    {steps.map((s) => (
                      <option key={s.months} value={s.months}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="text-link" disabled={busy} onClick={fill}>
                  Fill in the dates
                </button>
              </div>
              {dates.map((d, i) => {
                const locked = editing !== 'new' && i < editing.editions.length;
                return (
                  <label className="field" key={i}>
                    Edition {i + 1} start date{locked ? ' (already created)' : ''}
                    <input
                      type="date"
                      min="2000-01-01"
                      max="2100-01-01"
                      value={d}
                      disabled={busy || locked}
                      onChange={(e) =>
                        setDates(dates.map((x, j) => (j === i ? e.target.value : x)))
                      }
                    />
                  </label>
                );
              })}
              <button
                type="button"
                className="text-link"
                disabled={busy || dates.length >= 24}
                onClick={() => setDates([...dates, ''])}
              >
                Add a date
              </button>
              {dates.length > 1 &&
                (editing === 'new' || dates.length > editing.editions.length) && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setDates(dates.slice(0, -1))}
                  >
                    Remove the last date
                  </button>
                )}
              <button type="submit" className="primary-link" disabled={busy}>
                {editing === 'new' ? 'Create series' : 'Save series'}
              </button>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setError('');
                }}
              >
                Cancel
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
