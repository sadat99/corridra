import { DomainError } from '@corridra/domain';
import { customerProgrammeProjectionsEnabled } from '@corridra/auth/customer-programme-projections';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerProgrammeProjectionsEnabled())
    throw new DomainError('Programme projections are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Programme projections are unavailable', 503);
  await s.ready;
  return s;
}
const context = (r: Request) =>
  [
    r.headers.get('x-corridra-customer-subject') ?? undefined,
    r.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Programme projections are unavailable', 503)
      : error,
  );
}
export async function GET(request: Request) {
  try {
    const s = await services(),
      q = Object.fromEntries(new URL(request.url).searchParams),
      view = q.view;
    delete q.view;
    const value =
      view === 'owner'
        ? await s.customerProgrammeProjections.owner(q, ...context(request))
        : view === 'own'
          ? await s.customerProgrammeProjections.own(q, ...context(request))
          : null;
    if (!value) throw new DomainError('Unknown programme view', 400);
    return Response.json(value, { headers: deliveryHeaders });
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
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const value = JSON.parse((await boundedBody(request, 16384)).toString('utf8')) as unknown;
    return Response.json(await s.customerProgrammeProjections.command(value, ...context(request)), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}
