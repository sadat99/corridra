'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { formatDateTime } from '../../../lib/ux/format';
import { pp } from '../../../lib/i18n/programme-pages';
import './people-board.css';
import type { Invitation, Registration } from './participant-client';
import { customerHeaders, useCommandIds } from './pricing-client';
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
  decisionsFor,
  type BoardRow,
} from './programme-people-board-model';

// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): applications, invitations and registrations in one list with the
// next decision first. It reads what the organiser already reads (the page's applications list; the participants
// list the room hands in) and sends the decision the public page panel sends, with the same payload. Original
// controls for codes, labels, objectives and access stay in the participants panel beside it.
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmeId: string;
  /** True where the programme has a public page panel to read applications from. */
  applicationsOn: boolean;
  invitations: readonly Invitation[];
  registrations: readonly Registration[];
  moreInvitations: string | null;
  moreRegistrations: string | null;
  busy: boolean;
  onMore: (which: 'invitations' | 'registrations', cursor: string) => void;
};

const between = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max;

export function ProgrammePeopleBoard(props: Props) {
  const { subject, issuer, workspaceId, programmeId, applicationsOn } = props;
  const headers = useMemo(() => customerHeaders(subject, issuer), [subject, issuer]);
  const commands = useCommandIds();
  const [applications, setApplications] = useState<Application[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [read, setRead] = useState<'idle' | 'ready' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const writing = useRef(false);

  const load = useCallback(
    async (after?: string) => {
      try {
        const response = await fetch(
          `/api/customer-programme-pages?view=applications&workspaceId=${workspaceId}&programmeId=${programmeId}` +
            (after ? `&after=${after}` : ''),
          { cache: 'no-store', credentials: 'same-origin', headers },
        );
        // A page that is not published, not installed or not readable has no applications to show here.
        if (!response.ok) return setRead(response.status === 503 ? 'idle' : 'failed');
        const body = (await response.json()) as {
          applications?: unknown[];
          nextAfter?: string | null;
        };
        const rows = (body.applications ?? []).map(parseApplication);
        setApplications((old) =>
          after ? [...old, ...rows.filter((r) => !old.some((o) => o.id === r.id))] : rows,
        );
        setNextAfter(typeof body.nextAfter === 'string' ? body.nextAfter : null);
        setRead('ready');
      } catch {
        setRead('failed');
      }
    },
    [workspaceId, programmeId, headers],
  );
  useEffect(() => {
    if (!applicationsOn) return;
    // The read starts after this effect returns; state changes only when it settles.
    void Promise.resolve().then(() => load());
  }, [applicationsOn, load]);

  async function decide(item: Application, decision: 'INVITED' | 'WAITLISTED' | 'DECLINED') {
    if (writing.current) return;
    const note = decision === 'DECLINED' ? reason.trim() : '';
    if (decision === 'DECLINED' && !between(note, 10, 500)) {
      setRowError({ id: item.id, message: pp('pp.org.declineReasonNeeded') });
      return;
    }
    writing.current = true;
    setBusy(true);
    setRowError(null);
    const result = await pageRequest(
      { subject, issuer },
      {
        kind: 'application',
        action: 'decide',
        commandId: commands.forIntent('decide' + item.id + item.decisionVersion + decision + note),
        workspaceId,
        programmeId,
        applicationId: item.id,
        expectedVersion: item.decisionVersion,
        decision,
        ...(note ? { note } : {}),
        acknowledged: true,
      },
    );
    writing.current = false;
    setBusy(false);
    if (!result.ok) {
      setRowError({ id: item.id, message: result.message });
      return;
    }
    setDeclining(null);
    setReason('');
    try {
      const updated = parseApplication(result.body);
      setApplications((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      await load();
    }
  }

  const rows = useMemo(
    () => boardRows(applications, props.invitations, props.registrations),
    [applications, props.invitations, props.registrations],
  );
  const partial = nextAfter !== null || !!props.moreInvitations || !!props.moreRegistrations;
  const shown = rows.slice(0, boardVisible);
  const rest = rows.slice(boardVisible);

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
              {answers.map((decision) =>
                decision === 'DECLINED' ? (
                  <button
                    key={decision}
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => {
                      setDeclining(item.id);
                      setReason('');
                      setRowError(null);
                    }}
                  >
                    {pp('pp.org.decline')}
                    <span className="sr-only"> {item.displayLabel}</span>
                  </button>
                ) : (
                  <button
                    key={decision}
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void decide(item, decision)}
                  >
                    {decision === 'WAITLISTED'
                      ? pp('pp.org.waitlist')
                      : item.status === 'INVITATION_EXPIRED'
                        ? pp('pp.org.inviteAgain')
                        : pp('pp.org.invite')}
                    <span className="sr-only"> {item.displayLabel}</span>
                  </button>
                ),
              )}
            </div>
          )
        )}
        {rowError?.id === item.id && <p role="alert">{rowError.message}</p>}
      </>
    );
  }

  return (
    <div className="people-board" id={`${programmeId}-board`} tabIndex={-1}>
      <h4>{realCustomerInput() ? 'People board' : 'Sample people board'}</h4>
      <p className="people-board-lead">{boardLead(rows, partial)}</p>
      {read === 'failed' && (
        <p role="status" className="programme-note">
          Applications could not be read. Invitations and registrations are shown.
        </p>
      )}
      {shown.length > 0 && <ul className="people-board-list">{shown.map(row)}</ul>}
      {rest.length > 0 && (
        <details className="people-board-more">
          <summary>
            Show {rest.length} more
            {rows.some((r, i) => i >= boardVisible && r.group === 'closed')
              ? ', including ended'
              : ''}
          </summary>
          <ul className="people-board-list">{rest.map(row)}</ul>
        </details>
      )}
      {partial && (
        <button
          type="button"
          className="text-link"
          disabled={busy || props.busy}
          onClick={() => {
            if (nextAfter) void load(nextAfter);
            // One participants page per press: the participants read starts one request at a time.
            if (props.moreInvitations) props.onMore('invitations', props.moreInvitations);
            else if (props.moreRegistrations)
              props.onMore('registrations', props.moreRegistrations);
          }}
        >
          Load More People
        </button>
      )}
    </div>
  );
}
