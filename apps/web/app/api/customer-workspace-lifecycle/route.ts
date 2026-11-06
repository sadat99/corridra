import { DomainError } from '@corridra/domain';
import {
  customerWorkspaceIsStale,
  customerWorkspaceLifecycleEnabled,
  customerWorkspaceLifecycleInput,
  customerWorkspaceLifecycleQuery,
} from '@corridra/auth/customer-workspace-lifecycle';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unavailable = 'Workspace changes are unavailable';
async function services() {
  if (!customerWorkspaceLifecycleEnabled()) throw new DomainError(unavailable, 503);
  const s = foundations();
  if (!s) throw new DomainError(unavailable, 503);
  await s.ready;
  return s;
}
// A coded refusal (archived, unavailable, account_closed) keeps its code so the page can tell them apart.
function failure(error: unknown) {
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError(unavailable, 503));
  if (error instanceof DomainError && error.code)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: deliveryHeaders },
    );
  return deliveryError(error);
}
const subject = (request: Request) =>
  request.headers.get('x-corridra-customer-subject') ?? undefined;
const issuer = (request: Request) => request.headers.get('x-corridra-customer-issuer') ?? undefined;

export async function GET(request: Request) {
  try {
    const s = await services();
    const query = customerWorkspaceLifecycleQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(
      await s.customerWorkspaceLifecycle.state(query, subject(request), issuer(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}

// Renames, archives, restores or hands over a workspace, so a command is only ever a same-origin JSON POST. The same
// command id is sent again after a refusal such as the rate limit; the database answers a repeat with the same body.
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = customerWorkspaceLifecycleInput.parse(
      JSON.parse((await boundedBody(request, 4096)).toString('utf8')),
    );
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const outcome = await s.customerWorkspaceLifecycle.command(
      input,
      subject(request),
      issuer(request),
    );
    if (customerWorkspaceIsStale(outcome))
      return Response.json(
        {
          error:
            'This workspace changed since you opened it. Review the current name and try again.',
          code: 'stale',
          currentName: outcome.currentName,
          currentVersion: outcome.currentVersion,
        },
        { status: 409, headers: deliveryHeaders },
      );
    return Response.json(outcome, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
