import { DomainError } from '@corridra/domain';
import { customerProgrammeTermsEnabled } from '@corridra/auth/customer-programme-terms';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerProgrammeTermsEnabled())
    throw new DomainError('Sample programme terms are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Sample programme terms are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Sample programme terms are unavailable', 503)
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
    const t = s.customerProgrammeTerms;
    const ctx = context(request);
    if (view === 'state')
      return Response.json(await t.state(query, ...ctx), { headers: deliveryHeaders });
    if (view === 'report')
      return Response.json(await t.report(query, ...ctx), { headers: deliveryHeaders });
    if (view === 'place')
      return Response.json(await t.ownPlace(query, ...ctx), { headers: deliveryHeaders });
    if (view === 'reminders')
      return Response.json(await t.reminders(query, ...ctx), { headers: deliveryHeaders });
    throw new DomainError('Unknown terms view', 400);
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
    const body = JSON.parse((await boundedBody(request, 16384)).toString('utf8')) as {
      action?: unknown;
      input?: unknown;
    };
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const t = s.customerProgrammeTerms;
    const ctx = context(request);
    const run =
      body.action === 'terms'
        ? t.publishTerms(body.input, ...ctx)
        : body.action === 'eligibility'
          ? t.setEligibility(body.input, ...ctx)
          : body.action === 'places'
            ? t.setPlaces(body.input, ...ctx)
            : body.action === 'refresh'
              ? t.refreshPlaces(body.input, ...ctx)
              : body.action === 'assign'
                ? t.assignTask(body.input, ...ctx)
                : body.action === 'done'
                  ? t.finishTask(body.input, ...ctx)
                  : body.action === 'enrol'
                    ? t.enrol(body.input, ...ctx)
                    : null;
    if (!run) throw new DomainError('Unknown terms action', 400);
    return Response.json(await run, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
