'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CustomerWorkspace } from '@corridra/auth/customer-workspaces';
import { CustomerWorkspaceInvitation } from './customer-workspace-invitation';
import { CustomerWorkspaceTeam } from './customer-workspace-team';

type Draft = { version: 1; commandId: string; name: string };
type Status = 'loading' | 'ready' | 'signed-out' | 'denied' | 'changed' | 'unavailable' | 'error';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function workspace(value: unknown): value is CustomerWorkspace {
  if (!value || typeof value !== 'object') return false;
  const w = value as CustomerWorkspace;
  return (
    typeof w.id === 'string' &&
    uuid.test(w.id) &&
    typeof w.name === 'string' &&
    w.name.startsWith('Synthetic ') &&
    w.name.length >= 11 &&
    w.name.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(w.name) &&
    ['owner', 'admin', 'member'].includes(w.role) &&
    w.synthetic === true &&
    w.organisationId === null
  );
}
function readDraft(key: string): Draft | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  if (raw.length > 1000) throw new Error('Invalid saved retry details');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved retry details');
  const d = value as Draft;
  if (
    d.version !== 1 ||
    typeof d.commandId !== 'string' ||
    !uuid.test(d.commandId) ||
    typeof d.name !== 'string' ||
    !d.name.startsWith('Synthetic ') ||
    d.name.length < 11 ||
    d.name.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(d.name)
  )
    throw new Error('Invalid saved retry details');
  return { version: 1, commandId: d.commandId, name: d.name };
}
function failure(status: number): Status {
  return status === 401
    ? 'signed-out'
    : status === 403
      ? 'denied'
      : status === 409
        ? 'changed'
        : status === 503
          ? 'unavailable'
          : 'error';
}
const messages: Record<Exclude<Status, 'loading' | 'ready'>, string> = {
  'signed-out': 'Sign in again to access your test workspaces.',
  denied: 'This account does not have access to test workspaces.',
  changed: 'Your account or saved request changed. Reload your account before continuing.',
  unavailable: 'Test workspaces are not available right now.',
  error: 'Your test workspaces could not be loaded. Try again.',
};

async function fetchWorkspaces(subject: string, issuer: string, signal: AbortSignal) {
  const response = await fetch('/api/customer-workspaces', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
    headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
  });
  if (!response.ok) return { status: response.status, rows: [] as CustomerWorkspace[] };
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Invalid workspace response');
  const body = value as { synthetic?: unknown; workspaces?: unknown };
  if (
    body.synthetic !== true ||
    !Array.isArray(body.workspaces) ||
    !body.workspaces.every(workspace)
  )
    throw new Error('Invalid workspace response');
  return { status: response.status, rows: body.workspaces };
}

export function CustomerWorkspaces({
  subject,
  issuer,
  requestsEnabled = false,
  programmesEnabled = false,
  profilesEnabled = false,
}: {
  subject: string;
  issuer: string;
  requestsEnabled?: boolean;
  programmesEnabled?: boolean;
  profilesEnabled?: boolean;
}) {
  const storageKey = `corridra.customer-workspace.v1:${issuer}:${subject}`;
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<CustomerWorkspace[]>([]);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Draft | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    return fetchWorkspaces(subject, issuer, request.signal).then(
      ({ status, rows }) => {
        if (!mounted.current || current !== sequence.current) return false;
        if (status < 200 || status >= 300) {
          setStatus(failure(status));
          return false;
        }
        setRows(rows);
        setStatus('ready');
        try {
          const saved = readDraft(storageKey);
          setPending(saved);
          if (saved) setName(saved.name.slice('Synthetic '.length));
          setStorageFailed(false);
          return true;
        } catch {
          setStorageFailed(true);
          setMessage({
            text: 'Saved retry details could not be read. Review your workspaces before discarding them.',
            error: true,
          });
          return false;
        }
      },
      () => {
        if (mounted.current && current === sequence.current && !request.signal.aborted) {
          setRows([]);
          setStatus('error');
        }
        return false;
      },
    );
  }, [storageKey, subject, issuer]);
  const reload = useCallback(() => {
    setRows([]);
    setStatus('loading');
    setMessage(null);
    return refresh();
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      if (!inFlight.current) void reload();
    };
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.removeEventListener('focus', focus);
    };
  }, [refresh, reload]);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || status !== 'ready' || storageFailed) return;
    if (!pending && typeof crypto.randomUUID !== 'function') {
      setMessage({
        text: 'A current browser is needed to start a test workspace securely.',
        error: true,
      });
      return;
    }
    const proposed = pending ?? {
      version: 1 as const,
      commandId: crypto.randomUUID(),
      name: `Synthetic ${name.trim()}`,
    };
    if (
      proposed.name.length < 11 ||
      proposed.name.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(proposed.name)
    ) {
      setMessage({
        text: 'Enter a fictional test workspace name between 1 and 110 characters.',
        error: true,
      });
      return;
    }
    inFlight.current = true;
    setCreating(true);
    setMessage(null);
    try {
      // Store the intent before sending. Reload/retry must reuse its command ID.
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(proposed));
      } catch {
        setStorageFailed(true);
        setMessage({
          text: 'Retry details could not be saved. No workspace request was sent. Check browser storage and retry loading.',
          error: true,
        });
        return;
      }
      setPending(proposed);
      const response = await fetch('/api/customer-workspaces', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-corridra-customer-subject': subject,
          'x-corridra-customer-issuer': issuer,
        },
        body: JSON.stringify({ commandId: proposed.commandId, name: proposed.name }),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        if ([401, 403, 409, 503].includes(response.status)) {
          setRows([]);
          setStatus(failure(response.status));
        }
        setMessage({
          text: 'Creation was not confirmed. Your saved request is kept for a safe retry.',
          error: true,
        });
        return;
      }
      const value: unknown = await response.json();
      if (!mounted.current) return;
      if (!workspace(value) || value.name !== proposed.name)
        throw new Error('Invalid workspace response');
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        await reload();
        setMessage({
          text: 'The workspace was confirmed, but saved retry details could not be cleared. Review the list before retrying.',
          error: true,
        });
        return;
      }
      setPending(null);
      setName('');
      if (await reload()) setMessage({ text: 'Your test workspace is confirmed.', error: false });
    } catch {
      if (mounted.current)
        setMessage({
          text: 'Creation was not confirmed. Keep this page or reload and retry the saved request.',
          error: true,
        });
    } finally {
      inFlight.current = false;
      if (mounted.current) setCreating(false);
    }
  }
  function discard() {
    if (inFlight.current) return;
    try {
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setName('');
      setStorageFailed(false);
      setMessage({
        text: 'Retry details discarded. Review the list before starting a different workspace.',
        error: false,
      });
    } catch {
      setMessage({
        text: 'Retry details could not be discarded. Check browser storage and try again.',
        error: true,
      });
    }
  }
  return (
    <section
      className="detail-card ux-account-missions"
      aria-label="Your test workspaces"
      aria-busy={status === 'loading' || creating}
    >
      <h2>Your test workspaces</h2>
      <p>
        {programmesEnabled
          ? 'Use fictional names only. Sample delegation planning is available to workspace owners and administrators. Company profiles and other project tools are not available here yet.'
          : 'Use fictional names only. Company profiles and workspace projects are not available here yet.'}
      </p>
      {status === 'loading' && <p role="status">Loading your test workspaces…</p>}
      {status !== 'loading' && status !== 'ready' && (
        <>
          <p role="alert" className="ux-error-summary">
            {messages[status]}
          </p>
          {status === 'signed-out' ? (
            <a className="text-link" href="/signin">
              Sign in
            </a>
          ) : status === 'changed' || status === 'denied' ? (
            <a className="text-link" href="/account">
              Reload account
            </a>
          ) : (
            <button type="button" className="text-link" onClick={() => void reload()}>
              Retry loading workspaces
            </button>
          )}
        </>
      )}
      {status === 'ready' && (
        <>
          {rows.length === 0 ? (
            <p>No test workspaces yet.</p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <strong>{row.name}</strong> · {row.role} · Test data
                  {profilesEnabled && (
                    <p>
                      <a className="text-link" href={'/account/profile/' + row.id}>
                        {['owner', 'admin'].includes(row.role)
                          ? 'Edit sample company profile'
                          : 'View sample company profile'}
                      </a>
                    </p>
                  )}
                  {programmesEnabled && ['owner', 'admin'].includes(row.role) && (
                    <p>
                      <a className="text-link" href={'/account/delegations/' + row.id}>
                        Plan sample delegations
                      </a>
                    </p>
                  )}
                  {requestsEnabled && (
                    <p>
                      <a className="text-link" href={'/account/request/' + row.id}>
                        Send a private sample request
                      </a>
                    </p>
                  )}
                  {row.role === 'owner' && (
                    <CustomerWorkspaceTeam
                      key={issuer + ':' + subject + ':' + row.id}
                      workspace={row}
                      subject={subject}
                      issuer={issuer}
                      onDenied={(status) => {
                        setRows([]);
                        setStatus(status === 403 ? 'changed' : failure(status));
                        setMessage({
                          text: 'Team access could not be confirmed. Reload your account before continuing.',
                          error: true,
                        });
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="text-link"
            disabled={creating}
            onClick={() => void reload()}
          >
            Refresh workspaces
          </button>
          <CustomerWorkspaceInvitation
            key={issuer + ':' + subject}
            issuer={issuer}
            subject={subject}
            onJoined={() => {
              void reload().then((loaded) => {
                if (loaded)
                  setMessage({
                    text: 'Your test workspace membership is confirmed.',
                    error: false,
                  });
              });
            }}
            onDenied={(status) => {
              setRows([]);
              setStatus(status === 403 ? 'changed' : failure(status));
              setMessage({
                text: 'Joining was not confirmed. Reload your account and check the invitation.',
                error: true,
              });
            }}
          />
          <form className="operator-form" aria-label="Create a test workspace" onSubmit={create}>
            <label className="field">
              Test workspace name
              <input
                name="test-workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={110}
                autoComplete="off"
                readOnly={!!pending}
                disabled={creating || storageFailed}
              />
            </label>
            {pending && (
              <p>
                The previous request may already have succeeded. Retry uses the same request and
                keeps its original name.
              </p>
            )}
            <button className="primary-link" disabled={creating || storageFailed}>
              {creating
                ? 'Please wait…'
                : pending
                  ? 'Retry workspace creation'
                  : 'Create test workspace'}
            </button>
          </form>
          {(pending || storageFailed) && (
            <>
              <p>
                Discarding retry details does not delete a workspace. Check the list before starting
                another.
              </p>
              <button type="button" className="text-link" disabled={creating} onClick={discard}>
                Discard retry details
              </button>
            </>
          )}
        </>
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
      <p>Your existing private mission invitations remain in the shared-mission section below.</p>
    </section>
  );
}
