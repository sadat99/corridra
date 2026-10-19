import { DomainError } from '@corridra/domain';
import {
  customerProgrammeEconomicsEnabled,
  ledgerRecordInput,
} from '@corridra/auth/customer-programme-economics';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerProgrammeEconomicsEnabled())
    throw new DomainError('Sample delegation finances are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Sample delegation finances are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Sample delegation finances are unavailable', 503)
      : error,
  );
}
function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
export async function GET(request: Request) {
  try {
    const s = await services();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const view = query.view;
    delete query.view;
    if (view !== 'summary' && view !== 'entries')
      throw new DomainError('Unknown finance view', 400);
    return Response.json(
      view === 'summary'
        ? await s.customerProgrammeEconomics.summary(query, ...context(request))
        : await s.customerProgrammeEconomics.list(query, ...context(request)),
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
    const body = JSON.parse((await boundedBody(request, 8192)).toString('utf8'));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerProgrammeEconomics.record(ledgerRecordInput.parse(body), ...context(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
