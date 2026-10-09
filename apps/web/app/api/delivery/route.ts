import { DomainError } from '@corridra/domain';
import { publicDeliveryInput } from '@corridra/domain/delivery';
import { foundations } from '../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    deliveryEnabled();
    const s = foundations();
    if (!s) throw new DomainError('Delivery unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = publicDeliveryInput.parse(
      JSON.parse((await boundedBody(request, 8192)).toString('utf8')),
    );
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.delivery.budget(client, input.token);
    const result = await s.delivery.external(input);
    if ('bytes' in result) {
      const bytes = result.bytes;
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          const next = bytes.subarray(offset, offset + 65536);
          offset += next.length;
          controller.enqueue(new Uint8Array(next));
        },
      });
      return new Response(stream, {
        headers: {
          ...deliveryHeaders,
          'Content-Type': result.format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/pdf',
          'Content-Disposition': `attachment; filename="corridra-programme.${result.format.toLowerCase()}"`,
        },
      });
    }
    return Response.json(result, { headers: deliveryHeaders });
  } catch (error) {
    return deliveryError(error);
  }
}
export function GET() {
  return Response.json(
    { error: 'Open your approved private link' },
    { status: 405, headers: { ...deliveryHeaders, Allow: 'POST' } },
  );
}
export const HEAD = GET;
