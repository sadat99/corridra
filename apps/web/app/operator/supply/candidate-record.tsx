'use client';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { ActionFeedback, useActionFeedback } from '../../../components/ux/feedback';
import { formatDate } from '../../../lib/ux/format';
import {
  canWrite,
  methodWords,
  reasonCodes,
  refusalWords,
  reviewDecisionLabels,
  reviewWords,
  sizeWords,
  sourceKindWords,
  supplyBase,
  supplyGet,
  supplyPost,
  typeWords,
  withWorkspace,
} from '../../../lib/supply-screens';
import { nameCheckWords, type Candidate } from './candidates-list';
import { OrganisationPicker } from './organisation-picker';
import {
  DeniedNote,
  Loading,
  PausedNotice,
  PersonalDataLine,
  ReadFailure,
  SourceLabelLine,
  useLoad,
  useScreenState,
} from './supply-ui';

type Detail = Candidate & {
  websiteHost: string | null;
  publicIdentifier: string | null;
  nominationNote: string | null;
  sizeBand: string | null;
  counterpartyTypes: string[];
  sourceVersion: number;
  reviews: {
    id: string;
    decision: string;
    reasonCode: string;
    reason: string;
    reviewer: string;
    at: string;
  }[];
  matches: {
    id: string;
    decision: string;
    organisationId: string;
    organisationName: string | null;
    reverseOf: string | null;
    at: string;
    reversed: boolean;
  }[];
};

const matchWords: Record<string, string> = {
  MATCH: 'Match',
  NO_MATCH: 'No match',
  REVERSE: 'Reversal',
};

function ReviewPanel({
  tenant,
  detail,
  paused,
  onDone,
}: {
  tenant: string;
  detail: Detail;
  paused: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || paused) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const decision = String(data.get('decision') ?? '');
    setBusy(true);
    feedback.clear();
    try {
      await supplyPost(tenant, 'review', {
        commandId: commandId.current,
        candidateId: detail.id,
        decision,
        reasonCode: String(data.get('reasonCode') ?? ''),
        reason: String(data.get('reason') ?? '').trim(),
      });
      commandId.current = crypto.randomUUID();
      feedback.success(`Review recorded: ${reviewWords[decision] ?? decision}.`);
      formElement.reset();
      onDone();
    } catch (failure) {
      feedback.error(failure instanceof Error ? failure.message : 'The review was not recorded.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="review-heading">
      <h3 id="review-heading">Record a Review</h3>
      <form className="operator-form" onSubmit={send}>
        <fieldset className="supply-choices">
          <legend>Decision</legend>
          {reviewDecisionLabels.map(([value, label], index) => (
            <label key={value} className="supply-choice">
              <input
                type="radio"
                name="decision"
                value={value}
                required
                defaultChecked={index === 0}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="review-code">Reason code</label>
          <select id="review-code" name="reasonCode" required defaultValue="">
            <option value="" disabled>
              Choose a reason code
            </option>
            {reasonCodes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="field">
          Reason
          <textarea name="reason" required minLength={3} maxLength={300} />
        </label>
        <p className="supply-quiet">
          A review is added to the history. Earlier decisions are never changed.
        </p>
        {paused ? <p className="supply-quiet">{refusalWords.paused}</p> : null}
        <button className="primary-link" aria-disabled={busy || paused}>
          Record Review
        </button>
        <ActionFeedback scope="review" feedback={feedback.feedback} onClear={feedback.clear} />
      </form>
      <details className="research-history">
        <summary>Review history ({detail.reviews.length})</summary>
        <ul>
          {detail.reviews.map((review) => (
            <li key={review.id}>
              {reviewWords[review.decision] ?? review.decision}. {review.reason} (
              {review.reasonCode}). {formatDate(review.at)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function MatchPanel({
  tenant,
  detail,
  paused,
  onDone,
}: {
  tenant: string;
  detail: Detail;
  paused: boolean;
  onDone: () => void;
}) {
  const [organisation, setOrganisation] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  const qualified = !detail.expired && detail.latestReview?.decision === 'QUALIFIED';
  async function send(
    decision: 'MATCH' | 'NO_MATCH',
    reverseOf?: string,
    reason = 'Recorded by staff',
  ) {
    if (busy || paused) return;
    setBusy(true);
    feedback.clear();
    try {
      await supplyPost(tenant, 'match', {
        commandId: commandId.current,
        candidateId: detail.id,
        decision: reverseOf ? 'REVERSE' : decision,
        organisationId: reverseOf ? undefined : (organisation ?? undefined),
        reverseOf,
        reason,
      });
      commandId.current = crypto.randomUUID();
      feedback.success(
        reverseOf
          ? 'Match reversed.'
          : decision === 'MATCH'
            ? 'Match recorded.'
            : 'No match recorded.',
      );
      setOrganisation(null);
      onDone();
    } catch (failure) {
      feedback.error(failure instanceof Error ? failure.message : 'The decision was not recorded.');
    } finally {
      setBusy(false);
    }
  }
  const matchActionable = detail.matches.filter((m) => m.decision !== 'REVERSE' && !m.reversed);
  return (
    <section aria-labelledby="match-heading">
      <h3 id="match-heading">Match to a Company</h3>
      {!qualified ? (
        <p className="supply-quiet">Qualify this candidate before matching it to a company.</p>
      ) : (
        <div className="operator-form">
          <OrganisationPicker
            tenant={tenant}
            label="Company in the catalogue"
            value={organisation}
            onChange={(value, label) => {
              setOrganisation(value);
              setName(label);
            }}
          />
          {organisation ? (
            <p>
              Match {detail.companyName} to {name}. You can reverse this later.
            </p>
          ) : null}
          {paused ? <p className="supply-quiet">{refusalWords.paused}</p> : null}
          <div className="operator-toolbar">
            <button
              type="button"
              className="primary-link"
              aria-disabled={!organisation || busy || paused}
              onClick={() => organisation && void send('MATCH')}
            >
              Match to Company
            </button>
            <button
              type="button"
              className="text-link"
              aria-disabled={!organisation || busy || paused}
              onClick={() => organisation && void send('NO_MATCH')}
            >
              Record No Match
            </button>
          </div>
        </div>
      )}
      <ActionFeedback scope="match" feedback={feedback.feedback} onClear={feedback.clear} />
      <details className="research-history">
        <summary>Match history ({detail.matches.length})</summary>
        <ul>
          {detail.matches.map((m) => (
            <li key={m.id}>
              {matchWords[m.decision] ?? m.decision}
              {m.organisationName ? `: ${m.organisationName}` : ''}. {formatDate(m.at)}
              {m.reversed ? ' Reversed.' : ''}
              {matchActionable.some((x) => x.id === m.id) && !paused ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => void send('MATCH', m.id)}
                  >
                    Reverse This Match
                  </button>
                  <span className="supply-quiet">
                    {' '}
                    Reverse the{' '}
                    {m.decision === 'NO_MATCH'
                      ? 'no match'
                      : `match to ${m.organisationName ?? 'this company'}`}{' '}
                    recorded on {formatDate(m.at)}.
                  </span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function CandidateRecord({
  tenant,
  role,
  missionId,
  candidateId,
}: {
  tenant: string;
  role: string;
  missionId: string;
  candidateId: string;
}) {
  const state = useLoad<{ candidate: Detail }>(
    () => supplyGet(tenant, 'candidate', { id: candidateId }),
    `${tenant}:${candidateId}`,
  );
  const screen = useScreenState(tenant);
  const paused = screen.data ? !screen.data.moduleOpen : false;
  const detail = state.data?.candidate;
  const writable = canWrite(role);
  return (
    <section>
      <nav aria-label="Breadcrumb">
        <Link prefetch={false} className="text-link" href={withWorkspace(supplyBase, tenant)}>
          Supply Sources
        </Link>
        {' / '}
        <Link
          prefetch={false}
          className="text-link"
          href={withWorkspace(`${supplyBase}/missions/${missionId}`, tenant)}
        >
          Mission
        </Link>
      </nav>
      <PausedNotice paused={paused} />
      {state.loading && !detail ? <Loading words="Loading candidate." /> : null}
      {state.error ? <ReadFailure error={state.error} onRetry={state.reload} /> : null}
      {detail ? (
        <>
          <h2 dir="auto">{detail.companyName ?? 'Company name removed after retention'}</h2>
          <PersonalDataLine />
          {detail.warnings.includes('personal_name_check') ? (
            <p role="status" className="supply-check">
              <span className="ux-badge">Name check</span> {nameCheckWords}
            </p>
          ) : null}
          {detail.expired ? (
            <p className="supply-quiet">Retention date passed. Kept for history.</p>
          ) : null}
          <SourceLabelLine />
          <dl className="supply-facts">
            <div>
              <dt>Country</dt>
              <dd>{detail.country}</dd>
            </div>
            <div>
              <dt>Website host</dt>
              <dd>{detail.websiteHost ?? 'Not given'}</dd>
            </div>
            <div>
              <dt>Public identifier</dt>
              <dd>{detail.publicIdentifier ?? 'Not given'}</dd>
            </div>
            <div>
              <dt>Size band</dt>
              <dd>
                {detail.sizeBand ? (sizeWords[detail.sizeBand] ?? detail.sizeBand) : 'Not known'}
              </dd>
            </div>
            <div>
              <dt>Types</dt>
              <dd>
                {detail.counterpartyTypes.length
                  ? detail.counterpartyTypes.map((type) => typeWords[type] ?? type).join(', ')
                  : 'Not known'}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {detail.sourceLabel} ({sourceKindWords[detail.sourceKind] ?? detail.sourceKind}),
                version {detail.sourceVersion}
              </dd>
            </div>
            <div>
              <dt>Observed date</dt>
              <dd>{formatDate(detail.observedAt)}</dd>
            </div>
            <div>
              <dt>Keep until</dt>
              <dd>{formatDate(detail.retentionUntil)}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{methodWords[detail.method] ?? detail.method}</dd>
            </div>
            {detail.nominationNote ? (
              <div>
                <dt>Internal note (staff only)</dt>
                <dd>{detail.nominationNote}</dd>
              </div>
            ) : null}
          </dl>
          {writable ? (
            <>
              <ReviewPanel tenant={tenant} detail={detail} paused={paused} onDone={state.reload} />
              <MatchPanel tenant={tenant} detail={detail} paused={paused} onDone={state.reload} />
            </>
          ) : (
            <DeniedNote />
          )}
          <p>
            <Link
              prefetch={false}
              className="text-link"
              href={withWorkspace(`${supplyBase}/do-not-contact`, tenant)}
            >
              Do Not Contact
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}
