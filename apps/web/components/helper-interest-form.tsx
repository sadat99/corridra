'use client';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { helperInterestCopy } from '../lib/access-doors';

type Copy = typeof helperInterestCopy;
type Phase = 'about' | 'reason' | 'sending' | 'done';

/**
 * The helper interest form on the Team and Network Access page (ADR-0085). Two short steps (the design contract allows one
 * to three fields a step): who you are, then why. It sends one request and shows one acknowledgement on the screen. It creates
 * no account, keeps nothing in the browser and sends no email. The hidden field is for programs: a person never sees it.
 * The country list arrives as children so the options are built on the server.
 */
export function HelperInterestForm({ copy, children }: { copy: Copy; children: ReactNode }) {
  const id = useId();
  const aboutStep = useRef<HTMLFieldSetElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('about');
  const [values, setValues] = useState({
    name: '',
    email: '',
    country: '',
    reason: '',
    website: '',
  });
  const [failure, setFailure] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (failure) setFailure(null);
  };

  function next() {
    const fields = aboutStep.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input,select',
    );
    for (const field of fields ?? []) if (!field.reportValidity()) return;
    setPhase('reason');
    // The next field takes focus once it is shown.
    setTimeout(() => reasonField.current?.focus(), 0);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (phase === 'about') return next();
    if (phase !== 'reason') return;
    if (!reasonField.current?.reportValidity()) return;
    setPhase('sending');
    setFailure(null);
    try {
      const response = await fetch('/api/helper-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (response.status === 202) {
        // Nothing the person typed stays in the page once it is sent.
        setValues({ name: '', email: '', country: '', reason: '', website: '' });
        setPhase('done');
        setTimeout(() => done.current?.focus(), 0);
        return;
      }
      setFailure(
        response.status === 429
          ? copy.tooMany
          : response.status === 404
            ? copy.closed
            : response.status === 400
              ? copy.check
              : copy.failed,
      );
    } catch {
      setFailure(copy.failed);
    }
    setPhase('reason');
  }

  if (phase === 'done')
    return (
      <div ref={done} tabIndex={-1} role="status" className="access-helper-done">
        <p>
          <strong>{copy.doneTitle}</strong>
        </p>
        <p>{copy.doneText}</p>
      </div>
    );

  const errorId = `${id}-error`;
  const left = 500 - values.reason.length;
  return (
    <form
      className="access-helper-form"
      onSubmit={send}
      noValidate
      aria-describedby={failure ? errorId : undefined}
    >
      <fieldset ref={aboutStep} hidden={phase !== 'about'} disabled={phase === 'sending'}>
        <legend>{copy.aboutLegend}</legend>
        <div className="field">
          <label htmlFor={`${id}-name`}>{copy.nameLabel}</label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            value={values.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>{copy.emailLabel}</label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            value={values.email}
            onChange={(e) => set('email')(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-country`}>{copy.countryLabel}</label>
          <select
            id={`${id}-country`}
            name="country"
            required
            autoComplete="country"
            value={values.country}
            onChange={(e) => set('country')(e.target.value)}
          >
            <option value="">{copy.countryPlaceholder}</option>
            {children}
          </select>
        </div>
        <div className="access-helper-actions">
          <button type="button" className="button" onClick={next}>
            {copy.next}
          </button>
        </div>
      </fieldset>
      <fieldset hidden={phase === 'about'} disabled={phase === 'sending'}>
        <legend>{copy.reasonLegend}</legend>
        <div className="field">
          <label htmlFor={`${id}-reason`}>{copy.reasonLabel}</label>
          <textarea
            ref={reasonField}
            id={`${id}-reason`}
            name="reason"
            required
            minLength={10}
            maxLength={500}
            rows={4}
            aria-describedby={`${id}-count`}
            value={values.reason}
            onChange={(e) => set('reason')(e.target.value)}
          />
          <p id={`${id}-count`} className="access-helper-count">
            {copy.count.replace('{n}', String(left))}
          </p>
        </div>
        {/* For programs only. A person never sees or reaches this field. */}
        <div className="access-hp" aria-hidden="true">
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => set('website')(e.target.value)}
          />
        </div>
        {failure ? (
          <p id={errorId} role="alert" className="field-error">
            {failure}
          </p>
        ) : null}
        <div className="access-helper-actions">
          <button type="submit" className="button">
            {phase === 'sending' ? copy.sending : copy.send}
          </button>
          <button type="button" className="button-secondary" onClick={() => setPhase('about')}>
            {copy.back}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
