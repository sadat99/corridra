import { z } from 'zod';
import { currency, minorUnits } from './opportunities';
import { DomainError } from './index';
export const serviceEntry = z
  .object({
    id: z.uuid(),
    missionId: z.uuid(),
    kind: z.enum(['SERVICE_FEE', 'DELIVERY_COST', 'CONTRIBUTOR_REWARD']),
    amountMinor: minorUnits,
    currency,
    sourceId: z.uuid(),
    contributionId: z.uuid().optional(),
    ruleId: z.uuid().optional(),
    externalReference: z.string().trim().min(3).max(200),
    occurredAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((v) =>
    v.kind === 'CONTRIBUTOR_REWARD'
      ? Boolean(v.contributionId && v.ruleId)
      : !v.contributionId && !v.ruleId,
  );
// Derived reporting only: original ledger currency and amount are never replaced.
export const fxObservation = z
  .object({
    source: z.string().min(3).max(200),
    observedAt: z.iso.datetime({ offset: true }),
    from: currency,
    to: currency,
    numerator: minorUnits,
    denominator: minorUnits,
    method: z.literal('RATIONAL_HALF_UP'),
  })
  .strict();
export function deriveConversion(amountMinor: string, input: unknown) {
  const fx = fxObservation.parse(input),
    amount = BigInt(minorUnits.parse(amountMinor));
  const n = amount * BigInt(fx.numerator),
    d = BigInt(fx.denominator);
  return {
    amountMinor: ((2n * n + d) / (2n * d)).toString(),
    currency: fx.to,
    fx,
    authority: 'DERIVED_ONLY' as const,
  };
}
export function sumSameCurrency(entries: { amountMinor: string; currency: string }[]) {
  const currencies = new Set(entries.map((e) => e.currency));
  if (currencies.size !== 1) throw new DomainError('A single currency is required');
  return {
    currency: currency.parse(entries[0].currency),
    amountMinor: entries
      .reduce((s, e) => s + BigInt(minorUnits.parse(e.amountMinor)), 0n)
      .toString(),
  };
}
