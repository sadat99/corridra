import { displayMoney } from '@corridra/domain/locale';

const labels: Record<string, string> = {
  product: 'Product or equipment',
  specifications: 'Specification',
  moq: 'Minimum order quantity',
  oemOdm: 'Custom manufacturing',
  budgetMinor: 'Budget',
  budgetBasis: 'Budget basis',
  incoterm: 'Delivery term (Incoterm)',
  machinery: 'Machinery requirements',
};
export function SpecificationFields({ fields }: { fields: Record<string, unknown> }) {
  return (
    <dl>
      {Object.entries(fields)
        .filter(([key]) => key !== 'currency' || fields.budgetMinor === undefined)
        .map(([key, value]) => (
          <div key={key} className="ux-fact-row">
            <dt>
              {labels[key] ??
                key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())}
            </dt>
            <dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {value && typeof value === 'object' && !Array.isArray(value) ? (
                <SpecificationFields fields={value as Record<string, unknown>} />
              ) : key === 'budgetMinor' && typeof fields.currency === 'string' ? (
                displayMoney(String(value), fields.currency)
              ) : Array.isArray(value) ? (
                value.join('; ')
              ) : (
                String(value)
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
