'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { accountClient } from '../lib/neon-auth-client';
import { announceSessionChange } from './session-events';
import { accountAccessPath, accountReturnTo } from '../lib/account-return';
export type AccountFormMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify';
export function AccountForm({ mode }: { mode: AccountFormMode }) {
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
  const emailInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (failed && message) feedback.current?.focus();
  }, [failed, message]);
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
      if (mode === 'signin') {
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
              setCode('');
            }}
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
      )}
      {['signin', 'signup', 'reset'].includes(mode) && !(mode === 'reset' && sent) && (
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
