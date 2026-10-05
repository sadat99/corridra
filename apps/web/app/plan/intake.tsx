'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  briefSchema,
  intakeSteps,
  objectiveOptions,
  outcomeOptions,
} from '@corridra/domain/missions';
type Draft = {
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
  objective: '',
  market: 'Spain',
  attendance: 'Not decided',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
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
  'What are you trying to do?',
  'Where?',
  'What are you offering or looking for?',
  'What would make this worthwhile?',
  'Where should we respond?',
];
function saveDraft(draft: Draft, step: number, key: string) {
  sessionStorage.setItem(
    'corridra-mission-draft',
    JSON.stringify({ draft, step, key, at: Date.now() }),
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
    [ready, setReady] = useState(false);
  const key = useRef(''),
    submitted = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem('corridra-mission-draft') ?? 'null');
        if (
          saved &&
          Date.now() - saved.at < 86400000 &&
          typeof saved.key === 'string' &&
          typeof saved.draft?.offer === 'string' &&
          Array.isArray(saved.draft.outcomes)
        ) {
          key.current = saved.key;
          setDraft({ ...empty, ...saved.draft });
          setStep(Math.max(0, Math.min(4, Number(saved.step) || 0)));
        }
        const token = sessionStorage.getItem('corridra-mission-receipt');
        if (token) {
          setReceipt(token);
          setCheckCode(token);
          setFinished(true);
          submitted.current = true;
        }
      } catch {
        /* Storage may be unavailable. The form still works. */
      } finally {
        setReady(true);
      }
    });
  }, []);
  function persist(v: Draft, n: number) {
    if (!key.current) key.current = crypto.randomUUID();
    try {
      saveDraft(v, n, key.current);
    } catch {}
  }
  function change(field: keyof Draft, value: string | boolean | string[]) {
    const v = { ...draft, [field]: value };
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
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  function move(n: number) {
    setStep(n);
    setErrors({});
    persist(draft, n);
    queueMicrotask(() => heading.current?.focus());
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
        body: JSON.stringify({ key: key.current, brief: draft, websiteCheck: '' }),
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
          ? 'This brief has already been received.'
          : 'Your mission brief has been received.',
      );
      if (data.receipt) {
        setReceipt(data.receipt);
        setCheckCode(data.receipt);
        try {
          sessionStorage.setItem('corridra-mission-receipt', data.receipt);
          sessionStorage.removeItem('corridra-mission-draft');
        } catch {}
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save. Your input is still here.');
    } finally {
      setBusy(false);
    }
  }
  async function check(e: FormEvent) {
    e.preventDefault();
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
      <p className="field-error" id={`${name}-error`}>
        {errors[name][0]}
      </p>
    ) : null;
  return (
    <>
      <aside className="intake-notice">
        <strong>Test intake is open.</strong> Use invented details and an email ending in
        @example.invalid. Keep your receipt to read operator replies here. Email delivery is not
        enabled. <Link href="/privacy">Read the test intake notice</Link>.
      </aside>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!finished && (
        <form className="intake-form" onSubmit={submit} noValidate inert={!ready || busy}>
          <p className="label">STEP {step + 1} OF 5</p>
          <progress value={step + 1} max={5} aria-label="Brief progress" />
          <h2 ref={heading} tabIndex={-1}>
            {titles[step]}
          </h2>
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
            </fieldset>
          )}
          {step === 1 && (
            <>
              {field('market', 'Target country / market')}
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
                  maxLength={2000}
                  value={draft.offer}
                  onChange={(e) => change('offer', e.target.value)}
                  placeholder="Example: We manufacture hotel towels in Bangladesh and want to meet Spanish hospitality distributors buying private-label products."
                  aria-invalid={!!errors.offer?.length}
                  aria-describedby={errors.offer?.length ? 'offer-error' : undefined}
                />
                {error('offer')}
              </label>
              {field('website', 'Website or catalogue URL (optional)', 'url')}
              <p>
                Share a public link if it helps explain the brief. We do not fetch it automatically.
                Documents can be requested after review.
              </p>
            </>
          )}
          {step === 3 && (
            <>
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
                No account required. Corridra will review the brief before proposing next steps.
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
              {busy ? 'Saving…' : step === 4 ? 'Submit mission brief' : 'Continue'}
            </button>
          </div>
          <p>
            Your draft stays in this browser tab for up to 24 hours.{' '}
            <button
              className="text-link"
              type="button"
              onClick={() => {
                key.current = crypto.randomUUID();
                setDraft(empty);
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
          Start another brief (save your receipt first)
        </button>
      )}
      <section className="receipt-panel">
        <h2>Check a mission brief.</h2>
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
    </>
  );
}
