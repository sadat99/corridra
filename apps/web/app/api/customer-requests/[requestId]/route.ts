import { DomainError } from '@corridra/domain';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { foundations } from '../../../../lib/foundations';
import { deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    if (!customerRequestDetailsEnabled())
      throw new DomainError('Customer requests are unavailable', 503);
    const services = foundations();
    if (!services) throw new DomainError('Customer requests are unavailable', 503);
    await services.ready;
    return Response.json(
      await services.customerRequestDetails.detail(
        (await params).requestId,
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
      return deliveryError(new DomainError('Customer requests are unavailable', 503));
    return deliveryError(error);
  }
}
