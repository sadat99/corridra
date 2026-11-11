'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { problemReportCategories, problemReportLimits } from '@corridra/domain/problem-report';
import '../mr/first-question.css';
import './problem-reports.css';
import { CorridraIcon } from '../corridra-icon';
import { JourneyBar } from '../journey-bar';
import {
  attemptFor,
  draftErrors,
  fileBody,
  fileFailure,
  fileProblemReport,
  type Attempt,
  type Draft,
  type DraftErrors,
  type FailureLine,
  type FromPage,
  type ReportTarget,
} from '../../lib/problem-report-client';
import type { ReportLinks } from '../../lib/problem-report-links';
import {
  categoryWords,
  formWords,
  reviewSentence,
  type ReportSide,
} from '../../lib/problem-report-words';
import { ReportFailure } from './failure-line';

type Step = 'one' | 'two' | 'sent';

/**
 * Report a Problem: what went wrong, where, and a few words, then a check and one send. The words stay in this page's
 * memory only (never in browser storage), so a failed send loses nothing and a closed tab keeps nothing. One send at a
 * time; the same command id answers every retry of the same words, so a dropped connection never files twice.
 */
export function ProblemReportForm({
  target,
  links,
  from,
}: {
  target: ReportTarget;
  links: ReportLinks;
  /** The page the person came from, when it is a page of their own shell. */
  from: FromPage | null;
}) {
  const side: ReportSide = target.side;
  const [step, setStep] = useState<Step>('one');
  const [draft, setDraft] = useState<Draft>({
    category: '',
    where: from ? 'this_page' : 'another_page',
    pageText: '',
    detail: '',
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<FailureLine | null>(null);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState('');
  const attempt = useRef<Attempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const shownStep = useRef<Step>('one');
  const ids = { category: useId(), page: useId(), detail: useId() };
  const detailRequired = draft.category === 'something_else';
  const change = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  // A new step puts focus on its heading; a refused step or an Edit puts it on the control that needs it. Nothing takes
  // focus when the page first opens.
  useEffect(() => {
    const id = pendingFocus.current;
    pendingFocus.current = null;
    if (id) document.getElementById(id)?.focus();
    else if (shownStep.current !== step) heading.current?.focus();
    shownStep.current = step;
  }, [step, errors]);

  function carryOn() {
    const found = draftErrors(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      pendingFocus.current = found.category
        ? `${ids.category}-first`
        : found.page
          ? ids.page
          : ids.detail;
      return;
    }
    setFailure(null);
    setStep('two');
  }

  function edit(focusOn: string) {
    pendingFocus.current = focusOn;
    setStep('one');
  }

  async function send() {
    if (sending) return;
    const body = fileBody(draft, from?.masked ?? null);
    attempt.current = attemptFor(attempt.current, JSON.stringify(body), () => crypto.randomUUID());
    setSending(true);
    setFailure(null);
    const reply = await fileProblemReport(target, attempt.current.id, body);
    setSending(false);
    if (reply.ok) {
      setReference(reply.value.reference);
      setStep('sent');
    } else setFailure(fileFailure(reply.status, reply.code));
  }

  if (step === 'sent')
    return (
      <section className="pr-column" role="status">
        <h2 ref={heading} tabIndex={-1}>
          {formWords.sentTitle}
        </h2>
        <p>{formWords.sentReference(reference)}</p>
        <p>{reviewSentence(side)}</p>
        <p>{formWords.sentNoEmail}</p>
        <div className="pr-actions">
          <a className="primary-link" href={links.list}>
            {formWords.seeList}
          </a>
          {from ? (
            <a className="text-link" href={from.returnTo}>
              {formWords.goBack}
            </a>
          ) : null}
        </div>
      </section>
    );

  if (step === 'two')
    return (
      <section className="pr-column" aria-busy={sending}>
        <h2 ref={heading} tabIndex={-1}>
          {formWords.stepTwoTitle}
        </h2>
        <JourneyBar steps={formWords.steps} current={1} label={formWords.stepsLabel} />
        <p>{formWords.stepTwoIntro}</p>
        <dl className="pr-summary">
          <div>
            <dt>{formWords.summaryWhat}</dt>
            <dd>
              {draft.category ? categoryWords[draft.category].label : ''}{' '}
              <button
                type="button"
                className="text-link"
                aria-label={formWords.editWhat}
                onClick={() => edit(`${ids.category}-first`)}
              >
                {formWords.edit}
              </button>
            </dd>
          </div>
          <div>
            <dt>{formWords.summaryWhere}</dt>
            <dd>
              {draft.where === 'this_page' && from ? (
                <>
                  {formWords.thisPage}: <code>{from.masked}</code>
                </>
              ) : (
                draft.pageText.trim()
              )}{' '}
              <button
                type="button"
                className="text-link"
                aria-label={formWords.editWhere}
                onClick={() => edit(draft.where === 'this_page' ? `${ids.page}-this` : ids.page)}
              >
                {formWords.edit}
              </button>
            </dd>
          </div>
          <div>
            <dt>{formWords.summaryDetail}</dt>
            <dd>
              {draft.detail.trim() || formWords.nothingAdded}{' '}
              <button
                type="button"
                className="text-link"
                aria-label={formWords.editDetail}
                onClick={() => edit(ids.detail)}
              >
                {formWords.edit}
              </button>
            </dd>
          </div>
        </dl>
        {failure ? (
          <ReportFailure failure={failure} links={links} listLabel={formWords.seeList} />
        ) : null}
        <div className="pr-actions">
          <button
            type="button"
            className="primary-link"
            disabled={sending}
            onClick={() => void send()}
          >
            {sending ? formWords.sending : formWords.send}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={sending}
            onClick={() => setStep('one')}
          >
            {formWords.back}
          </button>
        </div>
      </section>
    );

  return (
    <form
      className="pr-column"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        carryOn();
      }}
    >
      <h2 ref={heading} tabIndex={-1}>
        {formWords.stepOneTitle}
      </h2>
      <p className="pr-meta">{formWords.stepOneMeta}</p>
      <JourneyBar steps={formWords.steps} current={0} label={formWords.stepsLabel} />
      <fieldset aria-describedby={errors.category ? `${ids.category}-error` : undefined}>
        <legend className="sr-only">{formWords.stepOneTitle}</legend>
        <div className="mr-fq-grid">
          {problemReportCategories.map((key, index) => (
            <label key={key} className="mr-fq-card" data-checked={draft.category === key}>
              <input
                type="radio"
                name="category"
                value={key}
                id={index === 0 ? `${ids.category}-first` : undefined}
                checked={draft.category === key}
                onChange={() => change({ category: key })}
              />
              <CorridraIcon name={categoryWords[key].icon} />
              <span>
                <b>{categoryWords[key].label}</b>
                <small>{categoryWords[key].hint}</small>
              </span>
              <span className="mr-fq-check" aria-hidden="true">
                <CorridraIcon name="check" />
              </span>
            </label>
          ))}
        </div>
        {errors.category ? (
          <p id={`${ids.category}-error`} className="field-error" role="alert">
            {errors.category}
          </p>
        ) : null}
      </fieldset>
      <fieldset>
        {from ? (
          <>
            <legend>{formWords.whereLegend}</legend>
            <div className="guide-options">
              <label className="choice">
                <input
                  type="radio"
                  name="where"
                  id={`${ids.page}-this`}
                  checked={draft.where === 'this_page'}
                  aria-describedby={`${ids.page}-path`}
                  onChange={() => change({ where: 'this_page' })}
                />
                <span>
                  {formWords.thisPage}
                  <br />
                  <code id={`${ids.page}-path`}>{from.masked}</code>
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="where"
                  checked={draft.where === 'another_page'}
                  onChange={() => change({ where: 'another_page' })}
                />
                {formWords.anotherPage}
              </label>
            </div>
          </>
        ) : (
          <legend className="sr-only">{formWords.whereLegend}</legend>
        )}
        {draft.where === 'another_page' ? (
          <div className="field">
            <label htmlFor={ids.page}>{formWords.pageField}</label>
            <input
              id={ids.page}
              type="text"
              value={draft.pageText}
              maxLength={problemReportLimits.pageText}
              aria-invalid={errors.page ? true : undefined}
              aria-describedby={`${ids.page}-hint${errors.page ? ` ${ids.page}-error` : ''}`}
              onChange={(event) => change({ pageText: event.target.value })}
            />
            <span id={`${ids.page}-hint`} className="guide-hint">
              {formWords.pageHint}
            </span>
            {errors.page ? (
              <span id={`${ids.page}-error`} className="field-error" role="alert">
                {errors.page}
              </span>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      <div className="field">
        <label htmlFor={ids.detail}>
          {formWords.detailLabel}
          <span className="pr-tag">{detailRequired ? formWords.required : formWords.optional}</span>
        </label>
        <textarea
          id={ids.detail}
          rows={4}
          value={draft.detail}
          maxLength={problemReportLimits.detail}
          aria-required={detailRequired}
          aria-invalid={errors.detail ? true : undefined}
          aria-describedby={`${ids.detail}-hint ${ids.detail}-count${errors.detail ? ` ${ids.detail}-error` : ''}`}
          onChange={(event) => change({ detail: event.target.value })}
        />
        <span id={`${ids.detail}-hint`} className="guide-hint">
          {formWords.detailHint}
        </span>
        <span id={`${ids.detail}-count`} className="pr-meta">
          {formWords.counter([...draft.detail].length, problemReportLimits.detail)}
        </span>
        {errors.detail ? (
          <span id={`${ids.detail}-error`} className="field-error" role="alert">
            {errors.detail}
          </span>
        ) : null}
      </div>
      <div className="pr-actions">
        <button type="submit" className="primary-link">
          {formWords.continue}
        </button>
        <a className="text-link" href={from?.returnTo ?? links.home}>
          {formWords.notNow}
        </a>
      </div>
    </form>
  );
}
