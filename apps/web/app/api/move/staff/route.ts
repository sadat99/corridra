import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { foundations } from '../../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Corridra team's side of Move records: read a mission's history and set, finish or clear its
// Moves. Same session, origin and tenant rules as the rest of the team API; the database decides the rest.
async function handle(request: Request) {
  const correlationId = randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Corridra-Request-ID': correlationId };
  try {
    if (!customerMovesEnabled()) throw new DomainError('Moves are unavailable', 503);
    const s = foundations();
    if (!s) return Response.json({ error: 'Moves are unavailable' }, { status: 503, headers });
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const url = new URL(request.url);
    const tenantId = z.uuid().parse(url.searchParams.get('tenant'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    if (request.method === 'GET')
      return Response.json(
        await s.moves.history(ctx, z.uuid().parse(url.searchParams.get('mission'))),
        { headers },
      );
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const body = await request.text();
    if (body.length > 20000) throw new DomainError('Request too large', 413);
    return Response.json(await s.moves.command(ctx, JSON.parse(body)), { headers });
  } catch (error) {
    const status =
      error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof z.ZodError
          ? (error.issues[0]?.message ?? 'Check the request')
          : 'Request failed';
    return Response.json({ error: message }, { status, headers });
  }
}
export const GET = handle;
export const POST = handle;
