'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { formatDateTime } from '../../../lib/ux/format';
import { pp } from '../../../lib/i18n/programme-pages';
import './people-board.css';
import type { Invitation, Registration } from './participant-client';
import { customerHeaders, useCommandIds } from './pricing-client';
import {
  type Decision,
  decisionLabel,
  decisionNote,
  decisionPayload,
  decisionProblem,
  decisionsFor,
} from './programme-application-decisions';
import {
  type Application,
  pageRequest,
  parseApplication,
  shortDay,
  statusWords,
} from './programme-page-client';
import {
  boardLead,
  boardRows,
  boardVisible,
  type BoardRow,
  type ReadState,
} from './programme-people-board-model';

// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): applications, invitations and registrations in one list with the
// next decision first. It reads what the organiser already reads (the page's applications list, once; the participants
// list the room hands in) and sends the decision the public page panel sends, with the same payload, through the same
// shared rules (programme-application-decisions.ts). The board owns the applications read and does not wait for the
// participants read: an application can be answered whether the participants list is loading, refreshing, expired or
// failed. Original controls for codes, labels, objectives and access stay in the participants panel beside it.
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmeId: string;
  /** True where the programme has a public page panel to read applications from. */
  applicationsOn: boolean;
  /** The state of the participants read the room hands in. Invitations and registrations are only as read. */
  people: ReadState;
  /** True while the participants list is read again after a command; the rows already read stay. */
  refreshing: boolean;
  invitations: readonly Invitation[];
  registrations: readonly Registration[];
  moreInvitations: string | null;
  moreRegistrations: string | null;
  busy: boolean;
  onMore: (which: 'invitations' | 'registrations', cursor: string) => void;
};

export function ProgrammePeopleBoard(props: Props) {
  const { subject, issuer, workspaceId, programmeId, applicationsOn } = props;
  const headers = useMemo(() => customerHeaders(subject, issuer), [subject, issuer]);
  const commands = useCommandIds();
  const [applications, setApplications] = useState<Application[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [read, setRead] = useState<ReadState>('loading');
  // A later read that failed after rows were read: the rows stay, and only the failed part is named.
  const [issue, setIssue] = useState<'more' | 'refresh' | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusTurn, setFocusTurn] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const writing = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const everRead = useRef(false);
  const pressedMore = useRef(false);
  const baseline = useRef(0);

  const load = useCallback(
    async (after?: string) => {
      const fail = (kind: 'failed' | 'unavailable') => {
        if (everRead.current) setIssue(after ? 'more' : 'refresh');
        else setRead(kind);
      };
      try {
        const response = await fetch(
          `/api/customer-programme-pages?view=applications&workspaceId=${workspaceId}&programmeId=${programmeId}` +
            (after ? `&after=${after}` : ''),
          { cache: 'no-store', credentials: 'same-origin', headers },
        );
        if (!response.ok) return fail(response.status === 503 ? 'unavailable' : 'failed');
        const body = (await response.json()) as {
          applications?: unknown[];
          nextAfter?: string | null;
        };
        const rows = (body.applications ?? []).map(parseApplication);
        setApplications((old) =>
          after ? [...old, ...rows.filter((r) => !old.some((o) => o.id === r.id))] : rows,
        );
        setNextAfter(typeof body.nextAfter === 'string' ? body.nextAfter : null);
        everRead.current = true;
        setIssue(null);
        setRead('ready');
      } catch {
        fail('failed');
      }
    },
    [workspaceId, programmeId, headers],
  );
  useEffect(() => {
    if (!applicationsOn) return;
    // The read starts after this effect returns; state changes only when it settles.
    void Promise.resolve().then(() => load());
  }, [applicationsOn, load]);

  async function decide(item: Application, decision: Decision) {
    if (writing.current) return;
    const note = decisionNote(decision, reason);
    const refusal = decisionProblem(decision, note);
    if (refusal) {
      setRowError({ id: item.id, message: refusal });
      return;
    }
    writing.current = true;
    setBusy(true);
    setRowError(null);
    const result = await pageRequest(
      { subject, issuer },
      decisionPayload({ workspaceId, programmeId }, item, decision, note, commands.forIntent),
    );
    writing.current = false;
    setBusy(false);
    if (!result.ok) {
      setRowError({ id: item.id, message: result.message });
      return;
    }
    setDeclining(null);
    setReason('');
    // The button that was pressed may leave the list (the row moves to another group, often into the closed part), so
    // focus goes to the board and the result is said in the live region.
    setFocusTurn((turn) => turn + 1);
    try {
      const updated = parseApplication(result.body);
      setApplications((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setAnnounce(`${item.displayLabel}: ${statusWords[updated.status]}.`);
    } catch {
      setAnnounce(`${item.displayLabel}: your answer was saved.`);
      await load();
    }
  }

  const rows = useMemo(
    () => boardRows(applications, props.invitations, props.registrations),
    [applications, props.invitations, props.registrations],
  );
  const applicationsRead: ReadState = applicationsOn ? read : 'none';
  const partial = nextAfter !== null || !!props.moreInvitations || !!props.moreRegistrations;
  const shown = rows.slice(0, boardVisible);
  const rest = rows.slice(boardVisible);
  const lead = boardLead(rows, partial, { applications: applicationsRead, people: props.people });

  useEffect(() => {
    if (focusTurn) region.current?.focus();
  }, [focusTurn]);
  // Load More People adds rows wherever their group puts them, often inside the closed part. When every page it asked
  // for has settled, say how many came and put focus back on the button, or on the board when it was the last page
  // (a button that was disabled while reading, or that left, cannot keep focus).
  useEffect(() => {
    if (!pressedMore.current || loadingMore || props.busy) return;
    pressedMore.current = false;
    const added = rows.length - baseline.current;
    setAnnounce(
      added > 0
        ? `${added} more ${added === 1 ? 'person' : 'people'} shown.`
        : 'No more people were shown.',
    );
    (partial ? moreButton.current : region.current)?.focus();
  }, [loadingMore, props.busy, rows.length, partial]);

  function row(item: BoardRow) {
    return (
      <li key={item.key} className="people-board-row" data-kind={item.kind} data-group={item.group}>
        {item.kind === 'application' ? (
          applicationBody(item.application)
        ) : item.kind === 'invitation' ? (
          <>
            <p>
              <strong>{item.label}</strong>{' '}
              <span className="programme-public-state">
                {item.invitation.status === 'ISSUED'
                  ? 'Invitation available'
                  : item.invitation.status === 'USED'
                    ? 'Invitation used'
                    : 'Invitation unavailable'}
              </span>
            </p>
            <p className="programme-note">Expires {formatDateTime(item.invitation.expiresAt)}</p>
          </>
        ) : (
          <p>
            <strong>{item.label}</strong>{' '}
            <span className="programme-public-state">
              {item.registration.status === 'REGISTERED'
                ? 'Registered, self-declared'
                : item.registration.status === 'WITHDRAWN'
                  ? 'Participant withdrew'
                  : 'Programme access revoked'}
            </span>
          </p>
        )}
      </li>
    );
  }
  function applicationBody(item: Application) {
    const answers = decisionsFor(item.status);
    return (
      <>
        <p>
          <strong>{item.displayLabel}</strong>{' '}
          <span className="programme-public-state">{statusWords[item.status]}</span>
        </p>
        <p>{item.statement}</p>
        <p className="programme-note">
          {pp('pp.org.row.applied', { date: shortDay(item.appliedAt) })}
          {item.status === 'INVITED' && item.invitationExpiresAt
            ? pp('pp.org.row.invitationUntil', { date: shortDay(item.invitationExpiresAt) })
            : ''}
          {item.note ? pp('pp.org.row.yourNote', { note: item.note }) : ''}
        </p>
        {item.status === 'JOINED' && <p className="programme-note">{pp('pp.org.row.joined')}</p>}
        {declining === item.id ? (
          <div className="people-board-decline">
            <label className="field">
              <span>{pp('pp.org.declineReason')}</span>
              <textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="guide-actions-row">
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => void decide(item, 'DECLINED')}
              >
                {pp('pp.org.declineConfirm')}
              </button>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setDeclining(null);
                  setRowError(null);
                }}
              >
                {pp('pp.cancel')}
              </button>
            </div>
          </div>
        ) : (
          answers.length > 0 && (
            <div className="guide-actions-row">
              {answers.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => {
                    if (decision !== 'DECLINED') return void decide(item, decision);
                    setDeclining(item.id);
                    setReason('');
                    setRowError(null);
                  }}
                >
                  {decisionLabel(decision, item.status)}
                  <span className="sr-only"> {item.displayLabel}</span>
                </button>
              ))}
            </div>
          )
        )}
        {rowError?.id === item.id && <p role="alert">{rowError.message}</p>}
      </>
    );
  }

  const unread = applicationsOn && (read === 'failed' || read === 'unavailable');
  return (
    <div
      className="people-board"
      id={`${programmeId}-board`}
      role="region"
      aria-labelledby={`${programmeId}-board-title`}
      aria-busy={props.refreshing}
      data-settled={!applicationsOn || read !== 'loading'}
      tabIndex={-1}
      ref={region}
    >
      <h4 id={`${programmeId}-board-title`}>
        {realCustomerInput() ? 'People board' : 'Sample people board'}
      </h4>
      {lead && <p className="people-board-lead">{lead}</p>}
      {applicationsOn && read === 'loading' && (
        <p role="status" className="programme-note">
          Reading applications…
        </p>
      )}
      {unread && (
        <>
          <p role="status" className="programme-note">
            {read === 'unavailable'
              ? 'Applications are not available for this programme right now.'
              : 'Applications could not be read.'}
            {props.people === 'ready' ? ' Invitations and registrations are shown.' : ''}
          </p>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setRead('loading');
              void load();
            }}
          >
            Read Applications Again
          </button>
        </>
      )}
      {issue && (
        <p role="status" className="programme-note">
          {issue === 'more'
            ? 'More applications could not be read. The ones already read are shown.'
            : 'Applications could not be refreshed. The ones read earlier are shown.'}
        </p>
      )}
      {props.refreshing && (
        <p className="programme-note">Refreshing invitations and registrations…</p>
      )}
      {shown.length > 0 && <ul className="people-board-list">{shown.map(row)}</ul>}
      {rest.length > 0 && (
        <details
          className="people-board-more"
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
        >
          <summary>
            Show {rest.length} More
            {rows.some((r, i) => i >= boardVisible && r.group === 'closed')
              ? ', Including Ended'
              : ''}
          </summary>
          <ul className="people-board-list">{rest.map(row)}</ul>
        </details>
      )}
      {partial && (
        <button
          type="button"
          className="text-link"
          ref={moreButton}
          disabled={busy || props.busy || loadingMore}
          onClick={() => {
            pressedMore.current = true;
            baseline.current = rows.length;
            // The new rows land wherever their group puts them, so the rest of the list opens with them.
            setMoreOpen(true);
            if (nextAfter) {
              setLoadingMore(true);
              void load(nextAfter).finally(() => setLoadingMore(false));
            }
            // One participants page per press: the participants read starts one request at a time.
            if (props.moreInvitations) props.onMore('invitations', props.moreInvitations);
            else if (props.moreRegistrations)
              props.onMore('registrations', props.moreRegistrations);
          }}
        >
          Load More People
        </button>
      )}
      <p role="status" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
