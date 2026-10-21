import { DomainError } from '@corridra/domain';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
import { pendingRequestCookieName, pendingRequestServices } from '../../../../lib/pending-request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const s = await pendingRequestServices(request);
    const available = await s.missions.realIntakeAvailable();
    const raw = (await cookies()).get(pendingRequestCookieName)?.value;
    if (!raw) return Response.json({ pending: false, available }, { headers: deliveryHeaders });
    try {
      s.missions.pendingRequestCapability(raw);
    } catch {
      return Response.json({ pending: false, available }, { headers: deliveryHeaders });
    }
    return Response.json({ pending: true, available }, { headers: deliveryHeaders });
  } catch (error) {
    return deliveryError(error);
  }
}
export async function POST(request: Request) {
  try {
    const s = await pendingRequestServices(request, true);
    if (!(await s.missions.realIntakeAvailable()))
      throw new DomainError(
        'New requests are paused. Existing requests remain available in your account.',
        503,
      );
    const input = z
      .object({ key: z.uuid(), brief: z.unknown() })
      .strict()
      .parse(JSON.parse((await boundedBody(request, 32768)).toString('utf8')));
    const pending = await s.missions.stagePendingRequest(input.key, input.brief);
    (await cookies()).set(pendingRequestCookieName, pending.cookie, {
      httpOnly: true,
      secure: new URL(s.config.APP_ORIGIN).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/intake',
      maxAge: 86400,
    });
    return Response.json(
      { pending: true, expiresAt: pending.expiresAt },
      { status: 201, headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(error);
  }
}
