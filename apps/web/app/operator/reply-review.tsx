'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  replyGaps,
  replyReviewReasons,
  replyTermNames,
  reviewState,
  suggestedAsk,
  type ReplyBody,
  type ReplyReviewReason,
  type ReplyTermName,
  type StoredReview,
} from '@corridra/domain/reply-review';
import { displayDate } from '@corridra/domain/locale';
import {
  preparedQuotation,
  prefillDeniedMessage,
  prefillFailureMessage,
  prefillLinkUnknownMessage,
  prefillMessage,
  prefillUnavailableMessage,
  reasonLabels,
  termLabels,
  termText,
} from '../../lib/reply-review-view';
import { useReplyPrefill } from '../../lib/ux/use-reply-prefill';
import { replyLinkSuffix, type ReplyLanguage } from '../../lib/reply-terms';
import { useOperatorFlags } from './operator-flags';
import './reply-review.css';
import './reply-handoff.css';

// The Corridra team's review of supplier replies (ADR-069), shown only where it is switched on. Each reply
// is set beside the requirement the supplier was shown, term by term, with the gaps the existing
// comparison engine reports. Three actions: publish (prepare the reply as a mission quotation, which the
// team still confirms through the existing form), ask (for named terms, through a new link) or reject (with
// a reason). Nothing here reaches a customer; no verdict is invented.
type Reply = {
  id: string;
  link_id: string;
  body: ReplyBody & { body?: string };
  created_at?: string;
  revision?: number;
  revised_at?: string;
};
type Disclosure = { link_id: string; role: string; shared_requirements: string };

export function ReplyReview({
  tenant,
  role,
  responses,
  disclosures,
  onRefresh,
}: {
  tenant: string;
  role: string;
  responses: Reply[];
  disclosures: Disclosure[];
  /** Loads the workspace's replies again, so a card shows the answer as it is now. */
  onRefresh?: () => Promise<void>;
}) {
  const { replyReview } = useOperatorFlags();
  const [reviews, setReviews] = useState<StoredReview[]>([]);
  const [open, setOpen] = useState<boolean | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const endpoint = `/api/reply/review?tenant=${encodeURIComponent(tenant)}`;
  const reload = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Reply review is unavailable');
    setOpen(data.open === true);
    setReviews(data.reviews as StoredReview[]);
    setUnavailable(false);
  }, [endpoint]);
  useEffect(() => {
    if (!replyReview) return;
    let active = true;
    fetch(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) {
          setOpen(data.open === true);
          setReviews(data.reviews as StoredReview[]);
        }
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [replyReview, endpoint]);
  if (!replyReview || responses.length === 0) return null;
  const canReview = ['owner', 'admin'].includes(role);
  return (
    <section className="reply-review" aria-label="Review supplier replies">
      <h3>Review supplier replies</h3>
      <p className="reply-review-note">
        Each reply is set beside the requirement the supplier was shown. The gaps are the ones the
        comparison engine reports. A decision here changes what the team does next; it does not send
        anything to a customer.
      </p>
      {unavailable && <p role="status">Reply review is not installed or not available here.</p>}
      {open === false && (
        <p role="status">
          Reply review is not open yet. You can read the replies; recording a decision needs the
          database side to be opened by the owner.
        </p>
      )}
      <ul className="reply-review-list">
        {responses.map((reply) => (
          <ReplyCard
            key={reply.id}
            reply={reply}
            requirement={disclosures.find((d) => d.link_id === reply.link_id)?.shared_requirements}
            reviews={reviews.filter((r) => r.responseId === reply.id)}
            tenant={tenant}
            canRecord={['owner', 'admin', 'operator'].includes(role)}
            canAct={canReview && open === true && !unavailable}
            onChanged={reload}
            onStale={async () => {
              await Promise.all([reload(), onRefresh?.()]);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function ReplyCard({
  reply,
  requirement,
  reviews,
  tenant,
  canRecord,
  canAct,
  onChanged,
  onStale,
}: {
  reply: Reply;
  requirement?: string;
  reviews: StoredReview[];
  tenant: string;
  /** Owner, admin or operator may record an offer; the database checks again. */
  canRecord: boolean;
  canAct: boolean;
  onChanged: () => Promise<void>;
  onStale: () => Promise<void>;
}) {
  const gaps = useMemo(() => replyGaps(reply.body), [reply.body]);
  const state = reviewState(reviews);
  const quotation = reply.body.quotation ?? null;
  const [mode, setMode] = useState<null | 'ask' | 'reject'>(null);
  const [asked, setAsked] = useState<ReplyTermName[]>(() => suggestedAsk(gaps.missing));
  const [language, setLanguage] = useState<ReplyLanguage>('en');
  const [reason, setReason] = useState<ReplyReviewReason>('NOT_A_FIT');
  const [note, setNote] = useState('');
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  // When the supplier corrects the answer, the choices made on the old one no longer apply: the terms to ask for are worked out again.
  const [shownRevision, setShownRevision] = useState(reply.revision ?? 0);
  if (shownRevision !== (reply.revision ?? 0)) {
    setShownRevision(reply.revision ?? 0);
    setAsked(suggestedAsk(gaps.missing));
    setMode(null);
  }

  async function send(decision: 'PUBLISH' | 'ASK' | 'REJECT') {
    setBusy(true);
    setMessage('');
    try {
      const body: Record<string, unknown> = {
        commandId,
        responseId: reply.id,
        // The answer version this card shows. The database refuses the decision if the answer has changed since.
        seen: reply.revision ?? 0,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === 'ASK' ? { askTerms: asked } : {}),
        ...(decision === 'REJECT' ? { reasonCode: reason } : {}),
      };
      const response = await fetch(`/api/reply/review?tenant=${encodeURIComponent(tenant)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        // A correction landed after this card was opened: show the latest answer and let the team decide again on what they read.
        if (response.status === 409 && /changed; reload/i.test(String(data.error ?? ''))) {
          setCommandId(crypto.randomUUID());
          setMessage(
            'The supplier corrected this answer after you opened it. The latest answer is shown now. Read it and decide again.',
          );
          await onStale();
          return;
        }
        throw new Error(data.error ?? 'The decision was not saved');
      }
      setCommandId(crypto.randomUUID());
      setMode(null);
      setNote('');
      setMessage(data.replayed ? 'Already recorded.' : 'Decision recorded.');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The decision was not saved');
    } finally {
      setBusy(false);
    }
  }

  // The card is drawn after the replies load, so the browser cannot jump to it. A link from the offer form names the
  // reply in ?reply=<id> (a # part would be read as a workspace section): bring that card into view once it exists.
  const card = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('reply') === reply.id)
      card.current?.scrollIntoView({ block: 'start' });
  }, [reply.id]);

  const published = state.final?.decision === 'PUBLISH';
  const prepared = published ? preparedQuotation(reply.body) : null;
  const prefill = useReplyPrefill(tenant, published && canRecord ? reply.id : null);
  // Mission pages exist only while CORRIDRA_UX_MISSIONS_V2 is on (the page answers 404 otherwise), so the link
  // is offered only once the flag read the Missions panel uses says they are on.
  // 'failed' is a check that could not be made, which is not the same as the pages being off.
  const [missionPages, setMissionPages] = useState<'unknown' | 'on' | 'off' | 'failed'>('unknown');
  const eligible = prefill.kind === 'eligible';
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    fetch('/api/team-work/flags')
      .then(async (r) => {
        if (!r.ok) return 'failed' as const;
        const flags = (await r.json()) as { missionsV2?: unknown } | null;
        if (typeof flags?.missionsV2 !== 'boolean') return 'failed' as const;
        return flags.missionsV2 ? ('on' as const) : ('off' as const);
      })
      .catch(() => 'failed' as const)
      .then((next) => {
        if (active) setMissionPages(next);
      });
    return () => {
      active = false;
    };
  }, [eligible]);
  const ineligible = published && canRecord && prefill.kind === 'ineligible';
  const han = (text: string) => (/\p{Script=Han}/u.test(text) ? 'zh' : undefined);

  return (
    <li className="reply-review-card" id={`reply-${reply.id}`} ref={card}>
      <header>
        <p className="reply-review-meta">
          Recipient link {reply.link_id.slice(0, 8)}
          {reply.created_at ? ` · received ${displayDate(reply.created_at)}` : ''} · Self-declared
        </p>
        {state.final ? (
          <p className="reply-review-state" data-state={state.final.decision}>
            {state.final.decision === 'PUBLISH'
              ? ineligible
                ? 'Published. This reply cannot be prepared as an offer.'
                : 'Published: prepared as a mission quotation, not yet confirmed.'
              : `Rejected: ${reasonLabels[state.final.reasonCode as ReplyReviewReason] ?? 'reason recorded'}.`}
          </p>
        ) : state.asked ? (
          <p className="reply-review-state" data-state="ASK">
            Asked for {state.asked.askTerms?.map((t) => termLabels[t]).join(', ')}. Waiting for a
            new reply.
          </p>
        ) : (
          <p className="reply-review-state" data-state="OPEN">
            Awaiting review.
          </p>
        )}
      </header>

      <div className="reply-review-columns">
        <section aria-label="Requirement shown to the supplier">
          <h4>What the supplier was shown</h4>
          <p lang={requirement ? han(requirement) : undefined}>
            {requirement ?? 'The shared requirement is not available.'}
          </p>
        </section>
        <section aria-label="The reply">
          <h4>The reply</h4>
          <p lang={han(String(reply.body.body ?? ''))}>{String(reply.body.body ?? '')}</p>
          {!!reply.revision && (
            <p className="reply-review-note">
              The recipient corrected this answer {reply.revision} time
              {reply.revision === 1 ? '' : 's'}. The latest answer is shown.
              {state.asked &&
                reply.revised_at &&
                new Date(reply.revised_at) > new Date(state.asked.createdAt) &&
                ' This answer came after your request for more terms.'}
            </p>
          )}
          {reply.body.meetingInterest === true && (
            <p>Meeting or visit interest expressed. No appointment is inferred.</p>
          )}
        </section>
      </div>

      {quotation?.terms ? (
        <section aria-label="Quotation term by term">
          <h4>
            Quotation term by term ({quotation.currency}){' '}
            {gaps.comparable ? (
              <span className="reply-review-ok">Comparable on supplied terms</span>
            ) : (
              <span className="reply-review-gap">Not comparable yet</span>
            )}
          </h4>
          <dl className="reply-review-terms">
            {replyTermNames.map((key) => {
              const value = quotation.terms?.[key];
              const missing = gaps.missing.includes(key);
              return (
                <div key={key} data-gap={missing ? 'true' : undefined}>
                  <dt>{termLabels[key]}</dt>
                  <dd lang={value ? han(value) : undefined}>
                    {termText(key, value, quotation.currency ?? '')}
                  </dd>
                  {missing && <dd className="reply-review-flag">Engine: missing</dd>}
                </div>
              );
            })}
          </dl>
          {gaps.expired && <p className="reply-review-flag">Engine: the quote has expired.</p>}
          {gaps.inconsistentTotal && (
            <p className="reply-review-flag">
              Engine: the total does not match unit price times quantity.
            </p>
          )}
          <p lang={han(quotation.uncertainties ?? '')}>
            Supplier uncertainties: {quotation.uncertainties}
          </p>
        </section>
      ) : (
        <p>No quotation in this reply.</p>
      )}

      {reviews.length > 0 && (
        <details className="reply-review-history">
          <summary>Review history ({reviews.length})</summary>
          <ol>
            {reviews.map((review) => (
              <li key={review.id}>
                {displayDate(review.createdAt)}: {review.decision.toLowerCase()}
                {review.askTerms
                  ? ` (${review.askTerms.map((t) => termLabels[t]).join(', ')})`
                  : ''}
                {review.reasonCode ? ` (${reasonLabels[review.reasonCode]})` : ''}
                {review.note ? `. ${review.note}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}

      {state.asked && state.asked.askTerms && (
        <div className="reply-review-link">
          <p>
            To ask again, create a new link for this recipient in Approve recipient disclosure, then
            add this to the end of that link:
          </p>
          <code>{replyLinkSuffix(language, state.asked.askTerms)}</code>
        </div>
      )}

      {prepared && (
        <div className="reply-review-prepared">
          <h4>Prepared quotation</h4>
          {canRecord && (
            <div className="reply-handoff-status" role="status">
              {prefill.kind === 'loading' && <p>Checking whether this reply can be prepared.</p>}
              {prefill.kind === 'eligible' && missionPages === 'on' && (
                <a
                  className="primary-link"
                  href={`/operator/missions/${prefill.prefill.missionId}?workspace=${encodeURIComponent(tenant)}&reply=${reply.id}#requirements`}
                >
                  Open Prepared Offer
                </a>
              )}
              {prefill.kind === 'eligible' && missionPages === 'unknown' && (
                <p>Checking whether this reply can be prepared.</p>
              )}
              {prefill.kind === 'eligible' && missionPages === 'off' && (
                <p>{prefillUnavailableMessage}</p>
              )}
              {prefill.kind === 'eligible' && missionPages === 'failed' && (
                <p>{prefillLinkUnknownMessage}</p>
              )}
              {prefill.kind === 'ineligible' && <p>{prefillMessage(prefill.code)}</p>}
              {prefill.kind === 'unavailable' && <p>{prefillUnavailableMessage}</p>}
              {prefill.kind === 'denied' && <p>{prefillDeniedMessage}</p>}
              {prefill.kind === 'error' && <p>{prefillFailureMessage}</p>}
            </div>
          )}
          {!['eligible', 'ineligible', 'loading'].includes(prefill.kind) && (
            <p>
              Copy this into Record a supplier offer on the mission and confirm it there. The reply
              is the self-declared source. Nothing reaches a customer until the publication path
              approves it.
            </p>
          )}
          <pre tabIndex={0}>{prepared}</pre>
          <button
            type="button"
            className="secondary-link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prepared);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy the Prepared Quotation'}
          </button>
        </div>
      )}

      {state.open && canAct && (
        <div className="reply-review-actions">
          {mode === null && (
            <div className="reply-review-buttons">
              <button type="button" disabled={busy} onClick={() => void send('PUBLISH')}>
                Publish: Prepare As a Quotation
              </button>
              <button
                type="button"
                className="secondary-link"
                disabled={busy}
                onClick={() => setMode('ask')}
              >
                Ask for Missing Terms
              </button>
              <button
                type="button"
                className="secondary-link"
                disabled={busy}
                onClick={() => setMode('reject')}
              >
                Reject
              </button>
            </div>
          )}
          {mode === 'ask' && (
            <fieldset>
              <legend>Ask the supplier for</legend>
              <div className="reply-review-checks">
                {replyTermNames.map((key) => (
                  <label key={key} className="check-field">
                    <input
                      type="checkbox"
                      checked={asked.includes(key)}
                      onChange={(e) =>
                        setAsked((current) =>
                          e.target.checked ? [...current, key] : current.filter((k) => k !== key),
                        )
                      }
                    />
                    {termLabels[key]}
                  </label>
                ))}
              </div>
              <label className="field">
                Language of the supplier&apos;s page
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as ReplyLanguage)}
                >
                  <option value="en">English</option>
                  <option value="zh">Chinese (draft)</option>
                </select>
                <span className="reply-review-note">
                  Chinese opens only after a native reviewer is recorded in the language review
                  record. Until then the link opens in English.
                </span>
              </label>
              <label className="field">
                Note for the team (optional)
                <textarea
                  value={note}
                  maxLength={500}
                  rows={2}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="reply-review-buttons">
                <button
                  type="button"
                  disabled={busy || asked.length === 0}
                  onClick={() => void send('ASK')}
                >
                  Record the Request
                </button>
                <button type="button" className="secondary-link" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
          {mode === 'reject' && (
            <fieldset>
              <legend>Reject this reply</legend>
              <label className="field">
                Reason
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReplyReviewReason)}
                >
                  {replyReviewReasons.map((code) => (
                    <option key={code} value={code}>
                      {reasonLabels[code]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Note for the team (optional)
                <textarea
                  value={note}
                  maxLength={500}
                  rows={2}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p>The customer never sees a rejected reply.</p>
              <div className="reply-review-buttons">
                <button type="button" disabled={busy} onClick={() => void send('REJECT')}>
                  Record the Rejection
                </button>
                <button type="button" className="secondary-link" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </li>
  );
}
