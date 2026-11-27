'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { FieldError } from '../../components/field-error';
import { ChangeSummary } from '../../components/ux/change-summary';
import { Dialog } from '../../components/ux/dialog';
import { ShowMoreList } from '../../components/ux/show-more';
import type { PackPreview, PackPublished } from '../../lib/route-pack-editor-publish';
import {
  nextPackCommand,
  packFingerprint,
  previewBody,
  publishBody,
  type PackCommand,
  type PackEdit,
} from '../../lib/route-pack-editor-pack';
import {
  alsoRemoved,
  assignmentsKept,
  basedOn,
  becomes,
  blockedLine,
  pendingCaution,
  packWords,
  readinessWarning,
  reasonCount,
  showFields,
} from './route-pack-pack-words';
import { sendPack, type PackSendResult } from './route-pack-pack-send';
import './route-pack-pack.css';

// ADR-093 Phase 3, PR 3b: the one dialog frame of every pack change (spec 8.9, 11.1 to 11.5). It owns the two requests and
// what each answer means: Next sends a preview (writes nothing) under a fresh command id and the internal preview reason; Review
// shows what publishing does, the readiness warning, the not-clearance line and the one reason; the primary sends the publish
// under one command id that is kept while the change and the reason stay the same, so Try Publishing Again never publishes
// twice. Both requests may open the authenticator check in place; this dialog stays, locked, with its step, choices and reason.
// The reason lives only in this component's state: it is never put in sessionStorage or any other store.

/** What the editor is told after a change is done: it reads the route again and shows the words. */
export type PackDone =
  { kind: 'published'; published: PackPublished } | { kind: 'proposed'; version: number };

type View = 'form' | 'stale' | 'denied' | 'notFound' | 'signedOut';
type Busy = null | 'checking' | 'publishing';

const pendingKeys = (preview: PackPreview) =>
  preview.warnings
    .filter((warning) => warning.code === 'ROUTE_PACK_GO_LIVE_PENDING_CORE')
    .flatMap((warning) => warning.keys);

/** The Pending Core caution: one line with the alert icon and words, and the fields behind a disclosure. Never a banner. */
export function PendingCaution({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  const named = labels.slice(0, 2).join(', ');
  return (
    <div className="route-pack-caution">
      <p className="route-edit-caution" role="status">
        <CorridraIcon name="alert" />
        <span>{pendingCaution(labels.length > 2 ? `${named} and others` : named)}</span>
      </p>
      {labels.length > 2 ? (
        <details className="route-pack-fields">
          <summary>{showFields(labels.length)}</summary>
          <ShowMoreList limit={6} noun="fields" className="route-pack-field-list">
            {labels.map((label) => (
              <li key={label} dir="auto">
                {label}
              </li>
            ))}
          </ShowMoreList>
        </details>
      ) : null}
    </div>
  );
}

export function PackDialog(props: {
  open: boolean;
  title: string;
  tenant: string;
  routeId: string;
  /** The pack as read; null for a route with no pack yet. */
  packVersion: number | null;
  /** The change as the first step holds it; null while it sets nothing new. */
  edit: PackEdit | null;
  /** The visible reason Next is off, shown beside it. */
  nextOff: string | null;
  /** The progress words of the first step. */
  stepWords: string;
  /** The controls of the first step. Left out, the dialog has one step and previews as it opens. */
  stepOne?: ReactNode;
  /** One step only: the statement above Review. */
  statement?: ReactNode;
  primary: string;
  /** The summary lines of Review, in words. */
  summary: (preview: PackPreview) => string[];
  /** Words of a server refusal with field keys replaced by labels. */
  labelOf: (key: string) => string;
  /** The words of 409 ROUTE_PACK_NO_CHANGE for this dialog; left out, the server's own. */
  noChangeWords?: string;
  onClose: () => void;
  onDone: (done: PackDone) => void;
  /** Reload Route: the editor reads the route again. */
  onReload: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const single = props.stepOne === undefined;
  const [step, setStep] = useState<'one' | 'review'>('one');
  const [view, setView] = useState<View>('form');
  const [busy, setBusy] = useState<Busy>(null);
  const [preview, setPreview] = useState<PackPreview | null>(null);
  // The change as it was previewed: Review shows and publishes exactly this, never a later state of the first step.
  const [previewed, setPreviewed] = useState<PackEdit | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Publishing again is offered once a publish was sent and not confirmed.
  const [retry, setRetry] = useState(false);
  const command = useRef<PackCommand | null>(null);
  const reviewLine = useRef<HTMLParagraphElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    target()?.focus();
  });

  // A closed dialog starts again from its first step; nothing of it is kept anywhere.
  const [wasOpen, setWasOpen] = useState(props.open);
  if (wasOpen !== props.open) {
    setWasOpen(props.open);
    if (!props.open) {
      setStep('one');
      setView('form');
      setBusy(null);
      setPreview(null);
      setPreviewed(null);
      setReason('');
      setReasonError(false);
      setError(null);
      setRetry(false);
    }
  }

  const serverWords = (text: string | null) =>
    text ? text.replace(/\b[a-z]+\.[A-Za-z_]+\b/g, (key) => props.labelOf(key)) : null;
  /** A refusal that ends the form: the words replace it. */
  const endsForm = (result: PackSendResult): boolean => {
    const ends: Partial<Record<PackSendResult['outcome'], View>> = {
      stale: 'stale',
      denied: 'denied',
      notFound: 'notFound',
      signedOut: 'signedOut',
    };
    const next = ends[result.outcome];
    if (!next) return false;
    setView(next);
    focusAfter.current = () => banner.current;
    return true;
  };
  const refusal = (result: PackSendResult, publishing: boolean): string => {
    const server = 'error' in result ? serverWords(result.error) : null;
    switch (result.outcome) {
      case 'stepUp':
        return packWords.stepUpKept;
      case 'noChange':
        return props.noChangeWords ?? server ?? packWords.notSent;
      case 'commandReused':
        return packWords.commandReused;
      case 'tooLarge':
        return packWords.tooLarge;
      case 'offline':
        return publishing ? packWords.publishOffline : packWords.previewOffline;
      default:
        return server ?? packWords.notSent;
    }
  };

  const check = async () => {
    const edit = props.edit;
    if (!edit || busy) return;
    setError(null);
    setBusy('checking');
    const result = await sendPack(
      props.tenant,
      previewBody(edit, props.routeId, props.packVersion, () => crypto.randomUUID()),
      false,
    );
    setBusy(null);
    if (result.outcome === 'previewed') {
      setPreview(result.preview);
      setPreviewed(edit);
      setStep('review');
      focusAfter.current = () => (single ? reasonBox.current : reviewLine.current);
      return;
    }
    if (endsForm(result)) return;
    setError(refusal(result, false));
    focusAfter.current = () => (single ? banner.current : nextButton.current);
  };
  // The one-step dialog previews as it opens (after the dialog is drawn, so the check has its page to open over).
  useEffect(() => {
    if (!props.open || !single) return;
    const timer = window.setTimeout(() => void check(), 0);
    return () => window.clearTimeout(timer);
    // Only the opening asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const publish = async () => {
    const edit = previewed;
    if (!edit || !preview || busy || preview.blocked) return;
    if (reason.trim().length < 3) {
      setReasonError(true);
      focusAfter.current = () => reasonBox.current;
      return;
    }
    setError(null);
    command.current = nextPackCommand(
      command.current,
      packFingerprint(edit, props.routeId, props.packVersion, reason),
      () => crypto.randomUUID(),
    );
    setBusy('publishing');
    const result = await sendPack(
      props.tenant,
      publishBody(edit, props.routeId, props.packVersion, reason, command.current),
      preview.onePersonPublication,
    );
    setBusy(null);
    if (result.outcome === 'published') {
      props.onDone({ kind: 'published', published: result.published });
      return;
    }
    if (result.outcome === 'proposed') {
      props.onDone({ kind: 'proposed', version: preview.newVersion });
      return;
    }
    if (endsForm(result)) return;
    // The id belonged to a body the server refused to repeat: the next press is a new command.
    if (result.outcome === 'commandReused') command.current = null;
    setRetry(result.outcome === 'savedNotPublished' || result.outcome === 'offline');
    setError(
      result.outcome === 'savedNotPublished' ? packWords.savedNotPublished : refusal(result, true),
    );
    focusAfter.current = () => primaryButton.current;
  };

  const locked = busy !== null;
  const reasonField = (
    <div className="field route-edit-field">
      <label htmlFor={`${id}-reason`}>{packWords.reasonLabel}</label>
      <textarea
        id={`${id}-reason`}
        ref={reasonBox}
        dir="auto"
        rows={3}
        maxLength={500}
        placeholder={packWords.reasonHint}
        value={reason}
        aria-invalid={reasonError ? true : undefined}
        aria-describedby={`${id}-reason-count${reasonError ? ` ${id}-reason-error` : ''}`}
        onChange={(event) => {
          setReason(event.target.value);
          if (event.target.value.trim().length >= 3) setReasonError(false);
          if (retry) setRetry(false);
        }}
      />
      <p className="route-edit-count" id={`${id}-reason-count`}>
        {reasonCount(reason.length)}
      </p>
      {reasonError ? (
        <FieldError id={`${id}-reason-error`}>{packWords.reasonShort}</FieldError>
      ) : null}
    </div>
  );
  const errorLine = error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null;
  const busyLine =
    busy === 'checking'
      ? packWords.checkingLine
      : busy === 'publishing'
        ? packWords.publishingLine
        : '';

  const ended =
    view === 'stale'
      ? packWords.stale
      : view === 'denied'
        ? packWords.denied
        : view === 'notFound'
          ? packWords.notFound
          : view === 'signedOut'
            ? packWords.signedOut
            : null;

  const review = preview ? (
    <>
      {single ? null : (
        <p className="route-edit-step" tabIndex={-1} ref={reviewLine}>
          {packWords.stepReview}
        </p>
      )}
      {props.statement}
      <ChangeSummary lines={props.summary(preview)} />
      <ul className="route-pack-versions">
        {preview.baseVersion !== null ? <li>{basedOn(preview.baseVersion)}</li> : null}
        <li>{becomes(preview.newVersion)}</li>
        <li>{assignmentsKept(preview.historicalAssignmentsPreserved)}</li>
        {preview.removedPolicies.length ? (
          <li dir="auto">{alsoRemoved(preview.removedPolicies.join(', '))}</li>
        ) : null}
      </ul>
      {preview.baseVersion === null ? (
        <p className="route-edit-quiet">{packWords.startsDraft}</p>
      ) : null}
      <PendingCaution labels={pendingKeys(preview).map(props.labelOf)} />
      {preview.onePersonPublication ? null : (
        <p className="route-edit-quiet">{packWords.secondOwner}</p>
      )}
      {preview.blocked ? (
        <p className="route-pack-blocked" role="alert" id={`${id}-blocked`}>
          <CorridraIcon name="alert" />
          <span>{blockedLine(preview.blocked.keys.map(props.labelOf).join(', '))}</span>
        </p>
      ) : null}
      <div className="route-pack-warning">
        <CorridraIcon name="alert" />
        <p>{readinessWarning(preview.newVersion)}</p>
      </div>
      <p className="route-edit-quiet">{packWords.notClearance}</p>
      {reasonField}
      {errorLine}
      <div className="route-dialog-actions">
        <button
          type="button"
          ref={primaryButton}
          className="primary-link"
          disabled={locked || !!preview.blocked}
          aria-busy={busy === 'publishing' || undefined}
          aria-describedby={preview.blocked ? `${id}-blocked` : undefined}
          onClick={() => void publish()}
        >
          {busy === 'publishing'
            ? packWords.publishing
            : retry
              ? packWords.tryAgain
              : preview.onePersonPublication
                ? props.primary
                : packWords.proposePack}
        </button>
        {single ? null : (
          <button
            type="button"
            className="text-link"
            disabled={locked}
            onClick={() => {
              setStep('one');
              setPreview(null);
              setError(null);
              setRetry(false);
              focusAfter.current = () => nextButton.current;
            }}
          >
            {packWords.back}
          </button>
        )}
        <button
          type="button"
          className="text-link"
          disabled={locked}
          data-autofocus={single || undefined}
          onClick={props.onClose}
        >
          {packWords.cancel}
        </button>
      </div>
      {preview.onePersonPublication ? (
        <p className="route-edit-quiet">{packWords.onePerson}</p>
      ) : null}
    </>
  ) : null;

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      locked={locked}
      returnFocusTo={props.returnFocusTo}
    >
      <div className="route-dialog route-pack" aria-busy={locked || undefined}>
        <p className="sr-only" role="status">
          {busyLine}
        </p>
        <div className="route-pack-banner" role="alert" tabIndex={-1} ref={banner}>
          {ended ? <p>{ended}</p> : null}
          {single && !preview && error ? <p>{error}</p> : null}
        </div>
        {ended ? (
          <div className="route-dialog-actions">
            {view === 'stale' ? (
              <button type="button" className="primary-link" onClick={props.onReload}>
                {packWords.reloadRoute}
              </button>
            ) : (
              <button type="button" className="primary-link" onClick={props.onClose}>
                {packWords.close}
              </button>
            )}
          </div>
        ) : step === 'review' && preview ? (
          review
        ) : single ? (
          <>
            {props.statement}
            {busy === 'checking' ? (
              <p className="route-edit-quiet">{packWords.checkingLine}</p>
            ) : null}
            <div className="route-dialog-actions">
              {error ? (
                <button type="button" className="primary-link" onClick={() => void check()}>
                  {packWords.checkAgain}
                </button>
              ) : null}
              <button
                type="button"
                className="text-link"
                disabled={locked}
                data-autofocus
                onClick={props.onClose}
              >
                {packWords.cancel}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="route-edit-step">{props.stepWords}</p>
            {/* While the preview is asked for, the first step cannot change (what Review shows is what was previewed). */}
            <fieldset className="route-pack-lock" disabled={busy === 'checking'}>
              {props.stepOne}
            </fieldset>
            {errorLine}
            <div className="route-dialog-actions">
              <button
                type="button"
                ref={nextButton}
                className="primary-link"
                disabled={locked || !props.edit}
                aria-busy={busy === 'checking' || undefined}
                aria-describedby={props.nextOff ? `${id}-next-off` : undefined}
                onClick={() => void check()}
              >
                {busy === 'checking' ? packWords.checking : packWords.next}
              </button>
              <button type="button" className="text-link" disabled={locked} onClick={props.onClose}>
                {packWords.cancel}
              </button>
              {props.nextOff ? (
                <span className="route-edit-quiet" id={`${id}-next-off`}>
                  {props.nextOff}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
