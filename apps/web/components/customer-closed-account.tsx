'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { accountWords } from '../app/account/account-lifecycle-words';
import {
  accountEndpoint,
  readAccountState,
  type AccountCommand,
  type AccountState,
} from '../app/account/account-lifecycle-client';
import { AccountSignout } from '../app/account/signout';
import { useLifecycleCommand, whenWords } from '../app/account/workspace-lifecycle-client';

const noHeaders = {};

/** What a person with a closed account sees instead of the customer pages: the status, Reopen My Account, Sign Out. */
export function CustomerClosedAccount({
  state,
  onReopened,
}: {
  state: AccountState;
  onReopened: () => void;
}) {
  const { send, busy } = useLifecycleCommand<AccountCommand>(noHeaders, accountEndpoint);
  const [message, setMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message]);
  const reopen = async () => {
    setMessage(null);
    const result = await send({ action: 'undo' });
    if (!result) return;
    if (result.kind === 'done') onReopened();
    else setMessage(result.kind === 'failed' ? result.message : accountWords.finalNotice);
  };
  return (
    <main className="operator-page ux-workspace ux-customer">
      <section className="detail-card" aria-labelledby="closed-account-heading">
        <h1 id="closed-account-heading" ref={heading} tabIndex={-1}>
          {accountWords.closedHeading}
        </h1>
        {state.canUndo && state.undoUntil ? (
          <p>
            Your account and workspaces are hidden. You can undo this until{' '}
            {whenWords(state.undoUntil)}. After that it is final.
          </p>
        ) : (
          <p>{accountWords.finalNotice}</p>
        )}
        {state.erasure && (
          <p>You also have an erasure request open. Reference {state.erasure.reference}.</p>
        )}
        {state.canUndo && (
          <button
            type="button"
            className="primary-link"
            disabled={busy}
            onClick={() => void reopen()}
          >
            {busy ? 'Please Wait…' : 'Reopen My Account'}
          </button>
        )}
        {message && (
          <p ref={alert} tabIndex={-1} role="alert" className="ux-error-summary">
            {message}
          </p>
        )}
        <p>
          <AccountSignout />
        </p>
      </section>
    </main>
  );
}

/**
 * Wraps the customer pages when the account module is on. If the signed-in person's account is closed their
 * pages are replaced by the closed-account screen; otherwise the pages are drawn as they always were.
 */
export function ClosedAccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const check = () =>
      void readAccountState(controller.signal).then((next) => {
        if (!controller.signal.aborted) setState(next);
      });
    check();
    window.addEventListener('focus', check);
    return () => {
      controller.abort();
      window.removeEventListener('focus', check);
    };
  }, []);
  if (state && state.status !== 'active')
    return (
      <CustomerClosedAccount
        state={state}
        onReopened={() => {
          setState(null);
          window.location.reload();
        }}
      />
    );
  return <>{children}</>;
}
