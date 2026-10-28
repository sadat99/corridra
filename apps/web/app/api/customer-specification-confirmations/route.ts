import { DomainError } from '@corridra/domain';
import { customerSpecificationConfirmationEnabled } from '@corridra/auth/customer-specification-confirmation';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    if (!customerSpecificationConfirmationEnabled())
      throw new DomainError('Specification confirmation is unavailable', 503);
    const s = foundations();
    if (!s) throw new DomainError('Specification confirmation is unavailable', 503);
    await s.ready;
    const subject = request.headers.get('x-corridra-customer-subject') ?? undefined;
    const issuer = request.headers.get('x-corridra-customer-issuer') ?? undefined;
    if (request.method === 'GET')
      return Response.json(
        await s.customerSpecificationConfirmations.read(
          new URL(request.url).searchParams.get('resourceId'),
          subject,
          issuer,
        ),
        { headers: deliveryHeaders },
      );
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    return Response.json(
      await s.customerSpecificationConfirmations.confirm(
        JSON.parse((await boundedBody(request, 8192)).toString('utf8')),
        subject,
        issuer,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError('Specification confirmation is unavailable', 503)
        : error,
    );
  }
}
export const GET = handle;
export const POST = handle;
