import { z } from 'zod';
import { currency, minorUnits } from './opportunities';
import { customerLabelAllowed } from './customer-input-mode';
import { DomainError } from './index';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine(customerLabelAllowed)
    .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v), 'Control characters are not allowed');
const amount = minorUnits.refine((v) => BigInt(v) <= BigInt(99999999999), 'Amount is too large');
export const arrangementModeLabels = {
  BUNDLED_SUPPLY: 'Bundled product or supply price',
  SEPARATE_FEE: 'Separate sourcing or facilitation fee',
  SUCCESS_COMMISSION: 'Success-based commission',
  HYBRID: 'Combined fees and commercial terms',
} as const;
export const arrangementPartyLabels = {
  buyer: 'Buyer',
  seller: 'Contracting seller',
  supplier: 'Supplier or manufacturer',
  serviceProvider: 'Service provider',
  serviceFeePayer: 'Service fee payer',
  serviceInvoiceIssuer: 'Service invoice issuer',
  servicePaymentRecipient: 'Service payment recipient',
  invoiceIssuer: 'Supply invoice issuer',
  paymentRecipient: 'Supply payment recipient',
  deliveryResponsible: 'Delivery responsibility',
  warrantyResponsible: 'Warranty and after-sales responsibility',
} as const;

export const commercialArrangement = z
  .object({
    version: z.literal(1),
    mode: z.enum(['BUNDLED_SUPPLY', 'SEPARATE_FEE', 'SUCCESS_COMMISSION', 'HYBRID']),
    parties: z
      .object({
        buyer: text(160),
        seller: text(160),
        supplier: text(160),
        serviceProvider: text(160),
        serviceFeePayer: text(160),
        serviceInvoiceIssuer: text(160),
        servicePaymentRecipient: text(160),
        invoiceIssuer: text(160),
        paymentRecipient: text(160),
        deliveryResponsible: text(160),
        warrantyResponsible: text(160),
        importerOfRecord: text(160).nullable(),
        operatingPartner: text(160).nullable(),
      })
      .strict(),
    // A quoted supply value belongs to the actual seller; it is never added to service-fee totals.
    supplyPrice: z
      .object({
        currency,
        amountMinor: amount,
        includedServices: text(500),
        exclusions: text(500),
      })
      .strict()
      .nullable(),
    // References, not duplicate amounts: existing quote components remain the only fixed service fees.
    fixedFeePositions: z
      .array(z.number().int().min(1).max(12))
      .max(12)
      .refine((v) => new Set(v).size === v.length, 'Reference each fee once'),
    commission: z
      .object({
        payer: text(160),
        recipient: text(160),
        trigger: text(500),
        baseDescription: text(300),
        baseMinor: amount,
        currency,
        rateBasisPoints: z.number().int().min(1).max(10000),
        evidenceRequired: text(500),
        rounding: z.literal('HALF_UP'),
        fixedFeeTreatment: z.enum(['NO_FIXED_FEE', 'ADDITIONAL', 'CREDIT_FIXED_FEE']),
      })
      .strict()
      .nullable(),
    sourceTerms: text(1000),
    // Representation does not establish legal approval or principal/seller authority.
    principalStatus: z.enum(['CORRIDRA_SERVICE_PROVIDER', 'PRINCIPAL_REVIEW_REQUIRED']),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      v.mode === 'BUNDLED_SUPPLY' &&
      (!v.supplyPrice || v.commission || v.fixedFeePositions.length)
    )
      issue('Bundled supply needs a supply price with no separate fee or commission');
    if (v.mode === 'SEPARATE_FEE' && (!v.fixedFeePositions.length || v.commission))
      issue('A separate fee needs referenced fixed fees and no commission');
    if (v.mode === 'SUCCESS_COMMISSION' && (!v.commission || v.fixedFeePositions.length))
      issue('A success commission needs its trigger and no fixed fee');
    if (v.mode === 'HYBRID' && !(v.fixedFeePositions.length && (v.commission || v.supplyPrice)))
      issue('Combined terms need fixed fees and a supply price or commission');
    if (
      v.commission &&
      v.fixedFeePositions.length > 0 !== (v.commission.fixedFeeTreatment !== 'NO_FIXED_FEE')
    )
      issue('State whether the commission adds to or credits the fixed fee');
  });
export type CommercialArrangement = z.infer<typeof commercialArrangement>;
export const internalSupplyEconomics = z
  .object({
    acquisitionCostMinor: amount,
    currency,
    markupBasisPoints: z.number().int().min(0).max(100000),
    relationshipNote: text(500),
  })
  .strict();
export type InternalSupplyEconomics = z.infer<typeof internalSupplyEconomics>;

// Exact derived estimates only. They do not earn, invoice, collect or pay any amount.
export function commissionEstimate(input: NonNullable<CommercialArrangement['commission']>) {
  const c = commercialArrangement.shape.commission.unwrap().parse(input);
  return (
    (BigInt(c.baseMinor) * BigInt(c.rateBasisPoints) + BigInt(5000)) /
    BigInt(10000)
  ).toString();
}
export function markedUpSupplyPrice(input: InternalSupplyEconomics) {
  const e = internalSupplyEconomics.parse(input);
  return (
    (BigInt(e.acquisitionCostMinor) * BigInt(10000 + e.markupBasisPoints) + BigInt(5000)) /
    BigInt(10000)
  ).toString();
}

export function validateArrangementFees(
  terms: CommercialArrangement,
  components: { kind: string; treatment: string; amountMinor: string | null }[],
  quoteCurrency: string,
) {
  const priced = components.flatMap((c, i) =>
    c.kind === 'service_fee' && c.amountMinor !== null && BigInt(c.amountMinor) > BigInt(0)
      ? [i + 1]
      : [],
  );
  if (
    priced.length !== terms.fixedFeePositions.length ||
    priced.some((p) => !terms.fixedFeePositions.includes(p))
  )
    throw new DomainError(
      'Reference every priced service fee exactly once in the commercial terms',
    );
  if (
    terms.commission?.fixedFeeTreatment === 'CREDIT_FIXED_FEE' &&
    terms.commission.currency !== quoteCurrency
  )
    throw new DomainError('A fixed-fee credit and commission need the same original currency');
  if (terms.principalStatus === 'PRINCIPAL_REVIEW_REQUIRED')
    throw new DomainError(
      'Corridra principal sales require separate legal and accounting approval',
    );
}
