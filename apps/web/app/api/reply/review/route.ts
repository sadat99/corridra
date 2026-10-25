import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
import { uxSwitchOn } from '../../../../lib/ux-switches';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Corridra team's review of supplier replies (ADR-069): read the reviews of a workspace, and publish,
// ask or reject one reply. Same session, origin and tenant rules as the rest of the team API; the database
// decides the rest (role, fresh authenticator check, an open control, no second final decision).
async function handle(request: Request) {
  const correlationId = randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Corridra-Request-ID': correlationId };
  try {
    if (!uxSwitchOn('CORRIDRA_REPLY_PAGE'))
      throw new DomainError('Reply review is unavailable', 503);
    const s = foundations();
    if (!s)
      return Response.json({ error: 'Reply review is unavailable' }, { status: 503, headers });
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
    if (request.method === 'GET') return Response.json(await s.replyReview.list(ctx), { headers });
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const body = await request.text();
    if (body.length > 4000) throw new DomainError('Request too large', 413);
    return Response.json(await s.replyReview.review(ctx, JSON.parse(body)), { headers });
  } catch (error) {
    const code = (error as { code?: string }).code;
    // The module is optional: not installed means unavailable, not a server error.
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : ['42P01', '3F000', '42883'].includes(code ?? '')
            ? 503
            : code === '42501'
              ? 403
              : code === '23514'
                ? 409
                : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof z.ZodError
          ? (error.issues[0]?.message ?? 'Check the request')
          : status === 503
            ? 'Reply review is unavailable'
            : status === 403
              ? (error as Error).message || 'Access denied'
              : status === 409
                ? (error as Error).message || 'That review conflicts with an earlier one'
                : 'Request failed';
    return Response.json({ error: message }, { status, headers });
  }
}
export const GET = handle;
export const POST = handle;
