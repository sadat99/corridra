import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerAccountLifecycleEnabled } from '@corridra/auth/customer-account-lifecycle';
import { erasureNoteProblem, erasureTransitionInput } from '@corridra/auth/customer-erasure-queue';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff queue of customer erasure requests (CRUD G5). The operator session, the members.manage role and the
// fresh authenticator check are the existing ones, and the database repeats them. There is no scope input: the
// database decides sample or real from the staff workspace. A person's internal id never leaves this route.
// Until the account module's scope function (modules 0003 and 0004) is installed, the service answers 503 on both GET
// and POST and reads and changes nothing: module 0001 alone has the queue functions WITHOUT the sample or real split.
// So this route is safe to deploy before that install, and starts working soon after it (the service checks again
// within a minute) without a redeploy.
type Services = NonNullable<ReturnType<typeof foundations>>;
async function erasePictures(
  s: Services,
  ctx: { token: string; tenantId: string; purpose: string },
  requestId: string,
) {
  try {
    const erased = await s.customerProfilePictureErasure.erase(ctx, randomUUID(), requestId);
    const deleted: string[] = [];
    for (const item of erased.pending) {
      try {
        if (!s.avatarStorage) break;
        await s.avatarStorage.delete(item.storageRef, item.id);
        deleted.push(item.id);
      } catch {
        console.warn(JSON.stringify({ code: 'profile_picture_erase_delete_pending', status: 200 }));
      }
    }
    if (deleted.length)
      await s.customerProfilePictureErasure.purged(ctx, requestId, deleted.slice(0, 100));
    return { retired: erased.retired, pending: erased.pending.length - deleted.length };
  } catch (error) {
    // The picture module is not installed: there is no picture to remove.
    if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
      return { retired: 0, pending: 0 };
    console.warn(JSON.stringify({ code: 'profile_picture_erase_failed', status: 200 }));
    return { retired: 0, pending: null };
  }
}
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
    const body = JSON.parse((await boundedBody(request, 4096)).toString('utf8')) as unknown;
    // A note with a line break or tab is refused by the database with no useful words, so say it here.
    const noteProblem = erasureNoteProblem((body as { note?: unknown } | null)?.note);
    if (noteProblem) throw new DomainError(noteProblem, 400);
    const input = erasureTransitionInput.parse(body);
    const done = await s.customerErasureQueue.transition(ctx, input);
    // ADR-088: once a request is in progress or completed, the person's profile picture goes with it: every picture is
    // retired and its stored files are deleted, then the rows. Sending the same transition again retries any file that
    // could not be deleted. It never undoes or fails the transition, which has already happened.
    const profilePicture =
      input.toState === 'in_progress' || input.toState === 'completed'
        ? await erasePictures(s, ctx, input.requestId)
        : undefined;
    return Response.json(profilePicture ? { ...done, profilePicture } : done, {
      headers: deliveryHeaders,
    });
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
