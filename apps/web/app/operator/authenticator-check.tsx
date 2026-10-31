'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { identityClient } from '@corridra/auth/client';
import { PanelHeading } from './panel-heading';
import { classifyVerifyResult, type AuthenticatorOutcome } from '../../lib/authenticator-check';
import { operatorSignInPath } from '../../lib/workspace-navigation';

type ResultKind = AuthenticatorOutcome | 'accepted-not-refreshed';
type Result = { kind: ResultKind; acceptedAt: Date | null };
type ReturnTarget = { href: string; label: string } | null;

const acceptedTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
const errorKinds: readonly ResultKind[] = [
  'invalid-code',
  'rate-limited',
  'signed-out',
  'origin-rejected',
];

/**
 * The body of the authenticator panel. The result of a check is said here, next to the field,
 * while the shared status line keeps saying "Saved." after a success. The code is read from the
 * form when it is sent and is never kept, shown or stored.
 */
export function AuthenticatorCheck({
  busy,
  act,
  returnTo,
  tenant,
}: {
  busy: boolean;
  act: (work: () => Promise<unknown>) => Promise<boolean>;
  returnTo: ReturnTarget;
  tenant: string;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const pending = useRef(false);
  const focusAfterResult = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (busy || !result || !focusAfterResult.current) return;
    focusAfterResult.current = false;
    if (formRef.current?.closest('[hidden]')) return;
    const target = result.kind === 'invalid-code' ? inputRef.current : noticeRef.current;
    target?.focus({ preventScroll: true });
    noticeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [busy, result]);
  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const code = String(new FormData(event.currentTarget).get('code'));
    setResult(null);
    setChecking(true);
    let outcome = 'unknown' as AuthenticatorOutcome;
    let acceptedAt: Date | null = null;
    try {
      const refreshed = await act(async () => {
        try {
          outcome = classifyVerifyResult(
            await identityClient.twoFactor.verifyTotp({ code, trustDevice: false }),
          );
        } catch {
          outcome = 'unknown';
        }
        if (outcome !== 'accepted') throw new Error('');
        acceptedAt = new Date();
      });
      if (inputRef.current) inputRef.current.value = '';
      focusAfterResult.current = true;
      setResult({
        kind: outcome === 'accepted' && !refreshed ? 'accepted-not-refreshed' : outcome,
        acceptedAt,
      });
    } finally {
      setChecking(false);
      pending.current = false;
    }
  }
  const invalid = result?.kind === 'invalid-code';
  return (
    <>
      <PanelHeading
        title="Confirm a sensitive action"
        eyebrow="Settings and access"
        icon="lock"
        description="Use a fresh code from your authenticator app to continue a protected action."
      />
      <div className="ux-authenticator-guidance">
        <p>
          Stay signed in while you verify. Invitation access requires a check made within the last
          five minutes.
        </p>
        <p>
          After verification, return to the form you were using and refresh its records.
          Verification does not grant a new role or change your country scope.
        </p>
      </div>
      <form
        ref={formRef}
        className="operator-form"
        aria-busy={checking ? true : undefined}
        onSubmit={(event) => void check(event)}
      >
        <label className="field">
          Current authenticator code
          <input
            ref={inputRef}
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={
              invalid
                ? 'workspace-authenticator-result workspace-authenticator-help'
                : 'workspace-authenticator-help'
            }
            required
          />
        </label>
        <p id="workspace-authenticator-help">
          Enter the six-digit code. Your existing form entries stay in their workspace tabs.
        </p>
        <button className="primary-link" disabled={busy}>
          Verify again
        </button>
        {checking ? (
          <p key="checking" className="billing-notice">
            Checking the code…
          </p>
        ) : (
          result && (
            <p
              key={result.kind}
              ref={noticeRef}
              id="workspace-authenticator-result"
              tabIndex={-1}
              className="billing-notice"
              data-tone={
                errorKinds.includes(result.kind)
                  ? 'error'
                  : result.kind === 'unknown'
                    ? undefined
                    : 'ok'
              }
              role={errorKinds.includes(result.kind) ? 'alert' : 'status'}
              aria-atomic="true"
            >
              <ResultText result={result} returnTo={returnTo} tenant={tenant} />
            </p>
          )
        )}
      </form>
    </>
  );
}

function ResultText({
  result,
  returnTo,
  tenant,
}: {
  result: Result;
  returnTo: ReturnTarget;
  tenant: string;
}) {
  const back = returnTo && (
    <>
      {' '}
      <a className="text-link" href={returnTo.href}>
        Back to {returnTo.label}
      </a>
    </>
  );
  const accepted = result.acceptedAt && (
    <strong>
      Code accepted at{' '}
      <time dateTime={result.acceptedAt.toISOString()}>
        {acceptedTime.format(result.acceptedAt)}
      </time>
      .
    </strong>
  );
  switch (result.kind) {
    case 'accepted':
      return (
        <>
          {accepted}{' '}
          {returnTo
            ? 'Most protected actions accept a check from the last five minutes, so try the action again now.'
            : 'Most protected actions accept a check from the last five minutes, so go back to your form and try the action again now.'}
          {back}
        </>
      );
    case 'accepted-not-refreshed':
      return (
        <>
          {accepted} The records on this page did not refresh, so some details may be out of date.
          Try the action again now.
          {back}
        </>
      );
    case 'invalid-code':
      return (
        <>
          <strong>Code not accepted.</strong> Type the code your app shows now. Codes change every
          30 seconds. If it still fails, check that the clock on your phone or computer is correct.
        </>
      );
    case 'rate-limited':
      return (
        <>
          <strong>Too many tries.</strong> This code was not checked. Wait a minute, then try again
          with the code your app shows then.
        </>
      );
    case 'signed-out':
      return (
        <>
          <strong>You are signed out.</strong> The code was not checked because your sign-in has
          ended. Copy any unsaved entries before you leave this page.{' '}
          <Link className="text-link" href={operatorSignInPath(tenant, 'workspace-authenticator')}>
            Sign in again
          </Link>
        </>
      );
    case 'origin-rejected':
      return (
        <>
          <strong>The check could not be confirmed from this page.</strong> The code was not
          checked. Copy any unsaved entries, then reload the page and try again with a new code.
        </>
      );
    case 'unknown':
      return (
        <>
          <strong>The check did not finish.</strong> There was no clear answer, so the code may not
          have been checked. Try again with the code your app shows now.
        </>
      );
  }
}
