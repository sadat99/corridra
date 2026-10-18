import { DomainError } from '@corridra/domain';
import {
  customerProgrammesEnabled,
  customerProgrammeInput,
} from '@corridra/auth/customer-programmes';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerProgrammesEnabled())
    throw new DomainError('Sample delegation planning is unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Sample delegation planning is unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Sample delegation planning is unavailable', 503)
      : error,
  );
}
export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(
      await s.customerProgrammes.list(
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
    const input = customerProgrammeInput.parse(
      JSON.parse((await boundedBody(request, 4096)).toString('utf8')),
    );
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerProgrammes.create(
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
