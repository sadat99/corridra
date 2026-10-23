'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  callBillingApi,
  dateTimeText,
  dayText,
  endReasonText,
  grantText,
  kindText,
  money,
  priceText,
  problemText,
  statusLabel,
  taxText,
  unconfirmed,
  validOverview,
  validPlans,
  type BillingOverview,
  type BillingPlan,
  type BillingPlans,
  type SubscriptionSummary,
} from './billing-client';

type Props = { subject: string; issuer: string; workspaceId: string };
type Panel = { kind: 'request'; plan: BillingPlan } | { kind: 'cancel' | 'withdraw' } | null;

export function BillingOverviewView(props: Props) {
  return (
    <ScopedOverview key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function periodText(s: SubscriptionSummary) {
  if (!s.periodStart || !s.periodEnd) return null;
  return dayText(s.periodStart) + ' until ' + dayText(s.periodEnd);
}
function StatusBadge({ s }: { s: SubscriptionSummary }) {
  const label =
    s.periodElapsed && (s.status === 'active' || s.status === 'cancel_scheduled')
      ? { text: 'Period ended, not renewed', tone: 'caution' as const }
      : statusLabel[s.status];
  return (
    <span className="ux-status" data-tone={label.tone}>
      {label.text}
    </span>
  );
}

function ScopedOverview({ subject, issuer, workspaceId }: Props) {
  const id = useId();
  const [overview, setOverview] = useState<BillingOverview | null>(null),
    [plans, setPlans] = useState<BillingPlans | null>(null),
    [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied' | 'off' | 'gone'>(
      'loading',
    ),
    [stale, setStale] = useState(false),
    [panel, setPanel] = useState<Panel>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const alive = useRef(false),
    task = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    const scope = { subject, issuer };
    const [o, p] = await Promise.all([
      callBillingApi<BillingOverview>(
        scope,
        { scope: 'overview', workspaceId },
        null,
        validOverview,
        controller.signal,
      ),
      callBillingApi<BillingPlans>(
        scope,
        { scope: 'plans', workspaceId },
        null,
        validPlans,
        controller.signal,
      ),
    ]);
    if (controller.signal.aborted || !alive.current) return;
    const failed = !o.ok ? o : !p.ok ? p : null;
    if (failed && !failed.ok) {
      setOverview(null);
      setPlans(null);
      setState(
        failed.status === 401 || failed.status === 403
          ? 'denied'
          : failed.status === 503
            ? 'off'
            : 'error',
      );
      setMessage(problemText(failed.status, 'load your plan'));
      return;
    }
    if (!o.ok || !p.ok) return;
    if (o.data.workspaceId !== workspaceId || p.data.workspaceId !== workspaceId) {
      setOverview(null);
      setPlans(null);
      setState('gone');
      setMessage('This answer did not match the workspace you opened. Reload the page.');
      return;
    }
    setOverview(o.data);
    setPlans(p.data);
    setStale(false);
    setState('ready');
  }, [subject, issuer, workspaceId]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => load());
    return () => {
      alive.current = false;
      task.current?.abort();
    };
  }, [load]);
  // The page stays readable, but acting needs a fresh look at the plan.
  useEffect(() => {
    if (!overview) return;
    const timer = setTimeout(
      () => setStale(true),
      Math.max(0, Date.parse(overview.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [overview]);
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
    const result = await callBillingApi<{ id: string }>(
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
    setAck(false);
    setMessage('Saved.');
    await load();
  }
  const open = (p: Panel) => {
    setPanel(p);
    setPending(null);
    setAck(false);
    setMessage('');
  };
  const act = (extra: Record<string, unknown>) => ({
    commandId: crypto.randomUUID(),
    workspaceId,
    ...extra,
  });
  function submitRequest(e: FormEvent, plan: BillingPlan) {
    e.preventDefault();
    if (!ack) return;
    void send(
      pending ??
        act({
          action: 'request',
          planKey: plan.key,
          planVersion: plan.version,
          planDigest: plan.digest,
          acknowledged: true,
        }),
    );
  }
  function submitChange(e: FormEvent, action: 'cancel' | 'keep' | 'withdraw', sub: string) {
    e.preventDefault();
    void send(pending ?? act({ action, subscriptionId: sub }));
  }

  const can = (a: string) =>
    !!overview && overview.canAct && !stale && (overview.actions as string[]).includes(a);
  const current = overview?.current ?? null;
  const asked = overview?.pending ?? null;
  return (
    <section aria-label="Plan and billing">
      <p>
        Plans here are samples. Nothing is charged, no invoice is made and no payment is taken. The
        limits in a plan are shown for information only.
      </p>
      {state === 'loading' && <p role="status">Loading your plan…</p>}
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
      {state === 'ready' && overview && plans && (
        <>
          {stale && (
            <div className="ux-state" data-state="expired">
              <p className="ux-state-label">Out of date</p>
              <div role="status">
                This page may be out of date, so the buttons are off. Reload it to continue.
              </div>
              <div className="ux-state-actions">
                <button type="button" className="button" onClick={() => void load()}>
                  Reload this page
                </button>
              </div>
            </div>
          )}
          {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}

          <section aria-labelledby={id + 'plan'} className="detail-card">
            <h2 id={id + 'plan'}>Your plan</h2>
            {current ? (
              <>
                <h3>{current.planTitle}</h3>
                <p>
                  <StatusBadge s={current} />
                </p>
                <p>
                  {priceText(current)} · {taxText[current.taxTreatment]}
                </p>
                {periodText(current) && <p>Current period: {periodText(current)}.</p>}
                {current.periodElapsed && (
                  <p role="status">
                    This period has ended and has not been renewed. Nothing from this plan applies
                    now.
                  </p>
                )}
                {current.status === 'cancel_scheduled' && !current.periodElapsed && (
                  <p>
                    You asked to cancel. The plan stays until the end of this period, then it ends.
                  </p>
                )}
              </>
            ) : (
              <p>Your workspace does not hold a plan.</p>
            )}
            {asked && (
              <p>
                You asked for <strong>{asked.planTitle}</strong>. <StatusBadge s={asked} /> The
                Corridra team will answer. Nothing starts until they do.
              </p>
            )}
            {overview.canAct && overview.actions.length > 0 && (
              <div className="guide-actions-row">
                {can('cancel') && (
                  <button
                    type="button"
                    className="button button-secondary"
                    data-intent="destructive"
                    onClick={() => open({ kind: 'cancel' })}
                  >
                    Cancel at the end of the period
                  </button>
                )}
                {can('keep') && current && (
                  <form onSubmit={(e) => submitChange(e, 'keep', current.id)}>
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Keep my plan
                    </button>
                  </form>
                )}
                {can('withdraw') && (
                  <button
                    type="button"
                    className="button button-secondary"
                    data-intent="destructive"
                    onClick={() => open({ kind: 'withdraw' })}
                  >
                    Withdraw my request
                  </button>
                )}
              </div>
            )}
            {panel?.kind === 'cancel' && current && (
              <form onSubmit={(e) => submitChange(e, 'cancel', current.id)} aria-label="Cancel">
                <p>
                  The plan stays until {current.periodEnd ? dayText(current.periodEnd) : 'the end'}.
                  You can take the cancellation back before then.
                </p>
                <button type="submit" className="button" data-intent="destructive" disabled={busy}>
                  Confirm cancellation
                </button>{' '}
                <button type="button" className="text-link" onClick={() => open(null)}>
                  Not now
                </button>
              </form>
            )}
            {panel?.kind === 'withdraw' && asked && (
              <form onSubmit={(e) => submitChange(e, 'withdraw', asked.id)} aria-label="Withdraw">
                <p>The request for {asked.planTitle} will be withdrawn. You can ask again later.</p>
                <button type="submit" className="button" data-intent="destructive" disabled={busy}>
                  Confirm withdrawal
                </button>{' '}
                <button type="button" className="text-link" onClick={() => open(null)}>
                  Not now
                </button>
              </form>
            )}
          </section>

          <section aria-labelledby={id + 'inc'} className="detail-card">
            <h2 id={id + 'inc'}>What your plan includes</h2>
            {overview.entitlements.length ? (
              <div
                role="region"
                aria-label="What your plan gives"
                tabIndex={0}
                style={{ overflowX: 'auto' }}
              >
                <table style={{ width: '100%' }}>
                  <caption style={{ textAlign: 'left' }}>
                    One row for everything the plan covers
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">What</th>
                      <th scope="col">What the plan gives</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.entitlements.map((e) => (
                      <tr key={e.key}>
                        <td>
                          <strong>{e.label}</strong>
                          <br />
                          {e.description}
                        </td>
                        <td>{grantText(e)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {current?.periodElapsed
                  ? 'The period has ended, so nothing is listed.'
                  : 'No plan is active, so nothing is listed.'}
              </p>
            )}
            <p>
              Corridra does not apply these limits yet. Nothing in your workspace is blocked or
              changed by your plan.
            </p>
          </section>

          <section aria-labelledby={id + 'offer'}>
            <h2 id={id + 'offer'}>Plans on offer</h2>
            {plans.plans.length === 0 ? (
              <div className="ux-state" data-state="empty">
                <p className="ux-state-label">No plans yet</p>
                <div role="status">No plan is on offer right now.</div>
              </div>
            ) : (
              <ul className="guide-list">
                {plans.plans.map((p) => {
                  const held = current?.planKey === p.key && current.planVersion === p.version;
                  const choosing = panel?.kind === 'request' && panel.plan.id === p.id;
                  return (
                    <li key={p.id} className="detail-card">
                      <h3>{p.title}</h3>
                      <p>
                        <strong>{priceText(p)}</strong> · {taxText[p.taxTreatment]}
                      </p>
                      <p>{p.summary}</p>
                      <details className="ux-journey-disclosure">
                        <summary>Everything in this plan</summary>
                        <p>Included</p>
                        <ul>
                          {p.included.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                        <p>Left out</p>
                        <ul>
                          {p.excluded.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                        <p>Limits (shown for information)</p>
                        <ul>
                          {p.entitlements.map((e) => (
                            <li key={e.key}>
                              {e.label}: {grantText(e)}
                            </li>
                          ))}
                        </ul>
                      </details>
                      {held ? (
                        <p>Your workspace holds this plan.</p>
                      ) : can('request') ? (
                        <div className="guide-actions-row">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => open(choosing ? null : { kind: 'request', plan: p })}
                          >
                            {choosing ? 'Close' : 'Ask for this plan'}
                          </button>
                        </div>
                      ) : null}
                      {choosing && (
                        <form
                          onSubmit={(e) => submitRequest(e, p)}
                          aria-label={'Ask for ' + p.title}
                        >
                          <p>
                            This sends a request to the Corridra team. Nothing is charged and
                            nothing starts until they answer.
                          </p>
                          <label
                            style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}
                          >
                            <input
                              type="checkbox"
                              checked={ack}
                              disabled={busy}
                              onChange={(e) => setAck(e.target.checked)}
                            />
                            I have read the price, the tax note, what is included and what is left
                            out.
                          </label>
                          <button type="submit" className="button" disabled={busy || !ack}>
                            {pending ? 'Send the same request again' : 'Send request'}
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!overview.canAct && (
              <p className="ux-empty">Only a workspace owner or admin can ask for a plan.</p>
            )}
          </section>

          {overview.subscriptions.length > 0 && (
            <section aria-labelledby={id + 'hist'}>
              <h2 id={id + 'hist'}>History</h2>
              <ul className="guide-list">
                {overview.subscriptions.map((s) => (
                  <li key={s.id} className="detail-card">
                    <h3>{s.planTitle}</h3>
                    <p>
                      <StatusBadge s={s} /> · {money(s.priceMinor, s.currency)}{' '}
                      {s.interval === 'month' ? 'per month' : 'per year'}
                    </p>
                    <ol>
                      {s.timeline.map((t) => (
                        <li key={t.seq}>
                          <strong>
                            {kindText[t.kind] ?? t.kind}
                            {t.endReason ? ' (' + endReasonText[t.endReason] + ')' : ''}
                          </strong>{' '}
                          · {t.by} · <time dateTime={t.at}>{dateTimeText(t.at)}</time>
                          {t.periodStart && t.periodEnd && (
                            <>
                              <br />
                              Period: {dayText(t.periodStart)} until {dayText(t.periodEnd)}
                            </>
                          )}
                          {t.note && (
                            <>
                              <br />
                              <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                {t.note}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </section>
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
