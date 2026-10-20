import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { foundations } from '../../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff review of company link requests. The operator session, the reviewer roles and the fresh
// authenticator check are the existing ones; customers never reach this path.
async function handle(request: Request) {
  try {
    if (!customerOrganisationLinksEnabled())
      throw new DomainError('Company link review is unavailable', 503);
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
    if (request.method === 'GET') {
      const claim = query.get('claim');
      if (claim)
        return Response.json(await s.staffOrganisationLinks.review(ctx, z.uuid().parse(claim)), {
          headers: deliveryHeaders,
        });
      return Response.json(
        await s.staffOrganisationLinks.queue(ctx, {
          ...(query.get('scope') ? { scope: query.get('scope') } : {}),
          ...(query.get('after') ? { after: query.get('after') } : {}),
          ...(query.get('pageSize') ? { pageSize: query.get('pageSize') } : {}),
        }),
        { headers: deliveryHeaders },
      );
    }
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    return Response.json(
      await s.staffOrganisationLinks.decide(
        ctx,
        JSON.parse((await boundedBody(request, 8192)).toString('utf8')),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError('Company link review is unavailable', 503)
        : error,
    );
  }
}
export const GET = handle;
export const POST = handle;
