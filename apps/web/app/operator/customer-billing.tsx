'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { displayDate, displayMoney } from '@corridra/domain/locale';

type Summary = {
  id: string;
  workspaceName?: string;
  planKey: string;
  planVersion: number;
  planTitle: string;
  interval: string;
  priceMinor: string;
  currency: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodElapsed: boolean;
  lastSeq?: number;
};
type Entitlement = {
  key: string;
  label: string;
  unit: 'count' | 'flag';
  mode: string;
  limit: number | null;
};
type Plan = {
  key: string;
  version: number;
  title: string;
  summary: string;
  interval: string;
  priceMinor: string;
  currency: string;
  taxTreatment: string;
  included: string[];
  excluded: string[];
  entitlements: Entitlement[];
  active: boolean;
  source?: string;
};
type Detail = {
  subscription: Summary;
  plan: Plan;
  events: {
    seq: number;
    at: string;
    kind: string;
    status: string;
    actorKind: string;
    customerNote: string | null;
    internalNote: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    endReason: string | null;
  }[];
  lastSeq: number;
  actions: string[];
  replacesHeldPlan: boolean;
  periodElapsed: boolean;
};
type PlanList = {
  plans: Plan[];
  entitlementKeys: { key: string; unit: 'count' | 'flag'; label: string }[];
};
const starter = 'Synthetic ';
const currencies = ['USD', 'EUR', 'GBP', 'BDT', 'JPY'];
const taxOptions: [string, string][] = [
  ['price_excludes_tax', 'Price excludes tax'],
  ['price_includes_tax', 'Price includes tax'],
  ['tax_to_be_confirmed', 'Tax to be confirmed'],
];
const modeOptions: Record<'count' | 'flag', [string, string][]> = {
  count: [
    ['limit', 'Up to a limit'],
    ['unlimited', 'No limit'],
  ],
  flag: [
    ['included', 'Included'],
    ['excluded', 'Not included'],
  ],
};
function money(minor: string, currency: string) {
  try {
    return displayMoney(minor, currency);
  } catch {
    return minor + ' ' + currency;
  }
}
function lines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
function plainError(status: number | null) {
  return status === 401 || status === 403
    ? 'Owner or admin access with a fresh authenticator check is required.'
    : status === 503
      ? 'Plans are unavailable.'
      : status === 409
        ? 'The subscription or plan changed, or the details were refused. Reload and check.'
        : status === 400
          ? 'Check the details. Every note starts with Synthetic, prices are whole minor units and a plan states every limit once.'
          : 'This could not be completed. Try again.';
}
const today = () => new Date().toISOString().slice(0, 10);

export function CustomerBilling({ tenant }: { tenant: string }) {
  return <Scoped key={tenant} tenant={tenant} />;
}
type Draft = {
  key: string;
  expectedVersion: number;
  title: string;
  summary: string;
  interval: string;
  price: string;
  currency: string;
  tax: string;
  included: string;
  excluded: string;
  active: boolean;
  grants: Record<string, { mode: string; limit: string }>;
};
function Scoped({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Summary[] | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [catalogue, setCatalogue] = useState<PlanList | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [fault, setFault] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [note, setNote] = useState(starter),
    [internal, setInternal] = useState(starter),
    [start, setStart] = useState(today()),
    [draft, setDraft] = useState<Draft | null>(null);
  const task = useRef<AbortController | null>(null);
  const endpoint = '/api/workspace/customer-billing?tenant=' + encodeURIComponent(tenant);
  const call = useCallback(
    async (query: string, body?: Record<string, unknown>) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      try {
        const r = await fetch(endpoint + query, {
          method: body ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return null;
        if (!r.ok) return { status: r.status, body: null as unknown };
        return { status: 200, body: (await r.json()) as unknown };
      } catch {
        return controller.signal.aborted ? null : { status: 0, body: null as unknown };
      }
    },
    [endpoint],
  );
  const loadList = useCallback(async () => {
    const r = await call('&scope=list');
    if (!r) return;
    if (r.status !== 200) {
      setRows(null);
      setFault(plainError(r.status));
      return;
    }
    const body = r.body as { subscriptions?: Summary[] };
    if (!Array.isArray(body.subscriptions)) {
      setFault(plainError(0));
      return;
    }
    setFault('');
    setRows(body.subscriptions);
  }, [call]);
  const loadPlans = useCallback(async () => {
    const r = await call('&scope=plans');
    if (!r) return;
    const body = r.body as PlanList | null;
    if (r.status !== 200 || !body || !Array.isArray(body.plans)) {
      setFault(plainError(r.status));
      return;
    }
    setCatalogue(body);
  }, [call]);
  const open = useCallback(
    async (id: string) => {
      const r = await call('&scope=detail&subscription=' + encodeURIComponent(id));
      if (!r) return;
      if (r.status !== 200) {
        setDetail(null);
        setFault(plainError(r.status));
        return;
      }
      const body = r.body as Detail;
      if (!body?.subscription || body.subscription.id !== id || !Array.isArray(body.events)) {
        setFault(plainError(0));
        return;
      }
      setFault('');
      setDetail(body);
    },
    [call],
  );
  useEffect(() => {
    void Promise.resolve().then(() => loadList());
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        task.current?.abort();
        setDetail(null);
        setRows(null);
        setMessage('Customer details were cleared while you were away. Reload to continue.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [loadList]);
  async function send(body: Record<string, unknown>, after: 'detail' | 'plans') {
    if (busy) return;
    setPending(body);
    setBusy(true);
    setMessage('');
    const r = await call('', body);
    setBusy(false);
    if (!r) return;
    if (r.status !== 200) {
      const unsure = r.status === 0 || (r.status >= 500 && r.status !== 503);
      if (!unsure) setPending(null);
      setMessage(
        unsure
          ? 'Could not confirm that this was saved. Send the same action again; it cannot be done twice.'
          : plainError(r.status),
      );
      return;
    }
    setPending(null);
    setMessage('Saved.');
    setNote(starter);
    setInternal(starter);
    if (after === 'detail' && detail) await open(detail.subscription.id);
    else {
      setDraft(null);
      await loadPlans();
    }
    await loadList();
  }
  const base = () =>
    detail
      ? {
          subscriptionId: detail.subscription.id,
          expectedSeq: detail.lastSeq,
          commandId: crypto.randomUUID(),
        }
      : null;
  function act(e: FormEvent, action: string, extra: Record<string, unknown>) {
    e.preventDefault();
    const b = base();
    if (!b) return;
    void send(pending ?? { action, ...b, ...extra }, 'detail');
  }
  function edit(plan: Plan | null) {
    if (!catalogue) return;
    const grants: Draft['grants'] = {};
    for (const k of catalogue.entitlementKeys) {
      const have = plan?.entitlements.find((e) => e.key === k.key);
      grants[k.key] = {
        mode: have?.mode ?? modeOptions[k.unit][0]![0],
        limit: have?.limit === null || have?.limit === undefined ? '' : String(have.limit),
      };
    }
    setPending(null);
    setMessage('');
    setDraft({
      key: plan?.key ?? '',
      expectedVersion: plan?.version ?? 0,
      title: plan?.title ?? '',
      summary: plan?.summary ?? '',
      interval: plan?.interval ?? 'month',
      price: plan?.priceMinor ?? '',
      currency: plan?.currency ?? 'USD',
      tax: plan?.taxTreatment ?? 'tax_to_be_confirmed',
      included: plan?.included.join('\n') ?? '',
      excluded: plan?.excluded.join('\n') ?? '',
      active: plan?.active ?? true,
      grants,
    });
  }
  function submitPlan(e: FormEvent) {
    e.preventDefault();
    if (!draft || !catalogue) return;
    void send(
      pending ?? {
        action: 'plan',
        commandId: crypto.randomUUID(),
        planKey: draft.key.trim(),
        expectedVersion: draft.expectedVersion,
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        interval: draft.interval,
        priceMinor: draft.price.trim(),
        currency: draft.currency,
        taxTreatment: draft.tax,
        included: lines(draft.included),
        excluded: lines(draft.excluded),
        active: draft.active,
        entitlements: catalogue.entitlementKeys.map((k) => {
          const g = draft.grants[k.key]!;
          return {
            key: k.key,
            mode: g.mode,
            limit: g.mode === 'limit' ? Number(g.limit) : null,
          };
        }),
      },
      'plans',
    );
  }
  const change = (set: () => void) => {
    set();
    setPending(null);
  };
  const can = (a: string) => !!detail && detail.actions.includes(a);
  return (
    <section aria-label="Customer sample plans" className="detail-card">
      <h3>Customer sample plans</h3>
      <p>
        Sample plan requests from customer workspaces. Activating a plan records the period only: no
        payment, no invoice. Plan limits are recorded and not enforced.
      </p>
      {fault && <p role="alert">{fault}</p>}
      {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}
      {rows === null && !fault && <p role="status">Loading plan requests…</p>}
      {rows && rows.length === 0 && <p>No customer has asked for a plan.</p>}
      {rows && rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <strong>{r.planTitle}</strong> · {r.workspaceName} · {r.status.replace('_', ' ')}
              {r.periodElapsed ? ' (period ended)' : ''}{' '}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setPending(null);
                  setMessage('');
                  void open(r.id);
                }}
              >
                Open {r.planTitle} for {r.workspaceName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail && (
        <section aria-label="Plan request detail">
          <h4>
            {detail.subscription.planTitle} for {detail.subscription.workspaceName}
          </h4>
          <p>
            Status: {detail.subscription.status.replace('_', ' ')}.{' '}
            {money(detail.plan.priceMinor, detail.plan.currency)} per {detail.plan.interval},{' '}
            {taxOptions.find(([k]) => k === detail.plan.taxTreatment)?.[1].toLowerCase()}.
            {detail.subscription.periodStart && detail.subscription.periodEnd
              ? ' Period ' +
                displayDate(detail.subscription.periodStart) +
                ' until ' +
                displayDate(detail.subscription.periodEnd) +
                '.'
              : ''}
          </p>
          {detail.replacesHeldPlan && can('activate') && (
            <p role="status">
              This workspace already holds a plan. Activating this request ends that plan.
            </p>
          )}
          <ol>
            {detail.events.map((ev) => (
              <li key={ev.seq}>
                {ev.kind.replace('_', ' ')} · {ev.actorKind} ·{' '}
                <time dateTime={ev.at}>{ev.at.slice(0, 16).replace('T', ' ')} UTC</time>
                {ev.periodStart && ev.periodEnd
                  ? ' · ' + displayDate(ev.periodStart) + ' until ' + displayDate(ev.periodEnd)
                  : ''}
                {ev.endReason ? ' · ' + ev.endReason.replace('_', ' ') : ''}
                {ev.customerNote ? ' · customer sees: ' + ev.customerNote : ''}
                {ev.internalNote ? ' · internal: ' + ev.internalNote : ''}
              </li>
            ))}
          </ol>
          {can('activate') && (
            <form
              aria-label="Activate"
              onSubmit={(e) =>
                act(e, 'activate', {
                  periodStart: start,
                  customerNote: note.trim().length > starter.length ? note.trim() : null,
                })
              }
            >
              <fieldset disabled={busy}>
                <div className="field">
                  <label htmlFor="billing-start">Period starts on</label>
                  <input
                    id="billing-start"
                    type="date"
                    required
                    value={start}
                    onChange={(e) => change(() => setStart(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="billing-activate-note">
                    Note the customer reads (optional, start with Synthetic)
                  </label>
                  <textarea
                    id="billing-activate-note"
                    rows={2}
                    maxLength={1000}
                    value={note}
                    onChange={(e) => change(() => setNote(e.target.value))}
                  />
                </div>
              </fieldset>
              <button type="submit" className="button" disabled={busy}>
                Activate this plan
              </button>
            </form>
          )}
          {can('renew') && (
            <form
              aria-label="Renew"
              onSubmit={(e) =>
                act(e, 'renew', {
                  customerNote: note.trim().length > starter.length ? note.trim() : null,
                })
              }
            >
              <div className="field">
                <label htmlFor="billing-renew-note">
                  Note the customer reads (optional, start with Synthetic)
                </label>
                <textarea
                  id="billing-renew-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  disabled={busy}
                  onChange={(e) => change(() => setNote(e.target.value))}
                />
              </div>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Renew for the next period
              </button>
            </form>
          )}
          {(can('decline') || can('end')) && (
            <form
              aria-label="Decline or end"
              onSubmit={(e) =>
                act(e, can('decline') ? 'decline' : 'end', { customerNote: note.trim() })
              }
            >
              <div className="field">
                <label htmlFor="billing-reason">
                  Reason the customer reads (start with Synthetic)
                </label>
                <textarea
                  id="billing-reason"
                  rows={2}
                  required
                  minLength={11}
                  maxLength={1000}
                  value={note}
                  disabled={busy}
                  onChange={(e) => change(() => setNote(e.target.value))}
                />
              </div>
              <button
                type="submit"
                className="button button-secondary"
                data-intent="destructive"
                disabled={busy}
              >
                {can('decline') ? 'Decline this request' : 'End this plan'}
              </button>
            </form>
          )}
          {can('note') && (
            <form
              aria-label="Internal note"
              onSubmit={(e) => act(e, 'note', { internalNote: internal.trim() })}
            >
              <div className="field">
                <label htmlFor="billing-internal">
                  Internal note, never shown to the customer (start with Synthetic)
                </label>
                <textarea
                  id="billing-internal"
                  rows={2}
                  required
                  minLength={11}
                  maxLength={1000}
                  value={internal}
                  disabled={busy}
                  onChange={(e) => change(() => setInternal(e.target.value))}
                />
              </div>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Save internal note
              </button>
            </form>
          )}
        </section>
      )}

      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && !catalogue) void loadPlans();
        }}
      >
        <summary>Plans on offer and plan versions</summary>
        {!catalogue && <p role="status">Loading plans…</p>}
        {catalogue && (
          <>
            <ul>
              {catalogue.plans.map((p) => (
                <li key={p.key}>
                  <strong>{p.title}</strong> · version {p.version} ·{' '}
                  {money(p.priceMinor, p.currency)} per {p.interval} ·{' '}
                  {p.active ? 'on offer' : 'retired'}{' '}
                  <button type="button" className="text-link" onClick={() => edit(p)}>
                    New version of {p.title}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="text-link" onClick={() => edit(null)}>
              Add a new plan
            </button>
          </>
        )}
        {draft && catalogue && (
          <form onSubmit={submitPlan} aria-label="Plan version">
            <fieldset disabled={busy}>
              <div className="field">
                <label htmlFor="plan-key">Plan key (letters, digits and hyphens)</label>
                <input
                  id="plan-key"
                  required
                  pattern="[a-z][a-z0-9\-]{2,59}"
                  readOnly={draft.expectedVersion > 0}
                  value={draft.key}
                  onChange={(e) => change(() => setDraft({ ...draft, key: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="plan-title">Title (must say sample)</label>
                <input
                  id="plan-title"
                  required
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) => change(() => setDraft({ ...draft, title: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="plan-summary">Summary</label>
                <textarea
                  id="plan-summary"
                  required
                  rows={2}
                  maxLength={400}
                  value={draft.summary}
                  onChange={(e) => change(() => setDraft({ ...draft, summary: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="plan-interval">Billed</label>
                <select
                  id="plan-interval"
                  value={draft.interval}
                  onChange={(e) => change(() => setDraft({ ...draft, interval: e.target.value }))}
                >
                  <option value="month">Every month</option>
                  <option value="year">Every year</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="plan-price">Price in whole minor units (for example 4900)</label>
                <input
                  id="plan-price"
                  required
                  inputMode="numeric"
                  pattern="0|[1-9][0-9]{0,10}"
                  value={draft.price}
                  onChange={(e) => change(() => setDraft({ ...draft, price: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="plan-currency">Currency</label>
                <select
                  id="plan-currency"
                  value={draft.currency}
                  onChange={(e) => change(() => setDraft({ ...draft, currency: e.target.value }))}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="plan-tax">Tax</label>
                <select
                  id="plan-tax"
                  value={draft.tax}
                  onChange={(e) => change(() => setDraft({ ...draft, tax: e.target.value }))}
                >
                  {taxOptions.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="plan-included">What is included (one per line)</label>
                <textarea
                  id="plan-included"
                  required
                  rows={3}
                  value={draft.included}
                  onChange={(e) => change(() => setDraft({ ...draft, included: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="plan-excluded">What is left out (one per line)</label>
                <textarea
                  id="plan-excluded"
                  required
                  rows={3}
                  value={draft.excluded}
                  onChange={(e) => change(() => setDraft({ ...draft, excluded: e.target.value }))}
                />
              </div>
              {catalogue.entitlementKeys.map((k) => {
                const g = draft.grants[k.key]!;
                return (
                  <div className="field" key={k.key}>
                    <label htmlFor={'grant-' + k.key}>{k.label}</label>
                    <select
                      id={'grant-' + k.key}
                      value={g.mode}
                      onChange={(e) =>
                        change(() =>
                          setDraft({
                            ...draft,
                            grants: { ...draft.grants, [k.key]: { ...g, mode: e.target.value } },
                          }),
                        )
                      }
                    >
                      {modeOptions[k.unit].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {g.mode === 'limit' && (
                      <input
                        aria-label={k.label + ' limit'}
                        inputMode="numeric"
                        required
                        pattern="[0-9]{1,6}"
                        value={g.limit}
                        onChange={(e) =>
                          change(() =>
                            setDraft({
                              ...draft,
                              grants: {
                                ...draft.grants,
                                [k.key]: { ...g, limit: e.target.value },
                              },
                            }),
                          )
                        }
                      />
                    )}
                  </div>
                );
              })}
              <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => change(() => setDraft({ ...draft, active: e.target.checked }))}
                />
                On offer to customers
              </label>
            </fieldset>
            <button type="submit" className="button" disabled={busy}>
              Save as a new version
            </button>
          </form>
        )}
      </details>
    </section>
  );
}
