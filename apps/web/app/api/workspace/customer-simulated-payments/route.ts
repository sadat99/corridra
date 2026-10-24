import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  customerSimulatedPaymentsEnabled,
  simulatedPaymentsOffMessage,
} from '@corridra/auth/customer-payments-simulated';
import { foundations } from '../../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Staff side of the simulated provider (ADR-065). Authority is the staff session (owner or admin with a fresh
// authenticator check); the workspace comes from the query and is checked by the database, never trusted.
async function handle(request: Request) {
  try {
    if (!customerSimulatedPaymentsEnabled())
      throw new DomainError(simulatedPaymentsOffMessage, 503);
    deliveryEnabled();
    const s = foundations();
    if (!s) throw new DomainError(simulatedPaymentsOffMessage, 503);
    await s.ready;
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
        await s.customerSimulatedPaymentsStaff.list(ctx, {
          ...(query.get('after') ? { after: query.get('after') } : {}),
        }),
        { headers: deliveryHeaders },
      );
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    return Response.json(await s.customerSimulatedPaymentsStaff.command(ctx, input), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError(simulatedPaymentsOffMessage, 503)
        : error,
    );
  }
}
export const GET = handle;
export const POST = handle;
