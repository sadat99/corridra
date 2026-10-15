'use client';
import Link from 'next/link';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { countryCodes } from '@corridra/domain/countries';
import { currencies } from '@corridra/domain/currencies';
import { intakeExperience } from '@corridra/domain/experience';
import { originalAmountToMinor } from '@corridra/domain/locale';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  briefSchema,
  intakeSteps,
  objectiveOptions,
  outcomeOptions,
} from '@corridra/domain/missions';
type Draft = {
  companyCountry: string;
  marketCode: string;
  job: string;
  technicalPurpose: string;
  parameters: string;
  quantity: string;
  unit: string;
  preferences: string;
  budgetAmount: string;
  currency: string;
  budgetBasis: string;
  whenNeeded: string;
  worthwhile: string;
  organiser: string;
  participants: string;
  objective: string;
  market: string;
  attendance: string;
  startDate: string;
  endDate: string;
  timezone: string;
  offer: string;
  website: string;
  outcomes: string[];
  notes: string;
  name: string;
  company: string;
  email: string;
  acknowledged: boolean;
};
const empty: Draft = {
  companyCountry: '',
  marketCode: '',
  job: '',
  technicalPurpose: '',
  parameters: '',
  quantity: '',
  unit: '',
  preferences: '',
  budgetAmount: '',
  currency: '',
  budgetBasis: '',
  whenNeeded: '',
  worthwhile: '',
  organiser: '',
  participants: '',
  objective: '',
  market: '',
  attendance: 'Not decided',
  startDate: '',
  endDate: '',
  timezone: 'UTC',
  offer: '',
  website: '',
  outcomes: [],
  notes: '',
  name: '',
  company: '',
  email: '',
  acknowledged: false,
};
const groups = [
  ['objective'],
  ['market', 'attendance', 'startDate', 'endDate', 'timezone'],
  ['offer', 'website'],
  ['outcomes', 'notes'],
  ['name', 'company', 'email', 'acknowledged'],
];
const titles = [
  'What are you trying to achieve?',
  'Where?',
  'What are you offering or looking for?',
  'What would make this worthwhile?',
  'Where should we respond?',
];
function objectiveForJob(job: string) {
  if (['sourcing', 'machinery_procurement', 'supplier_evaluation'].includes(job))
    return 'Source suppliers';
  if (job === 'delegations') return 'Run a multi-company mission';
  if (['business_trips', 'factory_visits', 'trade_fairs', 'meetings'].includes(job))
    return 'Make an upcoming business trip more productive';
  if (['customers', 'distributors', 'partners'].includes(job))
    return 'Find customers or distributors';
  return 'Sell in a new market';
}
function saveDraft(draft: Draft, step: number, key: string) {
  sessionStorage.setItem(
    'corridra-mission-draft',
    JSON.stringify({ version: 2, draft, step, key, at: Date.now() }),
  );
}
export function Intake() {
  const [draft, setDraft] = useState<Draft>(empty),
    [step, setStep] = useState(0),
    [errors, setErrors] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [receipt, setReceipt] = useState(''),
    [checkCode, setCheckCode] = useState(''),
    [result, setResult] = useState<{
      status: string;
      replies: { body: string; createdAt: string }[];
    } | null>(null),
    [finished, setFinished] = useState(false),
    [ready, setReady] = useState(false),
    [draftNotice, setDraftNotice] = useState('');
  const key = useRef(''),
    submitted = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        let restored = false;
        let saved;
        try {
          saved = JSON.parse(sessionStorage.getItem('corridra-mission-draft') ?? 'null');
        } catch {
          setDraftNotice(
            'A saved draft could not be restored. The form still works; keep a copy of your invented request before leaving this tab.',
          );
        }
        if (
          saved &&
          Date.now() - saved.at < 86400000 &&
          typeof saved.key === 'string' &&
          typeof saved.draft?.offer === 'string' &&
          Array.isArray(saved.draft.outcomes)
        ) {
          restored = true;
          setDraftNotice(
            'A draft from this tab was resumed. Your saved choices take precedence over link suggestions.',
          );
          key.current = saved.key;
          setDraft({ ...empty, ...saved.draft });
          setStep(saved.version === 2 ? Math.max(0, Math.min(4, Number(saved.step) || 0)) : 0);
        }
        if (saved && !restored)
          setDraftNotice('The earlier draft could not be resumed. Drafts expire after 24 hours.');
        const query = new URLSearchParams(window.location.search);
        const suggestedJob = query.get('job');
        if (!restored && suggestedJob && missionCatalogue.some((t) => t.key === suggestedJob))
          setDraft((current) => ({
            ...current,
            job: suggestedJob,
            objective: objectiveForJob(suggestedJob),
          }));
        const companyCountry = query.get('companyCountry'),
          marketCode = query.get('marketCode');
        if (
          !restored &&
          companyCountry &&
          countryCodes.includes(companyCountry as (typeof countryCodes)[number]) &&
          marketCode &&
          (marketCode === 'EU' ||
            countryCodes.includes(marketCode as (typeof countryCodes)[number]))
        ) {
          setDraft((current) => ({
            ...current,
            companyCountry,
            marketCode,
            market:
              marketCode === 'EU'
                ? 'European Union'
                : (new Intl.DisplayNames(['en'], { type: 'region' }).of(marketCode) ?? marketCode),
          }));
        }
        const token = sessionStorage.getItem('corridra-mission-receipt');
        if (token) {
          setReceipt(token);
          setCheckCode(token);
          setFinished(true);
          submitted.current = true;
        }
      } catch {
        setDraftNotice(
          'A saved draft could not be restored. The form still works; keep a copy of your invented request before leaving this tab.',
        );
      } finally {
        setReady(true);
      }
    });
  }, []);
  useEffect(() => {
    if (Object.values(errors).some((messages) => messages.length)) errorSummary.current?.focus();
  }, [errors]);
  function persist(v: Draft, n: number) {
    if (!key.current) key.current = crypto.randomUUID();
    try {
      saveDraft(v, n, key.current);
    } catch {
      setDraftNotice(
        'This browser could not save the draft. Keep this tab open and copy the invented request before leaving.',
      );
    }
  }
  function change(field: keyof Draft, value: string | boolean | string[]) {
    const v = { ...draft, [field]: value };
    if (field === 'job' && value) v.objective = objectiveForJob(String(value));
    if (field === 'objective')
      v.job = (
        {
          'Sell in a new market': 'buyers',
          'Find customers or distributors': 'distributors',
          'Source suppliers': 'sourcing',
          'Make an upcoming business trip more productive': 'business_trips',
          'Run a multi-company mission': 'delegations',
          'Something else': 'market_validation',
        } as Record<string, string>
      )[String(value)];
    if (v.job !== draft.job)
      for (const k of [
        'technicalPurpose',
        'parameters',
        'quantity',
        'unit',
        'preferences',
        'budgetAmount',
        'currency',
        'budgetBasis',
        'organiser',
        'participants',
      ] as const)
        v[k] = '';
    if (field === 'marketCode')
      v.market =
        String(value) === 'EU'
          ? 'European Union'
          : (new Intl.DisplayNames(['en'], { type: 'region' }).of(String(value)) ?? String(value));

    if (field === 'attendance' && value !== 'Yes') {
      v.startDate = '';
      v.endDate = '';
    }
    setDraft(v);
    persist(v, step);
    setErrors((e) => ({ ...e, [field]: [] }));
  }
  function validate(fields: string[]) {
    const p = (fields.length === groups.flat().length ? briefSchema : intakeSteps[step]).safeParse(
      draft,
    );
    const next: Record<string, string[]> = {};
    if (!p.success)
      for (const e of p.error.issues) {
        const f = String(e.path[0]);
        if (fields.includes(f)) next[f] = [e.message];
      }
    if (step === 0 || fields.length === groups.flat().length) {
      if (!draft.job) next.job = ['Choose the commercial job'];
    }
    if (step === 1 || fields.length === groups.flat().length) {
      if (!countryCodes.includes(draft.companyCountry as (typeof countryCodes)[number]))
        next.companyCountry = ['Choose the company country'];
      if (
        draft.marketCode !== 'EU' &&
        !countryCodes.includes(draft.marketCode as (typeof countryCodes)[number])
      )
        next.marketCode = ['Choose the target market'];
    }
    if (step === 2 || fields.length === groups.flat().length) {
      let structured;
      try {
        structured = intakeExperience.safeParse(experience());
      } catch (err) {
        next.requirements = [
          err instanceof Error ? err.message : 'Check the original amount and currency.',
        ];
      }
      if (structured && !structured.success)
        next.requirements = [structured.error.issues.map((e) => e.message).join('. ')];
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  function move(n: number) {
    setStep(n);
    setErrors({});
    persist(draft, n);
    queueMicrotask(() => heading.current?.focus());
  }
  function experience() {
    const sourcing = ['sourcing', 'supplier_evaluation', 'factory_visits'].includes(draft.job);
    const machinery = draft.job === 'machinery_procurement';
    const optional = (value: string) => value.trim() || undefined;
    return {
      schemaVersion: 1,
      companyCountry: draft.companyCountry,
      marketCode: draft.marketCode,
      job: draft.job,
      requirements: {
        objective: missionCatalogue.find((t) => t.key === draft.job)?.label ?? draft.objective,
        role:
          draft.job === 'delegations'
            ? 'INSTITUTION'
            : machinery
              ? 'BUYER'
              : sourcing
                ? 'IMPORTER'
                : 'EXPORTER',
        product: draft.offer,
        specifications: optional(draft.parameters),
        quantity: optional(draft.quantity),
        unit: optional(draft.unit),
        technicalConstraints: optional(draft.preferences),
        budgetMinor: optional(draft.budgetAmount)
          ? originalAmountToMinor(draft.budgetAmount, draft.currency)
          : undefined,
        currency: optional(draft.currency),
        budgetBasis: optional(draft.budgetBasis),
        travelDates: optional(draft.whenNeeded),
        decisionCriteria: optional(draft.worthwhile) ? [draft.worthwhile] : undefined,
        machinery:
          machinery && optional(draft.technicalPurpose)
            ? { application: draft.technicalPurpose }
            : undefined,
      },
      organiser: draft.job === 'delegations' ? optional(draft.organiser) : undefined,
      participants: draft.job === 'delegations' ? optional(draft.participants) : undefined,
    };
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || submitted.current) return;
    if (step < 4) {
      if (validate(groups[step])) move(step + 1);
      return;
    }
    if (!validate(groups.flat())) return;
    setBusy(true);
    setMessage('');
    persist(draft, step);
    try {
      const r = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.current,
          brief: briefSchema.parse({ ...draft, experience: experience() }),
          websiteCheck: '',
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErrors(data.fields ?? {});
        throw new Error(data.error);
      }
      submitted.current = true;
      setFinished(true);
      setMessage(
        data.duplicate
          ? 'This invented example request has already been recorded.'
          : 'Your invented example request has been recorded. No real customer mission has been accepted.',
      );
      if (data.receipt) {
        setReceipt(data.receipt);
        setCheckCode(data.receipt);
        try {
          sessionStorage.setItem('corridra-mission-receipt', data.receipt);
          sessionStorage.removeItem('corridra-mission-draft');
        } catch {
          setDraftNotice(
            'The request was recorded, but this browser could not save its receipt. Copy the private code before leaving.',
          );
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save. Your input is still here.');
    } finally {
      setBusy(false);
    }
  }
  async function check(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setResult(null);
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/intake/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt: checkCode }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to check receipt');
    } finally {
      setBusy(false);
    }
  }
  const field = (name: keyof Draft, label: string, type = 'text') => (
    <div className="field" key={name}>
      <label htmlFor={`brief-${name}`}>{label}</label>
      <input
        id={`brief-${name}`}
        type={type}
        value={String(draft[name])}
        onChange={(e) => change(name, e.target.value)}
        aria-invalid={!!errors[name]?.length}
        aria-describedby={errors[name]?.length ? `${name}-error` : undefined}
      />
      {errors[name]?.length && (
        <span id={`${name}-error`} className="field-error">
          {errors[name][0]}
        </span>
      )}
    </div>
  );
  const error = (name: string) =>
    errors[name]?.length ? (
      <p role="alert" className="field-error" id={`${name}-error`}>
        {errors[name][0]}
      </p>
    ) : null;
  return (
    <div className="ux-intake-layout">
      <aside className="intake-notice">
        <strong>Test intake is open. Real customer mission admission is unavailable.</strong> Use
        invented details and an email ending in @example.invalid. Keep your receipt to read operator
        replies here. Email delivery is not enabled.{' '}
        <Link href="/privacy">Read the test intake notice</Link>.
      </aside>
      <details lang="bn">
        <summary>বাংলায় সংক্ষিপ্ত নির্দেশনা</summary>
        <p>
          আপনি কী অর্জন করতে চান, প্রতিষ্ঠান কোন দেশে এবং কোন বাজারে কাজ করতে চান তা জানান। পণ্য,
          যন্ত্রপাতির প্রয়োজন, সময় এবং প্রত্যাশিত ফল সংক্ষেপে লিখুন। প্রতিটি প্রতিষ্ঠানের কাজ ও গোপন
          তথ্য আলাদা রাখা হয়।
        </p>
        <p>
          শুধু কাল্পনিক পরীক্ষামূলক তথ্য এবং @example.invalid ঠিকানা ব্যবহার করুন। প্রকৃত গ্রাহকের
          কাজ এখানে গ্রহণ করা হচ্ছে না। নথি এখন আপলোড করতে হবে না।
        </p>
      </details>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {draftNotice && (
        <p className="ux-draft-notice" aria-live="polite">
          {draftNotice}
        </p>
      )}
      {!finished && (
        <aside className="ux-brief-summary" aria-label="Your example request">
          <p className="label">YOUR EXAMPLE REQUEST</p>
          <dl>
            <div>
              <dt>Objective</dt>
              <dd>
                {missionCatalogue.find((item) => item.key === draft.job)?.label ?? 'Not chosen'}
              </dd>
            </div>
            <div>
              <dt>Company country</dt>
              <dd>
                {countryCodes.includes(draft.companyCountry as (typeof countryCodes)[number])
                  ? new Intl.DisplayNames(['en'], { type: 'region' }).of(draft.companyCountry)
                  : 'Not chosen'}
              </dd>
            </div>
            <div>
              <dt>Target market</dt>
              <dd>
                {draft.marketCode === 'EU'
                  ? 'European Union (trade bloc)'
                  : countryCodes.includes(draft.marketCode as (typeof countryCodes)[number])
                    ? new Intl.DisplayNames(['en'], { type: 'region' }).of(draft.marketCode)
                    : 'Not chosen'}
              </dd>
            </div>
            <div>
              <dt>Original budget</dt>
              <dd>
                {draft.budgetAmount
                  ? `${draft.budgetAmount} ${draft.currency || '(currency not chosen)'}`
                  : 'Not supplied'}
              </dd>
            </div>
          </dl>
          <p>Draft only. No admission, quotation, verification or payment is implied.</p>
        </aside>
      )}
      {!finished && (
        <form className="intake-form" onSubmit={submit} noValidate inert={!ready || busy}>
          <p className="label">STEP {step + 1} OF 5</p>
          <ol className="ux-intake-steps" aria-label="Request steps">
            {['Goal', 'Where', 'Details', 'Results', 'Contact'].map((label, index) => (
              <li key={label} aria-current={index === step ? 'step' : undefined}>
                <span>{index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <progress value={step + 1} max={5} aria-label="Request progress" />
          <h2 ref={heading} tabIndex={-1}>
            {titles[step]}
          </h2>
          {Object.values(errors).some((messages) => messages.length) && (
            <div ref={errorSummary} className="ux-error-summary" tabIndex={-1} role="alert">
              <strong>Check this step.</strong>
              <p>Review the highlighted fields before continuing. Your entries are still here.</p>
            </div>
          )}
          {step === 0 && (
            <fieldset>
              <legend className="sr-only">Mission objective</legend>
              {objectiveOptions.map((v) => (
                <label className="choice" key={v}>
                  <input
                    type="radio"
                    name="objective"
                    value={v}
                    checked={draft.objective === v}
                    onChange={() => change('objective', v)}
                  />
                  {v}
                </label>
              ))}
              {error('objective')}
              <label className="field">
                Commercial job
                <select value={draft.job} onChange={(e) => change('job', e.target.value)} required>
                  <option value="">Choose the job</option>
                  {missionCatalogue.map((job) => (
                    <option key={job.key} value={job.key}>
                      {job.label}
                    </option>
                  ))}
                </select>
              </label>
              {error('job')}
            </fieldset>
          )}
          {step === 1 && (
            <>
              <label className="field">
                Where is the company based?
                <select
                  value={draft.companyCountry}
                  onChange={(e) => change('companyCountry', e.target.value)}
                  required
                >
                  <option value="">Choose a country</option>
                  {countryCodes.map((code) => (
                    <option key={code} value={code}>
                      {new Intl.DisplayNames(['en'], { type: 'region' }).of(code)} ({code})
                    </option>
                  ))}
                </select>
              </label>
              {error('companyCountry')}
              <label className="field">
                Which market is involved?
                <select
                  value={draft.marketCode}
                  onChange={(e) => change('marketCode', e.target.value)}
                  required
                >
                  <option value="">Choose a market</option>
                  <option value="EU">European Union (trade bloc)</option>
                  {countryCodes.map((code) => (
                    <option key={code} value={code}>
                      {new Intl.DisplayNames(['en'], { type: 'region' }).of(code)} ({code})
                    </option>
                  ))}
                </select>
              </label>
              {error('marketCode')}
              <p>
                Company country and target market do not define shipment or meeting location.{' '}
                {draft.companyCountry &&
                  draft.marketCode &&
                  !(
                    draft.companyCountry === 'BD' && ['CN', 'ES', 'EU'].includes(draft.marketCode)
                  ) &&
                  'No operating offer is announced for this direction. You can still describe an invented test mission.'}
              </p>
              {field('whenNeeded', 'When is the activity needed? (optional)', 'date')}
              <fieldset>
                <legend>Will you be there in person?</legend>
                {['Yes', 'No', 'Not decided'].map((v) => (
                  <label className="choice" key={v}>
                    <input
                      type="radio"
                      name="attendance"
                      checked={draft.attendance === v}
                      onChange={() => change('attendance', v)}
                    />
                    {v}
                  </label>
                ))}
                {error('attendance')}
              </fieldset>
              {draft.attendance === 'Yes' && (
                <>
                  {field('startDate', 'From', 'date')}
                  {field('endDate', 'To', 'date')}
                  {field('timezone', 'Visit timezone')}
                </>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <label className="field">
                Your offer or requirement
                <textarea
                  rows={6}
                  maxLength={1000}
                  value={draft.offer}
                  onChange={(e) => change('offer', e.target.value)}
                  placeholder="Example: We manufacture hotel towels in Bangladesh and want to meet Spanish hospitality distributors buying private-label products."
                  aria-invalid={!!errors.offer?.length}
                  aria-describedby={errors.offer?.length ? 'offer-error' : undefined}
                />
                {error('offer')}
              </label>
              {draft.job === 'machinery_procurement' && (
                <>
                  {field('technicalPurpose', 'Technical purpose (optional)')}
                  {field('parameters', 'Key technical parameters (optional)')}
                  {field('preferences', 'Site, integration or after-sales constraints (optional)')}
                </>
              )}
              {['sourcing', 'supplier_evaluation', 'factory_visits'].includes(draft.job) && (
                <>
                  {field('parameters', 'Product specifications (optional)')}
                  {field('quantity', 'Required quantity (optional)')}
                  {field('unit', 'Quantity unit (required with quantity)')}
                  {field('preferences', 'Supplier preferences and constraints (optional)')}
                </>
              )}
              {[
                'buyers',
                'distributors',
                'customers',
                'market_entry',
                'export_market_access',
              ].includes(draft.job) && (
                <>
                  {field('parameters', 'Target buyer or distributor (optional)')}
                  {field('preferences', 'Commercial readiness and constraints (optional)')}
                </>
              )}
              {draft.job === 'delegations' && (
                <>
                  {field('organiser', 'Delegation organiser (optional)')}
                  {field(
                    'participants',
                    'Participating organisations and individual needs (optional)',
                  )}
                  <p>
                    Each participant receives an independent mission. Private offers and contacts
                    are not shared with the organiser automatically.
                  </p>
                </>
              )}
              {['sourcing', 'machinery_procurement'].includes(draft.job) && (
                <details>
                  <summary>Budget context (optional)</summary>
                  {field('budgetAmount', 'Budget in original currency (optional)')}
                  <label className="field">
                    Original currency
                    <select
                      value={draft.currency}
                      onChange={(e) => change('currency', e.target.value)}
                    >
                      <option value="">No budget supplied</option>
                      {Object.entries(currencies).map(([code, places]) => (
                        <option value={code} key={code}>
                          {code} ({places} decimal places)
                        </option>
                      ))}
                    </select>
                  </label>
                  {field('budgetBasis', 'Budget basis, such as total equipment budget')}
                  <p>
                    Enter the amount as quoted, such as CNY 12.00 or BHD 1.234. Use the selected
                    currency’s decimal places. No currency conversion is performed.
                  </p>
                </details>
              )}
              {error('requirements')}
              {field('website', 'Website or catalogue URL (optional)', 'url')}
              <p>
                Share a public link if it helps explain the request. We do not fetch it
                automatically. Documents can be requested after review.
              </p>
            </>
          )}
          {step === 3 && (
            <>
              {field('worthwhile', 'What outcome would make the engagement worthwhile? (optional)')}
              <fieldset>
                <legend>Desired outcomes</legend>
                {outcomeOptions.map((v) => (
                  <label className="choice" key={v}>
                    <input
                      type="checkbox"
                      checked={draft.outcomes.includes(v)}
                      onChange={(e) =>
                        change(
                          'outcomes',
                          e.target.checked
                            ? [...draft.outcomes, v]
                            : draft.outcomes.filter((o) => o !== v),
                        )
                      }
                    />
                    {v}
                  </label>
                ))}
                {error('outcomes')}
              </fieldset>
              <label className="field">
                Anything specific we should know? (optional)
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={draft.notes}
                  onChange={(e) => change('notes', e.target.value)}
                />
                {error('notes')}
              </label>
            </>
          )}
          {step === 4 && (
            <>
              {field('name', 'Name')}
              {field('company', 'Company')}
              {field('email', 'Work email', 'email')}
              <label className="choice">
                <input
                  type="checkbox"
                  checked={draft.acknowledged}
                  onChange={(e) => change('acknowledged', e.target.checked)}
                />
                I have read the test intake notice and am submitting invented test details.
              </label>
              {error('acknowledged')}
              <p>
                No account required. Corridra will review the request before proposing next steps.
                Check your receipt here for replies.
              </p>
            </>
          )}
          <div className="hero-actions">
            {step > 0 && (
              <button
                type="button"
                className="text-link"
                onClick={() => move(step - 1)}
                disabled={busy}
              >
                Back
              </button>
            )}
            <button className="primary-link" disabled={!ready || busy}>
              {busy ? 'Saving…' : step === 4 ? 'Submit mission request' : 'Continue'}
            </button>
          </div>
          <p>
            When browser storage is available, drafts stay in this tab for up to 24 hours.{' '}
            <button
              className="text-link"
              type="button"
              onClick={() => {
                key.current = crypto.randomUUID();
                setDraft(empty);
                setDraftNotice('');
                setStep(0);
                setErrors({});
                persist(empty, 0);
              }}
            >
              Clear draft
            </button>
          </p>
        </form>
      )}
      {receipt && (
        <div className="detail-card">
          <h2>Keep your private receipt.</h2>
          <p>
            Anyone with this code can read the mission status and replies. Save it before closing
            this tab. It expires after 30 days.
          </p>
          <label className="field">
            Private receipt code
            <input readOnly value={receipt} />
          </label>
        </div>
      )}
      {finished && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            submitted.current = false;
            key.current = crypto.randomUUID();
            setFinished(false);
            setDraftNotice('');
            setReceipt('');
            setDraft(empty);
            setStep(0);
            setMessage('');
            setErrors({});
            try {
              sessionStorage.removeItem('corridra-mission-receipt');
            } catch {}
            persist(empty, 0);
          }}
        >
          Start another request (save your receipt first)
        </button>
      )}
      <section id="receipt-check" tabIndex={-1} className="receipt-panel">
        <h2>Check a mission request.</h2>
        <form className="operator-form" onSubmit={check}>
          <label className="field">
            Receipt code
            <input
              required
              value={checkCode}
              onChange={(e) => setCheckCode(e.target.value)}
              autoComplete="off"
              maxLength={64}
            />
          </label>
          <button className="primary-link" disabled={!ready || busy}>
            Check status and replies
          </button>
        </form>
        {result && (
          <div>
            <p>
              Status: <strong>{result.status.replaceAll('_', ' ')}</strong>
            </p>
            {result.replies.length ? (
              result.replies.map((r, i) => (
                <article className="detail-card" key={i}>
                  <p>{r.body}</p>
                  <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                </article>
              ))
            ) : (
              <p>No operator reply yet.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
