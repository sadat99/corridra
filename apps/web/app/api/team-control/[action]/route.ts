import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
import { notify } from '../../../../lib/notify';
import { uxSwitchOn } from '../../../../lib/ux-switches';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Team control (WS-D): Today counts (CQ-34, CQ-73), team invitations behind CORRIDRA_TEAM_INVITES
// (CQ-74, D8) and authenticator reset (V-03). Authority lives in the services: withTenant and RLS.
// A refused action that needs a fresh authenticator check answers 401 with code STEP_UP_REQUIRED.
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), invite: z.unknown() }).strict(),
  z.object({ action: z.literal('resend'), invitationId: z.uuid() }).strict(),
  z.object({ action: z.literal('cancel'), invitationId: z.uuid() }).strict(),
]);

async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const correlationId = randomUUID();
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Corridra-Request-ID': correlationId,
  };
  try {
    const s = foundations();
    if (!s) throw new DomainError('Team control is unavailable', 503);
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const { action } = await params;
    const tenantId = z.uuid().parse(new URL(request.url).searchParams.get('tenant'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    const body = async () => {
      const text = await request.text();
      if (text.length > 4096) throw new DomainError('Request is too large', 413);
      return JSON.parse(text) as unknown;
    };
    if (action === 'today' && request.method === 'GET')
      return Response.json(await s.access.today(ctx), { headers });
    if (action === 'invites') {
      if (!uxSwitchOn('CORRIDRA_TEAM_INVITES')) throw new DomainError('Not found', 404);
      if (request.method === 'GET')
        return Response.json({ invitations: await s.access.team().list(ctx) }, { headers });
      const v = command.parse(await body());
      const team = s.access.team();
      if (v.action === 'invite') {
        const result = await team.invite(ctx, v.invite);
        const input = v.invite as { email: string; name: string; role: string };
        const notification = await notify({
          recipientAccountId: result.principalId,
          recipientKind: 'staff',
          recipientEmail: input.email,
          type: 'TEAM_INVITE',
          payload: { name: input.name, role: input.role, setupPath: '/operator/setup' },
          locale: 'en',
          tenantId,
          writer: { kind: 'staff', ctx },
        });
        return Response.json(
          { ...result, notification: { inbox: notification.inbox, email: notification.email } },
          { status: 201, headers },
        );
      }
      const result =
        v.action === 'resend'
          ? await team.resend(ctx, { invitationId: v.invitationId })
          : await team.cancel(ctx, { invitationId: v.invitationId });
      return Response.json(result, { status: 201, headers });
    }
    if (action === 'authenticator-reset' && request.method === 'POST')
      return Response.json(await s.access.team().resetAuthenticator(ctx, await body()), {
        status: 201,
        headers,
      });
    throw new DomainError('Not found', 404);
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : (error as { code?: string }).code === '42501'
            ? 403
            : ['23505', '23514', '23503'].includes((error as { code?: string }).code ?? '')
              ? 409
              : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400
          ? 'Check the submitted values'
          : status === 403
            ? 'Access denied'
            : status === 409
              ? 'The record changed. Refresh and try again.'
              : 'The request could not be completed';
    if (status === 500)
      console.error(JSON.stringify({ event: 'team_control_failed', correlationId }));
    const code = error instanceof DomainError ? error.code : undefined;
    return Response.json(
      code ? { error: message, code, correlationId } : { error: message, correlationId },
      {
        status,
        headers,
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
