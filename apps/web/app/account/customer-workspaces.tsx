'use client';
import { realCustomerInput, customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CustomerWorkspace } from '@corridra/auth/customer-workspaces';
import { CustomerWorkspaceInvitation } from './customer-workspace-invitation';
import { CustomerWorkspaceTeam } from './customer-workspace-team';
import { RefreshButton } from './refresh-button';
import { CustomerWorkspaceLeave } from './customer-workspace-leave';
import { useWorkspaceLifecycle } from './workspace-lifecycle';
import { CompanyLinkLine, useCompanyLinkOverview } from './company-link-status';
import { limitWords } from '../../lib/account-limit';
import { CorridraIcon } from '../../components/corridra-icon';
import { Dialog } from '../../components/ux/dialog';
import { EmptyState } from '../../components/ux/empty-state';
import { MenuAnchor, MenuButton, OverflowMenu } from '../../components/ux/overflow-menu';
import './workspace-table.css';

type Draft = { version: 1; commandId: string; name: string };
type Status =
  'loading' | 'ready' | 'signed-out' | 'denied' | 'changed' | 'unavailable' | 'limit' | 'error';
type DialogKind = { kind: 'create' } | { kind: 'join' } | { kind: 'team' | 'leave'; id: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function workspace(value: unknown): value is CustomerWorkspace {
  if (!value || typeof value !== 'object') return false;
  const w = value as CustomerWorkspace;
  return (
    typeof w.id === 'string' &&
    uuid.test(w.id) &&
    typeof w.name === 'string' &&
    customerLabelAllowed(w.name) &&
    w.name.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(w.name) &&
    ['owner', 'admin', 'member'].includes(w.role) &&
    customerProvenanceAllowed(w.synthetic) &&
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
    !customerLabelAllowed(d.name) ||
    d.name.length < (realCustomerInput() ? 2 : 11) ||
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
          : status === 429
            ? 'limit'
            : 'error';
}
const messages: Record<Exclude<Status, 'loading' | 'ready'>, string> = {
  'signed-out': 'Sign in again to see your workspaces.',
  denied: 'This account cannot use workspaces yet.',
  changed: 'Your account or saved request changed. Reload your account before continuing.',
  unavailable: 'Workspaces are not available right now.',
  limit: limitWords,
  error: 'Your workspaces could not be loaded. Try again.',
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
    !customerProvenanceAllowed(body.synthetic) ||
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
  draftsEnabled = false,
  memberRolesEnabled = false,
  linksEnabled = false,
  serviceRequestsEnabled = false,
  billingEnabled = false,
}: {
  subject: string;
  issuer: string;
  requestsEnabled?: boolean;
  programmesEnabled?: boolean;
  profilesEnabled?: boolean;
  draftsEnabled?: boolean;
  memberRolesEnabled?: boolean;
  linksEnabled?: boolean;
  serviceRequestsEnabled?: boolean;
  billingEnabled?: boolean;
}) {
  const storageKey = `corridra.customer-workspace.v1:${issuer}:${subject}`;
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<CustomerWorkspace[]>([]);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Draft | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // Dialogs with a request in flight (keyed 'team:<id>', 'leave:<id>', 'join'); they cannot be dismissed.
  const [working, setWorking] = useState<Record<string, boolean>>({});
  // When the control that opened a dialog is gone (a menu row, or the row itself after leaving), focus goes
  // to that row's menu button, or to the first action at the top of the list.
  const focusBack = (name?: string) => () =>
    (name
      ? [...document.querySelectorAll<HTMLElement>('.ux-ws-table button[aria-label]')].find(
          (el) => el.getAttribute('aria-label') === 'Actions for ' + name,
        )
      : undefined) ?? document.querySelector<HTMLElement>('.ux-ws-head-actions button');
  // The same keys as a ref, so the window-focus refresh can tell at once that a dialog is still sending.
  const sending = useRef(new Set<string>());
  const markSending = useCallback((key: string, busy: boolean) => {
    if (busy) sending.current.add(key);
    else sending.current.delete(key);
    setWorking((current) => (!!current[key] === busy ? current : { ...current, [key]: busy }));
  }, []);
  const setBusyFor = (key: string) => (busy: boolean) => markSending(key, busy);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const linkOverview = useCompanyLinkOverview(
    linksEnabled && status === 'ready',
    subject,
    issuer,
    rows,
  );
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
          if (saved) {
            setName(realCustomerInput() ? saved.name : saved.name.slice('Synthetic '.length));
            // A creation that may already have succeeded is shown at once, so it is retried or
            // discarded on purpose and never left out of sight.
            setDialog((d) => d ?? { kind: 'create' });
          }
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
    // The list is rebuilt, so every dialog is made again: no lock may be carried over from the old ones
    // (a request that ended while they were being replaced can no longer clear its own).
    sending.current.clear();
    setWorking({});
    setRows([]);
    setStatus('loading');
    setMessage(null);
    return refresh();
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      // Not while a creation or a dialog's request is out: the answer must reach its dialog first.
      if (!inFlight.current && sending.current.size === 0) void reload();
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
        text: 'A current browser is needed to start a workspace securely.',
        error: true,
      });
      return;
    }
    const proposed = pending ?? {
      version: 1 as const,
      commandId: crypto.randomUUID(),
      name: realCustomerInput() ? name.trim() : `Synthetic ${name.trim()}`,
    };
    if (
      !customerLabelAllowed(proposed.name) ||
      proposed.name.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(proposed.name)
    ) {
      setMessage({
        text: realCustomerInput()
          ? 'Enter a workspace name between 2 and 120 characters.'
          : 'Enter a workspace name between 1 and 110 characters.',
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
      setDialog(null);
      if (await reload()) setMessage({ text: 'Your workspace is confirmed.', error: false });
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
  const lifecycle = useWorkspaceLifecycle({
    subject,
    issuer,
    rows,
    enabled: status === 'ready',
    refreshRows: refresh,
    focusBack,
  });
  const messageBlock = message && (
    <p
      ref={feedback}
      tabIndex={-1}
      role={message.error ? 'alert' : 'status'}
      className={message.error ? 'ux-error-summary' : 'ux-draft-notice'}
    >
      {message.text}
    </p>
  );
  return (
    <section
      className="detail-card ux-account-missions"
      aria-label="Workspaces"
      aria-busy={status === 'loading' || creating}
    >
      <div className="ux-section-head">
        <h2>Workspaces</h2>
        {status === 'ready' && (
          <div className="ux-ws-head-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setDialog({ kind: 'join' })}
            >
              Join a Workspace
            </button>
            {rows.length > 0 && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setDialog({ kind: 'create' })}
              >
                Create a Workspace
              </button>
            )}
            <RefreshButton label="workspaces" disabled={creating} onClick={() => void reload()} />
          </div>
        )}
      </div>
      <p>
        A workspace is where you prepare and send requests.
        {programmesEnabled && ' Owners and administrators can also plan delegations.'}
      </p>
      {status === 'loading' && <p role="status">Loading your workspaces…</p>}
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
              Retry Loading Workspaces
            </button>
          )}
        </>
      )}
      {status === 'ready' && (
        <>
          {lifecycle.panel}
          {rows.length === 0 ? (
            <EmptyState
              icon="company"
              action={
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setDialog({ kind: 'create' })}
                >
                  Create a Workspace
                </button>
              }
            >
              No workspaces yet. Create your first one below.
            </EmptyState>
          ) : (
            <table className="ux-ws-table">
              <caption className="sr-only">Your workspaces</caption>
              <thead>
                <tr>
                  <th scope="col">Workspace</th>
                  <th scope="col">Role</th>
                  {linksEnabled && <th scope="col">Company link</th>}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lifecycle.visibleRows.map((row) => {
                  const archived = lifecycle.isArchived(row.id);
                  // Archived, or its status could not be read: either way no new request is offered from here.
                  const closedToNew = archived || lifecycle.statusUnknown(row.id);
                  const admin = ['owner', 'admin'].includes(row.role);
                  const start = closedToNew
                    ? null
                    : draftsEnabled
                      ? '/account/drafts/' + row.id
                      : requestsEnabled
                        ? '/account/request/' + row.id
                        : null;
                  const hasMenu =
                    !!start ||
                    profilesEnabled ||
                    (programmesEnabled && admin) ||
                    serviceRequestsEnabled ||
                    billingEnabled ||
                    row.role === 'owner' ||
                    memberRolesEnabled;
                  return (
                    <tr key={row.id}>
                      <th scope="row">
                        <strong>{row.name}</strong>
                        {/* CQ-56: a made-up example workspace says so in a live account. */}
                        {realCustomerInput() && row.synthetic && !row.name.includes('(madeup)')
                          ? ' (madeup)'
                          : ''}
                        {/* The Archived banner above the table says what is paused, once (owner screenshot, 13 Nov). */}
                        {archived && (
                          <>
                            {' '}
                            <span className="ux-badge">Archived</span>
                          </>
                        )}
                      </th>
                      <td className="ux-ws-role">{row.role}</td>
                      {linksEnabled && (
                        <td>
                          <CompanyLinkLine overview={linkOverview} workspaceId={row.id} />
                        </td>
                      )}
                      <td className="ux-ws-actions">
                        {hasMenu && (
                          <OverflowMenu
                            label={'Actions for ' + row.name}
                            trigger={<CorridraIcon name="more" />}
                            align="end"
                          >
                            {start && <MenuAnchor href={start}>New Request</MenuAnchor>}
                            {draftsEnabled && !closedToNew && (
                              <MenuAnchor href={'/account/drafts/' + row.id}>
                                Continue a Saved Draft
                              </MenuAnchor>
                            )}
                            {draftsEnabled && requestsEnabled && !closedToNew && (
                              <MenuAnchor href={'/account/request/' + row.id}>
                                Send a Private Request
                              </MenuAnchor>
                            )}
                            {profilesEnabled && (
                              <MenuAnchor href={'/account/profile/' + row.id}>
                                {admin ? 'Edit Company Profile' : 'View Company Profile'}
                              </MenuAnchor>
                            )}
                            {programmesEnabled && admin && (
                              <MenuAnchor href={'/account/delegations/' + row.id}>
                                Plan Delegations
                              </MenuAnchor>
                            )}
                            {serviceRequestsEnabled && (
                              <MenuAnchor href={'/account/service-requests/' + row.id}>
                                Paid-Service Requests
                              </MenuAnchor>
                            )}
                            {billingEnabled && (
                              <MenuAnchor href={'/account/billing/' + row.id}>
                                Plan and Billing
                              </MenuAnchor>
                            )}
                            {lifecycle.menuItems(row)}
                            {row.role === 'owner' && (
                              <MenuButton
                                data-menu-close=""
                                onClick={() => setDialog({ kind: 'team', id: row.id })}
                              >
                                Manage Team
                              </MenuButton>
                            )}
                            {memberRolesEnabled &&
                              row.role !== 'owner' &&
                              !lifecycle.keepsAccess(row.id) && (
                                <MenuButton
                                  data-menu-close=""
                                  onClick={() => setDialog({ kind: 'leave', id: row.id })}
                                >
                                  Leave Workspace
                                </MenuButton>
                              )}
                          </OverflowMenu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.map((row) => {
            const here = dialog && 'id' in dialog && dialog.id === row.id ? dialog.kind : null;
            return (
              <div key={'dialogs:' + row.id}>
                {row.role === 'owner' && (
                  <Dialog
                    open={here === 'team'}
                    onClose={() =>
                      setDialog((d) => (d && 'id' in d && d.kind === 'team' ? null : d))
                    }
                    title={'Team for ' + row.name}
                    keepMounted
                    locked={!!working['team:' + row.id]}
                    returnFocusTo={focusBack(row.name)}
                  >
                    <CustomerWorkspaceTeam
                      key={issuer + ':' + subject + ':' + row.id}
                      workspace={row}
                      subject={subject}
                      issuer={issuer}
                      memberRolesEnabled={memberRolesEnabled}
                      protectedMembers={lifecycle.protectedMembers(row.id)}
                      bare
                      open={here === 'team'}
                      onBusyChange={setBusyFor('team:' + row.id)}
                      onDenied={(status) => {
                        setDialog(null);
                        setRows([]);
                        setStatus(status === 403 ? 'changed' : failure(status));
                        setMessage({
                          text: 'Team access could not be confirmed. Reload your account before continuing.',
                          error: true,
                        });
                      }}
                    />
                  </Dialog>
                )}
                {memberRolesEnabled && row.role !== 'owner' && !lifecycle.keepsAccess(row.id) && (
                  <Dialog
                    open={here === 'leave'}
                    onClose={() =>
                      setDialog((d) => (d && 'id' in d && d.kind === 'leave' ? null : d))
                    }
                    title={'Leave ' + row.name}
                    keepMounted
                    locked={!!working['leave:' + row.id]}
                    returnFocusTo={focusBack(row.name)}
                  >
                    <CustomerWorkspaceLeave
                      key={'leave:' + issuer + ':' + subject + ':' + row.id}
                      workspace={row}
                      subject={subject}
                      issuer={issuer}
                      startAsking
                      onBusyChange={setBusyFor('leave:' + row.id)}
                      onCancel={() => setDialog(null)}
                      onLeft={(id) => {
                        setDialog(null);

                        setRows((current) => current.filter((r) => r.id !== id));
                        setMessage({
                          text: 'You have left the workspace. The owner can invite you again.',
                          error: false,
                        });
                      }}
                      onDenied={(status) => {
                        setDialog(null);
                        setRows([]);
                        setStatus(status === 403 ? 'changed' : failure(status));
                        setMessage({
                          text: 'Your access could not be confirmed. Reload your account before continuing.',
                          error: true,
                        });
                      }}
                    />
                  </Dialog>
                )}
              </div>
            );
          })}
          <Dialog
            open={dialog?.kind === 'join'}
            onClose={() => setDialog((d) => (d?.kind === 'join' ? null : d))}
            title="Join a Workspace"
            keepMounted
            locked={!!working.join}
            returnFocusTo={focusBack()}
          >
            <CustomerWorkspaceInvitation
              key={issuer + ':' + subject}
              issuer={issuer}
              subject={subject}
              bare
              onBusyChange={setBusyFor('join')}
              onJoined={() => {
                setDialog(null);
                void reload().then((loaded) => {
                  if (loaded)
                    setMessage({
                      text: 'You have joined the workspace.',
                      error: false,
                    });
                });
              }}
              onDenied={(status) => {
                setDialog(null);
                setRows([]);
                setStatus(status === 403 ? 'changed' : failure(status));
                setMessage({
                  text: 'Joining was not confirmed. Reload your account and check the invitation.',
                  error: true,
                });
              }}
            />
          </Dialog>
          <Dialog
            open={dialog?.kind === 'create'}
            onClose={() => setDialog((d) => (d?.kind === 'create' ? null : d))}
            title="Create a Workspace"
            locked={creating}
            returnFocusTo={focusBack()}
          >
            <form className="operator-form" aria-label="Create a workspace" onSubmit={create}>
              <div className="field">
                <label htmlFor="workspace-name">Workspace name</label>
                <input
                  id="workspace-name"
                  name="test-workspace-name"
                  aria-describedby="workspace-name-hint"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={realCustomerInput() ? 120 : 110}
                  autoComplete="off"
                  readOnly={!!pending}
                  disabled={creating || storageFailed}
                />
                <p id="workspace-name-hint" className="ux-hint">
                  {realCustomerInput()
                    ? 'Use a name you and your team will recognise.'
                    : 'Use a name you will recognise. This environment adds “Synthetic” in front.'}
                </p>
              </div>
              {pending && (
                <p>
                  The previous request may already have succeeded. Retry uses the same request and
                  keeps its original name.
                </p>
              )}
              <button className="primary-link" disabled={creating || storageFailed}>
                {creating
                  ? 'Please Wait…'
                  : pending
                    ? 'Retry Workspace Creation'
                    : 'Create Workspace'}
              </button>
            </form>
            {(pending || storageFailed) && (
              <>
                <p>
                  Discarding retry details does not delete a workspace. Check the list before
                  starting another.
                </p>
                <button type="button" className="text-link" disabled={creating} onClick={discard}>
                  Discard Retry Details
                </button>
              </>
            )}
            {dialog?.kind === 'create' && messageBlock}
          </Dialog>
        </>
      )}
      {dialog?.kind !== 'create' && messageBlock}
    </section>
  );
}
