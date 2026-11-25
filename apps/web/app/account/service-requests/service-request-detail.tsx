'use client';
import '../page-budget.css';
import './service-request.css';
import { CommercialArrangementSummary } from '../../../components/commercial-arrangement';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { displayMoney } from '@corridra/domain/locale';
import {
  basisText,
  callServiceApi,
  componentKindText,
  contextText,
  helpDateTimeText,
  helpDayText,
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
// The sample-mode rule for typed text is unchanged; it is said as a hint under the field, not in the label.
const sampleHint = realCustomerInput()
  ? null
  : 'Sample mode: start your text with the word Synthetic.';

// The page's h1 is drawn by the shell, outside this view. It names the service once the request is read, and
// says "Help request" before that and whenever the request cannot be shown.
const pageTitle = 'Help request';
let heading = '';
const headingListeners = new Set<() => void>();
function setHeading(next: string) {
  if (next === heading) return;
  heading = next;
  headingListeners.forEach((listener) => listener());
}
function subscribeHeading(listener: () => void) {
  headingListeners.add(listener);
  return () => {
    headingListeners.delete(listener);
  };
}
export function ServiceRequestHeading() {
  const title = useSyncExternalStore(
    subscribeHeading,
    () => heading,
    () => '',
  );
  return <>{title || pageTitle}</>;
}

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
    // CQ-72: true only when the quote really changed between reading it and confirming.
    [quoteChanged, setQuoteChanged] = useState(false),
    [panel, setPanel] = useState<Panel>(null),
    [note, setNote] = useState(starter),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [draft, setDraft] = useState({ need: '', region: '', from: '', to: '' });
  const alive = useRef(false),
    task = useRef<AbortController | null>(null);
  // `quiet` refreshes the page without clearing what is shown or typed if the refresh fails.
  const load = useCallback(
    async (quiet = false): Promise<boolean> => {
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
      if (controller.signal.aborted || !alive.current) return false;
      if (!result.ok && quiet) return false;
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
        return false;
      }
      if (result.data.request.id !== requestId || result.data.workspaceId !== workspaceId) {
        if (quiet) return false;
        setDetail(null);
        setState('gone');
        setMessage('This answer did not match the request you opened. Reload the page.');
        return false;
      }
      setDetail(result.data);
      if (!quiet)
        setDraft({
          need: result.data.need.text,
          region: result.data.need.region,
          from: result.data.need.preferredFrom ?? '',
          to: result.data.need.preferredTo ?? '',
        });
      setStale(false);
      setState('ready');
      return true;
    },
    [subject, issuer, workspaceId, requestId],
  );
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => load());
    return () => {
      alive.current = false;
      task.current?.abort();
    };
  }, [load]);
  // The page stays readable and keeps typed text. When its view expires it refreshes itself quietly;
  // only a refresh that fails turns the buttons off (CQ-72: no "out of date" while confirming).
  useEffect(() => {
    if (!detail) return;
    const timer = setTimeout(
      () =>
        void load(true).then((ok) => {
          if (!ok && alive.current) setStale(true);
        }),
      Math.max(0, Date.parse(detail.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [detail, load]);
  const serviceTitle = state === 'ready' && detail ? detail.service.title : '';
  useEffect(() => {
    setHeading(serviceTitle);
    // The tab title follows the h1 (D-021: a help request page title matches its heading).
    document.title = (serviceTitle || pageTitle) + ' | Corridra';
    return () => setHeading('');
  }, [serviceTitle]);
  // A step that opens takes the focus to its first field, so the keyboard and a screen reader land in it.
  useEffect(() => {
    if (panel) document.getElementById(id + (panel === 'revise' ? 'need' : panel))?.focus();
  }, [panel, id]);
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
  // CQ-72: read the request again just before accepting. Accept goes ahead when the quote is the one the
  // person read; a quote that really changed is shown again with a plain way to review it.
  async function submitAccept(e: FormEvent) {
    e.preventDefault();
    if (!detail?.quote || !ack || busy) return;
    if (pending) return void send(pending);
    const seen = { version: detail.quote.version, digest: detail.quote.digest };
    setBusy(true);
    const fresh = await callServiceApi<ServiceRequestDetail>(
      { subject, issuer },
      { scope: 'detail', workspaceId, requestId },
      null,
      validDetail,
    );
    if (!alive.current) return;
    setBusy(false);
    if (fresh.ok && fresh.data.request.id === requestId && fresh.data.workspaceId === workspaceId) {
      setDetail(fresh.data);
      setStale(false);
      if (fresh.data.quote?.version !== seen.version || fresh.data.quote?.digest !== seen.digest) {
        setQuoteChanged(true);
        setAck(false);
        return;
      }
    }
    void send(
      act({
        action: 'accept',
        quoteVersion: seen.version,
        quoteDigest: seen.digest,
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
    <section aria-label="Help request" className="account-compact">
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
                Try Again
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
          <div className="sr-summary">
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
                  Reload This Request
                </button>
              </div>
            </div>
          )}
          {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}

          <h2>What you asked for</h2>
          <dl className="account-facts account-wide">
            <dt>Need</dt>
            <dd className="sr-typed">{detail.need.text}</dd>
            <dt>Place</dt>
            <dd>{detail.need.region}</dd>
            <dt>Preferred dates</dt>
            <dd>
              {detail.need.preferredFrom
                ? helpDayText(detail.need.preferredFrom) +
                  (detail.need.preferredTo
                    ? ' to ' + helpDayText(detail.need.preferredTo)
                    : ' or later')
                : 'No preference'}
            </dd>
          </dl>
          {can('revise') && (
            <>
              <button type="button" className="text-link" onClick={() => open('revise')}>
                {panel === 'revise' ? 'Close Editing' : 'Edit This Request'}
              </button>
              {panel === 'revise' && (
                <form onSubmit={submitRevise} aria-label="Edit the request">
                  <fieldset disabled={busy}>
                    <div className="field">
                      <label htmlFor={id + 'need'}>What do you need?</label>
                      <textarea
                        id={id + 'need'}
                        aria-describedby={sampleHint ? id + 'need-hint' : undefined}
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
                      {sampleHint && <p id={id + 'need-hint'}>{sampleHint}</p>}
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
                    Save Changes
                  </button>
                </form>
              )}
            </>
          )}

          <details className="account-fold">
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
            <section aria-label="Quote" className="sr-part" id={id + 'quote'}>
              <h2>
                Quote, version {quote.version}
                {quote.expired && ' (expired)'}
              </h2>
              <p>
                This is a quote, not an order. Nothing is charged, and billing is not switched on.
                Valid until{' '}
                <time dateTime={quote.validUntil}>{helpDateTimeText(quote.validUntil)}</time>.
              </p>
              <p>{quote.scope}</p>
              {quote.commercialArrangement && (
                <CommercialArrangementSummary terms={quote.commercialArrangement} />
              )}
              {/* Below 48rem every cost is its own stacked block (item, kind, how it is counted, amount), so no
                  amount is ever off screen; from 48rem it is a table. The words and amounts are the same. */}
              <div
                className="sr-costs"
                role="region"
                aria-label="Quote costs, one row for every cost"
                tabIndex={0}
              >
                <table>
                  <caption>Every cost in this quote, in {quote.currency}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Kind</th>
                      <th scope="col">How it is counted</th>
                      <th scope="col" className="sr-amount">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.components.map((c) => (
                      <tr key={c.position}>
                        <th scope="row">{c.label}</th>
                        <td data-label="Kind">{componentKindText[c.kind]}</td>
                        <td data-label="How it is counted">{treatmentText[c.treatment]}</td>
                        <td data-label="Amount" className="sr-amount">
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
                      <td className="sr-amount">
                        <strong>{money(quote.fixedTotalMinor, quote.currency)}</strong>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" colSpan={3}>
                        Estimates added on top
                      </th>
                      <td className="sr-amount">
                        {money(quote.estimatedTotalMinor, quote.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <h3>Left out of this quote</h3>
              <ul>
                {quote.exclusions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h3>What this quote assumes</h3>
              <ul>
                {quote.assumptions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h3>Terms</h3>
              <p>Delivery: {quote.deliveryTerms}</p>
              <p>Payment: {quote.paymentTerms}</p>
            </section>
          )}

          {detail.orderIntent && (
            <section aria-label="Order intent" className="sr-part">
              <h2>Order intent recorded</h2>
              <p>{detail.orderIntent.statement}</p>
              <p>
                Quote version {detail.orderIntent.quoteVersion}, fixed price{' '}
                {money(detail.orderIntent.fixedTotalMinor, detail.orderIntent.currency)}, estimates{' '}
                {money(detail.orderIntent.estimatedTotalMinor, detail.orderIntent.currency)}.
                Accepted{' '}
                <time dateTime={detail.orderIntent.acceptedAt}>
                  {helpDateTimeText(detail.orderIntent.acceptedAt)}
                </time>
                .
              </p>
            </section>
          )}

          {detail.canAct ? (
            detail.actions.length > 0 && (
              <section aria-label="What you can do" className="sr-part">
                <h2>What you can do</h2>
                <div className="guide-actions-row">
                  {can('accept') && (
                    <button
                      type="button"
                      // One primary per decision region: while a step is open its confirm button is the
                      // primary, so this one is outlined.
                      className={panel && panel !== 'revise' ? 'button button-secondary' : 'button'}
                      aria-expanded={panel === 'accept'}
                      onClick={() => open('accept')}
                    >
                      Accept This Quote
                    </button>
                  )}
                  {can('decline') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-expanded={panel === 'decline'}
                      onClick={() => open('decline')}
                    >
                      Decline This Quote
                    </button>
                  )}
                  {can('question') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-expanded={panel === 'question'}
                      onClick={() => open('question')}
                    >
                      Ask a Question
                    </button>
                  )}
                  {can('withdraw') && (
                    <button
                      data-intent="destructive"
                      type="button"
                      className="button button-secondary"
                      aria-expanded={panel === 'withdraw'}
                      onClick={() => open('withdraw')}
                    >
                      Withdraw This Request
                    </button>
                  )}
                </div>
                {panel === 'accept' && quote && quoteChanged && (
                  <div className="ux-state" data-state="expired">
                    <p className="ux-state-label">The quote changed</p>
                    <div role="alert">
                      The Corridra team changed this quote while you were reading it. Nothing was
                      accepted. Review the new version before you accept.
                    </div>
                    <div className="ux-state-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setQuoteChanged(false);
                          document.getElementById(id + 'quote')?.scrollIntoView({ block: 'start' });
                        }}
                      >
                        Review the New Version
                      </button>
                    </div>
                  </div>
                )}
                {panel === 'accept' && quote && !quoteChanged && (
                  <form onSubmit={(e) => void submitAccept(e)} aria-label="Accept the quote">
                    <p>
                      You are accepting version {quote.version} for a fixed price of{' '}
                      <strong>{money(quote.fixedTotalMinor, quote.currency)}</strong>, plus
                      estimates of {money(quote.estimatedTotalMinor, quote.currency)}. Items marked
                      not included are not in these amounts.
                    </p>
                    <label className="sr-check">
                      <input
                        id={id + 'accept'}
                        type="checkbox"
                        checked={ack}
                        disabled={busy}
                        onChange={(e) => setAck(e.target.checked)}
                      />
                      I have read every cost, everything left out and every assumption. I understand
                      that nothing is charged and billing is not switched on.
                    </label>
                    <button type="submit" className="button" disabled={busy || !ack}>
                      {pending ? 'Send the Same Acceptance Again' : 'Confirm and Accept'}
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
                      <label htmlFor={id + 'decline'}>Why? (optional)</label>
                      <textarea
                        id={id + 'decline'}
                        aria-describedby={sampleHint ? id + 'decline-hint' : undefined}
                        maxLength={1000}
                        rows={3}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setPending(null);
                        }}
                      />
                      {sampleHint && <p id={id + 'decline-hint'}>{sampleHint}</p>}
                    </div>
                    <button type="submit" className="button" disabled={busy}>
                      Confirm and Decline
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
                      <label htmlFor={id + 'withdraw'}>Why? (optional)</label>
                      <textarea
                        id={id + 'withdraw'}
                        aria-describedby={sampleHint ? id + 'withdraw-hint' : undefined}
                        maxLength={1000}
                        rows={3}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setPending(null);
                        }}
                      />
                      {sampleHint && <p id={id + 'withdraw-hint'}>{sampleHint}</p>}
                    </div>
                    <button type="submit" className="button" disabled={busy}>
                      Confirm and Withdraw
                    </button>
                  </form>
                )}
                {panel === 'question' && (
                  <form onSubmit={submitQuestion} aria-label="Ask a question">
                    <div className="field">
                      <label htmlFor={id + 'question'}>Your question</label>
                      <textarea
                        id={id + 'question'}
                        aria-describedby={sampleHint ? id + 'question-hint' : undefined}
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
                      {sampleHint && <p id={id + 'question-hint'}>{sampleHint}</p>}
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
                      Send Question
                    </button>
                  </form>
                )}
              </section>
            )
          ) : (
            <p>You can read this request. Only an owner or admin of the workspace can act on it.</p>
          )}

          <div className="account-row">
            <section aria-label="Timeline">
              <details className="account-fold">
                <summary>What has happened ({detail.timeline.length})</summary>
                <ol>
                  {detail.timeline.map((e) => (
                    <li key={e.seq}>
                      <strong>
                        {kindText[e.kind] ?? e.kind}
                        {e.quoteVersion ? ' (version ' + e.quoteVersion + ')' : ''}
                      </strong>{' '}
                      · {e.by} · <time dateTime={e.at}>{helpDateTimeText(e.at)}</time>
                      {e.note && (
                        <>
                          <br />
                          <span className="sr-typed">{e.note}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </section>
            <button type="button" className="text-link" disabled={busy} onClick={() => void load()}>
              Reload This Request
            </button>
          </div>
        </>
      )}
    </section>
  );
}
