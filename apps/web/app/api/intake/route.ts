import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function POST(request: Request) {
  try {
    const s = foundations();
    if (!s) throw new DomainError('Intake is unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    // Vercel overwrites x-vercel-forwarded-for. Do not trust caller-selected XFF.
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError('Brief required', 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new DomainError('Brief is too large', 413);
      }
      chunks.push(value);
    }
    const v = z
      .object({ key: z.uuid(), brief: z.unknown(), websiteCheck: z.literal('') })
      .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return Response.json(await s.missions.submit(v.key, v.brief), { status: 201, headers });
  } catch (e) {
    const status =
      e instanceof DomainError
        ? e.status
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : (e as { code?: string }).code === '23514'
            ? 409
            : 500;
    return Response.json(
      {
        error:
          e instanceof DomainError
            ? e.message
            : status === 400
              ? 'Check the highlighted fields'
              : status === 409
                ? 'This brief changed after submission. Start a new brief.'
                : 'Intake could not be saved. Your input is still here.',
        fields: e instanceof z.ZodError ? z.flattenError(e).fieldErrors : undefined,
      },
      { status, headers },
    );
  }
}
