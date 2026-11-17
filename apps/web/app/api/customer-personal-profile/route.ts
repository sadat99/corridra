import { DomainError } from '@corridra/domain';
import { z } from 'zod';
import {
  customerPersonalProfileInput,
  personalProfileNoWorkspaceMessage,
  personalProfileStaleMessage,
} from '@corridra/auth/customer-personal-profiles';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-086. The signed-in person's own optional details: GET reads them (or ?scope=history), POST saves a new revision with
// the expected version and a command id. Every refusal carries a code the screen maps to its own words. A module that is
// not installed answers 503 module_unavailable.
const unavailable = 'Personal details are not available yet.';
const refuse = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: deliveryHeaders });
function failure(error: unknown) {
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  if (error instanceof DomainError)
    return refuse(error.status, error.code ?? 'refused', error.message);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return refuse(400, 'invalid', 'Check the details and try again.');
  if (['42P01', '3F000', '42883'].includes(code))
    return refuse(503, 'module_unavailable', unavailable);
  if (code === '42501') return refuse(403, 'account_inactive', 'These details cannot be changed.');
  if (code === '23514') {
    if (message === personalProfileStaleMessage)
      return refuse(409, 'stale', 'This changed in another window.');
    if (message === personalProfileNoWorkspaceMessage)
      return refuse(409, 'no_workspace', personalProfileNoWorkspaceMessage);
    if (message === 'Command conflicts with original request')
      return refuse(409, 'command_conflict', 'This save conflicts with an earlier one. Reload.');
    return refuse(400, 'invalid', 'Check the details and try again.');
  }
  console.warn(JSON.stringify({ code: 'personal_profile_failed', status: 500 }));
  return refuse(500, 'failed', 'The request could not be completed. Please try again.');
}
async function services() {
  const s = foundations();
  if (!s) throw new DomainError(unavailable, 503, 'module_unavailable');
  await s.ready;
  return s;
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
    const { scope, ...query } = Object.fromEntries(new URL(request.url).searchParams);
    if (scope !== undefined && scope !== 'history') return refuse(400, 'invalid', 'Unknown scope');
    return Response.json(
      scope === 'history'
        ? await s.customerPersonalProfiles.history(query, ...context(request))
        : await s.customerPersonalProfiles.view(...context(request)),
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
      return refuse(403, 'origin_refused', 'Request origin is not allowed');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return refuse(415, 'json_required', 'JSON required');
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    const parsed = customerPersonalProfileInput.parse(input);
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(await s.customerPersonalProfiles.command(parsed, ...context(request)), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}
