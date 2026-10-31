'use client';
// The in-place re-verify dialog (D12). Mount it once in a signed-in team shell. When an action calls
// withStepUp and the server answers STEP_UP_REQUIRED, this asks for the six-digit authenticator code,
// confirms it with the existing two-factor check, and lets the action retry. The form behind it stays
// mounted, so nothing typed is lost. Owner after Wave 0: WS-E (client).
import './ux-kit.css';
import { useEffect, useId, useRef, useState } from 'react';
import { identityClient } from '@corridra/auth/client';
import { stepUpEvent, type StepUpRequest } from '../../lib/ux/step-up';

export function StepUpDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<StepUpRequest | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The form exists only while the dialog is open, so a closed dialog never adds a second
  // "Six-digit code" field to the page (the sign-in and authenticator forms have their own).
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    function onRequest(event: Event) {
      const request = (event as CustomEvent<StepUpRequest>).detail;
      event.preventDefault();
      pending.current?.resolve(false);
      pending.current = request;
      setCode('');
      setError('');
      setOpen(true);
      if (!dialog.current?.open) dialog.current?.showModal();
    }
    window.addEventListener(stepUpEvent, onRequest);
    return () => window.removeEventListener(stepUpEvent, onRequest);
  }, []);

  function finish(verified: boolean) {
    pending.current?.resolve(verified);
    pending.current = null;
    dialog.current?.close();
    setOpen(false);
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await identityClient.twoFactor.verifyTotp({ code, trustDevice: false });
      if (result.error) throw new Error('That code did not work. Check the app and try again.');
      finish(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="ux-kit-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      {open ? (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <h2 id={`${id}-title`}>Confirm it is you</h2>
          <p>For this step we need a fresh authenticator code. Your work on the page is kept.</p>
          <div className="ux-kit-field">
            <label className="ux-kit-label" htmlFor={`${id}-code`}>
              Six-digit code
            </label>
            <input
              id={`${id}-code`}
              autoFocus
              className="ux-kit-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            {error ? (
              <p className="ux-kit-error" id={`${id}-error`} role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="ux-kit-row" style={{ marginTop: '1rem' }}>
            <button className="ux-kit-button" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Confirm and continue'}
            </button>
            <button
              className="ux-kit-button"
              data-variant="secondary"
              type="button"
              onClick={() => finish(false)}
            >
              Not now
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
