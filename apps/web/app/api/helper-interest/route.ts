import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { helperInterestEnabled } from '@corridra/auth/helper-interest';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
import { foundations } from '../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The helper interest register (ADR-0085).
// POST is public and does one thing: a person who has not been invited says they would like to become a field helper. It
// answers 404, as if the address did not exist, unless BOTH CORRIDRA_HELPER_INTEREST and CORRIDRA_NETWORK_ENABLED are exactly
// "true" and the database module is installed and open. A first sign-up and a repeat get the same answer. It creates no
// account, session or membership and sends no email. The body is capped at 4 KB.
// GET and DELETE are for an owner or admin of the staff workspace (fresh authenticator check, repeated by the database):
// the list, and deleting one entry on request. They do not depend on the form being switched on, so an entry can always be
// deleted; with the module not installed the list answers installed=false and the screen hides itself.
const notFound = () =>
  Response.json({ error: 'Not found' }, { status: 404, headers: deliveryHeaders });
const scope = z.object({ tenant: z.uuid() }).catchall(z.string());

function failure(error: unknown) {
  // A step-up request keeps its code, so the screen can open the authenticator dialog and read again.
  if (error instanceof DomainError && error.code)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: deliveryHeaders },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      { error: 'Check the highlighted fields' },
      { status: 400, headers: deliveryHeaders },
    );
  return deliveryError(error);
}

export async function POST(request: Request) {
  try {
    if (!helperInterestEnabled()) return notFound();
    const s = foundations();
    if (!s) return notFound();
    await s.ready;
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    if (!(await s.helperInterest.offered())) return notFound();
    // Vercel overwrites x-vercel-forwarded-for. Do not trust a caller-selected X-Forwarded-For. The address is only
    // ever used as a keyed one-way hash for the budget and is never stored.
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.helperInterest.clientBudget(client);
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    await s.helperInterest.submit(input);
    return Response.json({ received: true }, { status: 202, headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}

async function staffContext(request: Request, query: Record<string, string>) {
  const s = foundations();
  if (!s) throw new DomainError('This is not available', 503);
  await s.ready;
  const identity = await s.provider.getSession(request.headers);
  if (!identity) throw new DomainError('Sign in to continue', 401);
  const { tenant } = scope.parse(query);
  return { s, ctx: { token: identity.token, tenantId: tenant, purpose: 'synthetic_validation' } };
}

export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const { s, ctx } = await staffContext(request, query);
    // The screen asks first whether the module is installed, with a session but no authenticator step, so a database
    // without it never shows the panel and a refusal to read never looks like a missing module.
    if (query.view === 'installed')
      return Response.json(
        { installed: await s.helperInterest.installed() },
        { headers: deliveryHeaders },
      );
    const { tenant: _tenant, ...rest } = query;
    void _tenant;
    return Response.json(await s.helperInterest.list(ctx, rest), { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const { s, ctx } = await staffContext(request, query);
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 512)).toString('utf8'));
    return Response.json(await s.helperInterest.remove(ctx, input), { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
