import { useEffect, useRef, useState } from 'react';
import type { CustomerWorkspace } from '@corridra/auth/customer-workspaces';
import { limitWords } from '../../lib/account-limit';

// A non-owner leaves their own invited membership. The owner has no such control: the initial owner
// cannot be removed here. Leaving is recorded and the owner can invite the person again.
export function CustomerWorkspaceLeave({
  workspace,
  subject,
  issuer,
  onLeft,
  onDenied,
  startAsking = false,
  onCancel,
  onBusyChange,
}: {
  workspace: CustomerWorkspace;
  subject: string;
  issuer: string;
  onLeft: (workspaceId: string) => void;
  onDenied: (status: number) => void;
  /** Opened from the workspaces table's menu: start on the question, not on the Leave link. */
  startAsking?: boolean;
  /** Called when the person chooses to keep their access, so a dialog around this can close. */
  onCancel?: () => void;
  /** Tells a dialog around this when a request is in flight, so it cannot be dismissed meanwhile. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [asking, setAsking] = useState(startAsking),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const command = useRef<string | null>(null);
  const inFlight = useRef(false),
    alive = useRef(false);
  // Tell a dialog around this at once, in the same step as the request starts or ends, so it cannot be
  // dismissed in between.
  const markBusy = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  async function leave() {
    if (inFlight.current) return;
    if (typeof crypto.randomUUID !== 'function') {
      setMessage('Use a current browser to leave a team securely.');
      return;
    }
    // One command id per decision, so a lost response is retried as the same request.
    command.current ??= crypto.randomUUID();
    inFlight.current = true;
    markBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/customer-workspace-members', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-corridra-customer-subject': subject,
          'x-corridra-customer-issuer': issuer,
        },
        body: JSON.stringify({
          action: 'leave',
          commandId: command.current,
          workspaceId: workspace.id,
        }),
      });
      if (!alive.current) return;
      if (!response.ok) {
        // A 403 does not prove the membership was removed (it also covers an unverified session and a rejected
        // origin), so only a validated success response removes the workspace; denials reload the account.
        if ([401, 403, 409].includes(response.status)) onDenied(response.status);
        else
          setMessage(
            response.status === 429
              ? limitWords
              : response.status === 503
                ? 'Leaving a team is unavailable right now.'
                : 'Leaving was not confirmed. Try the same request again.',
          );
        return;
      }
      const result = (await response.json()) as Record<string, unknown>;
      if (!alive.current) return;
      if (!result || result.workspaceId !== workspace.id || result.status !== 'left')
        throw Error('Invalid leave response');
      onLeft(workspace.id);
    } catch {
      if (alive.current) setMessage('Leaving was not confirmed. Try the same request again.');
    } finally {
      inFlight.current = false;
      if (alive.current) markBusy(false);
    }
  }
  return (
    <div>
      {!asking && (
        <button type="button" className="text-link" onClick={() => setAsking(true)}>
          Leave {workspace.name}
        </button>
      )}
      {asking && (
        <div className="ux-draft-notice">
          <p>
            Leave {workspace.name}? You lose access to it straight away. The owner can invite you
            again. Your earlier activity stays in the history.
          </p>
          <button
            type="button"
            className="primary-link"
            disabled={busy}
            onClick={() => void leave()}
          >
            {busy ? 'Please Wait…' : 'Confirm Leaving'}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setAsking(startAsking);
              command.current = null;
              setMessage(null);
              onCancel?.();
            }}
          >
            Keep My Access
          </button>
        </div>
      )}
      {message && (
        <p ref={feedback} tabIndex={-1} role="alert" className="ux-error-summary">
          {message}
        </p>
      )}
    </div>
  );
}
