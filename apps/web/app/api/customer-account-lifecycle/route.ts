import { DomainError } from '@corridra/domain';
import {
  customerAccountLifecycleEnabled,
  customerAccountLifecycleInput,
} from '@corridra/auth/customer-account-lifecycle';
import { z } from 'zod';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unavailable = 'Account changes are unavailable';
async function services() {
  if (!customerAccountLifecycleEnabled()) throw new DomainError(unavailable, 503);
  const s = foundations();
  if (!s) throw new DomainError(unavailable, 503);
  await s.ready;
  return s;
}
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
// Self only: the page asks about the signed-in person and no query of any kind is accepted.
const noQuery = z.object({}).strict();

export async function GET(request: Request) {
  try {
    const s = await services();
    noQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(
      await s.customerAccountLifecycle.state(subject(request), issuer(request)),
      {
        headers: deliveryHeaders,
      },
    );
  } catch (error) {
    return failure(error);
  }
}

// Closes the signed-in account, takes the closing back, or files an erasure request. A closed account reaches this
// route to undo and to ask for erasure, and for nothing else. No person id or identity is ever read from the body.
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = customerAccountLifecycleInput.parse(
      JSON.parse((await boundedBody(request, 2048)).toString('utf8')),
    );
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerAccountLifecycle.command(input, subject(request), issuer(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
