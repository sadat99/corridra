import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useEffect, useRef, useState, type FormEvent } from 'react';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function accepted(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  const workspace = result.workspace as Record<string, unknown> | undefined;
  return (
    typeof result.workspaceId === 'string' &&
    uuid.test(result.workspaceId) &&
    typeof result.invitationId === 'string' &&
    uuid.test(result.invitationId) &&
    typeof result.memberId === 'string' &&
    uuid.test(result.memberId) &&
    !!workspace &&
    workspace.id === result.workspaceId &&
    workspace.role === 'member' &&
    customerProvenanceAllowed(workspace.synthetic) &&
    workspace.organisationId === null &&
    typeof workspace.name === 'string' &&
    customerLabelAllowed(workspace.name) &&
    workspace.name.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(workspace.name)
  );
}

export function CustomerWorkspaceInvitation({
  subject,
  issuer,
  onJoined,
  onDenied,
}: {
  subject: string;
  issuer: string;
  onJoined: () => void;
  onDenied: (status: number) => void;
}) {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<{ commandId: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false),
    inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  async function join(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(code) ||
      (!pending && typeof crypto.randomUUID !== 'function')
    ) {
      setMessage('Enter the full invitation code using a current browser.');
      return;
    }
    const command = pending ?? { commandId: crypto.randomUUID(), token: code };
    inFlight.current = true;
    setBusy(true);
    setPending(command);
    setMessage(null);
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await fetch('/api/customer-workspace-access', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-corridra-customer-subject': subject,
          'x-corridra-customer-issuer': issuer,
        },
        body: JSON.stringify({ action: 'accept', ...command }),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        if ([401, 403, 409, 503].includes(response.status)) {
          setCode('');
          setPending(null);
          onDenied(response.status);
        } else
          setMessage('Joining was not confirmed. Retry this invitation with the same request.');
        return;
      }
      const value: unknown = await response.json();
      if (!mounted.current) return;
      if (!accepted(value)) throw new Error('Invalid acceptance response');
      setCode('');
      setPending(null);
      onJoined();
    } catch {
      if (mounted.current && !request.signal.aborted)
        setMessage('Joining was not confirmed. Keep this page and retry the same request.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <details className="ux-journey-disclosure">
      <summary>Join a workspace</summary>
      <p>
        Use the invitation code from the workspace owner. Your account must already be allowed to
        join.
      </p>
      <p>
        Joining gives access to the workspace only. It does not share private missions or company
        records.
      </p>
      <form
        className="operator-form"
        aria-label="Accept a workspace invitation"
        aria-busy={busy}
        onSubmit={join}
      >
        <label className="field">
          Workspace invitation code
          <input
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            minLength={43}
            maxLength={43}
            pattern={'[A-Za-z0-9_\\-]{43}'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            readOnly={!!pending}
            disabled={busy}
          />
        </label>
        <p>
          The code stays on this page only. After reloading, enter it again to check the same
          invitation.
        </p>
        {pending && (
          <p>
            The earlier request may already have succeeded. Retrying cannot add the same membership
            twice.
          </p>
        )}
        <button className="primary-link" disabled={busy}>
          {busy ? 'Please wait…' : pending ? 'Retry joining workspace' : 'Join workspace'}
        </button>
        {pending && (
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setCode('');
              setPending(null);
              setMessage(
                'Code cleared. Your earlier request may already have succeeded. Refresh workspaces before entering another code.',
              );
            }}
          >
            Clear invitation code
          </button>
        )}
      </form>
      {message && (
        <p ref={feedback} tabIndex={-1} role="alert" className="ux-error-summary">
          {message}
        </p>
      )}
    </details>
  );
}
