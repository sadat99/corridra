'use client';
import { useRef, useState, type FormEvent } from 'react';
import { currencies } from '@corridra/domain/currencies';
import { displayMoney, originalAmountToMinor } from '@corridra/domain/locale';
export function RecipientResponse({
  token,
  allowQuotation,
  allowMeetingInterest,
  response,
}: {
  token: string;
  allowQuotation: boolean;
  allowMeetingInterest: boolean;
  response?: { body: Record<string, unknown>; sourceKind: string };
}) {
  const [quote, setQuote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(response);
  const id = useRef('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      values = new FormData(form);
    setBusy(true);
    setError('');
    if (!id.current) id.current = crypto.randomUUID();
    try {
      const terms = Object.fromEntries(
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
      const r = await fetch('/api/buyer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'detail-response',
            token,
            responseId: id.current,
            ...body,
          }),
          cache: 'no-store',
        }),
        v = await r.json();
      if (!r.ok) throw Error(v.error);
      setSaved({ body, sourceKind: v.sourceKind });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your response could not be recorded.');
    } finally {
      setBusy(false);
    }
  }
  if (saved) {
    const quotation = saved.body.quotation as null | {
      currency: string;
      terms: { unitPriceMinor?: string; totalPriceMinor?: string };
      uncertainties: string;
    };
    return (
      <section>
        <h3>Your recorded response</h3>
        <p>{String(saved.body.body)}</p>
        {quotation && (
          <>
            <p>
              Original quoted unit price:{' '}
              {quotation.terms.unitPriceMinor !== undefined
                ? displayMoney(quotation.terms.unitPriceMinor, quotation.currency)
                : 'NOT SUPPLIED'}
            </p>
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
      {error && <p role="alert">{error}</p>}
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
                Retain original currency and prices. Missing terms stay missing. No FX, independent
                verification or order is recorded.
              </p>
            </fieldset>
          )}
        </>
      )}
      <label className="check-field">
        <input name="acknowledged" type="checkbox" required />
        This is my declaration for this request. I understand that the operator will review it.
      </label>
      <button className="primary-link" disabled={busy}>
        Record response
      </button>
    </form>
  );
}
