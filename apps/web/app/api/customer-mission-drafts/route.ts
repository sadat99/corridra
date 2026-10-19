import { DomainError } from '@corridra/domain';
import {
  customerMissionDraftsEnabled,
  missionDraftCloseInput,
  missionDraftSaveInput,
} from '@corridra/auth/customer-mission-drafts';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerMissionDraftsEnabled())
    throw new DomainError('Sample request drafts are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Sample request drafts are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Sample request drafts are unavailable', 503)
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
    return Response.json(
      'draftId' in query
        ? await s.customerMissionDrafts.view(query, ...context(request))
        : await s.customerMissionDrafts.list(query, ...context(request)),
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
    const body = JSON.parse((await boundedBody(request, 32768)).toString('utf8')) as {
      action?: unknown;
      input?: unknown;
    };
    if (body.action !== 'save' && body.action !== 'close')
      throw new DomainError('Unknown draft action', 400);
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      body.action === 'save'
        ? await s.customerMissionDrafts.save(
            missionDraftSaveInput.parse(body.input),
            ...context(request),
          )
        : await s.customerMissionDrafts.close(
            missionDraftCloseInput.parse(body.input),
            ...context(request),
          ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
