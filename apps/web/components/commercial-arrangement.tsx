import {
  arrangementModeLabels,
  arrangementPartyLabels,
  commissionEstimate,
  type CommercialArrangement,
} from '@corridra/domain/commercial-arrangements';
import { displayMoney } from '@corridra/domain/locale';

export function CommercialArrangementSummary({ terms }: { terms: CommercialArrangement }) {
  const c = terms.commission;
  const commissionFacts = c
    ? [
        ['Payer', c.payer],
        ['Recipient', c.recipient],
        ['Trigger', c.trigger],
        ['Calculation base', `${c.baseDescription}: ${displayMoney(c.baseMinor, c.currency)}`],
        ['Rate', `${(c.rateBasisPoints / 100).toFixed(2)}%`],
        [
          'Estimated commission',
          `${displayMoney(commissionEstimate(c), c.currency)}. Not earned, invoiced or collected.`,
        ],
        ['Evidence required', c.evidenceRequired],
        [
          'Fixed fee treatment',
          c.fixedFeeTreatment === 'ADDITIONAL'
            ? 'Commission is additional to the fixed service fee.'
            : c.fixedFeeTreatment === 'CREDIT_FIXED_FEE'
              ? 'Credit the fixed service fee against the commission. Do not charge it twice.'
              : 'No fixed service fee.',
        ],
      ]
    : [];
  return (
    <section aria-label="Commercial arrangement" lang="en" dir="ltr">
      <h4>{arrangementModeLabels[terms.mode]}</h4>
      <p>
        <span lang="en">Self-declared</span> commercial terms. A service acceptance does not
        authorise a product purchase or confirm a sale.
      </p>
      <dl>
        {Object.entries(arrangementPartyLabels).map(([key, label]) => (
          <div key={key} className="ux-fact-row">
            <dt>{label}</dt>
            <dd>{terms.parties[key as keyof typeof arrangementPartyLabels]}</dd>
          </div>
        ))}
        <div className="ux-fact-row">
          <dt>Importer of record</dt>
          <dd>{terms.parties.importerOfRecord ?? 'Not agreed. Confirm before importing.'}</dd>
        </div>
        <div className="ux-fact-row">
          <dt>Independent operating partner</dt>
          <dd>
            {terms.parties.operatingPartner ??
              'None agreed. Corridra staff can coordinate the work directly.'}
          </dd>
        </div>
      </dl>
      {terms.supplyPrice && (
        <>
          <h5>Seller&apos;s quoted supply price</h5>
          <p>
            {displayMoney(terms.supplyPrice.amountMinor, terms.supplyPrice.currency)}. This belongs
            to the contracting seller. It is separate from the service totals below.
          </p>
          <p>Included services: {terms.supplyPrice.includedServices}</p>
          <p>Excluded: {terms.supplyPrice.exclusions}</p>
        </>
      )}
      <p>
        {terms.fixedFeePositions.length
          ? `Fixed service fees are the listed fee items ${terms.fixedFeePositions.join(', ')}. Each is charged once.`
          : 'There is no separate fixed service fee.'}
      </p>
      {c && (
        <>
          <h5>Conditional commission</h5>
          <dl>
            {commissionFacts.map(([label, value]) => (
              <div className="ux-fact-row" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            Calculated in whole minor units, rounded half up. A scheduled meeting alone does not
            establish the trigger.
          </p>
        </>
      )}
      <details>
        <summary>Original stated terms</summary>
        <p>{terms.sourceTerms}</p>
      </details>
      <p>
        No payment is taken here. Supply value and conditional commission are not recorded as
        Corridra earned revenue.
      </p>
    </section>
  );
}
