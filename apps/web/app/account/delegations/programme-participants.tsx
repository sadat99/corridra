'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { ProgrammeObjectives } from './programme-objectives';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParticipantView, type ParticipantScope } from './participant-client';
type Props = ParticipantScope & {
  workspaceId: string;
  programmeId: string;
  missionSharesEnabled?: boolean;
};
export function ProgrammeParticipants(props: Props) {
  return (
    <ScopedParticipants
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}
function ScopedParticipants(props: Props) {
  const [label, setLabel] = useState('Synthetic participant invitation'),
    [reason, setReason] = useState(''),
    [issueAck, setIssueAck] = useState(false),
    [changeAck, setChangeAck] = useState(false),
    [error, setError] = useState('');
  const [changeTarget, setChangeTarget] = useState<{
    id: string;
    kind: 'invitation' | 'registration';
  } | null>(null);
  const [accessError, setAccessError] = useState('');
  const clear = useCallback(() => {
    setLabel('Synthetic participant invitation');
    setChangeTarget(null);
    setAccessError('');
    setReason('');
    setIssueAck(false);
    setChangeAck(false);
    setError('');
  }, []);
  const saved = useCallback((command: { action: string }) => {
    if (command.action === 'invite') {
      setLabel('Synthetic participant invitation');
      setIssueAck(false);
    } else {
      setChangeTarget(null);
      setReason('');
      setChangeAck(false);
      setAccessError('');
    }
  }, []);
  const view = useParticipantView(props, clear, saved);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (
        label !== 'Synthetic participant invitation' ||
        reason ||
        view.pending ||
        view.result?.token
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [label, reason, view.pending, view.result]);
  function revoke(id: string, kind: 'invitation' | 'registration') {
    setError('');
    if (changeTarget?.id !== id || changeTarget.kind !== kind) {
      setChangeTarget({ id, kind });
      setReason('');
      setChangeAck(false);
      setAccessError('Give a reason and confirm the programme access change.');
      return;
    }
    if (reason.trim().length < 10 || reason.trim().length > 500 || !changeAck) {
      setAccessError('Give a reason and confirm the programme access change.');
      return;
    }
    void view.send({
      action: 'revoke',
      commandId: crypto.randomUUID(),
      workspaceId: props.workspaceId,
      programmeId: props.programmeId,
      kind,
      targetId: id,
      reason: reason.trim(),
      acknowledged: true,
    });
    setChangeAck(false);
  }
  const accessFields = (
    <div className="operator-form">
      <h4>Change programme access</h4>
      {accessError && <p role="alert">{accessError}</p>}
      <label className="field">
        Reason for access change
        <textarea
          value={reason}
          minLength={10}
          maxLength={500}
          disabled={view.busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={changeAck}
          disabled={view.busy}
          onChange={(e) => setChangeAck(e.target.checked)}
        />
        I confirm this access change. Revoking an invitation stops new registrations; revoking a
        registration ends programme access. Separate commercial permissions remain governed by their
        own grants. Reissuing an invitation does not restore a revoked registration.
      </label>
      <button
        type="button"
        className="primary-link"
        disabled={view.busy || !!view.pending || !changeAck || reason.trim().length < 10}
        onClick={() => {
          if (changeTarget) revoke(changeTarget.id, changeTarget.kind);
        }}
      >
        Confirm access change
      </button>
      <button
        type="button"
        className="text-link"
        onClick={() => {
          setChangeTarget(null);
          setReason('');
          setChangeAck(false);
          setAccessError('');
        }}
      >
        Cancel access change
      </button>
    </div>
  );
  if (!view.visible)
    return (
      <p role="status">Participant details are hidden. Access will be checked when you return.</p>
    );
  return (
    <section
      className="delivery-view ux-saved-commercial-report"
      aria-label={realCustomerInput() ? 'Programme participants' : 'Sample programme participants'}
    >
      <h3> {realCustomerInput() ? 'Participants' : 'Sample participants'} </h3>
      <p>
        {realCustomerInput()
          ? 'A registration records interest and permission to share a display name. Eligibility, private missions, meetings and fees are not managed here.'
          : 'Use fictional information only. A registration records interest and permission to share a display name. Eligibility, private missions, meetings and fees are not managed here.'}{' '}
      </p>
      {view.status === 'loading' && <p role="status">Checking programme participant access…</p>}
      {view.status === 'denied' && (
        <p role="alert">
          Only current programme workspace owners and administrators can manage these invitations
          and registrations.
        </p>
      )}
      {view.status === 'unavailable' && (
        <p role="status">
          {' '}
          {realCustomerInput()
            ? 'Delegation participation is unavailable.'
            : 'Sample delegation participation is unavailable.'}{' '}
        </p>
      )}
      {view.status === 'failed' && (
        <p role="alert">Participant details could not be confirmed. Reload to check access.</p>
      )}
      {view.status === 'ready' && view.data && (
        <>
          <h4>Invitations</h4>
          {view.data.invitations.length === 0 ? (
            <p className="ux-empty">
              {' '}
              {realCustomerInput() ? 'No invitations yet.' : 'No sample invitations yet.'}{' '}
            </p>
          ) : (
            <ul>
              {view.data.invitations.map((i) => (
                <li key={i.id}>
                  <strong>{i.label}</strong>
                  <p>
                    {i.status === 'ISSUED'
                      ? 'Invitation available'
                      : i.status === 'USED'
                        ? 'Invitation used'
                        : 'Invitation unavailable'}{' '}
                    · Expires {i.expiresAt}
                  </p>
                  {i.status === 'ISSUED' && (
                    <button
                      data-intent="destructive"
                      type="button"
                      className="text-link"
                      disabled={view.busy || !!view.pending}
                      onClick={() => revoke(i.id, 'invitation')}
                    >
                      Revoke invitation
                    </button>
                  )}
                  {!view.pending &&
                    changeTarget?.id === i.id &&
                    changeTarget.kind === 'invitation' &&
                    accessFields}
                </li>
              ))}
            </ul>
          )}
          {view.data.nextInvitationAfter && (
            <button
              type="button"
              className="text-link"
              disabled={view.busy}
              onClick={() => void view.load('invitations', view.data!.nextInvitationAfter!)}
            >
              Load more invitations
            </button>
          )}
          <h4>Consented registrations</h4>
          {view.data.registrations.length === 0 ? (
            <p className="ux-empty">No consented registrations yet.</p>
          ) : (
            <ul>
              {view.data.registrations.map((r) => (
                <li key={r.id}>
                  <strong>{r.displayLabel}</strong>
                  <p>
                    {r.status === 'REGISTERED'
                      ? 'Registered · Self-declared'
                      : r.status === 'WITHDRAWN'
                        ? 'Participant withdrew'
                        : 'Programme access revoked'}
                  </p>
                  {props.missionSharesEnabled && r.status === 'REGISTERED' && (
                    <ProgrammeObjectives
                      subject={props.subject}
                      issuer={props.issuer}
                      registrationId={r.id}
                      view="manage"
                    />
                  )}
                  {r.status === 'REGISTERED' && (
                    <button
                      data-intent="destructive"
                      type="button"
                      className="text-link"
                      disabled={view.busy || !!view.pending}
                      onClick={() => revoke(r.id, 'registration')}
                    >
                      Revoke programme access
                    </button>
                  )}
                  {!view.pending &&
                    changeTarget?.id === r.id &&
                    changeTarget.kind === 'registration' &&
                    accessFields}
                </li>
              ))}
            </ul>
          )}
          {view.data.nextRegistrationAfter && (
            <button
              type="button"
              className="text-link"
              disabled={view.busy}
              onClick={() => void view.load('registrations', view.data!.nextRegistrationAfter!)}
            >
              Load more registrations
            </button>
          )}
          {!view.pending && (
            <form
              className="operator-form"
              onSubmit={(event) => {
                event.preventDefault();
                setError('');
                if (
                  (!realCustomerInput() && !label.trim().startsWith('Synthetic ')) ||
                  label.trim().length < (realCustomerInput() ? 2 : 11) ||
                  label.trim().length > 120 ||
                  !issueAck
                ) {
                  setError(
                    realCustomerInput()
                      ? 'Enter a display label and confirm permission to share it.'
                      : 'Use a fictional label beginning with Synthetic and confirm sample use.',
                  );
                  return;
                }
                void view.send({
                  action: 'invite',
                  commandId: crypto.randomUUID(),
                  workspaceId: props.workspaceId,
                  programmeId: props.programmeId,
                  label: label.trim(),
                  acknowledged: true,
                });
                setIssueAck(false);
              }}
            >
              <h4>
                {' '}
                {realCustomerInput() ? 'Create a invitation' : 'Create a sample invitation'}{' '}
              </h4>
              <label className="field">
                Invitation label
                <input
                  value={label}
                  required
                  minLength={realCustomerInput() ? 2 : 11}
                  maxLength={120}
                  disabled={view.busy}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={issueAck}
                  required
                  disabled={view.busy}
                  onChange={(e) => setIssueAck(e.target.checked)}
                />
                {realCustomerInput()
                  ? 'I will share this code only with an approved test participant. No message is sent.'
                  : 'I will share this sample code only with an approved test participant. No message is sent.'}{' '}
              </label>
              <button className="primary-link" disabled={view.busy}>
                {realCustomerInput()
                  ? 'Create invitation code'
                  : 'Create sample invitation code'}{' '}
              </button>
            </form>
          )}
          {view.result?.action === 'invite' && view.result.issued === true && (
            <div>
              <label className="field">
                {realCustomerInput() ? 'Private invitation code' : 'Private sample invitation code'}{' '}
                <input readOnly autoComplete="off" value={String(view.result.token)} />
              </label>
              <p>
                Select and copy this code privately. It is shown once and clears when this view is
                hidden or expires. The recipient can use{' '}
                <Link className="text-link" href="/account/delegations">
                  Delegation registrations
                </Link>{' '}
                to inspect and accept it.
              </p>
            </div>
          )}
        </>
      )}
      {view.pending && view.status === 'ready' && (
        <button
          type="button"
          className="primary-link"
          disabled={view.busy}
          onClick={() => void view.send(view.pending!)}
        >
          Retry same participant request
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {view.notice && <p role="status">{view.notice}</p>}
      {view.status !== 'loading' && (
        <button
          type="button"
          className="text-link"
          disabled={view.busy}
          onClick={() => void view.load()}
        >
          Reload programme participants
        </button>
      )}
    </section>
  );
}
