import { DomainError } from '@corridra/domain';
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    if (!customerDeliveryEnabled())
      throw new DomainError('Account mission delivery are unavailable', 503);
    const s = foundations();
    if (!s) throw new DomainError('Account mission delivery are unavailable', 503);
    await s.ready;
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== s.config.APP_ORIGIN)
        throw new DomainError('Request origin is not allowed');
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        throw new DomainError('JSON required', 415);
      return Response.json(
        await s.customerAssignedMissions.accept(
          JSON.parse((await boundedBody(request, 16384)).toString('utf8')),
          request.headers.get('x-corridra-customer-subject') ?? undefined,
          request.headers.get('x-corridra-customer-issuer') ?? undefined,
        ),
        { headers: deliveryHeaders },
      );
    }
    return Response.json(
      await s.customerAssignedMissions.list(
        Object.fromEntries(new URL(request.url).searchParams),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError('Account mission delivery are unavailable', 503)
        : error,
    );
  }
}

export const GET = handle;
export const POST = handle;
