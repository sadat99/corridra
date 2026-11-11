import { DomainError } from '@corridra/domain';
import {
  customerProgrammePagesEnabled,
  programmeApplicationInput,
  programmePublicationInput,
  programmePublicationRefusal,
} from '@corridra/auth/customer-programme-publication';
import { archivedWorkspaceRefusal } from '@corridra/auth/customer-workspace-lifecycle';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The signed-in side of programme pages (ADR-080): the organiser's page and decisions, and a person's own
// applications. The public read of a page is a server-rendered page, not this route.
const off = 'Programme pages are unavailable';
async function services() {
  if (!customerProgrammePagesEnabled()) throw new DomainError(off, 503);
  const s = foundations();
  if (!s) throw new DomainError(off, 503);
  await s.ready;
  return s;
}
// A named refusal is a state the person can act on. It travels as a code, so the screen chooses the words.
function failure(error: unknown) {
  const archived = archivedWorkspaceRefusal(error);
  if (archived)
    return Response.json(
      { error: archived.message, code: archived.code },
      { status: archived.status, headers: deliveryHeaders },
    );
  const named = programmePublicationRefusal(error);
  if (named)
    return Response.json(
      { error: 'This could not be done as asked', code: named },
      { status: named.endsWith('RATE_LIMITED') ? 429 : 409, headers: deliveryHeaders },
    );
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError(off, 503)
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
    const s = await services(),
      query = Object.fromEntries(new URL(request.url).searchParams);
    const { view, ...input } = query;
    const who = context(request);
    if (view === 'own')
      return Response.json(await s.customerProgrammePages.own(input, ...who), {
        headers: deliveryHeaders,
      });
    if (view === 'page')
      return Response.json(await s.customerProgrammePages.view(input, ...who), {
        headers: deliveryHeaders,
      });
    if (view === 'applications')
      return Response.json(await s.customerProgrammePages.applications(input, ...who), {
        headers: deliveryHeaders,
      });
    throw new DomainError('Choose a programme page view', 400);
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
    const input: unknown = JSON.parse((await boundedBody(request, 24576)).toString('utf8'));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const kind =
      input && typeof input === 'object' && 'kind' in input
        ? (input as { kind: unknown }).kind
        : '';
    const { kind: _kind, ...rest } = (input ?? {}) as Record<string, unknown>;
    void _kind;
    if (kind === 'page')
      return Response.json(
        await s.customerProgrammePages.publication(
          programmePublicationInput.parse(rest),
          ...context(request),
        ),
        { headers: deliveryHeaders },
      );
    if (kind === 'application')
      return Response.json(
        await s.customerProgrammePages.application(
          programmeApplicationInput.parse(rest),
          ...context(request),
        ),
        { headers: deliveryHeaders },
      );
    throw new DomainError('Choose a programme page action', 400);
  } catch (error) {
    return failure(error);
  }
}
