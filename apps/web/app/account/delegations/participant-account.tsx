'use client';
import { ProgrammeContext } from './programme-context';
import { ProgrammeObjectives } from './programme-objectives';
import { ParticipantResults } from './participant-results';
import { ParticipantPlace } from './participant-place';
import { MyReminders } from './my-reminders';
import { useCallback, useEffect, useState } from 'react';
import { useParticipantView, type ParticipantScope } from './participant-client';
export function ParticipantAccount(
  props: ParticipantScope & {
    missionSharesEnabled?: boolean;
    contextEnabled?: boolean;
    coordinationEnabled?: boolean;
    termsEnabled?: boolean;
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
  },
) {
  const [token, setToken] = useState(''),
    [label, setLabel] = useState(''),
    [consent, setConsent] = useState(false),
    [reason, setReason] = useState(''),
    [withdrawAck, setWithdrawAck] = useState(false),
    [error, setError] = useState('');
  const [withdrawTarget, setWithdrawTarget] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState('');
  const clear = useCallback(() => {
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
        I confirm withdrawal. My registration history is retained, and this action does not change
        separate commercial permissions. Rejoining this sample programme after withdrawal is not
        available.
      </label>
      <button
        type="button"
        className="primary-link"
        disabled={view.busy || !!view.pending || !withdrawAck || reason.trim().length < 10}
        onClick={() => {
          if (withdrawTarget) withdraw(withdrawTarget);
        }}
      >
        Confirm withdrawal
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
        Cancel withdrawal
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
      className="delivery-view ux-saved-commercial-report"
      aria-label="My sample delegation participation"
    >
      <a className="text-link ux-back" href="/account">
        Back to my account
      </a>
      <p>
        Fictional sample registration only. An invitation grants no organiser workspace membership
        or private commercial access. Only the display name you consent to share is visible to
        programme organisers.
      </p>
      {props.termsEnabled && <MyReminders subject={props.subject} issuer={props.issuer} />}
      {view.status === 'loading' && <p role="status">Checking your programme access…</p>}
      {view.status === 'denied' && (
        <p role="alert">
          Your account or programme access could not be confirmed. Previous details were cleared.
        </p>
      )}
      {view.status === 'unavailable' && (
        <p role="status">Sample delegation participation is unavailable.</p>
      )}
      {view.status === 'failed' && (
        <p role="alert">Your programme details could not be checked. Reload to try again.</p>
      )}
      {view.status === 'ready' && view.data && (
        <>
          <h2>Your sample registrations</h2>
          {view.data.registrations.length === 0 ? (
            <p className="ux-empty">No sample registrations yet.</p>
          ) : (
            <ul>
              {view.data.registrations.map((r) => (
                <li key={r.id}>
                  {r.status === 'REGISTERED' ? (
                    <>
                      <h3>{r.name}</h3>
                      <p>{r.reportingPurpose}</p>
                      <p>{r.displayLabel} · Registered, self-declared</p>
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
                        />
                      )}
                      {props.termsEnabled && (
                        <ParticipantPlace
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
                      <button
                        type="button"
                        className="text-link"
                        disabled={view.busy || !!view.pending}
                        onClick={() => withdraw(r.id)}
                      >
                        Withdraw from programme
                      </button>
                      {!view.pending && withdrawTarget === r.id && withdrawalFields}
                    </>
                  ) : (
                    <p>
                      {r.status === 'WITHDRAWN'
                        ? 'You withdrew from this sample programme.'
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
              Load more of my registrations
            </button>
          )}
          {!view.pending && (
            <>
              <form
                className="operator-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError('');
                  setConsent(false);
                  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
                    setError('Enter the complete private sample invitation code.');
                    return;
                  }
                  void view.send({ action: 'preview', token });
                }}
              >
                <h2>Inspect a sample invitation</h2>
                <label className="field">
                  Private sample invitation code
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
                <button className="primary-link" disabled={view.busy}>
                  Preview sample invitation
                </button>
              </form>
              {preview && (
                <form
                  className="operator-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError('');
                    if (
                      !label.trim().startsWith('Synthetic ') ||
                      label.trim().length < 11 ||
                      label.trim().length > 120 ||
                      !consent
                    ) {
                      setError(
                        'Use a fictional display name beginning with Synthetic and consent to sharing it.',
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
                    Fictional display name
                    <input
                      value={label}
                      required
                      minLength={11}
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
                    I consent to sharing this fictional display name with this programme&apos;s
                    organisers.
                  </label>
                  <button className="primary-link" disabled={view.busy}>
                    Register for sample programme
                  </button>
                </form>
              )}
            </>
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
          Retry same programme request
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
          Reload my sample registrations
        </button>
      )}
    </section>
  );
}
