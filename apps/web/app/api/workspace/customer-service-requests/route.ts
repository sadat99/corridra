import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { foundations } from '../../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const unavailable = 'Paid-service requests are unavailable';
// Staff side. Authority is the staff session (owner or admin with a fresh authenticator check); the workspace
// comes from the query and is checked by the database, never trusted.
async function handle(request: Request) {
  try {
    if (!customerServiceRequestsEnabled()) throw new DomainError(unavailable, 503);
    deliveryEnabled();
    const s = foundations();
    if (!s) throw new DomainError(unavailable, 503);
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const query = new URL(request.url).searchParams;
    const ctx = {
      token: identity.token,
      tenantId: z.uuid().parse(query.get('tenant')),
      purpose: 'synthetic_validation',
    };
    if (request.method === 'GET') {
      const scope = query.get('scope') ?? 'list';
      const body =
        scope === 'catalogue'
          ? await s.customerServiceStaff.catalogue(ctx)
          : scope === 'detail'
            ? await s.customerServiceStaff.view(ctx, z.uuid().parse(query.get('request')))
            : scope === 'list'
              ? await s.customerServiceStaff.list(ctx, {
                  ...(query.get('after') ? { after: query.get('after') } : {}),
                })
              : null;
      if (body === null) throw new DomainError('Unknown scope', 400);
      return Response.json(body, { headers: deliveryHeaders });
    }
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = JSON.parse((await boundedBody(request, 16384)).toString('utf8')) as Record<
      string,
      unknown
    >;
    // A catalogue change is its own command shape; every other action is a request command.
    const { action, ...rest } = input;
    const result =
      action === 'catalogue'
        ? await s.customerServiceStaff.reviseCatalogue(ctx, rest)
        : await s.customerServiceStaff.command(ctx, input);
    return Response.json(result, { headers: deliveryHeaders });
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError(unavailable, 503)
        : error,
    );
  }
}
export const GET = handle;
export const POST = handle;
