import type { MissionExperience } from '@corridra/delivery/report';
import { displayMoney } from '@corridra/domain/locale';
const fields = [
  'specification',
  'quantity',
  'moq',
  'unit',
  'unitPriceMinor',
  'totalPriceMinor',
  'toolingMinor',
  'setupMinor',
  'packagingMinor',
  'leadTime',
  'validUntil',
  'incoterm',
  'shipping',
  'paymentTerms',
  'warranty',
  'installation',
  'training',
  'spares',
] as const;
const labels: Record<string, string> = {
  specification: 'Specification',
  quantity: 'Quantity',
  moq: 'Minimum order quantity',
  unit: 'Quantity unit',
  unitPriceMinor: 'Original unit price',
  totalPriceMinor: 'Original total',
  toolingMinor: 'Tooling',
  setupMinor: 'Setup',
  packagingMinor: 'Packaging',
  leadTime: 'Lead time',
  validUntil: 'Offer valid until',
  incoterm: 'Delivery terms (Incoterm)',
  shipping: 'Shipping scope',
  paymentTerms: 'Payment terms',
  warranty: 'Warranty',
  installation: 'Installation',
  training: 'Training',
  spares: 'Spares',
};
export function ComparisonMatrix({
  offers,
  language,
}: {
  offers: MissionExperience['quotations'];
  language: string;
}) {
  if (!offers.length) return null;
  return (
    <div
      className="ux-comparison-scroll"
      role="region"
      aria-label="Original quotation comparison"
      tabIndex={0}
    >
      <table className="ux-comparison-matrix">
        <caption>
          Original approved terms, without currency conversion. Missing terms remain missing.
        </caption>
        <thead>
          <tr>
            <th scope="col">Term</th>
            {offers.map((q) => (
              <th scope="col" key={q.id}>
                Offer revision {q.revision}
                <br />
                {q.currency}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <th scope="row">{labels[field]}</th>
              {offers.map((q) => {
                const value = q.terms[field];
                const missing = value === undefined || value === 'NOT_SUPPLIED';
                return (
                  <td key={q.id} className={missing ? 'ux-cell-missing' : undefined}>
                    <span
                      lang={
                        typeof value === 'string' && /\p{Script=Han}/u.test(value)
                          ? 'zh'
                          : undefined
                      }
                    >
                      {missing
                        ? 'NOT SUPPLIED'
                        : field.endsWith('Minor')
                          ? displayMoney(String(value), q.currency, language)
                          : String(value)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
