'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { lazy, Suspense, useRef, useState, type KeyboardEvent } from 'react';
import { currencies, formatMoney } from '@corridra/domain/opportunities';
import { MoneyInput } from '../../../components/ux/money-input';
import { CurrencySelect } from '../../../components/ux/pickers';
import {
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

const ProgrammeSeries = lazy(() =>
  import('./programme-series').then((module) => ({ default: module.ProgrammeSeries })),
);
const ProgrammeExports = lazy(() =>
  import('./programme-exports').then((module) => ({ default: module.ProgrammeExports })),
);

type Code = keyof typeof currencies;
type Content = {
  currency: Code;
  tiers: { label: string; amountMinor: string }[];
  earlyBird: { label: string; untilDate: string; reductionMinor: string }[];
  groupDiscounts: { label: string; minParticipants: number; reductionMinor: string }[];
};
type Template = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  retired: boolean;
  currency: Code;
  tierCount: number;
  content: Content;
};
type Overview = {
  expiresAt: string;
  schedule: { version: number; templateVersion: number; currency: Code; content: Content } | null;
  history: { version: number }[];
  participants: {
    registrationId: string;
    label: string;
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
    hasFee: boolean;
  }[];
  counts: { registered: number; active: number };
};
type Preview = {
  scheduleVersion: number;
  currency: Code;
  groupSize: number;
  perCurrency: { currency: Code; totalMinor: string }[];
  rows: {
    registrationId: string;
    tier: string;
    baseMinor: string;
    earlyBirdMinor: string;
    groupMinor: string;
    amountMinor: string;
  }[];
};
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmes: { id: string; name: string }[];
  onChanged: () => void;
};
type Section = 'pricing' | 'series' | 'exports';

const blankTier = () => ({ label: realCustomerInput() ? '' : 'Synthetic ', amount: '' });
const blankEarly = () => ({
  label: realCustomerInput() ? '' : 'Synthetic ',
  until: '',
  reduction: '',
});
const blankGroup = () => ({
  label: realCustomerInput() ? '' : 'Synthetic ',
  min: '',
  reduction: '',
});

function checkContent(c: unknown): Content {
  if (
    !object(c) ||
    typeof c.currency !== 'string' ||
    !(c.currency in currencies) ||
    !Array.isArray(c.tiers) ||
    c.tiers.length < 1 ||
    c.tiers.length > 12 ||
    !Array.isArray(c.earlyBird) ||
    c.earlyBird.length > 6 ||
    !Array.isArray(c.groupDiscounts) ||
    c.groupDiscounts.length > 6
  )
    throw Error('Invalid schedule');
  for (const t of c.tiers)
    if (!object(t) || !text(t.label, 120) || !minorText(t.amountMinor)) throw Error('tier');
  for (const t of c.earlyBird)
    if (!object(t) || !text(t.label, 120) || !text(t.untilDate, 10) || !minorText(t.reductionMinor))
      throw Error('early');
  for (const t of c.groupDiscounts)
    if (
      !object(t) ||
      !text(t.label, 120) ||
      !Number.isInteger(t.minParticipants) ||
      !minorText(t.reductionMinor)
    )
      throw Error('group');
  return c as unknown as Content;
}
function checkTemplate(t: unknown): Template {
  if (
    !object(t) ||
    !uuid(t.id) ||
    !Number.isInteger(t.version) ||
    !text(t.name, 120) ||
    typeof t.retired !== 'boolean' ||
    typeof t.currency !== 'string' ||
    !Number.isInteger(t.tierCount) ||
    t.provenance !== 'ORGANISER_RECORDED'
  )
    throw Error('Invalid fee schedule');
  checkContent(t.content);
  return t as unknown as Template;
}
const money = (minor: string, code: Code) => formatMoney(minor, code);

export function ProgrammePricing(props: Props) {
  return (
    <ScopedPricing key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function ScopedPricing(props: Props) {
  const [section, setSection] = useState<Section>('pricing');
  const tabs = useRef<Record<Section, HTMLButtonElement | null>>({
    pricing: null,
    series: null,
    exports: null,
  });
  const order: Section[] = ['pricing', 'series', 'exports'];
  const labels: Record<Section, string> = {
    pricing: 'Pricing',
    series: 'Series',
    exports: 'Exports',
  };
  function move(event: KeyboardEvent, current: Section) {
    const i = order.indexOf(current);
    const next =
      event.key === 'ArrowRight'
        ? order[(i + 1) % order.length]
        : event.key === 'ArrowLeft'
          ? order[(i + order.length - 1) % order.length]
          : event.key === 'Home'
            ? order[0]
            : event.key === 'End'
              ? order[order.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    setSection(next);
    tabs.current[next]?.focus();
  }
  return (
    <section className="detail-card pricing-area" aria-label="Pricing, series and exports">
      <h3>Pricing, series and exports</h3>
      <p>
        Your own price lists, repeat editions and downloads. Everything here is a record you keep.
        Corridra collects, holds and moves no money.
      </p>
      <div className="pricing-tabs" role="tablist" aria-label="Pricing sections">
        {order.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={'pricing-tab-' + key}
            aria-selected={section === key}
            aria-controls={'pricing-panel-' + key}
            tabIndex={section === key ? 0 : -1}
            ref={(node) => {
              tabs.current[key] = node;
            }}
            onClick={() => setSection(key)}
            onKeyDown={(event) => move(event, key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={'pricing-panel-' + section}
        aria-labelledby={'pricing-tab-' + section}
      >
        {section === 'pricing' && <PricingSection {...props} />}
        {section === 'series' && (
          <Suspense fallback={<p role="status">Loading series…</p>}>
            <ProgrammeSeries {...props} />
          </Suspense>
        )}
        {section === 'exports' && (
          <Suspense fallback={<p role="status">Loading exports…</p>}>
            <ProgrammeExports {...props} />
          </Suspense>
        )}
      </div>
    </section>
  );
}

function PricingSection({ subject, issuer, workspaceId, programmes, onChanged }: Props) {
  const headers = customerHeaders(subject, issuer);
  const commands = useCommandIds();
  const templateUrl =
    '/api/customer-programme-pricing?view=templates&pageSize=50&workspaceId=' + workspaceId;
  const [templates, reloadTemplates] = usePrivateView(
    templateUrl,
    headers,
    (v) => {
      if (
        !object(v) ||
        v.workspaceId !== workspaceId ||
        !Array.isArray(v.templates) ||
        typeof v.expiresAt !== 'string'
      )
        throw Error('Invalid list');
      return { expiresAt: v.expiresAt, templates: v.templates.map(checkTemplate) };
    },
    'Pricing is unavailable.',
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const writing = useRef(false);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [name, setName] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState<Code>('BDT');
  const [tiers, setTiers] = useState([blankTier()]);
  const [early, setEarly] = useState<ReturnType<typeof blankEarly>[]>([]);
  const [groups, setGroups] = useState<ReturnType<typeof blankGroup>[]>([]);
  const [programme, setProgramme] = useState('');
  const [overviewTick, setOverviewTick] = useState(0);

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
  function startEdit(t: Template | null) {
    setError('');
    setNotice('');
    setEditing(t ?? 'new');
    setName(t ? t.name : realCustomerInput() ? '' : 'Synthetic ');
    setDescription(t?.description ?? '');
    const c = t?.content;
    setCurrency(c?.currency ?? 'BDT');
    setTiers(
      c
        ? c.tiers.map((x) => ({
            label: x.label,
            amount: x.amountMinor,
          }))
        : [blankTier()],
    );
    setEarly(
      c
        ? c.earlyBird.map((x) => ({
            label: x.label,
            until: x.untilDate,
            reduction: x.reductionMinor,
          }))
        : [],
    );
    setGroups(
      c
        ? c.groupDiscounts.map((x) => ({
            label: x.label,
            min: String(x.minParticipants),
            reduction: x.reductionMinor,
          }))
        : [],
    );
  }
  function fail(message: string): null {
    setError(message);
    return null;
  }
  function build(): Content | null {
    if (!syntheticOk(name))
      return fail(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the schedule name with the word Synthetic and add a few words.',
      );
    if (description.trim() && !syntheticOk(description))
      return fail(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the description with the word Synthetic, or clear it.',
      );
    // CQ-84: the money fields hold exact minor units (MoneyInput); only a positive amount is accepted.
    const amount = (value: string, where: string) => {
      if (/^[1-9][0-9]{0,17}$/.test(value)) return value;
      fail(where + ': enter a positive amount using the currency’s decimal places.');
      return null;
    };
    const outTiers: Content['tiers'] = [];
    for (const [i, t] of tiers.entries()) {
      if (!syntheticOk(t.label))
        return fail(
          'Tier ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the name with the word Synthetic and add a few words.'),
        );
      const minor = amount(t.amount, 'Tier ' + (i + 1));
      if (!minor) return null;
      outTiers.push({ label: t.label.trim(), amountMinor: minor });
    }
    if (new Set(outTiers.map((t) => t.label)).size !== outTiers.length)
      return fail('Each tier needs a different name.');
    const outEarly: Content['earlyBird'] = [];
    for (const [i, t] of early.entries()) {
      if (!syntheticOk(t.label))
        return fail(
          'Early booking ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the name with the word Synthetic.'),
        );
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.until))
        return fail('Early booking ' + (i + 1) + ': choose the last day it applies.');
      const minor = amount(t.reduction, 'Early booking ' + (i + 1));
      if (!minor) return null;
      outEarly.push({ label: t.label.trim(), untilDate: t.until, reductionMinor: minor });
    }
    const outGroups: Content['groupDiscounts'] = [];
    for (const [i, t] of groups.entries()) {
      if (!syntheticOk(t.label))
        return fail(
          'Group ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the name with the word Synthetic.'),
        );
      if (!/^[1-9][0-9]{0,4}$/.test(t.min) || Number(t.min) < 2 || Number(t.min) > 10000)
        return fail('Group ' + (i + 1) + ': the number of participants is a whole number from 2.');
      const minor = amount(t.reduction, 'Group ' + (i + 1));
      if (!minor) return null;
      outGroups.push({
        label: t.label.trim(),
        minParticipants: Number(t.min),
        reductionMinor: minor,
      });
    }
    const max = (list: { reductionMinor: string }[]) =>
      list.reduce(
        (a, t) => (BigInt(t.reductionMinor) > a ? BigInt(t.reductionMinor) : a),
        BigInt(0),
      );
    const cheapest = outTiers.reduce(
      (a, t) => (BigInt(t.amountMinor) < a ? BigInt(t.amountMinor) : a),
      BigInt(outTiers[0]!.amountMinor),
    );
    if (max(outEarly) + max(outGroups) >= cheapest)
      return fail('Reductions together must stay below the cheapest tier, so no fee reaches zero.');
    return { currency, tiers: outTiers, earlyBird: outEarly, groupDiscounts: outGroups };
  }
  function save(
    retired = false,
    source: Template | null = editing === 'new' ? null : editing,
    override?: Template,
  ) {
    setError('');
    const content = override ? override.content : build();
    if (!content) return;
    const input = {
      expectedVersion: source ? source.version : 0,
      templateId: source ? source.id : null,
      name: override ? override.name : name.trim(),
      description: override ? override.description : description.trim() || null,
      content,
      retired,
    };
    void guard(async () => {
      const result = await postJson('/api/customer-programme-pricing', headers, {
        action: 'saveTemplate',
        input: {
          commandId: commands.forIntent('save' + JSON.stringify(input)),
          workspaceId,
          ...input,
        },
      });
      if (!result.ok) return setError(result.message);
      checkTemplate(result.body.template);
      setEditing(null);
      setNotice(
        retired
          ? 'Fee schedule retired.'
          : source
            ? 'Fee schedule saved.'
            : 'Fee schedule created.',
      );
      reloadTemplates();
    });
  }

  const [overview] = usePrivateView(
    programme
      ? '/api/customer-programme-pricing?view=overview&workspaceId=' +
          workspaceId +
          '&programmeId=' +
          programme +
          '&n=' +
          overviewTick
      : null,
    headers,
    (v) => {
      if (
        !object(v) ||
        v.programmeId !== programme ||
        v.workspaceId !== workspaceId ||
        typeof v.expiresAt !== 'string' ||
        !Array.isArray(v.participants) ||
        !Array.isArray(v.history) ||
        !object(v.counts)
      )
        throw Error('Invalid overview');
      if (v.schedule !== null) checkContent((v.schedule as { content: unknown }).content);
      for (const p of v.participants)
        if (
          !object(p) ||
          !uuid(p.registrationId) ||
          !text(p.label, 200) ||
          typeof p.hasFee !== 'boolean'
        )
          throw Error('Invalid participant');
      return v as unknown as Overview;
    },
    'Pricing is unavailable.',
  );
  const [scheduleChoice, setScheduleChoice] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [feeDate, setFeeDate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewRows, setPreviewRows] = useState<{ registrationId: string; tier: string }[]>([]);

  function refreshOverview() {
    setPreview(null);
    setPicked({});
    setOverviewTick((n) => n + 1);
  }
  function applySchedule() {
    setError('');
    const t = templates.data?.templates.find((x) => x.id === scheduleChoice);
    if (!t || !overview.data) return setError('Choose a fee schedule to apply.');
    const input = {
      programmeId: programme,
      expectedScheduleVersion: overview.data.schedule?.version ?? 0,
      templateId: t.id,
      templateVersion: t.version,
    };
    void guard(async () => {
      const result = await postJson('/api/customer-programme-pricing', headers, {
        action: 'applySchedule',
        input: {
          commandId: commands.forIntent('apply' + JSON.stringify(input)),
          workspaceId,
          ...input,
        },
      });
      if (!result.ok) return setError(result.message);
      setNotice('Fee schedule applied to the programme. No fee has been recorded yet.');
      refreshOverview();
    });
  }
  const eligible = (overview.data?.participants ?? []).filter(
    (p) => p.state === 'ACTIVE' && !p.hasFee,
  );
  function selection() {
    const schedule = overview.data?.schedule;
    if (!schedule) return null;
    const rows = eligible
      .filter((p) => p.registrationId in picked)
      .map((p) => ({ registrationId: p.registrationId, tier: picked[p.registrationId]! }));
    if (rows.length === 0) return fail('Choose at least one participant.');
    if (rows.length > 200) return fail('Choose up to 200 participants at a time.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(feeDate)) return fail('Choose the fee date.');
    return { schedule, rows };
  }
  function showPreview() {
    setError('');
    setNotice('');
    const sel = selection();
    if (!sel) return;
    void guard(async () => {
      const result = await postJson('/api/customer-programme-pricing', headers, {
        action: 'previewFees',
        input: {
          workspaceId,
          programmeId: programme,
          scheduleVersion: sel.schedule.version,
          feeDate,
          rows: sel.rows,
        },
      });
      if (!result.ok) return setError(result.message);
      const b = result.body;
      if (!Array.isArray(b.rows) || !Array.isArray(b.perCurrency) || b.preview !== true)
        throw Error('Unconfirmed');
      setPreview(b as unknown as Preview);
      setPreviewRows(sel.rows);
    });
  }
  function record() {
    setError('');
    const schedule = overview.data?.schedule;
    if (!schedule || !preview) return;
    const input = {
      programmeId: programme,
      scheduleVersion: schedule.version,
      feeDate,
      rows: previewRows,
    };
    void guard(async () => {
      const result = await postJson('/api/customer-programme-pricing', headers, {
        action: 'recordFees',
        input: {
          commandId: commands.forIntent('fees' + JSON.stringify(input)),
          workspaceId,
          ...input,
        },
      });
      if (!result.ok) {
        // An unconfirmed save keeps the preview so the identical retry reuses its command id.
        if (result.kind !== 'failed') setPreview(null);
        return setError(result.message);
      }
      if (!Array.isArray(result.body.rows) || result.body.rowCount !== previewRows.length)
        throw Error('Unconfirmed');
      setNotice(
        'Recorded ' +
          previewRows.length +
          ' fee' +
          (previewRows.length === 1 ? '' : 's') +
          '. Payments are not collected here.',
      );
      commands.clear();
      refreshOverview();
      onChanged();
    });
  }
  const labelOf = (id: string) =>
    overview.data?.participants.find((p) => p.registrationId === id)?.label ?? 'Participant';

  return (
    <div aria-busy={busy || templates.status === 'loading'}>
      <h4>Fee schedules</h4>
      <p>
        A fee schedule is a price list in one currency: named tiers, a reduction for booking early
        and a reduction for bigger groups. Amounts are exact; nothing is converted.
      </p>
      {templates.status === 'loading' && <p role="status">Loading fee schedules…</p>}
      {templates.status === 'unavailable' && <p role="status">{templates.message}</p>}
      {(templates.status === 'denied' || templates.status === 'failed') && (
        <>
          <p role="alert">{templates.message}</p>
          {templates.status === 'failed' && (
            <button type="button" className="text-link" onClick={reloadTemplates}>
              Reload fee schedules
            </button>
          )}
        </>
      )}
      {templates.status === 'ready' && templates.data && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          {templates.data.templates.length === 0 ? (
            <p>
              No fee schedules yet. Create one to record fees owed by participants (your own
              bookkeeping; Corridra moves no money).
            </p>
          ) : (
            <ul>
              {templates.data.templates.map((t) => (
                <li key={t.id}>
                  <strong>{t.name}</strong> · version {t.version} · {t.currency} · {t.tierCount}{' '}
                  tier
                  {t.tierCount === 1 ? '' : 's'}
                  {t.retired ? ' · retired' : ''}{' '}
                  {t.content.tiers.length > 0 && (
                    <span className="ux-hint">
                      {' '}
                      ·{' '}
                      {t.content.tiers
                        .map((tier) => `${tier.label}: ${money(tier.amountMinor, t.currency)}`)
                        .join('; ')}
                    </span>
                  )}{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => startEdit(t)}
                  >
                    Edit fee schedule {t.name}
                  </button>{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => save(!t.retired, t, t)}
                  >
                    {t.retired ? 'Restore fee schedule ' : 'Retire fee schedule '}
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!editing && (
            <button
              type="button"
              className="primary-link"
              disabled={busy}
              onClick={() => startEdit(null)}
            >
              New fee schedule
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
              <h5>{editing === 'new' ? 'New fee schedule' : 'Edit fee schedule'}</h5>
              <label className="field">
                {realCustomerInput() ? 'Name' : 'Name (start with Synthetic)'}{' '}
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
              <CurrencySelect
                label="Currency"
                value={currency}
                disabled={busy}
                onChange={(code) => {
                  if (code && code in currencies) setCurrency(code as Code);
                }}
              />
              <h5>Tiers</h5>
              {tiers.map((t, i) => (
                <fieldset key={i}>
                  <legend>Tier {i + 1}</legend>
                  <label className="field">
                    Tier {i + 1} name
                    <input
                      type="text"
                      maxLength={120}
                      value={t.label}
                      disabled={busy}
                      onChange={(e) =>
                        setTiers(
                          tiers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <MoneyInput
                    label={`Tier ${i + 1} fee`}
                    currency={currency}
                    value={t.amount || null}
                    disabled={busy}
                    onChange={(minor) =>
                      setTiers(tiers.map((x, j) => (j === i ? { ...x, amount: minor ?? '' } : x)))
                    }
                  />
                  {tiers.length > 1 && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                    >
                      Remove tier {i + 1}
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="text-link"
                disabled={busy || tiers.length >= 12}
                onClick={() => setTiers([...tiers, blankTier()])}
              >
                Add a tier
              </button>
              <h5>Early booking reductions</h5>
              {early.map((t, i) => (
                <fieldset key={i}>
                  <legend>Early booking {i + 1}</legend>
                  <label className="field">
                    Early booking {i + 1} name
                    <input
                      type="text"
                      maxLength={120}
                      value={t.label}
                      disabled={busy}
                      onChange={(e) =>
                        setEarly(
                          early.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Early booking {i + 1} last day it applies
                    <input
                      type="date"
                      min="2000-01-01"
                      max="2100-01-01"
                      value={t.until}
                      disabled={busy}
                      onChange={(e) =>
                        setEarly(
                          early.map((x, j) => (j === i ? { ...x, until: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <MoneyInput
                    label={`Early booking ${i + 1} amount taken off each fee`}
                    currency={currency}
                    value={t.reduction || null}
                    disabled={busy}
                    onChange={(minor) =>
                      setEarly(
                        early.map((x, j) => (j === i ? { ...x, reduction: minor ?? '' } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setEarly(early.filter((_, j) => j !== i))}
                  >
                    Remove early booking {i + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="text-link"
                disabled={busy || early.length >= 6}
                onClick={() => setEarly([...early, blankEarly()])}
              >
                Add an early booking reduction
              </button>
              <h5>Group reductions</h5>
              {groups.map((t, i) => (
                <fieldset key={i}>
                  <legend>Group {i + 1}</legend>
                  <label className="field">
                    Group {i + 1} name
                    <input
                      type="text"
                      maxLength={120}
                      value={t.label}
                      disabled={busy}
                      onChange={(e) =>
                        setGroups(
                          groups.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Group {i + 1} applies from this many participants
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={t.min}
                      disabled={busy}
                      onChange={(e) =>
                        setGroups(
                          groups.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <MoneyInput
                    label={`Group ${i + 1} amount taken off each fee`}
                    currency={currency}
                    value={t.reduction || null}
                    disabled={busy}
                    onChange={(minor) =>
                      setGroups(
                        groups.map((x, j) => (j === i ? { ...x, reduction: minor ?? '' } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setGroups(groups.filter((_, j) => j !== i))}
                  >
                    Remove group {i + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="text-link"
                disabled={busy || groups.length >= 6}
                onClick={() => setGroups([...groups, blankGroup()])}
              >
                Add a group reduction
              </button>
              <button type="submit" className="primary-link" disabled={busy}>
                {editing === 'new' ? 'Create fee schedule' : 'Save fee schedule'}
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

          <h4>Charge participants</h4>
          <p>
            Choose a programme, apply a fee schedule to it, then record the fees for several
            participants at once. Each fee is worked out from the schedule, and the whole batch is
            saved or none of it.
          </p>
          <label className="field">
            Programme
            <select
              value={programme}
              disabled={busy}
              onChange={(e) => {
                setProgramme(e.target.value);
                setPreview(null);
                setPicked({});
                setScheduleChoice('');
                setNotice('');
                setError('');
              }}
            >
              <option value="">Choose a programme</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {programme && overview.status === 'loading' && (
            <p role="status">Loading the programme…</p>
          )}
          {programme && (overview.status === 'failed' || overview.status === 'denied') && (
            <p role="alert">{overview.message}</p>
          )}
          {programme && overview.status === 'unavailable' && (
            <p role="status">{overview.message}</p>
          )}
          {programme && overview.status === 'ready' && overview.data && (
            <>
              {overview.data.schedule ? (
                <p>
                  Fee schedule version {overview.data.schedule.version} is applied (
                  {overview.data.schedule.currency}, {overview.data.schedule.content.tiers.length}{' '}
                  tier
                  {overview.data.schedule.content.tiers.length === 1 ? '' : 's'}).{' '}
                  {overview.data.counts.active} active participant
                  {overview.data.counts.active === 1 ? '' : 's'}.
                </p>
              ) : (
                <p>No fee schedule is applied to this programme yet.</p>
              )}
              <div className="operator-form">
                <label className="field">
                  {overview.data.schedule
                    ? 'Switch to another fee schedule'
                    : 'Fee schedule to apply'}
                  <select
                    value={scheduleChoice}
                    disabled={busy}
                    onChange={(e) => setScheduleChoice(e.target.value)}
                  >
                    <option value="">Choose a fee schedule</option>
                    {templates.data.templates
                      .filter((t) => !t.retired)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} (version {t.version})
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="text-link"
                  disabled={busy || !scheduleChoice}
                  onClick={applySchedule}
                >
                  Apply fee schedule
                </button>
              </div>
              {overview.data.schedule && !preview && (
                <form
                  className="operator-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    showPreview();
                  }}
                >
                  <h5>Record fees</h5>
                  {eligible.length === 0 ? (
                    <p>
                      Nobody is waiting for a fee. Active participants who have no fee yet appear
                      here.
                    </p>
                  ) : (
                    eligible.map((p) => {
                      const tiersHere = overview.data!.schedule!.content.tiers;
                      const on = p.registrationId in picked;
                      return (
                        <fieldset key={p.registrationId}>
                          <legend>{p.label}</legend>
                          <label className="check-field">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy}
                              onChange={(e) => {
                                const next = { ...picked };
                                if (e.target.checked) next[p.registrationId] = tiersHere[0]!.label;
                                else delete next[p.registrationId];
                                setPicked(next);
                              }}
                            />
                            Charge {p.label}
                          </label>
                          {on && (
                            <label className="field">
                              Tier for {p.label}
                              <select
                                value={picked[p.registrationId]}
                                disabled={busy}
                                onChange={(e) =>
                                  setPicked({ ...picked, [p.registrationId]: e.target.value })
                                }
                              >
                                {tiersHere.map((t) => (
                                  <option key={t.label} value={t.label}>
                                    {t.label} (
                                    {money(t.amountMinor, overview.data!.schedule!.currency)})
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </fieldset>
                      );
                    })
                  )}
                  {eligible.length > 0 && (
                    <>
                      <label className="field">
                        Fee date (early booking reductions use this date)
                        <input
                          type="date"
                          min="2000-01-01"
                          max="2100-01-01"
                          value={feeDate}
                          disabled={busy}
                          onChange={(e) => setFeeDate(e.target.value)}
                        />
                      </label>
                      <button type="submit" className="primary-link" disabled={busy}>
                        Preview fees
                      </button>
                    </>
                  )}
                </form>
              )}
              {preview && (
                <div className="operator-form">
                  <h5>Check before recording</h5>
                  <p>
                    {preview.rows.length} fee{preview.rows.length === 1 ? '' : 's'}, worked out for
                    a group of {preview.groupSize} active participant
                    {preview.groupSize === 1 ? '' : 's'}. Nothing is saved yet.
                  </p>
                  <div className="delivery-table">
                    <table>
                      <caption>Fees to record</caption>
                      <thead>
                        <tr>
                          <th scope="col">Participant</th>
                          <th scope="col">Tier</th>
                          <th scope="col">Tier fee</th>
                          <th scope="col">Early booking</th>
                          <th scope="col">Group</th>
                          <th scope="col">Fee</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r.registrationId}>
                            <th scope="row">{labelOf(r.registrationId)}</th>
                            <td>{r.tier}</td>
                            <td>{money(r.baseMinor, preview.currency)}</td>
                            <td>
                              {r.earlyBirdMinor === '0'
                                ? 'none'
                                : '-' + money(r.earlyBirdMinor, preview.currency).slice(4)}
                            </td>
                            <td>
                              {r.groupMinor === '0'
                                ? 'none'
                                : '-' + money(r.groupMinor, preview.currency).slice(4)}
                            </td>
                            <td>{money(r.amountMinor, preview.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.perCurrency.map((t) => (
                    <p key={t.currency}>
                      <strong>
                        Total in {t.currency}: {money(t.totalMinor, t.currency)}
                      </strong>
                    </p>
                  ))}
                  <button type="button" className="primary-link" disabled={busy} onClick={record}>
                    Record these fees
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setPreview(null)}
                  >
                    Change the selection
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {templates.status === 'ready' && programme === '' && programmes.length === 0 && (
        <p>
          {' '}
          {realCustomerInput()
            ? 'Create a programme first to charge participants.'
            : 'Create a sample programme first to charge participants.'}{' '}
        </p>
      )}
    </div>
  );
}
