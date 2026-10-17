import { DomainError } from '@corridra/domain';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function services() {
  if (!customerWorkspacesEnabled())
    throw new DomainError('Customer workspaces are unavailable', 503);
  const services = foundations();
  if (!services) throw new DomainError('Customer workspaces are unavailable', 503);
  await services.ready;
  return services;
}
function failure(error: unknown) {
  // Missing optional schema/provider is availability, never successful signup.
  if (
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '') ||
    (error instanceof Error && error.message === 'Customer identity is unavailable')
  )
    return deliveryError(new DomainError('Customer workspaces are unavailable', 503));
  return deliveryError(error);
}
export async function GET() {
  try {
    const s = await services();
    return Response.json(
      { workspaces: await s.customerWorkspaces.list(), synthetic: true },
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
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    return Response.json(await s.customerWorkspaces.provision(input), { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
