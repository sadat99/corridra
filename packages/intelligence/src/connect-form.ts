import { z } from 'zod';
import { countryCode } from '@corridra/domain/geography';
import { adapterId, adapterSecretRef } from './adapters';
import { modelPolicy } from './index';
import { taskId } from './registry';

// ADR-089. The guided Connect AI command. Takes plain form input and builds, on the server, exactly the model policy command
// that IntelligenceService.configure already accepts. The person never types JSON, never sends a key name or a key, and never
// sends processing locations for a market: "EU" is a market key that the service resolves from stored data inside the
// transaction. Nothing here switches AI on.
export const connectLocationLimit = 30;
export const legacyLocationLimit = 20;
const minor = z.string().regex(/^[1-9][0-9]{0,12}$/);
export const processingScope = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('countries'),
      codes: z
        .array(countryCode)
        .min(1)
        .max(connectLocationLimit)
        .refine((codes) => new Set(codes).size === codes.length, 'Each country once'),
    })
    .strict(),
  z.object({ kind: z.literal('market'), key: z.literal('EU') }).strict(),
]);
export const guidedConnection = z
  .object({
    adapter: adapterId,
    model: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/)
      .refine((m) => !m.split('/').some((s) => s === '.' || s === '..'), 'Check the model name'),
    evaluationStatus: z.enum(['SYNTHETIC_ONLY', 'APPROVED_PROVIDER']),
    processingScope,
    termsSourceId: z.uuid().toLowerCase(),
    evaluationSourceId: z.uuid().toLowerCase(),
    inputRateMinorPerMillion: minor,
    outputRateMinorPerMillion: minor,
    maxCostMinor: minor,
    dailyBudgetMinor: z
      .string()
      .regex(/^[1-9][0-9]{0,5}$/)
      .refine((v) => Number(v) <= 100000, 'At most 1,000.00 USD a day'),
    effectiveUntil: z.iso.datetime({ offset: true }),
    tasks: z
      .array(taskId)
      .min(1)
      .max(12)
      .refine((tasks) => new Set(tasks).size === tasks.length, 'Each task once'),
    fallbackPolicyId: z.uuid().toLowerCase().optional(),
    reason: z.string().trim().min(3).max(500),
    expectedVersion: z.number().int().min(0),
    confirmed: z.literal(true),
  })
  .strict();
export type GuidedConnection = z.infer<typeof guidedConnection>;

// Returns exactly the configure command. The server supplies the identifier, the version, the effective time, the resolved
// country codes and the key name derived from the provider.
export function connectionCommand(
  input: GuidedConnection,
  server: { id: string; version: number; processingLocations: string[]; effectiveFrom: string },
) {
  if (Date.parse(input.effectiveUntil) <= Date.parse(server.effectiveFrom))
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'Valid until must be in the future',
      },
    ]);
  return {
    policy: modelPolicy.parse({
      id: server.id,
      version: server.version,
      adapter: input.adapter,
      model: input.model,
      secretRef: adapterSecretRef[input.adapter],
      approved: true,
      evaluationStatus: input.evaluationStatus,
      evaluationSourceId: input.evaluationSourceId,
      processingLocations: server.processingLocations,
      tasks: input.tasks,
      fallbackPolicyIds: input.fallbackPolicyId ? [input.fallbackPolicyId] : [],
      inputRateMinorPerMillion: input.inputRateMinorPerMillion,
      outputRateMinorPerMillion: input.outputRateMinorPerMillion,
      maxCostMinor: input.maxCostMinor,
      currency: 'USD',
      effectiveUntil: input.effectiveUntil,
    }),
    key: `connect-${input.adapter}`,
    termsSourceId: input.termsSourceId,
    dailyBudgetMinor: input.dailyBudgetMinor,
    effectiveFrom: server.effectiveFrom,
    reason: input.reason,
  };
}
