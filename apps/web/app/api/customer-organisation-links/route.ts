import { DomainError } from '@corridra/domain';
import {
  customerOrganisationLinkCommandInput,
  customerOrganisationLinksEnabled,
} from '@corridra/auth/customer-organisation-links';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerOrganisationLinksEnabled())
    throw new DomainError('Company links are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Company links are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Company links are unavailable', 503)
      : error,
  );
}
function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
function client(request: Request) {
  return process.env.VERCEL
    ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
    : 'local';
}
// scope=view (default), overview (every reachable workspace) or search (public catalogue lookup).
export async function GET(request: Request) {
  try {
    const s = await services(),
      { scope, ...query } = Object.fromEntries(new URL(request.url).searchParams);
    if (scope !== undefined && !['view', 'overview', 'search'].includes(scope))
      throw new DomainError('Unknown scope', 400);
    if (scope === 'overview')
      return Response.json(await s.customerOrganisationLinks.overview(...context(request)), {
        headers: deliveryHeaders,
      });
    if (scope === 'search') await s.missions.budget(client(request));
    return Response.json(
      scope === 'search'
        ? await s.customerOrganisationLinks.search(query, ...context(request))
        : await s.customerOrganisationLinks.view(query, ...context(request)),
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
    const input: unknown = JSON.parse((await boundedBody(request, 8192)).toString('utf8'));
    await s.missions.budget(client(request));
    return Response.json(
      await s.customerOrganisationLinks.command(
        customerOrganisationLinkCommandInput.parse(input),
        ...context(request),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
