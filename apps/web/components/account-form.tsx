'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { accountClient } from '../lib/neon-auth-client';
import { announceSessionChange } from './session-events';
import { accountAccessPath, accountReturnTo } from '../lib/account-return';
export type AccountFormMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify';
// How long a person waits before asking for another sign-in code.
const resendSeconds = 30;
// The identity client can return an error or throw one. The code route reads only the status and
// the code from either and never shows the provider's own words, which could reveal an account.
async function settle(call: () => Promise<{ error?: unknown } | undefined | void>) {
  try {
    const result = await call();
    return result && result.error ? detail(result.error) : null;
  } catch (error) {
    return detail(error);
  }
}
function detail(error: unknown) {
  const e = (error ?? {}) as { status?: number; code?: string };
  return { status: e.status, code: String(e.code ?? '') };
}
export function AccountForm({
  mode,
  codeSignIn = false,
}: {
  mode: AccountFormMode;
  /** Set by the server from CORRIDRA_CUSTOMER_CODE_SIGNIN. Off keeps the form exactly as it was. */
  codeSignIn?: boolean;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const destination = accountReturnTo(query.get('returnTo'));
  const accessPath = (page: Parameters<typeof accountAccessPath>[0]) =>
    accountAccessPath(page, destination);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // This selects a form stage, not a claim that the provider verified or delivered anything.
  const [sent, setSent] = useState(mode === 'verify');
  const [codeRequested, setCodeRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  // Sign in with a code: a second route into the same sign-in form. Password stays the default.
  const [viaCode, setViaCode] = useState(
    mode === 'signin' && codeSignIn && query.get('method') === 'code',
  );
  const [codeSent, setCodeSent] = useState(false);
  const [waitLeft, setWaitLeft] = useState(0);
  const codeEnabled = mode === 'signin' && codeSignIn;
  const emailInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (failed && message) feedback.current?.focus();
  }, [failed, message]);
  useEffect(() => {
    if (waitLeft <= 0) return;
    const timer = window.setTimeout(() => setWaitLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [waitLeft]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await perform();
  }
  async function perform(requestCode = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailed(false);
    setBusy(true);
    setMessage('');
    try {
      if (codeEnabled && viaCode && (!codeSent || requestCode)) {
        // The answer never says whether an account exists. Only a rate limit is reported as such.
        const failure = await settle(() =>
          accountClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' }),
        );
        if (failure?.status === 429)
          throw new Error('Too many requests. Wait a minute, then try again.');
        setCode('');
        setCodeSent(true);
        setWaitLeft(resendSeconds);
        setMessage('If this address can sign in, a code is on its way.');
      } else if (codeEnabled && viaCode) {
        const failure = await settle(() => accountClient.signIn.emailOtp({ email, otp: code }));
        if (failure)
          throw new Error(
            failure.code === 'TOO_MANY_ATTEMPTS' || failure.status === 429
              ? 'Too many tries. Ask for a new code.'
              : 'That code is wrong or has expired. Check it or ask for a new code.',
          );
        setCode('');
        announceSessionChange();
        router.replace(destination);
        router.refresh();
      } else if (mode === 'signin') {
        const result = await accountClient.signIn.email({ email, password });
        if (result.error) throw new Error('Sign-in failed. Check your details and try again.');
        setPassword('');
        announceSessionChange();
        router.replace(destination);
        router.refresh();
      } else if (mode === 'signup') {
        const result = await accountClient.signUp.email({ name, email, password });
        if (result.error)
          throw new Error(
            'Your account could not be created. Check your details or try signing in.',
          );
        setPassword('');
        router.replace(accessPath('/verify-email'));
        router.refresh();
      } else if (mode === 'forgot') {
        const result = await accountClient.requestPasswordReset({
          email,
          redirectTo: window.location.origin + accessPath('/reset-password'),
        });
        if (result.error)
          throw new Error('The reset request could not be completed. Please try again.');
        setSent(true);
        setMessage('If an account uses this address, you will receive a password reset email.');
      } else if (mode === 'reset') {
        const token = query.get('token');
        if (!token) throw new Error('This reset link is incomplete. Request a new link.');
        const result = await accountClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error('This reset link could not be used. Request a new link.');
        setPassword('');
        setSent(true);
        setMessage('Your password has been changed. You can sign in now.');
        window.history.replaceState(null, '', accessPath('/reset-password'));
      } else if (sent && !requestCode) {
        const result = await accountClient.emailOtp.verifyEmail({ email, otp: code });
        if (result.error)
          throw new Error('That code could not be verified. Check it or request a new code.');
        setCode('');
        router.replace(accessPath('/signin'));
        router.refresh();
      } else {
        const result = await accountClient.emailOtp.sendVerificationOtp({
          email,
          type: 'email-verification',
        });
        if (result.error)
          throw new Error('A verification code could not be requested. Please try again.');
        setCode('');
        setCodeRequested(true);
        setSent(true);
        setMessage(
          'If verification is needed for this account, a code will be sent to this address.',
        );
      }
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : 'The request could not be completed. Please try again.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form method="post" className="operator-form" onSubmit={submit} aria-label="Account access">
      {mode === 'verify' && (
        <p>
          Enter the email address you used to sign up and the six-digit code from your email. You do
          not need a verification link. If you need another code, request one below. If this address
          already has a verified account, no code is sent: sign in, or reset your password.
        </p>
      )}
      {mode === 'signup' && (
        <p>
          Already have an account? Sign in, or reset your password. Signing up again with the same
          address does not create a second account and no code is sent.
        </p>
      )}
      {mode === 'signup' && (
        <label className="field">
          Name
          <input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            maxLength={120}
          />
        </label>
      )}
      {mode !== 'reset' && (
        <label className="field">
          Email
          <input
            type="email"
            ref={emailInput}
            value={email}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              if (mode !== 'verify') setSent(false);
              setCodeSent(false);
              setCode('');
            }}
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
      )}
      {['signin', 'signup', 'reset'].includes(mode) && !(mode === 'reset' && sent) && !viaCode && (
        <label className="field">
          {mode === 'reset' ? 'New password' : 'Password'}
          <input
            type="password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signin' ? undefined : 14}
            maxLength={128}
            required
          />
        </label>
      )}
      {mode === 'verify' && sent && (
        <label className="field">
          Verification code
          <input
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
      )}
      {codeEnabled && viaCode && codeSent && (
        <label className="field">
          Six-digit code
          <input
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
      )}
      {message && (
        <p
          ref={feedback}
          tabIndex={-1}
          role={failed ? 'alert' : 'status'}
          aria-live={failed ? 'assertive' : 'polite'}
          className={failed ? 'ux-error-summary' : 'ux-draft-notice'}
        >
          {message}
        </p>
      )}
      {!(sent && ['forgot', 'reset'].includes(mode)) && (
        <button className="primary-link" disabled={busy}>
          {busy
            ? 'Please wait…'
            : codeEnabled && viaCode && !codeSent
              ? 'Send code'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Request reset email'
                    : mode === 'reset'
                      ? 'Set new password'
                      : sent
                        ? 'Verify email'
                        : 'Request verification code'}
        </button>
      )}
      {codeEnabled && !viaCode && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setViaCode(true);
            setCodeSent(false);
            setCode('');
            setMessage('');
            setFailed(false);
          }}
        >
          Sign in with a code
        </button>
      )}
      {codeEnabled && viaCode && codeSent && (
        <>
          <button
            type="button"
            className="text-link"
            disabled={busy || waitLeft > 0}
            onClick={() => {
              if (emailInput.current?.reportValidity()) void perform(true);
            }}
          >
            Send a new code
          </button>
          {waitLeft > 0 && (
            <p>
              You can ask for a new code in {waitLeft} {waitLeft === 1 ? 'second' : 'seconds'}.
            </p>
          )}
        </>
      )}
      {codeEnabled && viaCode && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setViaCode(false);
            setCodeSent(false);
            setCode('');
            setMessage('');
            setFailed(false);
          }}
        >
          Use my password instead
        </button>
      )}
      {mode === 'verify' && sent && !codeRequested && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            if (emailInput.current?.reportValidity()) void perform(true);
          }}
        >
          Request verification code
        </button>
      )}
      {mode === 'verify' && sent && codeRequested && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setSent(false);
            setCode('');
            setMessage('');
            setFailed(false);
          }}
        >
          Request a new code
        </button>
      )}
      {mode === 'signin' && (
        <>
          <Link className="text-link" href={accessPath('/forgot-password')}>
            Forgot your password?
          </Link>
          <Link className="text-link" href={accessPath('/signup')}>
            Create an account
          </Link>
          <Link className="text-link" href={accessPath('/verify-email')}>
            Verify your email
          </Link>
          <Link className="text-link" href="/operator/signin">
            Invited operator sign-in
          </Link>
        </>
      )}
      {(mode === 'signup' || mode === 'verify') && (
        <Link className="text-link" href={accessPath('/forgot-password')}>
          Forgot your password?
        </Link>
      )}
      {mode !== 'signin' && (
        <Link className="text-link" href={accessPath('/signin')}>
          Back to sign-in
        </Link>
      )}
    </form>
  );
}
