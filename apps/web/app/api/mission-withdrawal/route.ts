import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../lib/foundations';
import { staffRefusal } from '../../../lib/staff-db-error';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Corridra team's read-only line "Withdrawn by the customer": whether the request behind a mission is withdrawn
// right now, and the date. Never the customer's reason. Same session and tenant rules as the rest of the team API;
// the database decides who may read it. There is no write method.
export async function GET(request: Request) {
  const correlationId = randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Corridra-Request-ID': correlationId };
  try {
    const s = foundations();
    if (!s) return Response.json({ error: 'The signal is unavailable' }, { status: 503, headers });
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const url = new URL(request.url);
    const tenantId = z.uuid().parse(url.searchParams.get('tenant'));
    const missionId = z.uuid().parse(url.searchParams.get('mission'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    return Response.json(await s.withdrawalSignal.read(ctx, missionId), { headers });
  } catch (error) {
    const refusal = staffRefusal(error);
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (refusal?.status ?? 500);
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof z.ZodError
          ? (error.issues[0]?.message ?? 'Check the request')
          : (refusal?.message ?? 'Request failed');
    return Response.json({ error: message }, { status, headers });
  }
}
