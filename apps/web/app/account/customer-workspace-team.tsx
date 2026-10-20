import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CustomerAccessPage, CustomerWorkspace } from '@corridra/auth/customer-workspaces';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);
const label = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.startsWith('Synthetic ') &&
  v.length >= 11 &&
  v.length <= 120 &&
  v === v.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(v);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC';
type Invite = { version: 1; commandId: string; label: string };
type Cursor = { invitationAfter?: string; memberAfter?: string };
type Removal = {
  kind: 'invitation' | 'membership';
  targetId: string;
  label: string;
  commandId: string;
};
function validPage(v: unknown, id: string): v is CustomerAccessPage {
  if (!v || typeof v !== 'object') return false;
  const p = v as CustomerAccessPage;
  return (
    p.workspaceId === id &&
    p.ownerProtected === true &&
    (p.nextInvitationAfter === null || validId(p.nextInvitationAfter)) &&
    (p.nextMemberAfter === null || validId(p.nextMemberAfter)) &&
    Array.isArray(p.invitations) &&
    p.invitations.length <= 25 &&
    p.invitations.every(
      (r) =>
        r &&
        validId(r.id) &&
        label(r.label) &&
        date(r.expiresAt) &&
        (r.memberId === null || validId(r.memberId)) &&
        ['pending', 'accepted', 'expired', 'cancelled'].includes(r.status),
    ) &&
    Array.isArray(p.memberships) &&
    p.memberships.length <= 25 &&
    p.memberships.every(
      (r) =>
        r &&
        validId(r.id) &&
        label(r.label) &&
        date(r.createdAt) &&
        r.role === 'member' &&
        ['active', 'revoked', 'account-disabled'].includes(r.status),
    )
  );
}
function readIntent(key: string): Invite | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  if (raw.length > 1000) throw Error('Invalid saved invitation');
  const p = JSON.parse(raw) as Invite;
  if (!p || p.version !== 1 || !validId(p.commandId) || !label(p.label))
    throw Error('Invalid saved invitation');
  return { version: 1, commandId: p.commandId, label: p.label };
}

export function CustomerWorkspaceTeam({
  workspace,
  subject,
  issuer,
  onDenied,
}: {
  workspace: CustomerWorkspace;
  subject: string;
  issuer: string;
  onDenied: (status: number) => void;
}) {
  const [page, setPage] = useState<CustomerAccessPage | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(''),
    [pending, setPending] = useState<Invite | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [issued, setIssued] = useState<{
    id: string;
    label: string;
    token: string | null;
    expiresAt: string;
  } | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const alive = useRef(false),
    inFlight = useRef(false),
    sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const cursors = useRef<Cursor>({});
  const feedback = useRef<HTMLParagraphElement>(null);
  const key = `corridra.customer-workspace-invite.v1:${issuer}:${subject}:${workspace.id}`;
  const headers = { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      mutation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  function denied(status: number) {
    setPage(null);
    setIssued(null);
    setRemoval(null);
    onDenied(status);
  }
  async function load(cursor: Cursor = {}) {
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPage(null);
    setLoading(true);
    setRemoval(null);
    try {
      const params = new URLSearchParams({ workspaceId: workspace.id, pageSize: '25', ...cursor });
      const response = await fetch('/api/customer-workspace-access?' + params, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: request.signal,
        headers,
      });
      if (!alive.current || current !== sequence.current) return false;
      if (!response.ok) {
        if ([401, 403, 409, 503].includes(response.status)) denied(response.status);
        else setMessage({ text: 'Team access could not be loaded. Try again.', error: true });
        return false;
      }
      const value: unknown = await response.json();
      if (!alive.current || current !== sequence.current) return false;
      if (!validPage(value, workspace.id)) throw Error('Invalid access response');
      cursors.current = cursor;
      setPage(value);
      try {
        const saved = readIntent(key);
        setPending(saved);
        if (saved) setName(saved.label.slice('Synthetic '.length));
        setStorageFailed(false);
      } catch {
        setStorageFailed(true);
        setMessage({
          text: 'Saved invitation details could not be read. Review the history before discarding retry details.',
          error: true,
        });
      }
      return true;
    } catch {
      if (alive.current && current === sequence.current && !request.signal.aborted)
        setMessage({ text: 'Team access could not be loaded. Try again.', error: true });
      return false;
    } finally {
      if (alive.current && current === sequence.current) setLoading(false);
    }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !page || storageFailed) return;
    if (!pending && typeof crypto.randomUUID !== 'function') {
      setMessage({ text: 'Use a current browser to issue an invitation securely.', error: true });
      return;
    }
    const intent = pending ?? {
      version: 1 as const,
      commandId: crypto.randomUUID(),
      label: 'Synthetic ' + name.trim(),
    };
    if (!label(intent.label)) {
      setMessage({ text: 'Enter a fictional label between 1 and 110 characters.', error: true });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setIssued(null);
    setMessage(null);
    setRemoval(null);
    try {
      try {
        sessionStorage.setItem(key, JSON.stringify(intent));
      } catch {
        setStorageFailed(true);
        setMessage({
          text: 'Retry details could not be saved. No invitation request was sent.',
          error: true,
        });
        return;
      }
      setPending(intent);
      const request = new AbortController();
      mutation.current = request;
      const response = await fetch('/api/customer-workspace-access', {
        method: 'POST',
        signal: request.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite',
          commandId: intent.commandId,
          workspaceId: workspace.id,
          label: intent.label,
        }),
      });
      if (!alive.current) return;
      if (!response.ok) {
        if ([401, 403, 409, 503].includes(response.status)) denied(response.status);
        else
          setMessage({
            text: 'Issuing was not confirmed. Retry the saved invitation request.',
            error: true,
          });
        return;
      }
      const result = (await response.json()) as {
        workspaceId?: unknown;
        invitationId?: unknown;
        issued?: unknown;
        token?: unknown;
        expiresAt?: unknown;
      };
      if (!alive.current) return;
      if (
        !result ||
        result.workspaceId !== workspace.id ||
        !validId(result.invitationId) ||
        !date(result.expiresAt) ||
        !(
          (result.issued === true &&
            typeof result.token === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(result.token)) ||
          (result.issued === false && result.token === null)
        )
      )
        throw Error('Invalid invitation response');
      const code = {
        id: result.invitationId,
        label: intent.label,
        token: result.token as string | null,
        expiresAt: result.expiresAt as string,
      };
      let cleared = true;
      try {
        sessionStorage.removeItem(key);
      } catch {
        cleared = false;
      }
      if (cleared) {
        setPending(null);
        setName('');
      } else setStorageFailed(true);
      setIssued(code);
      const loaded = await load();
      if (!alive.current) return;
      if (!cleared) setStorageFailed(true);
      if (loaded) {
        setMessage({
          text: !cleared
            ? 'Invitation confirmed, but retry details could not be cleared. Review this code and the history before retrying.'
            : code.token
              ? 'The sample invitation is issued. Keep its code privately before leaving this page.'
              : 'The invitation exists, but its code cannot be retrieved. Cancel it in the history and issue a new invitation.',
          error: !cleared || !code.token,
        });
      }
    } catch {
      if (alive.current)
        setMessage({
          text: 'Issuing was not confirmed. Keep or reload this page and retry the saved request.',
          error: true,
        });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function revoke() {
    if (!removal || inFlight.current || !page) return;
    const command = removal;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const request = new AbortController();
      mutation.current = request;
      const response = await fetch('/api/customer-workspace-access', {
        method: 'POST',
        signal: request.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke',
          workspaceId: workspace.id,
          commandId: command.commandId,
          kind: command.kind,
          targetId: command.targetId,
        }),
      });
      if (!alive.current) return;
      if (!response.ok) {
        if ([401, 403, 409, 503].includes(response.status)) denied(response.status);
        else
          setMessage({
            text: 'The access change was not confirmed. Retry this same change or reload the history.',
            error: true,
          });
        return;
      }
      const result = (await response.json()) as Record<string, unknown>;
      if (!alive.current) return;
      const expected = command.kind === 'invitation' ? 'cancelled' : 'revoked';
      if (
        !result ||
        result.workspaceId !== workspace.id ||
        result.status !== expected ||
        result[command.kind === 'invitation' ? 'invitationId' : 'memberId'] !== command.targetId
      )
        throw Error('Invalid revocation response');
      if (issued?.id === command.targetId) setIssued(null);
      if (await load())
        setMessage({
          text:
            command.kind === 'invitation'
              ? 'The invitation is cancelled. Its history is retained.'
              : 'The invited membership is revoked. Its history is retained.',
          error: false,
        });
    } catch {
      if (alive.current)
        setMessage({
          text: 'The access change was not confirmed. Retry this same change or reload the history.',
          error: true,
        });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function discard() {
    if (inFlight.current) return;
    try {
      sessionStorage.removeItem(key);
      setPending(null);
      setName('');
      setStorageFailed(false);
      setMessage({
        text: 'Retry details discarded. This does not cancel an invitation. Review the history before issuing another.',
        error: false,
      });
    } catch {
      setMessage({
        text: 'Retry details could not be cleared. Check browser storage and try again.',
        error: true,
      });
    }
  }
  function confirm(kind: Removal['kind'], targetId: string, name: string) {
    if (inFlight.current) return;
    if (typeof crypto.randomUUID !== 'function') {
      setMessage({ text: 'Use a current browser to change team access securely.', error: true });
      return;
    }
    setRemoval({ kind, targetId, label: name, commandId: crypto.randomUUID() });
    setMessage(null);
  }
  return (
    <details
      className="ux-journey-disclosure"
      onToggle={(event) => {
        if (event.currentTarget.open && !page && !loading && !inFlight.current) void load();
      }}
    >
      <summary>Manage team</summary>
      <section aria-label={'Test team for ' + workspace.name} aria-busy={loading || busy}>
        <p>
          Sample workspace access only. No private mission, company or financial information is
          shared.
        </p>
        <p>
          The initial workspace owner cannot be removed here. No email or other message is sent.
        </p>
        {loading && <p role="status">Loading team access…</p>}
        {!loading && !page && (
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setMessage(null);
              void load();
            }}
          >
            Retry loading team access
          </button>
        )}
        {page && (
          <>
            <h3>Invitations</h3>
            {page.invitations.length === 0 ? (
              <p>No sample invitations on this page.</p>
            ) : (
              <ul>
                {page.invitations.map((r) => (
                  <li key={r.id}>
                    <strong>{r.label}</strong> · {r.status} · Expires{' '}
                    <time dateTime={r.expiresAt}>{when(r.expiresAt)}</time>
                    <details className="ux-journey-disclosure">
                      <summary>Invitation reference</summary>
                      <p>{r.id}</p>
                    </details>
                    {(r.status === 'pending' || r.status === 'expired') && (
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy || !!removal}
                        onClick={() => confirm('invitation', r.id, r.label)}
                      >
                        Cancel invitation for {r.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {page.nextInvitationAfter && (
              <button
                type="button"
                className="text-link"
                disabled={busy || !!removal}
                onClick={() =>
                  void load({ ...cursors.current, invitationAfter: page.nextInvitationAfter! })
                }
              >
                Next invitations
              </button>
            )}
            <h3>Invited members</h3>
            {page.memberships.length === 0 ? (
              <p>No invited memberships on this page.</p>
            ) : (
              <ul>
                {page.memberships.map((r) => (
                  <li key={r.id}>
                    <strong>{r.label}</strong> · {r.role} · {r.status}
                    <details className="ux-journey-disclosure">
                      <summary>Membership reference</summary>
                      <p>{r.id}</p>
                    </details>
                    {r.status !== 'revoked' && (
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy || !!removal}
                        onClick={() => confirm('membership', r.id, r.label)}
                      >
                        Remove invited membership for {r.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {page.nextMemberAfter && (
              <button
                type="button"
                className="text-link"
                disabled={busy || !!removal}
                onClick={() =>
                  void load({ ...cursors.current, memberAfter: page.nextMemberAfter! })
                }
              >
                Next invited members
              </button>
            )}
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                void load();
              }}
            >
              Refresh team history
            </button>
            {removal && (
              <div className="ux-draft-notice">
                <p>
                  {removal.kind === 'invitation'
                    ? 'Cancel the invitation'
                    : 'Revoke the invited membership'}{' '}
                  for {removal.label}? History will remain.
                </p>
                <p>
                  Closing only dismisses this confirmation. It does not reverse an earlier request.
                  Refresh the history if a response was lost.
                </p>
                <button
                  type="button"
                  className="primary-link"
                  disabled={busy}
                  onClick={() => void revoke()}
                >
                  {removal.kind === 'invitation'
                    ? 'Confirm invitation cancellation'
                    : 'Confirm membership removal'}
                </button>
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => setRemoval(null)}
                >
                  Close confirmation
                </button>
              </div>
            )}
            <form
              className="operator-form"
              aria-label="Issue a sample workspace invitation"
              onSubmit={invite}
            >
              <label className="field">
                Sample invitation label
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={110}
                  autoComplete="off"
                  readOnly={!!pending}
                  disabled={busy || storageFailed || !!issued?.token || !!removal}
                />
              </label>
              <p>
                Use a fictional label. Only an account already allowed to use this test can accept
                the code.
              </p>
              {pending && (
                <p>
                  An earlier invitation may already exist. Retry keeps the original request and
                  label.
                </p>
              )}
              <button
                className="primary-link"
                disabled={busy || storageFailed || !!issued?.token || !!removal}
              >
                {busy
                  ? 'Please wait…'
                  : pending
                    ? 'Retry issuing invitation'
                    : 'Issue sample invitation'}
              </button>
            </form>
            {(pending || storageFailed) && (
              <button type="button" className="text-link" disabled={busy} onClick={discard}>
                Discard invitation retry details
              </button>
            )}
          </>
        )}
        {issued && (
          <div className="ux-draft-notice">
            <p>Invitation reference: {issued.id}</p>
            {issued.token ? (
              <>
                <label className="field">
                  New test workspace invitation code
                  <input value={issued.token} readOnly autoComplete="off" spellCheck={false} />
                </label>
                <p>
                  Shown on this page only. Select and copy the code privately. It expires{' '}
                  <time dateTime={issued.expiresAt}>{when(issued.expiresAt)}</time>. If lost, cancel
                  the invitation and issue another.
                </p>
                <button type="button" className="text-link" onClick={() => setIssued(null)}>
                  Clear new invitation code
                </button>
              </>
            ) : (
              <p>This invitation has no recoverable code. Find it in the history to cancel it.</p>
            )}
            <button
              type="button"
              className="text-link"
              disabled={!page || busy || !!removal}
              onClick={() => confirm('invitation', issued.id, issued.label)}
            >
              Cancel this issued invitation
            </button>
          </div>
        )}
        {message && (
          <p
            ref={feedback}
            tabIndex={-1}
            role={message.error ? 'alert' : 'status'}
            className={message.error ? 'ux-error-summary' : 'ux-draft-notice'}
          >
            {message.text}
          </p>
        )}
      </section>
    </details>
  );
}
