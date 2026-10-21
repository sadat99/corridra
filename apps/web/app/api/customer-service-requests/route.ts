import { DomainError } from '@corridra/domain';
import {
  customerServiceCommandInput,
  customerServiceRequestsEnabled,
} from '@corridra/auth/customer-service-requests';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerServiceRequestsEnabled())
    throw new DomainError('Help requests are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Help requests are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Help requests are unavailable', 503)
      : error,
  );
}
function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
// Reads: ?scope=catalogue, ?scope=list&workspaceId=..., ?scope=detail&workspaceId=...&requestId=...
export async function GET(request: Request) {
  try {
    const s = await services(),
      { scope, ...query } = Object.fromEntries(new URL(request.url).searchParams);
    const body =
      scope === 'catalogue'
        ? await s.customerServiceRequests.catalogue(...context(request))
        : scope === 'detail'
          ? await s.customerServiceRequests.view(query, ...context(request))
          : scope === 'list' || scope === undefined
            ? await s.customerServiceRequests.list(query, ...context(request))
            : null;
    if (body === null) throw new DomainError('Unknown scope', 400);
    return Response.json(body, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
// Every change is a same-origin JSON POST naming one command id.
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 8192)).toString('utf8'));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerServiceRequests.command(
        customerServiceCommandInput.parse(input),
        ...context(request),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
