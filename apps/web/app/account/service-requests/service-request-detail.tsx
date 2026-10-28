'use client';
import { CommercialArrangementSummary } from '../../../components/commercial-arrangement';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { displayMoney } from '@corridra/domain/locale';
import {
  basisText,
  callServiceApi,
  componentKindText,
  contextText,
  dateTimeText,
  dayText,
  kindText,
  problemText,
  statusLabel,
  treatmentText,
  unconfirmed,
  validDetail,
  type ServiceRequestDetail,
} from './service-request-client';

type Props = { subject: string; issuer: string; workspaceId: string; requestId: string };
type Panel = 'accept' | 'decline' | 'question' | 'withdraw' | 'revise' | null;
const starter = realCustomerInput() ? '' : 'Synthetic ';

function money(minor: string | null, currency: string) {
  if (minor === null) return 'Amount not stated';
  try {
    return displayMoney(minor, currency);
  } catch {
    return minor + ' ' + currency;
  }
}

export function ServiceRequestDetailView(props: Props) {
  return (
    <ScopedDetail
      key={[props.issuer, props.subject, props.workspaceId, props.requestId].join(':')}
      {...props}
    />
  );
}
function ScopedDetail({ subject, issuer, workspaceId, requestId }: Props) {
  const id = useId();
  const [detail, setDetail] = useState<ServiceRequestDetail | null>(null),
    [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied' | 'off' | 'gone'>(
      'loading',
    ),
    [stale, setStale] = useState(false),
    [panel, setPanel] = useState<Panel>(null),
    [note, setNote] = useState(starter),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [draft, setDraft] = useState({ need: '', region: '', from: '', to: '' });
  const alive = useRef(false),
    task = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    const result = await callServiceApi<ServiceRequestDetail>(
      { subject, issuer },
      { scope: 'detail', workspaceId, requestId },
      null,
      validDetail,
      controller.signal,
    );
    if (controller.signal.aborted || !alive.current) return;
    if (!result.ok) {
      setDetail(null);
      setState(
        result.status === 401 || result.status === 403
          ? 'denied'
          : result.status === 503
            ? 'off'
            : 'error',
      );
      setMessage(problemText(result.status, 'load this request'));
      return;
    }
    if (result.data.request.id !== requestId || result.data.workspaceId !== workspaceId) {
      setDetail(null);
      setState('gone');
      setMessage('This answer did not match the request you opened. Reload the page.');
      return;
    }
    setDetail(result.data);
    setDraft({
      need: result.data.need.text,
      region: result.data.need.region,
      from: result.data.need.preferredFrom ?? '',
      to: result.data.need.preferredTo ?? '',
    });
    setStale(false);
    setState('ready');
  }, [subject, issuer, workspaceId, requestId]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => load());
    return () => {
      alive.current = false;
      task.current?.abort();
    };
  }, [load]);
  // The page stays readable and keeps typed text, but acting needs a fresh look at the request.
  useEffect(() => {
    if (!detail) return;
    const timer = setTimeout(
      () => setStale(true),
      Math.max(0, Date.parse(detail.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [detail]);
  useEffect(() => {
    if (!pending) return;
    const leave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [pending]);

  async function send(body: Record<string, unknown>) {
    if (busy) return;
    setPending(body);
    setBusy(true);
    setMessage('');
    const result = await callServiceApi<{ id: string }>(
      { subject, issuer },
      null,
      body,
      (v) => typeof (v as { id?: unknown } | null)?.id === 'string',
    );
    if (!alive.current) return;
    setBusy(false);
    if (!result.ok) {
      const unsure = unconfirmed(result.status);
      if (!unsure) setPending(null);
      if (result.status === 409) {
        setStale(true);
        setMessage(problemText(409, 'save this'));
        return;
      }
      setMessage(
        unsure
          ? 'We could not confirm that this was saved. Try the same action again; it cannot be done twice.'
          : problemText(result.status, 'save this'),
      );
      return;
    }
    setPending(null);
    setPanel(null);
    setNote(starter);
    setAck(false);
    setMessage('Saved.');
    await load();
  }
  const base = { commandId: '', workspaceId, requestId };
  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setPending(null);
    setAck(false);
    setNote(starter);
    setMessage('');
  };
  const act = (extra: Record<string, unknown>) => ({
    ...base,
    commandId: crypto.randomUUID(),
    ...extra,
  });
  function submitQuestion(e: FormEvent) {
    e.preventDefault();
    void send(pending ?? act({ action: 'question', note: note.trim() }));
  }
  function endRequest(kind: 'decline' | 'withdraw') {
    const text = note.trim();
    void send(pending ?? act({ action: kind, note: text.length > starter.length ? text : null }));
  }
  function submitAccept(e: FormEvent) {
    e.preventDefault();
    if (!detail?.quote || !ack) return;
    void send(
      pending ??
        act({
          action: 'accept',
          quoteVersion: detail.quote.version,
          quoteDigest: detail.quote.digest,
          acknowledged: true,
        }),
    );
  }
  function submitRevise(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    void send(
      pending ??
        act({
          action: 'revise',
          expectedNeedVersion: detail.need.version,
          need: draft.need.trim(),
          preferredFrom: draft.from || null,
          preferredTo: draft.to || null,
          region: draft.region,
        }),
    );
  }

  const label = detail ? statusLabel[detail.request.status] : null;
  const can = (a: string) =>
    !!detail && detail.canAct && !stale && (detail.actions as string[]).includes(a);
  const quote = detail?.quote ?? null;
  return (
    <section aria-label="Help request">
      <p>
        <a className="text-link" href={'/account/service-requests/' + workspaceId}>
          All help requests
        </a>
      </p>
      {state === 'loading' && <p role="status">Loading your request…</p>}
      {state !== 'loading' && state !== 'ready' && (
        <div className="ux-state" data-state={state === 'denied' ? 'denied' : 'unavailable'}>
          <p className="ux-state-label">
            {state === 'denied' ? 'Access required' : 'Temporarily unavailable'}
          </p>
          <div role="alert">{message}</div>
          <div className="ux-state-actions">
            {state !== 'denied' && (
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
      {state === 'ready' && detail && label && (
        <>
          <div className="detail-card">
            <h2>{detail.service.title}</h2>
            <p>
              <span className="ux-status" data-tone={label.tone}>
                {label.text}
              </span>
            </p>
            <p>
              {contextText[detail.request.contextKind]}: {detail.request.contextLabel}
            </p>
            <p>{basisText[detail.service.quoteBasis]}</p>
          </div>
          {stale && (
            <div className="ux-state" data-state="expired">
              <p className="ux-state-label">Out of date</p>
              <div role="status">
                This page may be out of date, so the buttons are off. Reload it to continue.
                Anything you typed stays here.
              </div>
              <div className="ux-state-actions">
                <button type="button" className="button" onClick={() => void load()}>
                  Reload this request
                </button>
              </div>
            </div>
          )}
          {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}

          <h3>What you asked for</h3>
          <dl>
            <dt>Need</dt>
            <dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.need.text}</dd>
            <dt>Place</dt>
            <dd>{detail.need.region}</dd>
            <dt>Preferred dates</dt>
            <dd>
              {detail.need.preferredFrom
                ? dayText(detail.need.preferredFrom) +
                  (detail.need.preferredTo
                    ? ' to ' + dayText(detail.need.preferredTo)
                    : ' or later')
                : 'No preference'}
            </dd>
          </dl>
          {can('revise') && (
            <>
              <button type="button" className="text-link" onClick={() => open('revise')}>
                {panel === 'revise' ? 'Close editing' : 'Edit this request'}
              </button>
              {panel === 'revise' && (
                <form onSubmit={submitRevise} aria-label="Edit the request">
                  <fieldset disabled={busy}>
                    <div className="field">
                      <label htmlFor={id + 'need'}>
                        {' '}
                        {realCustomerInput()
                          ? 'What do you need?'
                          : 'What do you need? (start with Synthetic)'}{' '}
                      </label>
                      <textarea
                        id={id + 'need'}
                        required
                        minLength={realCustomerInput() ? 2 : 11}
                        maxLength={1000}
                        rows={4}
                        value={draft.need}
                        onChange={(e) => {
                          setDraft({ ...draft, need: e.target.value });
                          setPending(null);
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={id + 'region'}>Where do you need it?</label>
                      <select
                        id={id + 'region'}
                        value={draft.region}
                        onChange={(e) => {
                          setDraft({ ...draft, region: e.target.value });
                          setPending(null);
                        }}
                      >
                        {detail.service.regions.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={id + 'from'}>Earliest date (optional)</label>
                      <input
                        id={id + 'from'}
                        type="date"
                        value={draft.from}
                        onChange={(e) => {
                          setDraft({ ...draft, from: e.target.value });
                          setPending(null);
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={id + 'to'}>Latest date (optional)</label>
                      <input
                        id={id + 'to'}
                        type="date"
                        value={draft.to}
                        onChange={(e) => {
                          setDraft({ ...draft, to: e.target.value });
                          setPending(null);
                        }}
                      />
                    </div>
                  </fieldset>
                  <button type="submit" className="button" disabled={busy}>
                    Save changes
                  </button>
                </form>
              )}
            </>
          )}

          <details className="ux-journey-disclosure">
            <summary>What this service includes and leaves out</summary>
            <p>Included</p>
            <ul>
              {detail.service.included.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p>Not included</p>
            <ul>
              {detail.service.excluded.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </details>

          {quote && (
            <section aria-label="Quote" className="detail-card">
              <h3>
                Quote, version {quote.version}
                {quote.expired && ' (expired)'}
              </h3>
              <p>
                This is a quote, not an order. Nothing is charged, and billing is not switched on.
                Valid until{' '}
                <time dateTime={quote.validUntil}>{dateTimeText(quote.validUntil)}</time>.
              </p>
              <p>{quote.scope}</p>
              {quote.commercialArrangement && (
                <CommercialArrangementSummary terms={quote.commercialArrangement} />
              )}
              <div
                role="region"
                aria-label="Quote costs, one row for every cost"
                tabIndex={0}
                style={{ overflowX: 'auto' }}
              >
                <table style={{ width: '100%' }}>
                  <caption style={{ textAlign: 'left' }}>
                    Every cost in this quote, in {quote.currency}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Kind</th>
                      <th scope="col">How it is counted</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.components.map((c) => (
                      <tr key={c.position}>
                        <th scope="row" style={{ textTransform: 'none', letterSpacing: 0 }}>
                          {c.label}
                        </th>
                        <td>{componentKindText[c.kind]}</td>
                        <td>{treatmentText[c.treatment]}</td>
                        <td style={{ textAlign: 'right' }}>
                          {c.treatment === 'not_included' && c.amountMinor === null
                            ? 'Not included'
                            : money(c.amountMinor, quote.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={3}>
                        Fixed price for the included items
                      </th>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{money(quote.fixedTotalMinor, quote.currency)}</strong>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" colSpan={3}>
                        Estimates added on top
                      </th>
                      <td style={{ textAlign: 'right' }}>
                        {money(quote.estimatedTotalMinor, quote.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <h4>Left out of this quote</h4>
              <ul>
                {quote.exclusions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h4>What this quote assumes</h4>
              <ul>
                {quote.assumptions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h4>Terms</h4>
              <p>Delivery: {quote.deliveryTerms}</p>
              <p>Payment: {quote.paymentTerms}</p>
            </section>
          )}

          {detail.orderIntent && (
            <section aria-label="Order intent" className="detail-card">
              <h3>Order intent recorded</h3>
              <p>{detail.orderIntent.statement}</p>
              <p>
                Quote version {detail.orderIntent.quoteVersion}, fixed price{' '}
                {money(detail.orderIntent.fixedTotalMinor, detail.orderIntent.currency)}, estimates{' '}
                {money(detail.orderIntent.estimatedTotalMinor, detail.orderIntent.currency)}.
                Accepted{' '}
                <time dateTime={detail.orderIntent.acceptedAt}>
                  {dateTimeText(detail.orderIntent.acceptedAt)}
                </time>
                .
              </p>
            </section>
          )}

          {detail.canAct ? (
            detail.actions.length > 0 && (
              <section aria-label="What you can do">
                <h3>What you can do</h3>
                <div className="guide-actions-row">
                  {can('accept') && (
                    <button type="button" className="button" onClick={() => open('accept')}>
                      Accept this quote
                    </button>
                  )}
                  {can('decline') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => open('decline')}
                    >
                      Decline this quote
                    </button>
                  )}
                  {can('question') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => open('question')}
                    >
                      Ask a question
                    </button>
                  )}
                  {can('withdraw') && (
                    <button
                      data-intent="destructive"
                      type="button"
                      className="button button-secondary"
                      onClick={() => open('withdraw')}
                    >
                      Withdraw this request
                    </button>
                  )}
                </div>
                {panel === 'accept' && quote && (
                  <form onSubmit={submitAccept} aria-label="Accept the quote">
                    <p>
                      You are accepting version {quote.version} for a fixed price of{' '}
                      <strong>{money(quote.fixedTotalMinor, quote.currency)}</strong>, plus
                      estimates of {money(quote.estimatedTotalMinor, quote.currency)}. Items marked
                      not included are not in these amounts.
                    </p>
                    <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <input
                        type="checkbox"
                        checked={ack}
                        disabled={busy}
                        onChange={(e) => setAck(e.target.checked)}
                      />
                      I have read every cost, everything left out and every assumption. I understand
                      that nothing is charged and billing is not switched on.
                    </label>
                    <button type="submit" className="button" disabled={busy || !ack}>
                      {pending ? 'Send the same acceptance again' : 'Confirm and accept'}
                    </button>
                  </form>
                )}
                {panel === 'decline' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      endRequest('decline');
                    }}
                    aria-label="Decline the quote"
                  >
                    <div className="field">
                      <label htmlFor={id + 'decline'}>
                        {' '}
                        {realCustomerInput()
                          ? 'Why? (optional)'
                          : 'Why? (optional, start with Synthetic)'}{' '}
                      </label>
                      <textarea
                        id={id + 'decline'}
                        maxLength={1000}
                        rows={3}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setPending(null);
                        }}
                      />
                    </div>
                    <button type="submit" className="button" disabled={busy}>
                      Confirm and decline
                    </button>
                  </form>
                )}
                {panel === 'withdraw' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      endRequest('withdraw');
                    }}
                    aria-label="Withdraw the request"
                  >
                    <div className="field">
                      <label htmlFor={id + 'withdraw'}>
                        {' '}
                        {realCustomerInput()
                          ? 'Why? (optional)'
                          : 'Why? (optional, start with Synthetic)'}{' '}
                      </label>
                      <textarea
                        id={id + 'withdraw'}
                        maxLength={1000}
                        rows={3}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setPending(null);
                        }}
                      />
                    </div>
                    <button type="submit" className="button" disabled={busy}>
                      Confirm and withdraw
                    </button>
                  </form>
                )}
                {panel === 'question' && (
                  <form onSubmit={submitQuestion} aria-label="Ask a question">
                    <div className="field">
                      <label htmlFor={id + 'question'}>
                        {' '}
                        {realCustomerInput()
                          ? 'Your question'
                          : 'Your question (start with Synthetic)'}{' '}
                      </label>
                      <textarea
                        id={id + 'question'}
                        required
                        minLength={realCustomerInput() ? 2 : 11}
                        maxLength={1000}
                        rows={3}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setPending(null);
                        }}
                      />
                    </div>
                    <button
                      type="submit"
                      className="button"
                      disabled={
                        busy ||
                        !customerLabelAllowed(note) ||
                        note.trim().length < (realCustomerInput() ? 2 : 11)
                      }
                    >
                      Send question
                    </button>
                  </form>
                )}
              </section>
            )
          ) : (
            <p>You can read this request. Only an owner or admin of the workspace can act on it.</p>
          )}

          <section aria-label="Timeline">
            <h3>What has happened</h3>
            <ol>
              {detail.timeline.map((e) => (
                <li key={e.seq}>
                  <strong>
                    {kindText[e.kind] ?? e.kind}
                    {e.quoteVersion ? ' (version ' + e.quoteVersion + ')' : ''}
                  </strong>{' '}
                  · {e.by} · <time dateTime={e.at}>{dateTimeText(e.at)}</time>
                  {e.note && (
                    <>
                      <br />
                      <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {e.note}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
          <button type="button" className="text-link" disabled={busy} onClick={() => void load()}>
            Reload this request
          </button>
        </>
      )}
    </section>
  );
}
