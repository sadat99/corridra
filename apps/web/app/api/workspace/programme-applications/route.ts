import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerProgrammePagesEnabled } from '@corridra/auth/customer-programme-publication';
import { deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
import { foundations } from '../../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Corridra staff reading applications to public programme pages (ADR-080, owner decision of 12 November 2026). GET only:
// no other method exists, so nothing here can decide, edit, invite or export. The operator session and the selected staff
// workspace are the existing ones and the database repeats them (owner or admin, fresh authenticator check). There is no
// scope input: the database decides sample or real from the staff workspace. Off, or before the module has its staff read,
// the route answers 503 and touches nothing.
const off = 'Programme applications are not available yet.';
const scope = z.object({ tenant: z.uuid() }).catchall(z.string());

export async function GET(request: Request) {
  try {
    if (!customerProgrammePagesEnabled()) throw new DomainError(off, 503, 'unavailable');
    const s = foundations();
    if (!s) throw new DomainError(off, 503, 'unavailable');
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const { tenant, ...query } = scope.parse(Object.fromEntries(new URL(request.url).searchParams));
    const ctx = { token: identity.token, tenantId: tenant, purpose: 'synthetic_validation' };
    return Response.json(await s.staffProgrammeApplications.list(ctx, query), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    // A step-up request keeps its code, so the screen can open the authenticator dialog and read again.
    if (error instanceof DomainError && error.code)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: deliveryHeaders },
      );
    return deliveryError(error);
  }
}
