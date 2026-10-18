import { DomainError } from '@corridra/domain';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function services() {
  if (!customerRequestsEnabled()) throw new DomainError('Customer requests are unavailable', 503);
  const services = foundations();
  if (!services) throw new DomainError('Customer requests are unavailable', 503);
  await services.ready;
  return services;
}
function failure(error: unknown) {
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError('Customer requests are unavailable', 503));
  return deliveryError(error);
}
export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(
      await s.customerRequests.list(
        Object.fromEntries(new URL(request.url).searchParams),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 20000)).toString('utf8'));
    return Response.json(
      await s.customerRequests.submit(
        input,
        (context, brief) => s.missions.prepareCustomerIntake(context, brief),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
