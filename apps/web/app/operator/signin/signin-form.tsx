'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { identityClient } from '@corridra/auth/client';
import { operatorReturnTo } from '../../../lib/workspace-navigation';
export function OperatorSignin({ returnTo = '/operator' }: { returnTo?: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<'password' | 'enrol' | 'verify'>('password');
  const heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [stage]);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (message) errorMessage.current?.focus();
  }, [message]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (stage === 'password') {
        const r = await identityClient.signIn.email({ email, password });
        if (r.error) throw new Error('Sign-in failed. Check your details and try again.');
        if ('twoFactorRedirect' in r.data && r.data.twoFactorRedirect) {
          setPassword('');
          setStage('verify');
        } else {
          const session = await identityClient.getSession();
          setStage(session.data?.user.twoFactorEnabled ? 'verify' : 'enrol');
        }
      } else if (stage === 'enrol') {
        const r = await identityClient.twoFactor.enable({ password });
        if (r.error || !r.data || r.data.method !== 'totp')
          throw new Error('Authenticator setup failed. Check your password and try again.');
        setSetup(r.data);
        setPassword('');
        setStage('verify');
      } else {
        const r = await identityClient.twoFactor.verifyTotp({ code, trustDevice: false });
        if (r.error) throw new Error('That code could not be verified. Try a current code.');
        setSetup(null);
        setCode('');
        // Browsers can retain a fragment through the initial protected-page redirect.
        // Validate it again and keep only registered destinations after MFA.
        const destination =
          returnTo.startsWith('/operator') && !returnTo.includes('#')
            ? operatorReturnTo(returnTo + window.location.hash)
            : operatorReturnTo(returnTo);
        router.replace(destination);
        router.refresh();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const contributor = returnTo.startsWith('/contributor?');
  return (
    <form
      method="post"
      className="operator-form"
      onSubmit={submit}
      aria-label={contributor ? 'Contributor sign-in' : 'Operator sign-in'}
    >
      <h2 ref={heading} tabIndex={-1}>
        {stage === 'password'
          ? contributor
            ? 'Use your contributor work account'
            : 'Use your operator account'
          : stage === 'enrol'
            ? 'Set up your authenticator'
            : 'Verify your authenticator'}
      </h2>
      <p>
        Access is limited to invited work accounts. Use your separate work password and
        authenticator. Your customer account does not grant staff or assigned-task access.
      </p>
      {stage === 'password' && (
        <label className="field">
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </label>
      )}
      {stage !== 'verify' && (
        <label className="field">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
        </label>
      )}
      {setup && (
        <div className="setup-secret">
          <p>
            Add this setup key to your authenticator. Keep your recovery codes in a private password
            manager.
          </p>
          <label className="field">
            Authenticator setup key
            <input readOnly value={new URL(setup.totpURI).searchParams.get('secret') ?? ''} />
          </label>
          <details>
            <summary>Recovery codes</summary>
            <pre>{setup.backupCodes.join('\n')}</pre>
          </details>
        </div>
      )}
      {stage === 'verify' && (
        <label className="field">
          Six-digit code
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            disabled={busy}
          />
        </label>
      )}
      {message && (
        <p role="alert" tabIndex={-1} ref={errorMessage} className="field-error">
          {message}
        </p>
      )}
      <button className="primary-link" disabled={busy}>
        {busy
          ? 'Checking…'
          : stage === 'password'
            ? 'Continue'
            : stage === 'enrol'
              ? 'Set up authenticator'
              : 'Verify and open workspace'}
      </button>
    </form>
  );
}
