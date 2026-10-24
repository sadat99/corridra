import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerInvoicingEnabled } from '@corridra/auth/customer-invoicing';
import {
  customerRealInvoicingEnabled,
  realInvoicingOffMessage,
} from '@corridra/auth/customer-invoicing-real';
import { foundations } from '../../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const unavailable = 'Plans are unavailable';
// Staff side. Authority is the staff session (owner or admin with a fresh authenticator check); the workspace
// comes from the query and is checked by the database, never trusted.
async function handle(request: Request) {
  try {
    if (!customerBillingEnabled()) throw new DomainError(unavailable, 503);
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
    // Real invoices (ADR-064) are their own namespace: ?invoicing=real. Their command names overlap the sample ones.
    const real = query.get('invoicing') === 'real';
    if (real && !customerRealInvoicingEnabled())
      throw new DomainError(realInvoicingOffMessage, 503);
    if (request.method === 'GET') {
      const scope = query.get('scope') ?? 'list';
      if (real) {
        const body =
          scope === 'pending'
            ? await s.customerRealInvoicingStaff.pending(ctx)
            : scope === 'invoices'
              ? await s.customerRealInvoicingStaff.list(ctx, {
                  ...(query.get('after') ? { after: query.get('after') } : {}),
                })
              : scope === 'invoice'
                ? await s.customerRealInvoicingStaff.view(
                    ctx,
                    z.uuid().parse(query.get('invoiceId')),
                  )
                : null;
        if (body === null) throw new DomainError('Unknown scope', 400);
        return Response.json(body, { headers: deliveryHeaders });
      }
      // Sample invoices have their own switch on top of the billing switch.
      if (['pending', 'invoices', 'invoice'].includes(scope) && !customerInvoicingEnabled())
        throw new DomainError(unavailable, 503);
      const body =
        scope === 'pending'
          ? await s.customerInvoicingStaff.pending(ctx)
          : scope === 'invoices'
            ? await s.customerInvoicingStaff.list(ctx, {
                ...(query.get('after') ? { after: query.get('after') } : {}),
              })
            : scope === 'invoice'
              ? await s.customerInvoicingStaff.view(ctx, z.uuid().parse(query.get('invoiceId')))
              : scope === 'plans'
                ? await s.customerBillingStaff.plans(ctx)
                : scope === 'detail'
                  ? await s.customerBillingStaff.view(
                      ctx,
                      z.uuid().parse(query.get('subscription')),
                    )
                  : scope === 'list'
                    ? await s.customerBillingStaff.list(ctx, {
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
    if (real)
      return Response.json(await s.customerRealInvoicingStaff.command(ctx, input), {
        headers: deliveryHeaders,
      });
    // A plan change is its own command shape; every other action is a subscription command.
    const { action, ...rest } = input;
    const invoicing = action === 'issue' || action === 'payment' || action === 'credit';
    if (invoicing && !customerInvoicingEnabled()) throw new DomainError(unavailable, 503);
    const result = invoicing
      ? await s.customerInvoicingStaff.command(ctx, input)
      : action === 'plan'
        ? await s.customerBillingStaff.revisePlan(ctx, rest)
        : await s.customerBillingStaff.command(ctx, input);
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
