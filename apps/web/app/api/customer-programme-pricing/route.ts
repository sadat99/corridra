import { DomainError } from '@corridra/domain';
import { customerProgrammePricingEnabled } from '@corridra/auth/customer-programme-pricing';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerProgrammePricingEnabled())
    throw new DomainError('Sample pricing and series are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Sample pricing and series are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Sample pricing and series are unavailable', 503)
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
    const c = s.customerProgrammePricing;
    const ctx = context(request);
    const run =
      view === 'templates'
        ? c.templates(query, ...ctx)
        : view === 'overview'
          ? c.overview(query, ...ctx)
          : view === 'series'
            ? c.seriesList(query, ...ctx)
            : view === 'revenue'
              ? c.revenue(query, ...ctx)
              : null;
    if (!run) throw new DomainError('Unknown pricing view', 400);
    return Response.json(await run, { headers: deliveryHeaders });
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
    const body = JSON.parse((await boundedBody(request, 65536)).toString('utf8')) as {
      action?: unknown;
      input?: unknown;
    };
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const c = s.customerProgrammePricing;
    const ctx = context(request);
    const run =
      body.action === 'saveTemplate'
        ? c.saveTemplate(body.input, ...ctx)
        : body.action === 'applySchedule'
          ? c.applySchedule(body.input, ...ctx)
          : body.action === 'previewFees'
            ? c.previewFees(body.input, ...ctx)
            : body.action === 'recordFees'
              ? c.recordFees(body.input, ...ctx)
              : body.action === 'saveSeries'
                ? c.saveSeries(body.input, ...ctx)
                : body.action === 'createEdition'
                  ? c.createEdition(body.input, ...ctx)
                  : null;
    if (!run) throw new DomainError('Unknown pricing action', 400);
    return Response.json(await run, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
