import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

export const adapterId = z.enum(['openai', 'anthropic', 'google']);
export const secretRef = z.enum([
  'CORRIDRA_OPENAI_API_KEY',
  'CORRIDRA_ANTHROPIC_API_KEY',
  'CORRIDRA_GOOGLE_API_KEY',
]);
export type AdapterRequest = {
  adapter: z.infer<typeof adapterId>;
  model: string;
  secretRef: z.infer<typeof secretRef>;
  schema: z.ZodType;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
};
export type AdapterResponse = { output: unknown; inputTokens: number; outputTokens: number };
export interface InferenceAdapter {
  ready?(policy: {
    adapter: z.infer<typeof adapterId>;
    secretRef: z.infer<typeof secretRef>;
    evaluationStatus?: string;
    processingLocations?: string[];
  }): boolean;
  generate(request: AdapterRequest): Promise<AdapterResponse>;
}
const refs = {
  openai: 'CORRIDRA_OPENAI_API_KEY',
  anthropic: 'CORRIDRA_ANTHROPIC_API_KEY',
  google: 'CORRIDRA_GOOGLE_API_KEY',
} as const;
// No configurable URL, arbitrary provider options, model tools, telemetry or raw responses.
export class SdkInferenceAdapter implements InferenceAdapter {
  constructor(
    private secrets: Readonly<Record<string, string | undefined>> = process.env,
    private transport?: typeof fetch,
    private allowSyntheticEvaluation = false,
  ) {}
  ready(p: {
    adapter: z.infer<typeof adapterId>;
    secretRef: z.infer<typeof secretRef>;
    evaluationStatus?: string;
    processingLocations?: string[];
  }) {
    const configured =
      this.secrets['CORRIDRA_' + p.adapter.toUpperCase() + '_PROCESSING_LOCATIONS']
        ?.split(',')
        .map((s) => s.trim()) ?? [];
    const regionReady =
      (this.allowSyntheticEvaluation && p.evaluationStatus === 'SYNTHETIC_ONLY') ||
      (!!p.processingLocations?.length &&
        p.processingLocations.every((c) => configured.includes(c)));
    return (
      regionReady &&
      (p.evaluationStatus === 'APPROVED_PROVIDER' ||
        (this.allowSyntheticEvaluation && p.evaluationStatus === 'SYNTHETIC_ONLY')) &&
      p.secretRef === refs[p.adapter] &&
      !!this.secrets[p.secretRef]
    );
  }
  async generate(r: AdapterRequest): Promise<AdapterResponse> {
    const apiKey = this.secrets[r.secretRef];
    if (r.secretRef !== refs[r.adapter] || !apiKey) throw new Error('PROVIDER_NOT_READY');
    if (
      Object.values(refs).some((ref) => this.secrets[ref] && r.prompt.includes(this.secrets[ref]!))
    )
      throw new Error('SECRET_IN_TASK_INPUT');
    const boundedTransport: typeof fetch = async (input, init) => {
      const response = await (this.transport ?? fetch)(input, init);
      if (!response.body) return response;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 262144) {
          await reader.cancel();
          throw new Error('PROVIDER_RESPONSE_LIMIT');
        }
        chunks.push(chunk.value);
      }
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(Buffer.concat(chunks), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
    const model =
      r.adapter === 'openai'
        ? createOpenAI({ apiKey, fetch: boundedTransport }).chat(r.model)
        : r.adapter === 'anthropic'
          ? createAnthropic({ apiKey, fetch: boundedTransport })(r.model)
          : createGoogleGenerativeAI({ apiKey, fetch: boundedTransport })(r.model);
    const result = await generateText({
      model,
      output: Output.object({ schema: r.schema }),
      system: r.system,
      prompt: r.prompt,
      maxOutputTokens: r.maxOutputTokens,
      maxRetries: 0,
      abortSignal: r.signal,
    });
    if (result.toolCalls.length) throw new Error('TOOLS_FORBIDDEN');
    const inputTokens = result.totalUsage.inputTokens;
    const outputTokens = result.totalUsage.outputTokens;
    if (
      inputTokens === undefined ||
      outputTokens === undefined ||
      !Number.isSafeInteger(inputTokens) ||
      !Number.isSafeInteger(outputTokens) ||
      inputTokens < 0 ||
      outputTokens < 0
    )
      throw new Error('USAGE_UNAVAILABLE');
    if (JSON.stringify(result.output).includes(apiKey!))
      throw new Error('SECRET_IN_PROVIDER_OUTPUT');
    return { output: result.output, inputTokens, outputTokens };
  }
}
