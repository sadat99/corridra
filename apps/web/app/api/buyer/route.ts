import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { buyerRequest } from '@corridra/domain/access';
import { foundations } from '../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function POST(request: Request) {
  try {
    const s = foundations();
    if (!s) throw new DomainError('Private introductions are unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError('Request body required', 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) {
        await reader.cancel();
        throw new DomainError('Request is too large', 413);
      }
      chunks.push(value);
    }
    const input = buyerRequest.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.communications.budget(client, input.token);
    return Response.json(await s.communications.buyer(input), { headers });
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
            : status === 409
              ? 'A response was already recorded for this link.'
              : status === 400
                ? 'Check the submitted values'
                : 'The response could not be completed. Please try again.',
      },
      { status, headers },
    );
  }
}
export function GET() {
  return Response.json(
    { error: 'Use the private introduction page' },
    { status: 405, headers: { ...headers, Allow: 'POST' } },
  );
}
export const HEAD = GET;
