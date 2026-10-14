'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { checkedResponse, accessDenied } from '../../components/private-capability';
import { currencies } from '@corridra/domain/currencies';
import { displayMoney, originalAmountToMinor } from '@corridra/domain/locale';
export function RecipientResponse({
  token,
  allowQuotation,
  allowMeetingInterest,
  response,
  onAccessDenied,
}: {
  token: string;
  allowQuotation: boolean;
  allowMeetingInterest: boolean;
  response?: { body: Record<string, unknown>; sourceKind: string };
  onAccessDenied?: () => void;
}) {
  const [quote, setQuote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(response),
    [acknowledged, setAcknowledged] = useState(false);
  const feedback = useRef<HTMLParagraphElement>(null),
    receiptHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (acknowledged) receiptHeading.current?.focus();
  }, [acknowledged]);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  const id = useRef('');
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const form = e.currentTarget,
      values = new FormData(form);
    setBusy(true);
    setError('');
    if (!id.current) id.current = crypto.randomUUID();
    try {
      const terms = pending
        ? {}
        : Object.fromEntries(
            [
              'specification',
              'quantity',
              'unit',
              'unitPriceMinor',
              'totalPriceMinor',
              'leadTime',
              'paymentTerms',
            ]
              .map((k) => [k, String(values.get(k) ?? '').trim()])
              .filter(([, v]) => v)
              .map(([key, value]) => [
                key,
                key.includes('Minor')
                  ? originalAmountToMinor(value, String(values.get('currency')))
                  : value,
              ]),
          );
      const body = {
        body: String(values.get('body')),
        meetingInterest: values.get('meetingInterest') === 'on',
        quotation: quote
          ? {
              currency: String(values.get('currency')),
              terms,
              uncertainties: String(values.get('uncertainties')),
            }
          : null,
        acknowledged: values.get('acknowledged') === 'on',
      };
      const command = pending ?? {
        action: 'detail-response',
        token,
        responseId: id.current,
        ...body,
      };
      setPending(command);
      const r = await fetch('/api/buyer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
          cache: 'no-store',
        }),
        checked = await checkedResponse(r),
        v = await checked.json();
      const recorded = { ...command };
      delete recorded.action;
      delete recorded.token;
      delete recorded.responseId;
      setSaved({ body: recorded, sourceKind: v.sourceKind });
      setAcknowledged(true);
      setPending(null);
    } catch (err) {
      if (accessDenied(err)) onAccessDenied?.();
      setError(err instanceof Error ? err.message : 'Your response could not be recorded.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (saved) {
    const quotation = saved.body.quotation as null | {
      currency: string;
      terms: Record<string, string>;
      uncertainties: string;
    };
    return (
      <section>
        <h3 ref={receiptHeading} tabIndex={-1}>
          Your recorded response
        </h3>
        <p>{String(saved.body.body)}</p>
        {quotation && (
          <>
            <p>
              Original quoted unit price:{' '}
              {quotation.terms.unitPriceMinor !== undefined
                ? displayMoney(quotation.terms.unitPriceMinor, quotation.currency)
                : 'NOT SUPPLIED'}
            </p>
            <p>
              Original quoted total:{' '}
              {quotation.terms.totalPriceMinor !== undefined
                ? displayMoney(quotation.terms.totalPriceMinor, quotation.currency)
                : 'NOT SUPPLIED'}
            </p>
            <details>
              <summary>Recorded original offer terms</summary>
              <dl>
                {Object.entries(quotation.terms).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd lang={/\p{Script=Han}/u.test(value) ? 'zh' : undefined}>
                      {key.endsWith('Minor') ? displayMoney(value, quotation.currency) : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            <p>{quotation.uncertainties}</p>
          </>
        )}
        {!!saved.body.meetingInterest && (
          <p>Meeting or visit interest recorded. No appointment confirmed.</p>
        )}
        <p className="evidence-label">
          {saved.sourceKind}. The operator must review this declaration. No meeting, quotation
          approval or verification is inferred.
        </p>
      </section>
    );
  }
  return (
    <form onSubmit={submit}>
      <h3>Reply or request clarification</h3>
      {error && (
        <p ref={feedback} tabIndex={-1} className="ux-error-summary" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <p>
          The response is not acknowledged. Retry sends the same original request; keep this page
          open.
        </p>
      )}
      <fieldset disabled={busy || !!pending}>
        <legend className="sr-only">Original declaration</legend>
        <label className="field">
          Your response
          <textarea name="body" minLength={3} maxLength={1000} required />
        </label>
        {allowMeetingInterest && (
          <label className="check-field">
            <input type="checkbox" name="meetingInterest" />I would like to discuss a meeting or
            visit. This is interest, not a confirmed appointment.
          </label>
        )}
        {allowQuotation && (
          <>
            <label className="check-field">
              <input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} />
              Include a supplier-declared quotation
            </label>
            {quote && (
              <fieldset>
                <legend>Original offer terms</legend>
                <label className="field">
                  Original currency
                  <select name="currency" required>
                    <option value="">Choose currency</option>
                    {Object.keys(currencies).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    'specification',
                    'quantity',
                    'unit',
                    'unitPriceMinor',
                    'totalPriceMinor',
                    'leadTime',
                    'paymentTerms',
                  ] as const
                ).map((k) => (
                  <label className="field" key={k}>
                    {
                      {
                        specification: 'Quoted specification',
                        quantity: 'Quantity',
                        unit: 'Quantity unit',
                        unitPriceMinor: 'Unit price (original currency amount)',
                        totalPriceMinor: 'Total (original currency amount)',
                        leadTime: 'Lead time',
                        paymentTerms: 'Payment terms',
                      }[k]
                    }{' '}
                    (optional)
                    <input
                      name={k}
                      maxLength={k.includes('Minor') ? 18 : 1000}
                      inputMode={
                        k.includes('Minor') ? 'decimal' : k === 'quantity' ? 'numeric' : undefined
                      }
                    />
                  </label>
                ))}
                <label className="field">
                  Missing information and uncertainties
                  <textarea name="uncertainties" minLength={3} maxLength={1000} required />
                </label>
                <p>
                  Retain original currency and prices. Missing terms stay missing. No FX,
                  independent verification or order is recorded.
                </p>
              </fieldset>
            )}
          </>
        )}
        <label className="check-field">
          <input name="acknowledged" type="checkbox" required />
          This is my declaration for this request. I understand that the operator will review it.
        </label>
      </fieldset>
      <button className="primary-link" disabled={busy}>
        {pending ? 'Retry the same declaration' : 'Record response'}
      </button>
    </form>
  );
}
