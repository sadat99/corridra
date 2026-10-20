import { useEffect, useRef, useState } from 'react';
import type { CustomerWorkspace } from '@corridra/auth/customer-workspaces';

// A non-owner leaves their own invited membership. The owner has no such control: the initial owner
// cannot be removed here. Leaving is recorded and the owner can invite the person again.
export function CustomerWorkspaceLeave({
  workspace,
  subject,
  issuer,
  onLeft,
  onDenied,
}: {
  workspace: CustomerWorkspace;
  subject: string;
  issuer: string;
  onLeft: (workspaceId: string) => void;
  onDenied: (status: number) => void;
}) {
  const [asking, setAsking] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const command = useRef<string | null>(null);
  const inFlight = useRef(false),
    alive = useRef(false);
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
    setBusy(true);
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
        // 403 also means the membership is already gone, which is the outcome the person asked for.
        if (response.status === 403) onLeft(workspace.id);
        else if ([401, 409].includes(response.status)) onDenied(response.status);
        else
          setMessage(
            response.status === 503
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
      if (alive.current) setBusy(false);
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
            {busy ? 'Please wait…' : 'Confirm leaving'}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setAsking(false);
              command.current = null;
              setMessage(null);
            }}
          >
            Keep my access
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
