import { z } from 'zod';
import { DomainError } from '@corridra/domain';
export const deliveryHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function boundedBody(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('Request body required', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new DomainError('Request is too large', 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export function deliveryEnabled() {
  if (process.env.CORRIDRA_DELIVERY_ENABLED !== 'true')
    throw new DomainError('Client and programme delivery is unavailable', 503);
}
export function deliveryError(error: unknown) {
  const code = (error as { code?: string }).code;
  const status =
    error instanceof DomainError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : code === '42501'
          ? 403
          : ['23514', '23503', '23505', '22007', '22P02'].includes(code ?? '')
            ? 409
            : 500;
  return Response.json(
    {
      error:
        error instanceof DomainError
          ? error.message
          : status === 403
            ? 'Access denied or link unavailable'
            : status === 400
              ? 'Check the submitted values'
              : status === 409
                ? 'The request conflicts with the current scope or state. Refresh and review it again.'
                : 'The request could not be completed. Please try again.',
    },
    { status, headers: deliveryHeaders },
  );
}
