'use client';
import { useId } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import {
  arrangementModeLabels,
  arrangementPartyLabels,
  commercialArrangement,
  internalSupplyEconomics,
  markedUpSupplyPrice,
  type CommercialArrangement,
} from '@corridra/domain/commercial-arrangements';

type Parties = CommercialArrangement['parties'];
export type ArrangementForm = {
  mode: '' | CommercialArrangement['mode'];
  parties: Parties;
  supplyPrice: string;
  includedServices: string;
  exclusions: string;
  sourceTerms: string;
  commissionPayer: string;
  commissionRecipient: string;
  trigger: string;
  baseDescription: string;
  baseMinor: string;
  rate: string;
  evidenceRequired: string;
  fixedFeeTreatment: 'ADDITIONAL' | 'CREDIT_FIXED_FEE';
  acquisitionCost: string;
  markupRate: string;
  relationshipNote: string;
};
export function emptyArrangementForm(): ArrangementForm {
  const s = realCustomerInput() ? '' : 'Synthetic ';
  return {
    mode: '',
    parties: {
      buyer: s,
      seller: s,
      supplier: s,
      serviceProvider: s,
      serviceFeePayer: s,
      serviceInvoiceIssuer: s,
      servicePaymentRecipient: s,
      invoiceIssuer: s,
      paymentRecipient: s,
      deliveryResponsible: s,
      warrantyResponsible: s,
      importerOfRecord: null,
      operatingPartner: null,
    },
    supplyPrice: '',
    includedServices: s,
    exclusions: s,
    sourceTerms: s,
    commissionPayer: s,
    commissionRecipient: s,
    trigger: s,
    baseDescription: s,
    baseMinor: '',
    rate: '',
    evidenceRequired: s,
    fixedFeeTreatment: 'ADDITIONAL',
    acquisitionCost: '',
    markupRate: '',
    relationshipNote: s,
  };
}
function basisPoints(rate: string) {
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(rate))
    throw new Error('Use a percentage with at most two decimal places.');
  const [whole, decimals = ''] = rate.split('.');
  return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
}
export function arrangementPayload(
  d: ArrangementForm,
  currency: string,
  components: { kind: string; amount: string }[],
) {
  if (!d.mode) return {};
  const fixedFeePositions = components.flatMap((c, i) =>
    c.kind === 'service_fee' && /^[1-9][0-9]*$/.test(c.amount.trim()) ? [i + 1] : [],
  );
  const hasSupply = d.mode === 'BUNDLED_SUPPLY' || (d.mode === 'HYBRID' && d.supplyPrice !== '');
  const hasCommission =
    d.mode === 'SUCCESS_COMMISSION' || (d.mode === 'HYBRID' && d.baseMinor !== '');
  const terms = commercialArrangement.parse({
    version: 1,
    mode: d.mode,
    parties: d.parties,
    supplyPrice: hasSupply
      ? {
          currency,
          amountMinor: d.supplyPrice,
          includedServices: d.includedServices,
          exclusions: d.exclusions,
        }
      : null,
    fixedFeePositions,
    commission: hasCommission
      ? {
          payer: d.commissionPayer,
          recipient: d.commissionRecipient,
          trigger: d.trigger,
          baseDescription: d.baseDescription,
          baseMinor: d.baseMinor,
          currency,
          rateBasisPoints: basisPoints(d.rate),
          evidenceRequired: d.evidenceRequired,
          rounding: 'HALF_UP',
          fixedFeeTreatment: fixedFeePositions.length ? d.fixedFeeTreatment : 'NO_FIXED_FEE',
        }
      : null,
    sourceTerms: d.sourceTerms,
    principalStatus: 'CORRIDRA_SERVICE_PROVIDER',
  });
  return {
    commercialArrangement: terms,
    ...(d.acquisitionCost
      ? {
          internalEconomics: internalSupplyEconomics.parse({
            acquisitionCostMinor: d.acquisitionCost,
            currency,
            markupBasisPoints: basisPoints(d.markupRate),
            relationshipNote: d.relationshipNote,
          }),
        }
      : {}),
  };
}

export function CommercialArrangementFields({
  value: d,
  onChange,
  currency,
}: {
  value: ArrangementForm;
  onChange: (v: ArrangementForm) => void;
  currency: string;
}) {
  const id = useId();
  const set = <K extends keyof ArrangementForm>(key: K, value: ArrangementForm[K]) =>
    onChange({ ...d, [key]: value });
  const field = (key: keyof ArrangementForm, label: string, required = true) => (
    <label className="field" htmlFor={id + key}>
      {label}
      <input
        id={id + key}
        value={String(d[key])}
        maxLength={key === 'sourceTerms' ? 1000 : 500}
        required={required}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </label>
  );
  let markedUp: string | null = null;
  if (d.acquisitionCost && d.markupRate)
    try {
      markedUp = markedUpSupplyPrice(
        internalSupplyEconomics.parse({
          acquisitionCostMinor: d.acquisitionCost,
          currency,
          markupBasisPoints: basisPoints(d.markupRate),
          relationshipNote: d.relationshipNote,
        }),
      );
    } catch {
      /* Invalid private input remains editable. */
    }
  return (
    <details>
      <summary>Commercial arrangement (optional)</summary>
      <label className="field" htmlFor={id + 'mode'}>
        How is this work priced?
        <select
          id={id + 'mode'}
          value={d.mode}
          onChange={(e) => set('mode', e.target.value as ArrangementForm['mode'])}
        >
          <option value="">Use the existing itemised service quote</option>
          {Object.entries(arrangementModeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {d.mode && (
        <>
          <p>
            Amounts below use whole minor units in {currency}, as do the quote items. Supply price
            stays separate from Corridra&apos;s service totals.
          </p>
          <fieldset>
            <legend>Contracting parties and responsibilities</legend>
            {Object.entries(arrangementPartyLabels).map(([key, label]) => (
              <label className="field" key={key} htmlFor={id + key}>
                {label}
                <input
                  id={id + key}
                  required
                  maxLength={160}
                  value={d.parties[key as keyof typeof arrangementPartyLabels]}
                  onChange={(e) => set('parties', { ...d.parties, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="field" htmlFor={id + 'importer'}>
              Importer of record (optional)
              <input
                id={id + 'importer'}
                maxLength={160}
                value={d.parties.importerOfRecord ?? ''}
                onChange={(e) =>
                  set('parties', { ...d.parties, importerOfRecord: e.target.value || null })
                }
              />
            </label>
            <label className="field" htmlFor={id + 'partner'}>
              Independent operating partner (optional)
              <input
                id={id + 'partner'}
                maxLength={160}
                value={d.parties.operatingPartner ?? ''}
                onChange={(e) =>
                  set('parties', { ...d.parties, operatingPartner: e.target.value || null })
                }
              />
            </label>
          </fieldset>
          {(d.mode === 'BUNDLED_SUPPLY' || d.mode === 'HYBRID') && (
            <fieldset>
              <legend>Seller&apos;s supply price</legend>
              {field('supplyPrice', 'Quoted supply total', d.mode === 'BUNDLED_SUPPLY')}
              {field(
                'includedServices',
                'Services included in the supply price',
                d.supplyPrice !== '',
              )}
              {field('exclusions', 'Supply price exclusions', d.supplyPrice !== '')}
              {d.mode === 'BUNDLED_SUPPLY' && (
                <p>
                  Use zero for the existing service-fee item. The seller&apos;s bundled price
                  already includes this work.
                </p>
              )}
            </fieldset>
          )}
          {(d.mode === 'SUCCESS_COMMISSION' || d.mode === 'HYBRID') && (
            <fieldset>
              <legend>Conditional commission</legend>
              {field('baseMinor', 'Commission base amount', d.mode === 'SUCCESS_COMMISSION')}
              {field('rate', 'Commission rate (%)', d.baseMinor !== '')}
              {field('baseDescription', 'What the commission is calculated on', d.baseMinor !== '')}
              {field('trigger', 'Exact event that earns the commission', d.baseMinor !== '')}
              {field('commissionPayer', 'Commission payer', d.baseMinor !== '')}
              {field('commissionRecipient', 'Commission recipient', d.baseMinor !== '')}
              {field(
                'evidenceRequired',
                'Evidence required before commission is earned',
                d.baseMinor !== '',
              )}
              {d.mode === 'HYBRID' && (
                <label className="field" htmlFor={id + 'fee-treatment'}>
                  How does this combine with fixed fees?
                  <select
                    id={id + 'fee-treatment'}
                    value={d.fixedFeeTreatment}
                    onChange={(e) =>
                      set(
                        'fixedFeeTreatment',
                        e.target.value as ArrangementForm['fixedFeeTreatment'],
                      )
                    }
                  >
                    <option value="ADDITIONAL">Commission is additional</option>
                    <option value="CREDIT_FIXED_FEE">
                      Credit the fixed fee against commission
                    </option>
                  </select>
                </label>
              )}
              <p>
                This is a conditional estimate. Nothing is earned or collected by preparing or
                accepting this quote.
              </p>
            </fieldset>
          )}
          {field('sourceTerms', 'Original stated commercial terms')}
          <details>
            <summary>Private procurement costs and relationships</summary>
            <p>
              Handling staff only. These details are never included in the customer&apos;s quote.
            </p>
            {field('acquisitionCost', 'Acquisition cost (optional)', false)}
            {field('markupRate', 'Markup on acquisition cost (%)', d.acquisitionCost !== '')}
            {field(
              'relationshipNote',
              'Private relationship and cost source',
              d.acquisitionCost !== '',
            )}
            {markedUp && (
              <p>
                Derived supply price at this markup: {markedUp} minor units in {currency}. This is
                not a Corridra commission.
              </p>
            )}
          </details>
          <p>
            Corridra principal sales need separate legal and accounting approval. This form does not
            activate them.
          </p>
        </>
      )}
    </details>
  );
}
