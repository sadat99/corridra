'use client';
import { ParticipantProjectionSharing } from './programme-projections';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { registrationsBack, registrationsHelper } from '../frame-copy';
import { ProgrammeContext } from './programme-context';
import { ProgrammeObjectives } from './programme-objectives';
import { DelegatePath } from './delegate-path';
import { ParticipantResults } from './participant-results';
import { ParticipantPlace } from './participant-place';
import { MyReminders } from './my-reminders';
import { Fold } from '../fold';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CorridraIcon } from '../../../components/corridra-icon';
import { MenuButton, OverflowMenu } from '../../../components/ux/overflow-menu';
import './participant-account.css';
import { useParticipantView, type ParticipantScope } from './participant-client';
import { ParticipantLabelEditor, dropLabelDrafts } from './participant-label';
export function ParticipantAccount(
  props: ParticipantScope & {
    missionSharesEnabled?: boolean;
    contextEnabled?: boolean;
    coordinationEnabled?: boolean;
    termsEnabled?: boolean;
    projectionsEnabled?: boolean;
    /** Programme pages and shared objectives are both on: the delegate's objective path is shown. */
    objectivePathEnabled?: boolean;
    draftsEnabled?: boolean;
    /** The page frame shows the back link and the helper line; this section leaves them out. */
    framed?: boolean;
  },
) {
  return <ScopedAccount key={props.issuer + ':' + props.subject} {...props} />;
}
function ScopedAccount(
  props: ParticipantScope & {
    missionSharesEnabled?: boolean;
    contextEnabled?: boolean;
    coordinationEnabled?: boolean;
    termsEnabled?: boolean;
    projectionsEnabled?: boolean;
    /** Programme pages and shared objectives are both on: the delegate's objective path is shown. */
    objectivePathEnabled?: boolean;
    draftsEnabled?: boolean;
    framed?: boolean;
  },
) {
  const [token, setToken] = useState(''),
    [label, setLabel] = useState(''),
    [consent, setConsent] = useState(false),
    [reason, setReason] = useState(''),
    [withdrawAck, setWithdrawAck] = useState(false),
    [error, setError] = useState('');
  const [withdrawTarget, setWithdrawTarget] = useState<string | null>(null);
  // The delegate asked to share their objective from the path: the objective tools open with these words ready.
  const [shareStart, setShareStart] = useState<{ registrationId: string; summary: string } | null>(
    null,
  );
  const [withdrawError, setWithdrawError] = useState('');
  // With the page frame the withdrawal starts from a menu that closes on its choice; focus goes to the first field.
  const reasonField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.framed && withdrawTarget) reasonField.current?.focus();
  }, [props.framed, withdrawTarget]);
  const clear = useCallback(() => {
    // Whatever refused access, the typed label corrections go with the rest of the private details.
    dropLabelDrafts();
    setToken('');
    setWithdrawTarget(null);
    setWithdrawError('');
    setLabel('');
    setConsent(false);
    setReason('');
    setWithdrawAck(false);
    setError('');
  }, []);
  const saved = useCallback((command: { action: string }) => {
    if (command.action === 'accept') {
      setToken('');
      setLabel('');
      setConsent(false);
    } else {
      setWithdrawTarget(null);
      setReason('');
      setWithdrawAck(false);
      setWithdrawError('');
    }
  }, []);
  const view = useParticipantView(props, clear, saved);
  const [labelNote, setLabelNote] = useState('');
  const preview =
    view.result?.action === 'preview' && view.result.requestToken === token ? view.result : null;
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (token || label || reason || view.pending) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [token, label, reason, view.pending]);
  function withdraw(id: string) {
    setError('');
    if (withdrawTarget !== id) {
      setWithdrawTarget(id);
      setReason('');
      setWithdrawAck(false);
      setWithdrawError('Give a reason and confirm withdrawal before ending programme access.');
      return;
    }
    if (reason.trim().length < 10 || reason.trim().length > 500 || !withdrawAck) {
      setWithdrawError('Give a reason and confirm withdrawal before ending programme access.');
      return;
    }
    void view.send({
      action: 'withdraw',
      commandId: crypto.randomUUID(),
      registrationId: id,
      reason: reason.trim(),
      acknowledged: true,
    });
    setWithdrawAck(false);
  }
  const withdrawalFields = (
    <div className="operator-form">
      <h4>Withdraw programme access</h4>
      {withdrawError && <p role="alert">{withdrawError}</p>}
      <label className="field">
        Reason for withdrawal
        <textarea
          ref={reasonField}
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
          checked={withdrawAck}
          disabled={view.busy}
          onChange={(e) => setWithdrawAck(e.target.checked)}
        />
        {realCustomerInput()
          ? 'I confirm withdrawal. My registration history is retained, and this action does not change separate commercial permissions. Rejoining this programme after withdrawal is not available.'
          : 'I confirm withdrawal. My registration history is retained, and this action does not change separate commercial permissions. Rejoining this sample programme after withdrawal is not available.'}{' '}
      </label>
      <button
        type="button"
        className="primary-link"
        disabled={view.busy || !!view.pending || !withdrawAck || reason.trim().length < 10}
        onClick={() => {
          if (withdrawTarget) withdraw(withdrawTarget);
        }}
      >
        Confirm Withdrawal
      </button>
      <button
        type="button"
        className="text-link"
        onClick={() => {
          setWithdrawTarget(null);
          setReason('');
          setWithdrawAck(false);
          setWithdrawError('');
        }}
      >
        Cancel Withdrawal
      </button>
    </div>
  );
  if (!view.visible)
    return (
      <p role="status">
        Your programme details are hidden. Access will be checked when you return.
      </p>
    );
  return (
    <section
      className={
        props.framed
          ? 'delivery-view ux-saved-commercial-report ux-reg'
          : 'delivery-view ux-saved-commercial-report'
      }
      aria-label={
        realCustomerInput() ? 'My delegation participation' : 'My sample delegation participation'
      }
    >
      {!props.framed && (
        <>
          <a className="text-link ux-back" href={registrationsBack.href}>
            {registrationsBack.label}
          </a>
          <p>{registrationsHelper()} </p>
        </>
      )}
      {props.termsEnabled && <MyReminders subject={props.subject} issuer={props.issuer} />}
      {view.status === 'loading' && <p role="status">Checking your programme access…</p>}
      {view.status === 'denied' && (
        <p role="alert">
          Your account or programme access could not be confirmed. Previous details were cleared.
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
        <p role="alert">Your programme details could not be checked. Reload to try again.</p>
      )}
      {view.status === 'ready' && view.data && (
        <>
          <h2> {realCustomerInput() ? 'Your registrations' : 'Your sample registrations'} </h2>
          {view.data.registrations.length === 0 ? (
            <p className="ux-empty">
              {' '}
              {realCustomerInput() ? 'No registrations yet.' : 'No sample registrations yet.'}{' '}
            </p>
          ) : (
            <ul className={props.framed ? 'ux-reg-list' : undefined}>
              {view.data.registrations.map((r) => (
                <li key={r.id} id={'registration-' + r.id}>
                  {r.status === 'REGISTERED' ? (
                    <>
                      <h3>{r.name}</h3>
                      <p>{r.reportingPurpose}</p>
                      <p>
                        {r.displayLabel} ·{' '}
                        {r.labelChangedBy === 'organiser'
                          ? 'Label changed by the organiser'
                          : 'Registered, self-declared'}
                      </p>
                      {typeof r.labelVersion === 'number' && r.displayLabel && (
                        <ParticipantLabelEditor
                          key={r.id}
                          registrationId={r.id}
                          label={r.displayLabel}
                          version={r.labelVersion}
                          headers={{
                            'x-corridra-customer-subject': props.subject,
                            'x-corridra-customer-issuer': props.issuer,
                          }}
                          mine={true}
                          onChanged={() => void view.load()}
                          onNote={setLabelNote}
                          onDenied={view.deny}
                        />
                      )}
                      <Fold
                        anchor={'registration-' + r.id}
                        open={shareStart?.registrationId === r.id}
                        summary="Programme details, objectives and results"
                      >
                        {props.objectivePathEnabled && props.missionSharesEnabled && (
                          <DelegatePath
                            subject={props.subject}
                            issuer={props.issuer}
                            registrationId={r.id}
                            programmeName={r.name ?? ''}
                            displayLabel={r.displayLabel ?? ''}
                            draftsEnabled={!!props.draftsEnabled}
                            onShare={(summary) => setShareStart({ registrationId: r.id, summary })}
                          />
                        )}
                        {props.contextEnabled && (
                          <ProgrammeContext
                            subject={props.subject}
                            issuer={props.issuer}
                            programmeId={r.programmeId!}
                            registrationId={r.id}
                          />
                        )}
                        {props.missionSharesEnabled && (
                          <ProgrammeObjectives
                            subject={props.subject}
                            issuer={props.issuer}
                            registrationId={r.id}
                            view="own"
                            start={shareStart?.registrationId === r.id ? shareStart : undefined}
                          />
                        )}
                        {props.termsEnabled && (
                          <ParticipantPlace
                            subject={props.subject}
                            issuer={props.issuer}
                            registrationId={r.id}
                          />
                        )}
                        {props.projectionsEnabled && (
                          <ParticipantProjectionSharing
                            subject={props.subject}
                            issuer={props.issuer}
                            registrationId={r.id}
                          />
                        )}
                        {props.coordinationEnabled && (
                          <ParticipantResults
                            subject={props.subject}
                            issuer={props.issuer}
                            registrationId={r.id}
                          />
                        )}
                      </Fold>
                      {props.framed ? (
                        // A rare action: one tap deeper in the row menu. The confirm step is the withdrawal form below it.
                        <OverflowMenu
                          label={'More actions for ' + (r.name ?? 'this programme')}
                          trigger={<CorridraIcon name="more" />}
                          className="ux-reg-more"
                          align="start"
                        >
                          <MenuButton
                            data-menu-close=""
                            disabled={view.busy || !!view.pending}
                            onClick={() => withdraw(r.id)}
                          >
                            Withdraw From Programme
                          </MenuButton>
                        </OverflowMenu>
                      ) : (
                        <button
                          type="button"
                          className="text-link"
                          disabled={view.busy || !!view.pending}
                          onClick={() => withdraw(r.id)}
                        >
                          Withdraw From Programme
                        </button>
                      )}
                      {!view.pending && withdrawTarget === r.id && withdrawalFields}
                    </>
                  ) : (
                    <p>
                      {r.status === 'WITHDRAWN'
                        ? realCustomerInput()
                          ? 'You withdrew from this programme.'
                          : 'You withdrew from this sample programme.'
                        : realCustomerInput()
                          ? 'Access to this programme was revoked.'
                          : 'Access to this sample programme was revoked.'}
                    </p>
                  )}
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
              Load More of My Registrations
            </button>
          )}
          {!view.pending && (
            <Fold
              summary={realCustomerInput() ? 'Check an invitation' : 'Inspect a sample invitation'}
              open={!!preview}
            >
              <form
                className="operator-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError('');
                  setConsent(false);
                  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
                    setError(
                      realCustomerInput()
                        ? 'Enter the complete private invitation code.'
                        : 'Enter the complete private sample invitation code.',
                    );
                    return;
                  }
                  void view.send({ action: 'preview', token });
                }}
              >
                <h2>
                  {' '}
                  {realCustomerInput() ? 'Check an invitation' : 'Inspect a sample invitation'}{' '}
                </h2>
                <label className="field">
                  {realCustomerInput()
                    ? 'Private invitation code'
                    : 'Private sample invitation code'}{' '}
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    required
                    minLength={43}
                    maxLength={43}
                    disabled={view.busy}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setConsent(false);
                    }}
                  />
                </label>
                <button
                  className={props.framed && preview ? 'text-link' : 'primary-link'}
                  disabled={view.busy}
                >
                  {realCustomerInput() ? 'Preview Invitation' : 'Preview Sample Invitation'}{' '}
                </button>
              </form>
              {preview && (
                <form
                  className="operator-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError('');
                    if (
                      (!realCustomerInput() && !label.trim().startsWith('Synthetic ')) ||
                      label.trim().length < (realCustomerInput() ? 2 : 11) ||
                      label.trim().length > 120 ||
                      !consent
                    ) {
                      setError(
                        realCustomerInput()
                          ? 'Enter your display name and consent to sharing it.'
                          : 'Use a fictional display name beginning with Synthetic and consent to sharing it.',
                      );
                      return;
                    }
                    await view.send({
                      action: 'accept',
                      commandId: crypto.randomUUID(),
                      programmeId: preview.programmeId,
                      token,
                      displayLabel: label.trim(),
                      consented: true,
                    });
                  }}
                >
                  <h3>{String(preview.name)}</h3>
                  <p>{String(preview.reportingPurpose)}</p>
                  <p>
                    Invitation expires {String(preview.expiresAt)}. Registration records interest;
                    eligibility, meetings and fees are not confirmed.
                  </p>
                  <label className="field">
                    {realCustomerInput() ? 'Display name' : 'Fictional display name'}{' '}
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
                      checked={consent}
                      required
                      disabled={view.busy}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    {realCustomerInput()
                      ? 'I consent to sharing this display name with this programme’s organisers.'
                      : 'I consent to sharing this fictional display name with this programme&apos;s organisers.'}{' '}
                  </label>
                  <button className="primary-link" disabled={view.busy}>
                    {realCustomerInput()
                      ? 'Register for Programme'
                      : 'Register for Sample Programme'}{' '}
                  </button>
                </form>
              )}
            </Fold>
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
          Retry Same Programme Request
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {view.notice && <p role="status">{view.notice}</p>}
      {labelNote && <p role="status">{labelNote}</p>}
      {view.status !== 'loading' && (
        <button
          type="button"
          className="text-link"
          disabled={view.busy}
          onClick={() => void view.load()}
        >
          {realCustomerInput() ? 'Reload My Registrations' : 'Reload My Sample Registrations'}{' '}
        </button>
      )}
    </section>
  );
}
