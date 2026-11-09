import { DomainError } from '@corridra/domain';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { archivedWorkspaceRefusal } from '@corridra/auth/customer-workspace-lifecycle';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function services() {
  if (!customerWorkspacesEnabled())
    throw new DomainError('Customer workspaces are unavailable', 503);
  const service = foundations();
  if (!service) throw new DomainError('Customer workspaces are unavailable', 503);
  await service.ready;
  return service;
}
// An archived workspace says so, with the code archived, instead of the generic try-again answer.
function failure(error: unknown) {
  const archived = archivedWorkspaceRefusal(error);
  if (archived)
    return Response.json(
      { error: archived.message, code: archived.code },
      { status: archived.status, headers: deliveryHeaders },
    );
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError('Customer workspaces are unavailable', 503));
  return deliveryError(error);
}
export async function GET(request: Request) {
  try {
    const service = await services();
    const result = await service.customerWorkspaces.listAccess(
      Object.fromEntries(new URL(request.url).searchParams),
      request.headers.get('x-corridra-customer-subject') ?? undefined,
      request.headers.get('x-corridra-customer-issuer') ?? undefined,
    );
    return Response.json(result, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const service = await services();
    if (request.headers.get('origin') !== service.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    const result = await service.customerWorkspaces.access(
      input,
      request.headers.get('x-corridra-customer-subject') ?? undefined,
      request.headers.get('x-corridra-customer-issuer') ?? undefined,
    );
    return Response.json(result, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
