import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerSpecificationConfirmationEnabled } from '@corridra/auth/customer-specification-confirmation';
import { foundations } from '../../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    if (!customerSpecificationConfirmationEnabled())
      throw new DomainError('Specification confirmation is unavailable', 503);
    deliveryEnabled();
    const s = foundations();
    if (!s) throw new DomainError('Workspace unavailable', 503);
    await s.ready;
    if (request.method === 'POST' && request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const query = new URL(request.url).searchParams;
    const ctx = {
      token: identity.token,
      tenantId: z.uuid().parse(query.get('tenant')),
      purpose: 'synthetic_validation',
    };
    if (request.method === 'GET')
      return Response.json(
        await s.specificationConfirmations.options(ctx, query.get('publicationId')),
        { headers: deliveryHeaders },
      );
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    return Response.json(
      await s.specificationConfirmations.request(
        ctx,
        JSON.parse((await boundedBody(request, 8192)).toString('utf8')),
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
