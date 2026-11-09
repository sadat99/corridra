'use client';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { CustomerAccessPage } from '@corridra/auth/customer-workspaces';
import {
  lifecycleWords,
  useLifecycleCommand,
  whenWords,
  type LifecycleCommand,
  type LifecycleResult,
  type LifecycleState,
  type SessionHeaders,
} from './workspace-lifecycle-client';
import { limitWords } from '../../lib/account-limit';
import { LifecycleErrorLine } from './lifecycle-error-line';
import './invitation-dialog.css';

type BodyProps = {
  /** The workspace as the page last read it. */
  state: LifecycleState;
  /** Called with the finished change, as the words to announce and the new state's version. */
  onFinished: (announce: string, change?: { undoId?: string }) => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  onReload: () => void;
  headers: SessionHeaders;
};

const staleWords =
  'This workspace was changed since you opened this. Reload Workspaces to see its current state.';

/** Runs one command for a dialog and reports its busy state; anything but a finished change becomes a message. */
function useDialogCommand(props: BodyProps) {
  const { send, busy } = useLifecycleCommand(props.headers);
  const [message, setMessage] = useState<string | null>(null);
  const { onBusyChange } = props;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  async function run(
    command: LifecycleCommand,
    finished: (result: Extract<LifecycleResult, { kind: 'done' }>) => void,
    onStale?: (result: Extract<LifecycleResult, { kind: 'stale' }>) => void,
  ) {
    setMessage(null);
    const result = await send(command);
    if (!result) return;
    if (result.kind === 'done') finished(result);
    else if (result.kind === 'stale') {
      if (onStale) onStale(result);
      else setMessage(staleWords);
    } else if (result.kind === 'archived') setMessage(lifecycleWords.archived);
    else setMessage(result.message);
  }
  return { run, busy, message, setMessage };
}

function Actions({
  safe,
  onSafe,
  children,
  busy,
}: {
  safe: string;
  onSafe: () => void;
  children?: ReactNode;
  busy: boolean;
}) {
  return (
    <div className="ux-dialog-actions">
      <button
        type="button"
        className="button button-secondary"
        data-autofocus=""
        disabled={busy}
        onClick={onSafe}
      >
        {safe}
      </button>
      {children}
    </div>
  );
}

export function RenameBody(props: BodyProps) {
  const { state } = props;
  const [current, setCurrent] = useState({ name: state.name, version: state.version });
  const [name, setName] = useState(state.name);
  const [reason, setReason] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const { run, busy, message, setMessage } = useDialogCommand(props);
  const reasonLength = reason.trim().length;
  const changed = name.trim() !== current.name && name.trim().length >= 2;
  const valid = changed && reasonLength >= 10 && reasonLength <= 500;
  const touched = name !== state.name || reason !== '';
  const renames = state.history.filter((entry) => entry.kind === 'rename');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    void run(
      {
        action: 'rename',
        workspaceId: state.workspaceId,
        name: name.trim(),
        reason: reason.trim(),
        expectedVersion: current.version,
      },
      () => props.onFinished(`Workspace renamed to ${name.trim()}.`),
      (stale) => {
        setCurrent({ name: stale.currentName, version: stale.currentVersion });
        setMessage(
          `Someone else changed this name first. The name is now ${stale.currentName}. Your new name is still in the field. Choose Save Name again to replace it, or Cancel.`,
        );
      },
    );
  }
  return (
    <form onSubmit={submit}>
      <p>Current name: {current.name}</p>
      <label className="field">
        Workspace name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          autoComplete="off"
          required
        />
      </label>
      {current.name !== state.name && (
        <button type="button" className="text-link" onClick={() => setName(current.name)}>
          Use Current Name
        </button>
      )}
      <label className="field">
        Why are you renaming it?
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          required
          aria-describedby="rename-reason-help"
        />
      </label>
      <p id="rename-reason-help" className="notifications-help">
        10 to 500 characters. Only people in this workspace can read this. Every name stays in the
        history.
      </p>
      <details>
        <summary>Name History</summary>
        {renames.length === 0 ? (
          <p>No earlier names.</p>
        ) : (
          <ul>
            {renames.map((entry) => (
              <li key={entry.version}>
                {entry.previousName} to {entry.name}. {whenWords(entry.at)}.{' '}
                {entry.byYou ? 'By you.' : 'By another person.'}
                {entry.reason ? ` ${entry.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </details>
      <LifecycleErrorLine message={message} />
      {discarding ? (
        <div className="ux-draft-notice" role="group" aria-label="Discard changes">
          <p>Discard Changes?</p>
          <div className="ux-dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              data-autofocus=""
              onClick={() => setDiscarding(false)}
            >
              Keep Editing
            </button>
            <button type="button" className="text-link" onClick={props.onCancel}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <Actions
          safe="Cancel"
          busy={busy}
          onSafe={() => (touched ? setDiscarding(true) : props.onCancel())}
        >
          <button type="submit" className="primary-link" disabled={busy || !valid}>
            {busy ? 'Please Wait…' : 'Save Name'}
          </button>
        </Actions>
      )}
    </form>
  );
}

export function ArchiveBody(props: BodyProps) {
  const { state } = props;
  const [typed, setTyped] = useState('');
  const { run, busy, message } = useDialogCommand(props);
  const matches = typed.trim() === state.name;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches) return;
    void run(
      {
        action: 'archive',
        workspaceId: state.workspaceId,
        expectedVersion: state.version,
        confirmName: typed.trim(),
      },
      () => props.onFinished(`${state.name} was archived.`, { undoId: state.workspaceId }),
    );
  }
  return (
    <form onSubmit={submit}>
      <p>Archiving {state.name} pauses it. Here is what happens.</p>
      <ul>
        <li>New private requests, invitations and registrations stop.</li>
        <li>Existing records stay readable.</li>
        <li>Nothing is deleted.</li>
        <li>Restore Workspace undoes it.</li>
      </ul>
      <label className="field">
        Type the workspace name to confirm
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="archive-name-help"
        />
      </label>
      <p id="archive-name-help" className="notifications-help">
        Type {state.name} exactly.
      </p>
      <LifecycleErrorLine message={message} />
      <Actions safe="Keep Workspace" busy={busy} onSafe={props.onCancel}>
        <button
          type="submit"
          className="button button-secondary"
          data-intent="destructive"
          disabled={busy || !matches}
        >
          {busy ? 'Please Wait…' : 'Archive Workspace'}
        </button>
      </Actions>
    </form>
  );
}

export function RestoreBody(props: BodyProps) {
  const { state } = props;
  const { run, busy, message } = useDialogCommand(props);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          { action: 'restore', workspaceId: state.workspaceId, expectedVersion: state.version },
          () => props.onFinished(`${state.name} was restored.`),
        );
      }}
    >
      <p>
        {state.name} will be open again. Invitations can be sent and new requests can be started.
      </p>
      <LifecycleErrorLine message={message} />
      <Actions safe="Not Now" busy={busy} onSafe={props.onCancel}>
        <button type="submit" className="primary-link" disabled={busy}>
          {busy ? 'Please Wait…' : 'Restore Workspace'}
        </button>
      </Actions>
    </form>
  );
}

type Candidate = { id: string; label: string; role: string };

export function TransferBody(props: BodyProps) {
  const { state, headers } = props;
  const [members, setMembers] = useState<Candidate[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [memberId, setMemberId] = useState('');
  const [typed, setTyped] = useState('');
  const { run, busy, message } = useDialogCommand(props);
  useEffect(() => {
    const controller = new AbortController();
    // The team is read page by page until the list is exhausted or 200 members are in hand, so a member beyond the
    // first page can be chosen, and "no one" is only said once every page has been seen.
    void (async () => {
      const found: Candidate[] = [];
      let after: string | null = null;
      let seen = 0;
      do {
        const query = new URLSearchParams({ workspaceId: state.workspaceId, pageSize: '100' });
        if (after) query.set('memberAfter', after);
        const response = await fetch('/api/customer-workspace-access?' + query, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers,
        });
        if (!response.ok)
          throw new Error(response.status === 429 ? limitWords : 'The team could not be loaded.');
        const page = (await response.json()) as CustomerAccessPage;
        seen += page.memberships.length;
        for (const m of page.memberships)
          if (
            m.status === 'active' &&
            !state.protectedMembers.some((kept) => kept.memberId === m.id)
          )
            found.push({ id: m.id, label: m.label, role: m.role });
        after = page.nextMemberAfter ?? null;
      } while (after && seen < 200);
      if (after && found.length === 0) throw new Error('The team is too large to list here.');
      setMembers(found);
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setLoadFailed(error instanceof Error ? error.message : 'The team could not be loaded.');
    });
    return () => controller.abort();
  }, [state.workspaceId, state.protectedMembers, headers]);
  const chosen = useMemo(() => members?.find((m) => m.id === memberId), [members, memberId]);
  const ready = !!chosen && typed.trim() === state.name;
  if (loadFailed)
    return (
      <>
        <p role="alert" className="ux-error-summary">
          {loadFailed}
        </p>
        <Actions safe="Cancel" busy={false} onSafe={props.onCancel} />
      </>
    );
  if (!members) return <p role="status">Loading the team…</p>;
  if (members.length === 0)
    return (
      <>
        <p>There is no one to transfer to yet. Invite a member first, then come back.</p>
        <Actions safe="Cancel" busy={false} onSafe={props.onCancel} />
      </>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!chosen || !ready) return;
        void run(
          {
            action: 'offer_transfer',
            workspaceId: state.workspaceId,
            memberId: chosen.id,
            confirmName: typed.trim(),
            expectedVersion: state.version,
          },
          (result) =>
            props.onFinished(
              `Offer sent to ${chosen.label}.${
                result.done.expiresAt
                  ? ` It stays open until ${whenWords(result.done.expiresAt)}.`
                  : ''
              }`,
            ),
        );
      }}
    >
      <label className="field">
        New owner
        <select value={memberId} onChange={(event) => setMemberId(event.target.value)} required>
          <option value="">Choose a member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}, {m.role}
            </option>
          ))}
        </select>
      </label>
      <p className="notifications-help">
        {chosen ? chosen.label : 'The member'} will get an offer. It stays open for 7 days. You stay
        the owner until they accept. If they accept, you become an admin.
      </p>
      <label className="field">
        Type the workspace name to confirm
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="transfer-name-help"
        />
      </label>
      <p id="transfer-name-help" className="notifications-help">
        Type {state.name} exactly.
      </p>
      <LifecycleErrorLine message={message} />
      <Actions safe="Cancel" busy={busy} onSafe={props.onCancel}>
        <button type="submit" className="primary-link" disabled={busy || !ready}>
          {busy ? 'Please Wait…' : 'Send Offer'}
        </button>
      </Actions>
    </form>
  );
}

/** The named member answers an ownership offer. */
export function AnswerBody(props: BodyProps & { answer: 'accept' | 'decline' }) {
  const { state, answer } = props;
  const offer = state.offer;
  const { run, busy, message } = useDialogCommand(props);
  const accept = answer === 'accept';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!offer) return;
        void run(
          { action: accept ? 'accept_transfer' : 'decline_transfer', offerId: offer.offerId },
          () =>
            props.onFinished(
              accept ? `You are now the owner of ${state.name}.` : 'You declined the offer.',
            ),
        );
      }}
    >
      <p>
        {accept
          ? `You will be the owner. You can archive the workspace, rename it and transfer ownership. The current owner becomes an admin.`
          : 'The current owner stays the owner. They will see that you declined.'}
      </p>
      <LifecycleErrorLine message={message} />
      <Actions safe="Not Now" busy={busy} onSafe={props.onCancel}>
        <button
          type="submit"
          className={accept ? 'primary-link' : 'button button-secondary'}
          disabled={busy || !offer}
        >
          {busy ? 'Please Wait…' : accept ? 'Accept Ownership' : 'Decline Offer'}
        </button>
      </Actions>
    </form>
  );
}

/** The owner withdraws an open ownership offer. */
export function CancelBody(props: BodyProps) {
  const { state } = props;
  const offer = state.offer;
  const { run, busy, message } = useDialogCommand(props);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!offer) return;
        void run(
          { action: 'cancel_transfer', workspaceId: state.workspaceId, offerId: offer.offerId },
          () => props.onFinished('The ownership offer was cancelled.'),
        );
      }}
    >
      <p>The member will no longer see the offer. You stay the owner and can send a new offer.</p>
      <LifecycleErrorLine message={message} />
      <Actions safe="Not Now" busy={busy} onSafe={props.onCancel}>
        <button type="submit" className="primary-link" disabled={busy || !offer}>
          {busy ? 'Please Wait…' : 'Cancel Offer'}
        </button>
      </Actions>
    </form>
  );
}
