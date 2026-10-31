import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../lib/foundations';
import { notificationsOn } from '../../../lib/notify';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

// The signed-in team member's own inbox (commercial readiness program, D7). GET lists items; POST
// marks one as read. Off (404) until CORRIDRA_NOTIFICATIONS_V2 is on. Customer inbox reads are added
// by WS-E through the customer proof. Owner after Wave 0: WS-E.
async function handle(request: Request) {
  try {
    if (!notificationsOn()) throw new DomainError('Not found', 404);
    const s = foundations();
    if (!s) throw new DomainError('Inbox is unavailable', 503);
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const tenantId = z.uuid().parse(new URL(request.url).searchParams.get('tenant'));
    const who = {
      kind: 'staff' as const,
      ctx: { token: identity.token, tenantId, purpose: 'synthetic_validation' },
    };
    if (request.method === 'GET') return Response.json(await s.inbox.list(who), { headers });
    const body = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await request.json());
    return Response.json({ read: await s.inbox.markRead(who, body.id) }, { headers });
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400
          ? 'Check the submitted values'
          : 'The inbox could not be loaded';
    return Response.json({ error: message }, { status, headers });
  }
}
export const GET = handle;
export const POST = handle;
