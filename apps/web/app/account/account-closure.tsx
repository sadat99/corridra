'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/ux/dialog';
import { accountWords, erasureStatusWords } from './account-lifecycle-words';
import {
  accountEndpoint,
  readAccountState,
  type AccountCommand,
  type AccountState,
} from './account-lifecycle-client';
import { useLifecycleCommand, whenWords, type LifecycleResult } from './workspace-lifecycle-client';

/** Shown while the real controls are closed or unavailable. Plain text, one sentence, no control. */
export function AccountClosureComingSoon() {
  return (
    <section aria-label={accountWords.sectionHeading}>
      <h3>{accountWords.sectionHeading}</h3>
      <p>
        Coming soon. To close your account or ask for erasure now, write to the privacy contact on
        the{' '}
        <Link className="text-link" prefetch={false} href="/privacy">
          privacy page
        </Link>
        . We reply within 30 days.
      </p>
    </section>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  return message ? (
    <p ref={ref} tabIndex={-1} role="alert" className="ux-error-summary">
      {message}
    </p>
  ) : null;
}

const noHeaders = {};
type Asking = 'close' | 'erasure' | null;

export function AccountClosure() {
  const [state, setState] = useState<AccountState | null | undefined>(undefined);
  const [asking, setAsking] = useState<Asking>(null);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  // One command id for each kind of action: a close that was not confirmed keeps its id for the retry of the close only,
  // and never lends it to an erasure request or an undo.
  const closing = useLifecycleCommand<AccountCommand>(noHeaders, accountEndpoint);
  const erasing = useLifecycleCommand<AccountCommand>(noHeaders, accountEndpoint);
  const undoing = useLifecycleCommand<AccountCommand>(noHeaders, accountEndpoint);
  const busy = closing.busy || erasing.busy || undoing.busy;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readAccountState(controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, []);
  // The button that opened a dialog may be gone once the account has changed, so focus goes to the section heading.
  useEffect(() => {
    if (announce) heading.current?.focus();
  }, [announce]);
  if (state === undefined) return null;
  if (state === null) return <AccountClosureComingSoon />;

  const reload = async () => setState((await readAccountState()) ?? state);
  const close = () => {
    setAsking(null);
    setTyped('');
    setMessage(null);
  };
  async function run(
    send: (command: AccountCommand) => Promise<LifecycleResult | null>,
    command: AccountCommand,
    finished: (result: LifecycleResult) => void,
  ) {
    setMessage(null);
    const result = await send(command);
    if (!result) return;
    if (result.kind === 'done') finished(result);
    else {
      setMessage(
        result.kind === 'failed'
          ? result.message
          : 'This was not confirmed. Try the same request again.',
      );
      // A refusal such as a workspace that still needs an owner changes what the dialog shows.
      void reload();
    }
  }
  const submitClose = (event: FormEvent) => {
    event.preventDefault();
    if (typed !== accountWords.closePhrase) return;
    void run(closing.send, { action: 'close', confirmation: typed }, async () => {
      close();
      await reload();
      setAnnounce('Your account is closed.');
    });
  };
  const submitErasure = (event: FormEvent) => {
    event.preventDefault();
    void run(erasing.send, { action: 'file_erasure' }, async (result) => {
      close();
      await reload();
      const done =
        result.kind === 'done' ? (result.done as { changed?: boolean; reference?: string }) : {};
      setAnnounce(
        done.changed === false
          ? `You already have an open request. Reference ${done.reference}.`
          : `Your erasure request was sent. Reference ${done.reference}.`,
      );
    });
  };

  const erasure = state.erasure;
  const [statusLabel, statusLine] = erasure ? erasureStatusWords[erasure.status] : ['', ''];
  const closed = state.status !== 'active';
  return (
    <section aria-label={accountWords.sectionHeading}>
      <h3 ref={heading} tabIndex={-1}>
        {accountWords.sectionHeading}
      </h3>
      {announce && (
        <p role="status" className="ux-draft-notice">
          {announce}
        </p>
      )}
      {closed ? (
        <>
          {state.status === 'closed' && state.undoUntil ? (
            <p>Your account is closed until {whenWords(state.undoUntil)}.</p>
          ) : (
            <p>{accountWords.finalNotice}</p>
          )}
          {state.canUndo && (
            <button
              type="button"
              className="primary-link"
              disabled={busy}
              onClick={() =>
                void run(undoing.send, { action: 'undo' }, async () => {
                  await reload();
                  setAnnounce(accountWords.reopened);
                })
              }
            >
              {busy ? 'Please Wait…' : 'Reopen My Account'}
            </button>
          )}
          <ErrorLine message={message} />
        </>
      ) : (
        <>
          <div>
            <h4>Close Account</h4>
            <p>{accountWords.closeRow}</p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setAsking('close')}
            >
              Close Account
            </button>
          </div>
          {!erasure && (
            <div>
              <h4>Ask for Erasure</h4>
              <p>{accountWords.erasureRow}</p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAsking('erasure')}
              >
                Ask for Erasure
              </button>
            </div>
          )}
        </>
      )}
      {erasure && (
        <div className="ux-draft-notice">
          <h4>Erasure Request</h4>
          <dl>
            <dt>Reference</dt>
            <dd>{erasure.reference}</dd>
            <dt>Sent</dt>
            <dd>{whenWords(erasure.filedAt)}</dd>
            <dt>Staff reply due by</dt>
            <dd>{whenWords(erasure.dueAt)}</dd>
            <dt>Status</dt>
            <dd>{statusLabel}</dd>
          </dl>
          <p>{statusLine}</p>
          {erasure.note && <p>{erasure.note}</p>}
        </div>
      )}
      <Dialog
        open={asking === 'close'}
        onClose={close}
        title={accountWords.closeTitle}
        locked={busy}
        returnFocusTo={() => heading.current}
      >
        {state.blockers.length > 0 ? (
          <>
            <div className="ux-draft-notice" role="status">
              <p>{accountWords.blockedNotice}</p>
              <ul>
                {state.blockers.map((blocker) => (
                  <li key={blocker.workspaceId}>
                    {blocker.name}{' '}
                    <Link
                      className="text-link"
                      prefetch={false}
                      href={`/account?view=work&tab=workspaces#workspace-${blocker.workspaceId}`}
                    >
                      Manage {blocker.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ux-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                data-autofocus=""
                onClick={close}
              >
                Keep My Account
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submitClose}>
            <p>{accountWords.closeBody}</p>
            <label className="field">
              Type {accountWords.closePhrase} to confirm
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
            <ErrorLine message={message} />
            <div className="ux-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                data-autofocus=""
                disabled={busy}
                onClick={close}
              >
                Keep My Account
              </button>
              <button
                type="submit"
                className="button button-secondary"
                data-intent="destructive"
                disabled={busy || typed !== accountWords.closePhrase}
              >
                {busy ? 'Please Wait…' : 'Close Account'}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={asking === 'erasure'}
        onClose={close}
        title={accountWords.erasureTitle}
        locked={busy}
        returnFocusTo={() => heading.current}
      >
        <form onSubmit={submitErasure}>
          <p>{accountWords.erasureBody}</p>
          <ErrorLine message={message} />
          <div className="ux-dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              data-autofocus=""
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button type="submit" className="primary-link" disabled={busy}>
              {busy ? 'Please Wait…' : 'Send Erasure Request'}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
