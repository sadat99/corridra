import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerAccountLifecycleEnabled } from '@corridra/auth/customer-account-lifecycle';
import { erasureTransitionInput } from '@corridra/auth/customer-erasure-queue';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff queue of customer erasure requests (CRUD G5). The operator session, the members.manage role and the
// fresh authenticator check are the existing ones, and the database repeats them. There is no scope input: the
// database decides sample or real from the staff workspace. A person's internal id never leaves this route.
const statuses = z.enum(['received', 'in_progress', 'completed', 'declined']);
const page = z.coerce.number().int().min(1).max(100);
const after = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
async function handle(request: Request) {
  try {
    if (!customerAccountLifecycleEnabled())
      throw new DomainError('The erasure queue is unavailable', 503);
    const s = foundations();
    if (!s) throw new DomainError('Workspace unavailable', 503);
    await s.ready;
    if (request.method === 'POST' && request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const query = new URL(request.url).searchParams;
    const ctx = {
      token: identity.token,
      tenantId: z.uuid().parse(query.get('tenant')),
      purpose: 'synthetic_validation',
    };
    if (request.method === 'GET') {
      const pageSize = query.get('pageSize') ? page.parse(query.get('pageSize')) : 25;
      const rows = await s.customerErasureQueue.queue(ctx, {
        ...(query.get('after') ? { afterNumber: after.parse(query.get('after')) } : {}),
        pageSize,
        ...(query.get('status') ? { status: statuses.parse(query.get('status')) } : {}),
      });
      // Only these fields leave the route: a field the database adds later is not shown by default.
      const items = rows.map((row) => ({
        id: row.id,
        number: row.number,
        reference: row.reference,
        filedAt: row.filedAt,
        dueAt: row.dueAt,
        daysLeft: row.daysLeft,
        status: row.status,
        note: row.note,
        accountStatus: row.accountStatus,
        closedAt: row.closedAt,
        undoUntil: row.undoUntil,
      }));
      return Response.json(
        { items, nextAfter: items.length === pageSize ? items[items.length - 1]!.number : null },
        { headers: deliveryHeaders },
      );
    }
    if (request.method !== 'POST') throw new DomainError('Not found', 404);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    return Response.json(
      await s.customerErasureQueue.transition(
        ctx,
        erasureTransitionInput.parse(
          JSON.parse((await boundedBody(request, 4096)).toString('utf8')),
        ),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError('The erasure queue is unavailable', 503)
        : error,
    );
  }
}
export const GET = handle;
export const POST = handle;
