'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountWords } from '../app/account/account-lifecycle-words';
import {
  accountEndpoint,
  readAccountState,
  type AccountCommand,
  type AccountState,
} from '../app/account/account-lifecycle-client';
import { AccountSignout } from '../app/account/signout';
import {
  sessionHeaders,
  useLifecycleCommand,
  whenWords,
  type SessionHeaders,
} from '../app/account/workspace-lifecycle-client';
import { LifecycleErrorLine } from '../app/account/lifecycle-error-line';

/** What a person with a closed account sees instead of the customer pages: the status, Reopen My Account, Sign Out. */
export function CustomerClosedAccount({
  state,
  headers,
  onReopened,
}: {
  state: AccountState;
  headers: SessionHeaders;
  onReopened: () => void;
}) {
  const { send, busy } = useLifecycleCommand<AccountCommand>(headers, accountEndpoint);
  const erase = useLifecycleCommand<AccountCommand>(headers, accountEndpoint);
  const [filed, setFiled] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const reopen = async () => {
    setMessage(null);
    const result = await send({ action: 'undo' });
    if (!result) return;
    if (result.kind === 'done') onReopened();
    else setMessage(result.kind === 'failed' ? result.message : accountWords.finalNotice);
  };
  // A closed person can still ask for erasure: the right does not end with the closing.
  const askErasure = async () => {
    setMessage(null);
    const result = await erase.send({ action: 'file_erasure' });
    if (!result) return;
    if (result.kind === 'done') setFiled((result.done as { reference?: string }).reference ?? '');
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
            Your account is closed. You can undo this until {whenWords(state.undoUntil)}. After that
            it is final.
          </p>
        ) : (
          <p>{accountWords.finalNotice}</p>
        )}
        {(state.erasure || filed) && (
          <p>
            You also have an erasure request open. Reference {state.erasure?.reference ?? filed}.
          </p>
        )}
        {!state.erasure && !filed && (
          <>
            <p>{accountWords.closedNotice}</p>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || erase.busy}
              onClick={() => void askErasure()}
            >
              {erase.busy ? 'Please Wait…' : 'Ask for Erasure'}
            </button>
          </>
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
        <LifecycleErrorLine message={message} />
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
export function ClosedAccountGate({
  subject,
  issuer,
  children,
}: {
  subject: string;
  issuer: string;
  children: ReactNode;
}) {
  const headers = useMemo(() => sessionHeaders(subject, issuer), [subject, issuer]);
  const [state, setState] = useState<AccountState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const check = () =>
      void readAccountState(headers, controller.signal).then((next) => {
        if (!controller.signal.aborted) setState(next);
      });
    check();
    window.addEventListener('focus', check);
    return () => {
      controller.abort();
      window.removeEventListener('focus', check);
    };
  }, [headers]);
  if (state && state.status !== 'active')
    return (
      <CustomerClosedAccount
        state={state}
        headers={headers}
        onReopened={() => {
          setState(null);
          window.location.reload();
        }}
      />
    );
  return <>{children}</>;
}
