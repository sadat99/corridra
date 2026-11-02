import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { foundations } from '../../../lib/foundations';
import { notificationsOn } from '../../../lib/notify';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  try {
    if (!notificationsOn() || !customerRequestsEnabled()) throw new DomainError('Not found', 404);
    const s = foundations();
    if (!s) throw new DomainError('Inbox is unavailable', 503);
    await s.ready;
    const context = [
      request.headers.get('x-corridra-customer-subject') ?? undefined,
      request.headers.get('x-corridra-customer-issuer') ?? undefined,
    ] as const;
    if (request.method === 'GET') {
      z.object({})
        .strict()
        .parse(Object.fromEntries(new URL(request.url).searchParams));
      return Response.json(await s.customerInbox.list(...context), { headers: deliveryHeaders });
    }
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const body = z
      .object({ id: z.uuid() })
      .strict()
      .parse(JSON.parse((await boundedBody(request, 1024)).toString('utf8')));
    return Response.json(
      { read: await s.customerInbox.markRead(body.id, ...context) },
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError('Inbox is unavailable', 503)
        : error,
    );
  }
}
export const GET = handle;
export const POST = handle;
