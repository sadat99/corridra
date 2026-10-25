import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { foundations } from '../../../../lib/foundations';
import { boundedBody } from '../../../../lib/delivery-http';
import { staffRefusal } from '../../../../lib/staff-db-error';
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
    const input = JSON.parse((await boundedBody(request, 20000)).toString('utf8'));
    const outcome = await s.moves.command(ctx, input);
    // Email about a Move is a separate step after the Move is stored: it can never fail or undo the Move.
    // It queues nothing unless Pulse is on in the application and the database, and sends nothing until
    // the owner has chosen where the address comes from.
    if (input?.action === 'set' && !outcome.replayed && s.pulse.canSend) {
      try {
        const jobs = await s.pulse.enqueueForCommand(ctx, outcome.commandId);
        if (jobs.length > 0) {
          const { pulseOrchestrator } = await import('../../../../lib/pulse-orchestrator');
          for (const job of jobs) await pulseOrchestrator.start(job);
        }
      } catch {
        // Mail problems are not Move problems.
      }
    }
    return Response.json(outcome, { headers });
  } catch (error) {
    const refusal = staffRefusal(error);
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : (refusal?.status ?? 500);
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof z.ZodError
          ? (error.issues[0]?.message ?? 'Check the request')
          : error instanceof SyntaxError
            ? 'Check the request'
            : (refusal?.message ?? 'Request failed');
    return Response.json({ error: message }, { status, headers });
  }
}
export const GET = handle;
export const POST = handle;
