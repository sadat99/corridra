'use client';
import { useEffect, useRef, useState } from 'react';
import { briefSchema } from '@corridra/domain/missions';
import { Intake } from '../../plan/intake';
import {
  privateRequestStorageKeys,
  type PrivateRequestScope,
} from '../../../lib/private-request-storage';

type Pending = { version: 1; commandId: string; workspaceId: string; brief: unknown; at: number };
type Saved = { id: string; workspaceId: string; synthetic: true };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function pendingValue(raw: string, workspaceId: string): Pending {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Saved retry details are invalid.');
  const v = value as Partial<Pending>;
  if (
    v.version !== 1 ||
    typeof v.commandId !== 'string' ||
    !uuid.test(v.commandId) ||
    v.workspaceId !== workspaceId ||
    typeof v.at !== 'number' ||
    !Number.isFinite(v.at) ||
    v.at > Date.now() + 60000 ||
    Date.now() - v.at >= 86400000 ||
    !briefSchema.safeParse(v.brief).success
  )
    throw new Error(
      'Saved retry details could not be restored. Check your saved requests before starting another.',
    );
  return v as Pending;
}
export function PrivateRequestIntake(scope: PrivateRequestScope) {
  return (
    <ScopedIntake
      key={JSON.stringify([scope.issuer, scope.subject, scope.workspaceId])}
      {...scope}
    />
  );
}
function ScopedIntake(scope: PrivateRequestScope) {
  const keys = privateRequestStorageKeys(scope);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [problem, setProblem] = useState('');
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [paused, setPaused] = useState(false);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let hidden = false,
      restoring = false;
    function pause() {
      hidden = true;
      controller.current?.abort();
      setBusy(false);
      setPaused(true);
    }
    function restore() {
      if (restoring) return;
      restoring = true;
      setPaused(true);
      window.location.reload();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) restore();
    }
    function visibility() {
      if (document.visibilityState === 'hidden') pause();
      else if (hidden) restore();
    }
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const raw = sessionStorage.getItem(keys.pending);
        if (raw) setPending(pendingValue(raw, scope.workspaceId));
      } catch (error) {
        setInvalid(true);
        setProblem(error instanceof Error ? error.message : 'Recovery details could not be read.');
      }
      setLoaded(true);
    });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [keys.pending, scope.workspaceId]);
  function clear() {
    sessionStorage.removeItem(keys.pending);
    sessionStorage.removeItem(keys.draft);
  }
  async function send(value: Pending) {
    if (running.current) throw new Error('The original request is still being checked.');
    // Persist the exact normalized input before any HTTP write. Never send a
    // possibly unrecoverable private command when this tab cannot save it.
    try {
      sessionStorage.setItem(keys.pending, JSON.stringify(value));
    } catch {
      const message =
        'This tab could not save retry details. No new request was sent. Keep your input and try another browser.';
      setProblem(message);
      throw new Error(message);
    }
    running.current = true;
    setBusy(true);
    setProblem('');
    setPending(value);
    const operation = new AbortController();
    controller.current = operation;
    try {
      const response = await fetch('/api/customer-requests', {
        method: 'POST',
        cache: 'no-store',
        signal: operation.signal,
        headers: {
          'content-type': 'application/json',
          'x-corridra-customer-subject': scope.subject,
          'x-corridra-customer-issuer': scope.issuer,
        },
        body: JSON.stringify({
          commandId: value.commandId,
          workspaceId: scope.workspaceId,
          brief: value.brief,
        }),
      });
      if (operation.signal.aborted) throw new Error('Request checking was interrupted.');
      if ([401, 403, 409].includes(response.status)) {
        try {
          clear();
        } catch {
          /* Never show stale private content after denial. */
        }
        setPending(null);
        setDenied(true);
        throw new Error(
          'Private request access could not be confirmed. Reload your account before continuing.',
        );
      }
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'The request limit was reached. Retry the same request later.'
            : 'The request could not be confirmed. Retry the original request safely.',
        );
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        throw new Error('The request acknowledgement could not be confirmed.');
      }
      if (!result || typeof result !== 'object')
        throw new Error('The request acknowledgement could not be confirmed.');
      const ack = result as Partial<Saved>;
      if (
        typeof ack.id !== 'string' ||
        !uuid.test(ack.id) ||
        ack.workspaceId !== scope.workspaceId ||
        ack.synthetic !== true
      )
        throw new Error('The request acknowledgement could not be confirmed.');
      if (operation.signal.aborted) return;
      setSaved(ack as Saved);
      setPending(null);
      try {
        clear();
      } catch {
        setProblem(
          'The sample request was saved, but this browser could not clear its local retry details.',
        );
      }
    } catch (error) {
      if (!operation.signal.aborted)
        setProblem(
          error instanceof Error
            ? error.message
            : 'The request could not be confirmed. Retry the original request safely.',
        );
      throw error;
    } finally {
      running.current = false;
      if (!operation.signal.aborted) setBusy(false);
    }
  }
  async function submit(commandId: string, brief: unknown) {
    if (invalid || denied)
      throw new Error('Reload your account and review the saved request first.');
    if (!uuid.test(commandId))
      throw new Error('The private request command is invalid. Reload your account.');
    const normalized = briefSchema.parse(brief);
    if (
      pending &&
      (pending.commandId !== commandId ||
        JSON.stringify(pending.brief) !== JSON.stringify(normalized))
    )
      throw new Error(
        'The original request is kept unchanged. Retry it or review your saved requests before starting another.',
      );
    await send(
      pending ?? {
        version: 1,
        commandId,
        workspaceId: scope.workspaceId,
        brief: normalized,
        at: Date.now(),
      },
    );
  }
  async function retry() {
    if (pending && !busy)
      try {
        await send(pending);
      } catch {
        /* The exact pending request and visible error are retained. */
      }
  }
  function forget() {
    if (
      !window.confirm(
        'Forget only this tab’s retry details? The original request may already be saved. This does not cancel it.',
      )
    )
      return;
    try {
      clear();
      setPending(null);
      setSaved(null);
      setInvalid(false);
      setProblem('');
      setGeneration((n) => n + 1);
    } catch {
      setProblem(
        'This tab could not clear its retry details. Review your saved requests before continuing.',
      );
    }
  }
  if (paused)
    return (
      <section className="detail-card">
        <p role="status">Rechecking account access before restoring your private draft…</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </section>
    );
  return (
    <section className="detail-card" aria-label="Private sample request" aria-busy={busy}>
      <p>
        Use invented details only. Each request stays private to its creator; workspace membership
        does not share it.
      </p>
      {!loaded && <p role="status">Loading your private request draft…</p>}
      {problem && <p role="alert">{problem}</p>}
      {denied && (
        <a className="text-link" href="/account">
          Reload your account
        </a>
      )}
      {saved && (
        <div role="status">
          <h2>Your private sample request is saved.</h2>
          <p>A saved request is not an accepted engagement, meeting or deal.</p>
          <p>Request reference: {saved.id}</p>
        </div>
      )}
      {pending && !denied && (
        <div>
          <h2>Check the original request</h2>
          <p>It may already be saved. A retry uses the same command and original input.</p>
          <button
            type="button"
            className="primary-link"
            disabled={busy}
            onClick={() => void retry()}
          >
            {busy ? 'Checking…' : 'Retry original request'}
          </button>
        </div>
      )}
      {(pending || invalid || saved) && !denied && (
        <button type="button" className="text-link" disabled={busy} onClick={forget}>
          {saved ? 'Start another private sample request' : 'Forget local retry details'}
        </button>
      )}
      <p>
        <a className="text-link" href="/account#customer-requests">
          Review my saved requests
        </a>
      </p>
      {loaded && !invalid && !denied && (
        <div hidden={pending !== null || saved !== null}>
          <Intake key={generation} privateSubmission={{ draftStorageKey: keys.draft, submit }} />
        </div>
      )}
    </section>
  );
}
