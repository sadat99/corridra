import { DomainError } from '@corridra/domain';
import {
  customerSavedMissionsEnabled,
  savedMissionInput,
} from '@corridra/auth/customer-saved-missions';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerSavedMissionsEnabled())
    throw new DomainError('Saved commercial missions are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Saved commercial missions are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Saved commercial missions are unavailable', 503)
      : error,
  );
}
export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(
      await s.customerSavedMissions.list(
        Object.fromEntries(new URL(request.url).searchParams),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
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
    const input = savedMissionInput.parse(
      JSON.parse((await boundedBody(request, 8192)).toString('utf8')),
    );
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    // Reuse the original shared per-client delivery budget. Other saved actions
    // also have a per-resource budget; no bearer is recovered from storage.
    await s.delivery.budget(client, input.action === 'save' ? input.token : input.resourceId);
    return Response.json(
      await s.customerSavedMissions.command(
        input,
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
