import { z } from 'zod';
import { countryCode } from '@corridra/domain/geography';
import { DomainError } from '@corridra/domain';
import { authorizeAiTask, dataRights } from '@corridra/domain/policy';
import { adapterId, secretRef, type InferenceAdapter } from './adapters';
import { registeredTask, taskId, taskInput, type TaskInput } from './registry';

const minor = z.string().regex(/^[1-9][0-9]{0,12}$/);
export const modelPolicy = z
  .object({
    id: z.uuid().toLowerCase(),
    version: z.number().int().positive(),
    adapter: adapterId,
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
    secretRef,
    approved: z.literal(true),
    evaluationStatus: z.enum(['SYNTHETIC_ONLY', 'APPROVED_PROVIDER']),
    evaluationSourceId: z.uuid().toLowerCase(),
    processingLocations: z.array(countryCode).min(1).max(20),
    tasks: z.array(taskId).min(1).max(12),
    fallbackPolicyIds: z.array(z.uuid().toLowerCase()).max(1).default([]),
    inputRateMinorPerMillion: minor,
    outputRateMinorPerMillion: minor,
    maxCostMinor: minor,
    currency: z.literal('USD'),
    effectiveUntil: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (v) => !v.model.split('/').some((s) => s === '.' || s === '..'),
    'Model path traversal is forbidden',
  )
  .refine(
    (v) =>
      v.secretRef ===
      (
        {
          openai: 'CORRIDRA_OPENAI_API_KEY',
          anthropic: 'CORRIDRA_ANTHROPIC_API_KEY',
          google: 'CORRIDRA_GOOGLE_API_KEY',
        } as const
      )[v.adapter],
    'Provider secret reference mismatch',
  );
export type ModelPolicy = z.infer<typeof modelPolicy>;
export type Source = {
  tenantId: string;
  sourceId: string;
  claimId: string;
  quote: string;
  rights: z.infer<typeof dataRights>;
};
export type Attempt = {
  policyId: string;
  model: string;
  adapter: string;
  promptVersion: string;
  evaluationSet: string;
  status: 'SUCCEEDED' | 'FAILED';
  inputTokens: number | null;
  outputTokens: number | null;
  reservedMinor: string;
  estimatedMinor: string | null;
  latencyMs: number;
  errorCode: string | null;
};
export interface GatewayStore {
  // Must authorize current source/claim/rights, current pinned mission policy and actor approval.
  authorize(
    input: TaskInput,
  ): Promise<{ tenantId: string; sources: Source[]; models: ModelPolicy[] }>;
  reserve(policy: ModelPolicy, worstCost: string): Promise<boolean>;
  record(attempt: Attempt, output?: unknown): Promise<void>;
}
export const estimatedCost = (input: number, output: number, p: ModelPolicy) => {
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0)
    throw new DomainError('Invalid provider usage');
  return (
    (BigInt(input) * BigInt(p.inputRateMinorPerMillion) +
      BigInt(output) * BigInt(p.outputRateMinorPerMillion) +
      BigInt(999999)) /
    BigInt(1000000)
  ).toString();
};
export function checkGrounding(output: unknown, sources: Source[]) {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if ('sourceId' in o && !sources.some((s) => s.sourceId === o.sourceId))
      throw new DomainError('Unknown source');
    if ('claimId' in o || 'quote' in o) {
      if (
        !sources.some(
          (s) =>
            s.sourceId === o.sourceId &&
            s.claimId === o.claimId &&
            typeof o.quote === 'string' &&
            s.quote.includes(o.quote),
        )
      )
        throw new DomainError('Unsupported factual quotation');
    }
    Object.values(o).forEach(visit);
  };
  visit(output);
}
export class IntelligenceGateway {
  constructor(
    private adapter: InferenceAdapter,
    private enabled: boolean,
  ) {}
  async execute(raw: unknown, store: GatewayStore) {
    if (!this.enabled) throw new DomainError('AI assistance is disabled', 503);
    const input = taskInput.parse(raw),
      task = registeredTask(input.task);
    const context = await store.authorize(input);
    if (
      !context.sources.length ||
      context.sources.length !== input.claimIds.length ||
      input.claimIds.some((id) => !context.sources.some((s) => s.claimId === id))
    )
      throw new DomainError('Authorized claims required');
    const prompt = JSON.stringify({
      task: input.task,
      targetLanguage: input.targetLanguage,
      untrustedSources: context.sources.map((s) => ({
        sourceId: s.sourceId,
        claimId: s.claimId,
        quote: s.quote,
      })),
    });
    const inputCeiling =
      Buffer.byteLength(prompt + task.system + JSON.stringify(z.toJSONSchema(task.schema))) + 4096;
    if (inputCeiling > task.maxInputBytes) throw new DomainError('Task input exceeds limit', 413);
    // Public classification alone does not make contact information approved model input.
    if (
      context.sources.some(
        (s) =>
          /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(s.quote) ||
          /(?:\+\d[\d ()-]{7,}\d|\b(?:phone|tel|mobile|whatsapp)\s*[:=]?\s*\d[\d ()-]{6,}\d)/i.test(
            s.quote,
          ) ||
          s.rights.subjectLocations.length > 0,
      )
    )
      throw new DomainError('Personal contact data is not supported');
    for (const source of context.sources)
      if (source.rights.sourceId !== source.sourceId)
        throw new DomainError('Source rights mismatch');
    const started = Date.now();
    let reservedTotal = BigInt(0);
    const totalCeiling = BigInt(modelPolicy.parse(context.models[0]).maxCostMinor);
    for (const rawPolicy of context.models.slice(0, task.maxAttempts)) {
      const p = modelPolicy.parse(rawPolicy);
      if (Date.parse(p.effectiveUntil) <= Date.now() || !p.tasks.includes(input.task))
        throw new DomainError('Model policy is not current or eligible');
      for (const source of context.sources) {
        authorizeAiTask(
          {
            tenantId: context.tenantId,
            sourceTenantId: source.tenantId,
            task: input.task === 'translation' ? 'DRAFT' : 'EXTRACT',
            providerApproved: p.approved,
            humanApproved: true,
            routeReady: true,
            requestedTools: [...task.tools],
            allowedTools: [...task.tools],
          },
          source.rights,
        );
        if (
          p.processingLocations.some(
            (location) =>
              !source.rights.processingLocations.some((approved) => approved === location),
          )
        )
          throw new DomainError('Provider processing region is not approved');
      }
      const remainingBeforeReservation = task.timeoutMs - (Date.now() - started);
      if (remainingBeforeReservation <= 0) break;
      if (this.adapter.ready && !this.adapter.ready(p)) continue;
      const worst = estimatedCost(inputCeiling, task.maxOutputTokens, p);
      if (
        reservedTotal + BigInt(worst) > totalCeiling ||
        BigInt(worst) > BigInt(p.maxCostMinor) ||
        !(await store.reserve(p, worst))
      )
        continue;
      reservedTotal += BigInt(worst);
      const remaining = task.timeoutMs - (Date.now() - started);
      if (remaining <= 0) {
        await store.record({
          policyId: p.id,
          model: p.model,
          adapter: p.adapter,
          promptVersion: task.promptVersion,
          evaluationSet: task.evaluationSet,
          status: 'FAILED',
          inputTokens: 0,
          outputTokens: 0,
          reservedMinor: worst,
          estimatedMinor: '0',
          latencyMs: 0,
          errorCode: 'DEADLINE_BEFORE_INFERENCE',
        });
        break;
      }
      const at = Date.now();
      let result;
      try {
        // Enforce timeout even when an injected adapter ignores AbortSignal.
        const signal = AbortSignal.timeout(remaining);
        result = await Promise.race([
          this.adapter.generate({
            adapter: p.adapter,
            model: p.model,
            secretRef: p.secretRef,
            schema: task.schema,
            system: task.system,
            prompt,
            maxOutputTokens: task.maxOutputTokens,
            signal,
          }),
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(new Error('TIMEOUT')), { once: true }),
          ),
        ]);
        const output = task.schema.parse(result.output);
        checkGrounding(output, context.sources);
        if (result.outputTokens > task.maxOutputTokens || result.inputTokens > inputCeiling)
          throw new Error('USAGE_CAP_EXCEEDED');
        const cost = estimatedCost(result.inputTokens, result.outputTokens, p);
        await store.record(
          {
            policyId: p.id,
            model: p.model,
            adapter: p.adapter,
            promptVersion: task.promptVersion,
            evaluationSet: task.evaluationSet,
            status: 'SUCCEEDED',
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            reservedMinor: worst,
            estimatedMinor: cost,
            latencyMs: Date.now() - at,
            errorCode: null,
          },
          output,
        );
        return {
          output,
          policyId: p.id,
          policyVersion: p.version,
          promptVersion: task.promptVersion,
          estimatedCostMinor: cost,
          currency: p.currency,
        };
      } catch {
        // Never store provider error text: it may contain request bodies or credentials.
        await store.record({
          policyId: p.id,
          model: p.model,
          adapter: p.adapter,
          promptVersion: task.promptVersion,
          evaluationSet: task.evaluationSet,
          status: 'FAILED',
          inputTokens: result?.inputTokens ?? null,
          outputTokens: result?.outputTokens ?? null,
          reservedMinor: worst,
          estimatedMinor: null,
          latencyMs: Date.now() - at,
          errorCode: 'INFERENCE_OR_VALIDATION_FAILED',
        });
      }
    }
    return {
      output: null,
      fallback: 'MANUAL_REVIEW' as const,
      message: 'AI assistance is unavailable. Continue with the existing review workflow.',
    };
  }
}
