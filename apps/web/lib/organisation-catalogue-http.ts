import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import type { RequestContext } from '@corridra/db';
import { foundations } from './foundations';
import { boundedBody, deliveryEnabled, deliveryError } from './delivery-http';

// The shared door of the staff routes for source rights, takedown, claim redaction and the closed-claims lookup
// (ADR-079 slice B). They use the operator session and the delivery switch, never the customer link switch.
export async function staffCatalogueDoor(request: Request) {
  deliveryEnabled();
  const s = foundations();
  if (!s) throw new DomainError('Workspace unavailable', 503);
  await s.ready;
  if (request.method === 'POST' && request.headers.get('origin') !== s.config.APP_ORIGIN)
    throw new DomainError('Request origin is not allowed');
  const identity = await s.provider.getSession(request.headers);
  if (!identity) throw new DomainError('Sign in to continue', 401);
  const query = new URL(request.url).searchParams;
  const ctx: RequestContext = {
    token: identity.token,
    tenantId: z.uuid().parse(query.get('tenant')),
    purpose: 'synthetic_validation',
  };
  return { s, ctx, query };
}
export async function staffCatalogueBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new DomainError('JSON required', 415);
  return JSON.parse((await boundedBody(request, 8192)).toString('utf8')) as unknown;
}
// A database that does not have the 0021 functions yet answers 503, never a 500.
export function staffCatalogueError(error: unknown, unavailable: string) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError(unavailable, 503)
      : error,
  );
}
