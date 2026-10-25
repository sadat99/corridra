'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { currencies } from '@corridra/domain/currencies';
import type { Introduction } from '@corridra/domain/access';
import { checkedResponse, accessDenied } from '../../components/private-capability';
import { ParticipantScope } from '../../components/participant-scope';
import {
  buildReplyTerms,
  incoterms,
  noCharge,
  replyFields,
  replyGroups,
  shippingScopes,
  type ReplyGroup,
  type ReplyLanguage,
  type ReplyTermKey,
} from '../../lib/reply-terms';
import { expiryLine, receiptText, termValue, type RecordedReply } from '../../lib/reply-receipt';
import { fillReply, replyHtmlLang, replyWords } from '../../lib/reply-words';
import './reply-journey.css';

export type ReplyData = {
  role?: string;
  sharedRequirements?: string;
  sharedUncertainty?: string;
  allowQuotation?: boolean;
  allowMeetingInterest?: boolean;
  detailResponse?: { body: Record<string, unknown>; sourceKind: string };
  introduction: Introduction;
  template: string;
  expiresAt: string;
  decision: string | null;
};
export type ReplyDecision = 'INTERESTED' | 'NEED_INFO' | 'NOT_RELEVANT';
type Phase = 'answer' | 'message' | ReplyGroup | 'check' | 'receipt';

/**
 * The Reply Page (ADR-069): one question at a time. The answer, then for Interested a short message and an
 * optional quote in four small steps, a check of what was typed, and a receipt. It sends the same command
 * the older form sent, so the database and its rules are unchanged. Everything a supplier types is kept in
 * this page's memory only; the address fragment holds the private link and nothing else is stored.
 */
export function ReplyJourney({
  data,
  token,
  language,
  ask,
  busy,
  pending,
  declined,
  optOut,
  onOptOut,
  onRespond,
  onStop,
  onAccessDenied,
}: {
  data: ReplyData;
  token: string;
  language: ReplyLanguage;
  ask: readonly ReplyTermKey[];
  busy: boolean;
  pending: ReplyDecision | null;
  declined: boolean;
  optOut: boolean;
  onOptOut: (value: boolean) => void;
  onRespond: (decision: ReplyDecision) => void;
  onStop: () => void;
  onAccessDenied: () => void;
}) {
  const words = replyWords[language];
  const detailOpen = !!data.sharedRequirements && !data.detailResponse;
  const [phase, setPhase] = useState<Phase>('answer');
  const [body, setBody] = useState('');
  const [meeting, setMeeting] = useState(false);
  const [quote, setQuote] = useState(false);
  const [currency, setCurrency] = useState('');
  const [values, setValues] = useState<Partial<Record<string, string>>>({});
  const [uncertainties, setUncertainties] = useState('');
  const [amountMode, setAmountMode] = useState<Partial<Record<string, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const [command, setCommand] = useState<Record<string, unknown> | null>(null);
  const [sent, setSent] = useState<{ reply: RecordedReply; at: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const responseId = useRef('');
  const inFlight = useRef(false);

  // What step the person is on. A decision made earlier (or on another visit) moves the page on.
  const effective: Phase =
    sent || data.detailResponse
      ? 'receipt'
      : phase === 'answer' && data.decision
        ? data.decision === 'INTERESTED' && detailOpen
          ? 'message'
          : 'receipt'
        : phase;
  const firstRender = useRef(true);
  useEffect(() => {
    // Move focus to the new step's heading, but not when the page first opens.
    if (firstRender.current) firstRender.current = false;
    else heading.current?.focus();
  }, [effective]);

  const order: Phase[] = useMemo(
    () => ['answer', 'message', ...(quote ? replyGroups : []), 'check'],
    [quote],
  );
  const stepNumber = Math.max(1, order.indexOf(effective) + 1);
  const stepLine = fillReply(words.step, { n: String(stepNumber), total: String(order.length) });

  const keysOf = (group: ReplyGroup) =>
    replyFields.filter((field) => field.group === group).map((field) => field.key);
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  function leave(from: Phase, to: Phase) {
    // Going forward checks the step that is being left; going back never blocks.
    if (to !== 'receipt' && order.indexOf(to) > order.indexOf(from)) {
      if (from === 'message' && body.trim().length < 3) {
        setErrors({ body: words.messageTooShort });
        return;
      }
      if ((replyGroups as readonly Phase[]).includes(from)) {
        const result = buildReplyTerms(values, currency, keysOf(from as ReplyGroup));
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        // A quote always names its currency: the database refuses one that does not.
        if (from === 'price' && !Object.hasOwn(currencies, currency)) {
          setErrors({ currency: 'currency' });
          return;
        }
        if (from === 'included' && uncertainties.trim().length < 3) {
          setErrors({ uncertainties: words.errors.text });
          return;
        }
      }
    }
    setErrors({});
    setPhase(to);
  }

  const built = useMemo(
    () => (quote ? buildReplyTerms(values, currency) : null),
    [quote, values, currency],
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!acknowledged) {
      setErrors({ acknowledged: words.notAcknowledged });
      return;
    }
    if (quote && !Object.hasOwn(currencies, currency)) {
      setErrors({ currency: 'currency' });
      setPhase('price');
      return;
    }
    if (quote && built && !built.ok) {
      // Cannot normally happen (each step is checked), but never send what does not build.
      const first = replyFields.find((spec) => built.errors[spec.key]);
      setErrors(built.errors);
      if (first) setPhase(first.group);
      else if (built.errors.currency) setPhase('price');
      return;
    }
    inFlight.current = true;
    setSending(true);
    setProblem('');
    try {
      if (!responseId.current) responseId.current = crypto.randomUUID();
      const message = command ?? {
        action: 'detail-response',
        token,
        responseId: responseId.current,
        body: body.trim(),
        meetingInterest: meeting,
        quotation:
          quote && built?.ok
            ? { currency, terms: built.terms, uncertainties: uncertainties.trim() }
            : null,
        acknowledged: true,
      };
      // A failed send keeps the exact message, so a retry sends the same thing under the same id.
      setCommand(message);
      const response = await fetch('/api/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        cache: 'no-store',
      });
      await checkedResponse(response);
      await response.json();
      setSent({
        at: new Date(),
        reply: {
          body: String(message.body),
          meetingInterest: message.meetingInterest === true,
          quotation: message.quotation as RecordedReply['quotation'],
        },
      });
      setCommand(null);
    } catch (error) {
      if (accessDenied(error)) onAccessDenied();
      setProblem(error instanceof Error ? error.message : 'Your answer could not be recorded.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const recorded: RecordedReply | null = sent
    ? sent.reply
    : data.detailResponse
      ? {
          body: String(data.detailResponse.body.body ?? ''),
          meetingInterest: data.detailResponse.body.meetingInterest === true,
          quotation: (data.detailResponse.body.quotation as RecordedReply['quotation']) ?? null,
        }
      : null;
  const storedAt = (data.detailResponse as { createdAt?: string } | undefined)?.createdAt;
  const receipt = recorded
    ? receiptText(recorded, words, sent?.at ?? (storedAt ? new Date(storedAt) : new Date()))
    : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(receipt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const field = (key: ReplyTermKey) => {
    const spec = replyFields.find((item) => item.key === key)!;
    const error = errors[key];
    const asked = ask.includes(key);
    const id = `reply-${key}`;
    const label = (
      <>
        {words.fields[key]}
        {asked && <span className="reply-asked">{words.askedMark}</span>}
      </>
    );
    const common = {
      id,
      name: key,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${id}-error` : words.hints[key] ? `${id}-hint` : undefined,
    };
    let control;
    if (spec.kind === 'incoterm')
      control = (
        <select {...common} value={values[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
          <option value="">{words.chooseOne}</option>
          {incoterms.map((term) => (
            <option key={term} value={term}>
              {term}
            </option>
          ))}
        </select>
      );
    else if (spec.kind === 'shipping')
      control = (
        <select {...common} value={values[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
          <option value="">{words.chooseOne}</option>
          {shippingScopes
            .filter((scope) => scope !== 'NOT_SUPPLIED')
            .map((scope) => (
              <option key={scope} value={scope}>
                {words.shippingValues[scope]}
              </option>
            ))}
        </select>
      );
    else if (spec.kind === 'charge')
      control = (
        <div className="reply-charge">
          <select
            {...common}
            value={values[key] === noCharge ? noCharge : amountMode[key] ? 'AMOUNT' : ''}
            onChange={(e) => {
              setAmountMode((current) => ({ ...current, [key]: e.target.value === 'AMOUNT' }));
              set(key, e.target.value === noCharge ? noCharge : '');
            }}
          >
            <option value="">{words.notStated}</option>
            <option value={noCharge}>{words.noCharge}</option>
            <option value="AMOUNT">{words.chargeAmount}</option>
          </select>
          {amountMode[key] && values[key] !== noCharge && (
            <input
              inputMode="decimal"
              maxLength={24}
              aria-label={words.fields[key]}
              value={values[key] ?? ''}
              onChange={(e) => set(key, e.target.value)}
            />
          )}
        </div>
      );
    else if (spec.kind === 'date')
      control = (
        <input
          {...common}
          type="date"
          value={values[key] ?? ''}
          onChange={(e) => set(key, e.target.value)}
        />
      );
    else
      control = (
        <input
          {...common}
          value={values[key] ?? ''}
          maxLength={spec.kind === 'text' ? 1000 : spec.kind === 'unit' ? 80 : 24}
          inputMode={
            spec.kind === 'amount' ? 'decimal' : spec.kind === 'integer' ? 'numeric' : undefined
          }
          onChange={(e) => set(key, e.target.value)}
        />
      );
    return (
      <div className="reply-field" key={key} data-asked={asked ? 'true' : undefined}>
        <label htmlFor={id}>{label}</label>
        {control}
        {words.hints[key] && !error && (
          <p id={`${id}-hint`} className="reply-hint">
            {words.hints[key]}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="reply-error" role="alert">
            {words.errors[error as keyof typeof words.errors] ?? error}
          </p>
        )}
      </div>
    );
  };

  const nav = (back: Phase | null, nextLabel: string, next: Phase | null, extra?: ReactNode) => (
    <div className="reply-actions">
      {back && (
        <button type="button" className="secondary-link" onClick={() => leave(effective, back)}>
          {words.back}
        </button>
      )}
      {next && (
        <button type="button" className="primary-link" onClick={() => leave(effective, next)}>
          {nextLabel}
        </button>
      )}
      {extra}
    </div>
  );

  const askedHere = (group: ReplyGroup) => ask.filter((key) => keysOf(group).includes(key));
  const lang = replyHtmlLang[language];

  return (
    <div className="reply" lang={lang.lang} dir={lang.dir} data-phase={effective}>
      <p className="reply-sample">{words.sampleOnly}</p>
      <ParticipantScope
        purpose={data.introduction.conversationPurpose}
        expiresAt={data.expiresAt}
        audience={data.role ? `${data.role.toLowerCase()} request` : 'Private buyer introduction'}
      />
      {effective !== 'receipt' && <p className="reply-step">{stepLine}</p>}

      {effective === 'answer' && (
        <section aria-labelledby="reply-h">
          <h2 id="reply-h" ref={heading} tabIndex={-1}>
            {words.answerQuestion}
          </h2>
          <details className="reply-about">
            <summary>{words.aboutIntro}</summary>
            <div lang="en" dir="ltr">
              <p>{data.template}</p>
              <dl className="buyer-details">
                {(
                  [
                    ['Company', data.introduction.company],
                    ['Country', data.introduction.country],
                    ['Relevant capability', data.introduction.capability],
                    ['Why there may be a fit', data.introduction.fit],
                    ['What remains unverified', data.introduction.uncertainty],
                    ['Purpose of conversation', data.introduction.conversationPurpose],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
          {data.sharedRequirements && (
            <div className="reply-shared" lang="en" dir="ltr">
              <h3>{words.requirementLabel}</h3>
              <p>{data.sharedRequirements}</p>
              {data.sharedUncertainty && <p>{data.sharedUncertainty}</p>}
            </div>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={optOut}
              disabled={busy || !!pending}
              onChange={(e) => onOptOut(e.target.checked)}
            />
            {words.optOut}
          </label>
          <div className="reply-actions">
            {(
              [
                ['INTERESTED', words.interested],
                ['NEED_INFO', words.needInfo],
                ['NOT_RELEVANT', words.notRelevant],
              ] as const
            ).map(([decision, label]) => (
              <button
                key={decision}
                className={decision === 'INTERESTED' ? 'primary-link' : 'secondary-link'}
                disabled={busy || !!pending || declined || (optOut && decision === 'INTERESTED')}
                onClick={() => onRespond(decision)}
              >
                {label}
              </button>
            ))}
          </div>
          {pending && (
            <button className="primary-link" disabled={busy} onClick={() => onRespond(pending)}>
              {words.retrySame}
            </button>
          )}
          {!declined && (
            <button className="text-link" disabled={busy || !!pending} onClick={onStop}>
              {words.stop}
            </button>
          )}
        </section>
      )}

      {effective === 'message' && (
        <section aria-labelledby="reply-h">
          <h2 id="reply-h" ref={heading} tabIndex={-1}>
            {words.stepMessage}
          </h2>
          <div className="reply-field">
            <label htmlFor="reply-body">{words.messageLabel}</label>
            <textarea
              id="reply-body"
              value={body}
              maxLength={1000}
              rows={4}
              aria-invalid={errors.body ? true : undefined}
              aria-describedby="reply-body-hint"
              onChange={(e) => setBody(e.target.value)}
            />
            <p id="reply-body-hint" className="reply-hint">
              {words.messageHelp}
            </p>
            {errors.body && (
              <p className="reply-error" role="alert">
                {errors.body}
              </p>
            )}
          </div>
          {data.allowMeetingInterest && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={meeting}
                onChange={(e) => setMeeting(e.target.checked)}
              />
              {words.meetingInterest}
            </label>
          )}
          {ask.length > 0 && data.allowQuotation && (
            <p className="reply-note" role="note">
              {words.askedTitle}: {ask.map((key) => words.fields[key]).join(', ')}
            </p>
          )}
          <div className="reply-actions">
            {data.allowQuotation && (
              <button
                type="button"
                className="primary-link"
                onClick={() => {
                  if (body.trim().length < 3) return setErrors({ body: words.messageTooShort });
                  setQuote(true);
                  setErrors({});
                  setPhase('what');
                }}
              >
                {words.addQuote}
              </button>
            )}
            <button
              type="button"
              className={data.allowQuotation ? 'secondary-link' : 'primary-link'}
              onClick={() => {
                if (body.trim().length < 3) return setErrors({ body: words.messageTooShort });
                setQuote(false);
                setErrors({});
                setPhase('check');
              }}
            >
              {data.allowQuotation ? words.skipQuote : words.next}
            </button>
          </div>
        </section>
      )}

      {(replyGroups as readonly Phase[]).includes(effective) && (
        <section aria-labelledby="reply-h">
          <h2 id="reply-h" ref={heading} tabIndex={-1}>
            {words.stepQuote[effective as ReplyGroup]}
          </h2>
          <p className="reply-hint">{words.quoteIntro}</p>
          {askedHere(effective as ReplyGroup).length > 0 && (
            <p className="reply-note" role="note">
              {words.askedTitle}:{' '}
              {askedHere(effective as ReplyGroup)
                .map((k) => words.fields[k])
                .join(', ')}
            </p>
          )}
          {effective === 'price' && (
            <div className="reply-field">
              <label htmlFor="reply-currency">{words.currency}</label>
              <select
                id="reply-currency"
                value={currency}
                aria-invalid={errors.currency ? true : undefined}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="">{words.chooseCurrency}</option>
                {Object.keys(currencies).map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
              {errors.currency && (
                <p className="reply-error" role="alert">
                  {words.errors.currency}
                </p>
              )}
            </div>
          )}
          {keysOf(effective as ReplyGroup).map((key) => field(key))}
          {effective === 'included' && (
            <div className="reply-field">
              <label htmlFor="reply-uncertainties">{words.uncertainties}</label>
              <textarea
                id="reply-uncertainties"
                rows={3}
                maxLength={1000}
                value={uncertainties}
                aria-invalid={errors.uncertainties ? true : undefined}
                aria-describedby="reply-uncertainties-hint"
                onChange={(e) => setUncertainties(e.target.value)}
              />
              <p id="reply-uncertainties-hint" className="reply-hint">
                {words.uncertaintiesHelp}
              </p>
              {errors.uncertainties && (
                <p className="reply-error" role="alert">
                  {errors.uncertainties}
                </p>
              )}
            </div>
          )}
          {nav(
            order[order.indexOf(effective) - 1],
            words.next,
            order[order.indexOf(effective) + 1],
          )}
        </section>
      )}

      {effective === 'check' && (
        <form onSubmit={send} noValidate aria-labelledby="reply-h">
          <h2 id="reply-h" ref={heading} tabIndex={-1}>
            {words.stepCheck}
          </h2>
          <p>{words.checkIntro}</p>
          <h3>{words.checkYourAnswer}</h3>
          <p className="reply-typed">{body}</p>
          {meeting && <p>{words.checkMeeting}</p>}
          {quote && built?.ok ? (
            <>
              <h3>
                {words.checkQuote} ({currency || words.notStated})
              </h3>
              <dl className="reply-summary">
                {replyFields.map((spec) => (
                  <div key={spec.key}>
                    <dt>{words.fields[spec.key]}</dt>
                    <dd data-state={built.terms[spec.key] === undefined ? 'blank' : 'given'}>
                      {termValue(spec.key, built.terms[spec.key], currency, words)}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>{words.uncertainties}</dt>
                  <dd className="reply-typed">{uncertainties}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>{words.checkNoQuote}</p>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            {words.acknowledge}
          </label>
          {errors.acknowledged && (
            <p className="reply-error" role="alert">
              {errors.acknowledged}
            </p>
          )}
          {problem && (
            <p className="reply-error" role="alert">
              {problem}
            </p>
          )}
          <div className="reply-actions">
            <button
              type="button"
              className="secondary-link"
              disabled={sending || !!command}
              onClick={() => leave('check', quote ? 'included' : 'message')}
            >
              {words.back}
            </button>
            <button className="primary-link" disabled={sending}>
              {sending ? words.sending : command ? words.retrySame : words.send}
            </button>
          </div>
        </form>
      )}

      {effective === 'receipt' && (
        <section aria-labelledby="reply-h">
          <h2 id="reply-h" ref={heading} tabIndex={-1}>
            {words.receiptTitle}
          </h2>
          {recorded ? (
            <>
              <p>{words.receiptIntro}</p>
              <pre className="reply-receipt" tabIndex={0}>
                {receipt}
              </pre>
              <div className="reply-actions">
                <button type="button" className="secondary-link" onClick={copy}>
                  {copied ? words.receiptCopied : words.receiptCopy}
                </button>
                <a
                  className="text-link"
                  download="corridra-receipt.txt"
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(receipt)}`}
                >
                  {words.receiptDownload}
                </a>
              </div>
            </>
          ) : (
            <p>{words.recorded}</p>
          )}
        </section>
      )}

      <p className="reply-foot">{words.noMailingList}</p>
      <p className="reply-foot">{expiryLine(words, data.expiresAt)}</p>
    </div>
  );
}
