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
  commissioning: 'Commissioning',
};
export function ComparisonMatrix({
  offers,
  shortlist,
  language,
  machinery = false,
}: {
  offers: MissionExperience['quotations'];
  shortlist: MissionExperience['shortlist'];
  language: string;
  /** Machinery missions always show the commissioning row; other missions show it only when an offer states it. */
  machinery?: boolean;
}) {
  if (!offers.length) return null;
  const rows: readonly string[] =
    machinery || offers.some((q) => q.terms.commissioning !== undefined)
      ? fields.flatMap((field) => (field === 'installation' ? [field, 'commissioning'] : [field]))
      : fields;
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
            {offers.map((q) => {
              // The supplier is the shortlisted company the quotation is for; no match, no name line.
              const company = shortlist.find((t) => t.id === q.targetId)?.company;
              return (
                <th scope="col" key={q.id}>
                  Offer revision {q.revision}
                  {company ? (
                    <>
                      <br />
                      <span lang={/\p{Script=Han}/u.test(company) ? 'zh' : undefined}>
                        {company}
                      </span>
                    </>
                  ) : null}
                  <br />
                  {q.currency}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((field) => (
            <tr key={field}>
              <th scope="row">{labels[field]}</th>
              {offers.map((q) => {
                const value = (q.terms as Record<string, string | undefined>)[field];
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
