'use client';
import { formatMoment } from '../../lib/ux/format';
import { useEffect, useRef, useState } from 'react';
import type { Introduction } from '@corridra/domain/access';
import {
  usePrivateCapability,
  checkedResponse,
  accessDenied,
} from '../../components/private-capability';
import { ParticipantScope } from '../../components/participant-scope';
import { RecipientResponse } from './recipient-response';
import { ReplyJourney } from './reply-journey';
import { parseReplyFragment } from '../../lib/reply-terms';
import { replyHtmlLang, replyWords } from '../../lib/reply-words';
import { linkGone } from '../delivery-view';
import { LinkStatus } from './link-status';
type View = {
  capability?: string;
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
  synthetic: boolean;
};
const labels = {
  INTERESTED: 'Interested',
  NEED_INFO: 'Need more information',
  NOT_RELEVANT: 'Not relevant',
} as const;
/**
 * The words for a read or an answer that did not go through. A link the server refuses (signed out, not allowed,
 * not found or gone) says the one shared line for a link that no longer opens. Any other failure keeps the reason
 * the server gave, and a failure with no reason says what to do next.
 */
export function refusalWords(error: unknown, gone: string, whenUnknown: string): string {
  if (accessDenied(error)) return gone;
  return error instanceof Error && error.message ? error.message : whenUnknown;
}
/**
 * The Reply Page keeps the failure words it has always had: the reason the error carries, whatever its kind, and
 * the given words only for a failure that is not an error at all. Nothing here is new wording.
 */
export function replyFailureWords(error: unknown, whenNotAnError: string): string {
  return error instanceof Error ? error.message : whenNotAnError;
}
export function BuyerIntroduction({
  replyPage = false,
  chineseReleased = false,
  beforeSend = false,
  steps = false,
}: {
  replyPage?: boolean;
  chineseReleased?: boolean;
  beforeSend?: boolean;
  steps?: boolean;
}) {
  const capability = usePrivateCapability();
  return (
    <ScopedIntroduction
      key={capability}
      capability={capability}
      replyPage={replyPage}
      chineseReleased={chineseReleased}
      beforeSend={beforeSend}
      steps={steps}
    />
  );
}
function ScopedIntroduction({
  capability,
  replyPage,
  chineseReleased,
  beforeSend,
  steps,
}: {
  capability: string;
  replyPage: boolean;
  chineseReleased: boolean;
  beforeSend: boolean;
  steps: boolean;
}) {
  // The Reply Page reads `t=<token>&l=<language>&ask=<terms>`; an older link is the bare token. With the
  // switch off the whole fragment is the token, exactly as before.
  const parsed = replyPage ? parseReplyFragment(capability) : null;
  // A draft language is never shown to a supplier before its native reviewer is recorded (the language
  // review record): until then a link that names Chinese opens in English.
  const fragment =
    parsed && parsed.language === 'zh' && !chineseReleased
      ? { ...parsed, language: 'en' as const }
      : parsed;
  const linkToken = fragment ? fragment.token : capability;
  const words = replyWords[fragment?.language ?? 'en'];
  // D-053: one line for a link that no longer opens, the same on every private page. The Reply Page keeps its own
  // words in the language of the link (lib/reply-words.ts) and, for a failed read or answer, the reason as before.
  const gone = replyPage ? words.unavailable : linkGone;
  const failed = (error: unknown, whenUnknown: string, replyWhenNotAnError: string) =>
    replyPage
      ? replyFailureWords(error, replyWhenNotAnError)
      : refusalWords(error, linkGone, whenUnknown);
  const [data, setData] = useState<View | null>(null),
    [message, setMessage] = useState(
      replyPage ? `${words.loading}…` : 'Loading your introduction…',
    ),
    [busy, setBusy] = useState(false),
    [optOut, setOptOut] = useState(false),
    [declined, setDeclined] = useState(false),
    [pending, setPending] = useState<{
      decision: keyof typeof labels;
      optOut: boolean;
      responseId: string;
    } | null>(null);
  const inFlight = useRef(false);
  const token = useRef(''),
    requestId = useRef('');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    token.current = linkToken;
    if (!/^[a-f0-9]{64}$/.test(token.current)) {
      Promise.resolve().then(() => {
        if (active) setMessage(gone);
      });
      return () => {
        active = false;
      };
    }
    fetch('/api/buyer', {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', token: token.current }),
      cache: 'no-store',
    })
      .then(async (r) => {
        await checkedResponse(r);
        const value = await r.json();
        return value as View;
      })
      .then((v) => {
        if (active) {
          setData({ ...v, capability: token.current });
          setMessage('');
        }
      })
      .catch((e) => {
        if (active) setMessage(failed(e, 'Your introduction could not be opened. Try again.', ''));
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the link decides everything here
  }, [capability]);
  async function respond(decision: keyof typeof labels) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const command = pending ?? { decision, optOut, responseId: requestId.current };
    setPending(command);
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respond',
          token: token.current,
          ...command,
        }),
        cache: 'no-store',
      });
      await checkedResponse(r);
      const v = await r.json();
      setData((current) => (current ? { ...current, decision: v.decision } : current));
      setMessage(replyPage ? words.recorded : 'Thank you. Your response has been recorded.');
      setPending(null);
      if (command.optOut) setDeclined(true);
    } catch (e) {
      if (accessDenied(e)) {
        setData(null);
        setPending(null);
      }
      setMessage(
        failed(
          e,
          'Your response could not be saved. Try again.',
          'Your response could not be saved. Try again.',
        ),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function stopContact() {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'optout', token: token.current }),
        cache: 'no-store',
      });
      await checkedResponse(r);
      await r.json();
      setDeclined(true);
      setMessage(
        'Your request has been recorded. Further introductions from this workspace are blocked.',
      );
    } catch (e) {
      if (accessDenied(e)) {
        setData(null);
        setPending(null);
      }
      setMessage(failed(e, 'Your request could not be saved. Try again.', 'Please try again.'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (replyPage && data && fragment)
    return (
      <section
        className="detail-card buyer-card"
        aria-label="Private introduction"
        lang={replyHtmlLang[fragment.language].lang}
        dir={replyHtmlLang[fragment.language].dir}
      >
        <p role="status" aria-live="polite">
          {message}
        </p>
        <ReplyJourney
          data={data}
          token={data.capability ?? ''}
          language={fragment.language}
          beforeSend={beforeSend}
          steps={steps}
          ask={fragment.ask}
          busy={busy}
          pending={pending ? pending.decision : null}
          declined={declined}
          optOut={optOut}
          onOptOut={setOptOut}
          onRespond={(decision) => void respond(decision)}
          onStop={() => void stopContact()}
          onAccessDenied={() => {
            setData(null);
            setMessage(gone);
          }}
        />
      </section>
    );
  // UI/UX.v4.1 L8: the link does not open. Told from the one refusal line alone, so nothing about the introduction
  // is read or shown; the card takes a caution edge, the line a lock, and the retry becomes the one primary action.
  const unavailable = !data && message === gone;
  return (
    <section
      className="detail-card buyer-card"
      aria-label="Private introduction"
      data-link-state={unavailable ? 'unavailable' : undefined}
    >
      <LinkStatus message={message} unavailable={unavailable} />
      {!data && message !== 'Loading your introduction…' && (
        <button
          className={unavailable ? 'primary-link' : 'text-link'}
          onClick={() => window.location.reload()}
        >
          Retry Private Introduction
        </button>
      )}
      {data && (
        <>
          {data.synthetic && (
            <p className="evidence-label" data-madeup-panel>
              (madeup) Sample introduction. No real outreach.
            </p>
          )}
          <ParticipantScope
            purpose={data.introduction.conversationPurpose}
            expiresAt={data.expiresAt}
            audience={
              data.role ? `${data.role.toLowerCase()} request` : 'Private buyer introduction'
            }
          />
          <p>{data.template}</p>
          {data.sharedRequirements && (
            <section>
              <h2>{data.role?.toLowerCase()} request</h2>
              <h3>Explicitly shared requirements</h3>
              <p>{data.sharedRequirements}</p>
              <p>Uncertainty: {data.sharedUncertainty}</p>
              <RecipientResponse
                token={data.capability ?? ''}
                onAccessDenied={() => {
                  setData(null);
                  setMessage(gone);
                }}
                allowQuotation={!!data.allowQuotation}
                allowMeetingInterest={!!data.allowMeetingInterest}
                response={data.detailResponse}
              />
            </section>
          )}
          <dl className="buyer-details">
            {(
              [
                ['Company', data.introduction.company],
                ['Country', data.introduction.country],
                ['Relevant capability', data.introduction.capability],
                ['Why there may be a fit', data.introduction.fit],
                ['Evidence highlights', data.introduction.evidence],
                ['What remains unverified', data.introduction.uncertainty],
                ['Purpose of conversation', data.introduction.conversationPurpose],
                ['Available dates', data.introduction.availableDates],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  {label === 'Evidence highlights' && (
                    <p className="evidence-label">
                      Corridra team-reported context. No independent verification is asserted.
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {data.decision ? (
            <p>
              Your response: <strong>{labels[data.decision as keyof typeof labels]}</strong>.
              Corridra will use it only to handle this introduction.
            </p>
          ) : (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={optOut}
                  disabled={busy || !!pending}
                  onChange={(e) => setOptOut(e.target.checked)}
                />
                Do not send me further introductions from this workspace
              </label>
              <div className="buyer-actions">
                {(Object.keys(labels) as (keyof typeof labels)[]).map((decision) => (
                  <button
                    key={decision}
                    className={decision === 'INTERESTED' ? 'primary-link' : 'secondary-link'}
                    disabled={
                      busy || !!pending || declined || (optOut && decision === 'INTERESTED')
                    }
                    onClick={() => void respond(decision)}
                  >
                    {labels[decision]}
                  </button>
                ))}
              </div>
            </>
          )}
          {pending && (
            <button
              className="primary-link"
              disabled={busy}
              onClick={() => void respond(pending.decision)}
            >
              Retry the Same Response
            </button>
          )}
          {!declined && (
            <button
              className="text-link"
              disabled={busy || !!pending}
              onClick={() => void stopContact()}
            >
              Stop Further Introductions
            </button>
          )}
          <p>You will not be added to a mailing list by responding.</p>
          <p>Private link expires {formatMoment(data.expiresAt)}.</p>
        </>
      )}
    </section>
  );
}
