import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
import { uxSwitchOn } from '../../../../lib/ux-switches';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Team work reads for the mission queue and mission page (commercial readiness program, D15).
//   GET /api/team-work/flags                      which team-work screens are switched on
//   GET /api/team-work/mission?tenant=&id=        one mission, same shape and permission as the queue
// Both need a signed-in team session; the mission read also goes through the tenant's missions.read check.
async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Corridra-Request-ID': randomUUID() };
  try {
    const s = foundations();
    if (!s) throw new DomainError('Operator workspace is unavailable', 503);
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const { action } = await params;
    if (action === 'flags')
      return Response.json({ missionsV2: uxSwitchOn('CORRIDRA_UX_MISSIONS_V2') }, { headers });
    if (action === 'mission') {
      const query = new URL(request.url).searchParams;
      const ctx = {
        token: identity.token,
        tenantId: z.uuid().parse(query.get('tenant')),
        purpose: 'synthetic_validation',
        correlationId: headers['X-Corridra-Request-ID'],
      };
      return Response.json(await s.missions.mission(ctx, z.uuid().parse(query.get('id'))), {
        headers,
      });
    }
    throw new DomainError('Not found', 404);
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (error as { code?: string }).code === '42501'
            ? 403
            : 500;
    return Response.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : status === 400
              ? 'Check the request'
              : status === 403
                ? 'Your role cannot open this mission'
                : 'The mission could not be loaded. Try again.',
        ...(error instanceof DomainError && error.code ? { code: error.code } : {}),
      },
      { status, headers },
    );
  }
}
export const GET = handle;
