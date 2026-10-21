import { cookies } from 'next/headers';
import { DomainError } from '@corridra/domain';
import { z } from 'zod';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../../lib/delivery-http';
import {
  pendingRequestCookieName,
  pendingRequestServices,
} from '../../../../../lib/pending-request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const s = await pendingRequestServices(request, true);
    z.object({})
      .strict()
      .parse(JSON.parse((await boundedBody(request, 1024)).toString('utf8')));
    const jar = await cookies();
    const raw = jar.get(pendingRequestCookieName)?.value;
    if (!raw) throw new DomainError('Your saved request expired. Start a new request.', 404);
    const cap = s.missions.pendingRequestCapability(raw);
    const result = await s.customerRequests.claimPending(cap, (context, brief) =>
      s.missions.prepareCustomerIntake(context, brief),
    );
    jar.set(pendingRequestCookieName, '', {
      httpOnly: true,
      secure: new URL(s.config.APP_ORIGIN).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/intake',
      maxAge: 0,
    });
    return Response.json(result, { headers: deliveryHeaders });
  } catch (error) {
    return deliveryError(error);
  }
}
