'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  basisText,
  callServiceApi,
  contextText,
  dateTimeText,
  problemText,
  statusLabel,
  validCatalogue,
  validList,
  type CatalogueResult,
  type ListResult,
} from './service-request-client';

type Props = { subject: string; issuer: string; workspaceId: string };

export function ServiceRequestList(props: Props) {
  return (
    <ScopedList key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}
function ScopedList({ subject, issuer, workspaceId }: Props) {
  const [list, setList] = useState<ListResult | null>(null),
    [catalogue, setCatalogue] = useState<CatalogueResult | null>(null),
    [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied' | 'off'>('loading'),
    [message, setMessage] = useState(''),
    [more, setMore] = useState(false);
  const task = useRef<AbortController | null>(null);
  const load = useCallback(
    async (after?: string) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      const scope = { subject, issuer };
      const result = await callServiceApi<ListResult>(
        scope,
        { scope: 'list', workspaceId, pageSize: '20', ...(after ? { after } : {}) },
        null,
        validList,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setList(null);
        setState(
          result.status === 401 || result.status === 403
            ? 'denied'
            : result.status === 503
              ? 'off'
              : 'error',
        );
        setMessage(problemText(result.status, 'load your help requests'));
        return;
      }
      if (result.data.workspaceId !== workspaceId) {
        setState('error');
        setMessage('The answer did not match this workspace. Reload the page.');
        return;
      }
      setList((prior) =>
        after && prior
          ? { ...result.data, requests: [...prior.requests, ...result.data.requests] }
          : result.data,
      );
      setState('ready');
      setMessage('');
      const services = await callServiceApi<CatalogueResult>(
        scope,
        { scope: 'catalogue' },
        null,
        validCatalogue,
        controller.signal,
      );
      if (!controller.signal.aborted && services.ok) setCatalogue(services.data);
    },
    [subject, issuer, workspaceId],
  );
  useEffect(() => {
    void Promise.resolve().then(() => load());
    return () => task.current?.abort();
  }, [load]);
  return (
    <section aria-label="Paid-service requests">
      <p>
        Ask for paid local help from a place you already work in, such as a programme, a private
        request or an approved company. We send you a quote first. Accepting a quote records your
        order intent only: nothing is charged and billing is not switched on.
      </p>
      {state === 'loading' && <p role="status">Loading your help requests…</p>}
      {state !== 'loading' && state !== 'ready' && (
        <div className="ux-state" data-state={state === 'denied' ? 'denied' : 'unavailable'}>
          <p className="ux-state-label">
            {state === 'denied' ? 'Access required' : 'Temporarily unavailable'}
          </p>
          <div role="alert">{message}</div>
          <div className="ux-state-actions">
            {state === 'error' && (
              <button type="button" className="button button-secondary" onClick={() => void load()}>
                Try again
              </button>
            )}
            <a className="text-link" href="/account">
              Return to your account
            </a>
          </div>
        </div>
      )}
      {state === 'ready' && list && (
        <>
          <h2>Your help requests</h2>
          {list.requests.length === 0 ? (
            <div className="ux-state" data-state="empty">
              <p className="ux-state-label">No requests yet</p>
              <div role="status">
                {list.canRequest
                  ? 'Start from a delegation programme, a private request or an approved company, and choose Request help.'
                  : 'Nothing has been requested in this workspace yet. Only an owner or admin can ask for help.'}
              </div>
            </div>
          ) : (
            <ul className="guide-list">
              {list.requests.map((r) => {
                const label = statusLabel[r.status];
                return (
                  <li key={r.id} className="detail-card">
                    <h3>
                      <a href={'/account/service-requests/' + workspaceId + '/' + r.id}>
                        {r.serviceTitle}
                      </a>
                    </h3>
                    <p>
                      <span className="ux-status" data-tone={label.tone}>
                        {label.text}
                      </span>
                    </p>
                    <p>
                      {contextText[r.contextKind]}: {r.contextLabel}
                    </p>
                    <p>
                      {r.region} · updated{' '}
                      <time dateTime={r.updatedAt}>{dateTimeText(r.updatedAt)}</time>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {list.nextAfter && (
            <button
              type="button"
              className="button button-secondary"
              disabled={more}
              onClick={() => {
                setMore(true);
                void load(list.nextAfter ?? undefined).finally(() => setMore(false));
              }}
            >
              Show older requests
            </button>
          )}
          {catalogue && catalogue.services.length > 0 && (
            <details className="ux-journey-disclosure">
              <summary>What we can help with</summary>
              <ul>
                {catalogue.services.map((s) => (
                  <li key={s.key}>
                    <strong>{s.title}</strong> · {basisText[s.quoteBasis]}
                    <br />
                    {s.summary}
                    <br />
                    Where: {s.regions.join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </p>
    </section>
  );
}
