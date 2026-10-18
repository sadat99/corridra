import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  customerParticipantsEnabled,
  customerParticipantInput,
} from '@corridra/auth/customer-participants';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerParticipantsEnabled())
    throw new DomainError('Sample delegation participation is unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Sample delegation participation is unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Sample delegation participation is unavailable', 503)
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
    if (view !== 'own' && view !== 'manage')
      throw new DomainError('Choose a participant view', 400);
    return Response.json(
      view === 'own'
        ? await s.customerParticipants.own(input, ...context(request))
        : await s.customerParticipants.list(input, ...context(request)),
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
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    if (input && typeof input === 'object' && 'action' in input && input.action === 'preview') {
      const v = z
        .object({ action: z.literal('preview'), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(input);
      return Response.json(
        await s.customerParticipants.preview({ token: v.token }, ...context(request)),
        { headers: deliveryHeaders },
      );
    }
    return Response.json(
      await s.customerParticipants.command(
        customerParticipantInput.parse(input),
        ...context(request),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
