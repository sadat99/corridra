import { DomainError } from '@corridra/domain';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  profilePictureNothingMessage,
  profilePictureRemoveInput,
  profilePictureRequestHash,
  profilePictureStaleMessage,
  profilePictureUploadHeaders,
  publicPicture,
  type ProfilePictureObject,
} from '@corridra/auth/customer-profile-pictures';
import { personalProfileNoWorkspaceMessage } from '@corridra/auth/customer-personal-profiles';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import type { AvatarStorage } from '@corridra/evidence/avatar-storage';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryHeaders } from '../../../../lib/delivery-http';
import { profilePictureCapability } from '../../../../lib/profile-picture-capability';
import {
  PictureRejected,
  pictureLimits,
  pictureRefusalWords,
  processPicture,
  sniffPicture,
} from '../../../../lib/profile-picture-image';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-088. The signed-in person's own profile picture.
// GET ?scope=view answers { currentVersion, picture: { version, updatedAt } | null } as JSON.
// GET ?size=large|small answers the picture's bytes (image/webp, nosniff, private no-store) after checking them against
// the stored hash; there is no public address and no provider URL ever leaves the server.
// POST takes the image bytes (JPEG, PNG or WebP, at most 8 MiB) with x-command-id and x-expected-version, checks the real
// bytes, redraws them as two square WebP files without metadata, stores them privately and makes them the picture.
// DELETE takes { commandId, expectedVersion } and removes the picture; its files are deleted, then the row.
// While the profilePicture capability is off (or customer workspaces are off) every method answers 404 before anything is
// read. Logs carry a code and a status only, never a name, an email, an id or image data.
const headers = { ...deliveryHeaders, 'Cache-Control': 'private, no-store' };
const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers });
const refuse = (status: number, code: string, error: string) => answer(status, { error, code });
const log = (code: string, status: number) => console.warn(JSON.stringify({ code, status }));
const unavailable = 'Profile pictures are not available yet.';
const notFound = () => refuse(404, 'not_found', 'Not found');
const open = () => profilePictureCapability.profilePicture && customerWorkspacesEnabled();

function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
async function services() {
  const s = foundations();
  if (!s) throw new DomainError(unavailable, 503, 'module_unavailable');
  await s.ready;
  if (!s.avatarStorage) throw new DomainError(unavailable, 503, 'storage_unavailable');
  return { s, storage: s.avatarStorage };
}
function failure(error: unknown) {
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  if (error instanceof PictureRejected)
    return refuse(
      error.reason === 'too_large' ? 413 : error.reason === 'wrong_type' ? 415 : 422,
      error.reason,
      pictureRefusalWords[error.reason],
    );
  if (error instanceof DomainError)
    return refuse(error.status, error.code ?? 'refused', error.message);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return refuse(400, 'invalid', 'Check the request and try again.');
  if (['42P01', '3F000', '42883'].includes(code))
    return refuse(503, 'module_unavailable', unavailable);
  if (code === '42501')
    return refuse(403, 'account_inactive', 'The picture on this account cannot be changed.');
  if (code === '54000')
    return refuse(429, 'rate_limited', 'Too many picture uploads. Try again in an hour.');
  if (code === '23514') {
    if (message === profilePictureStaleMessage)
      return refuse(409, 'stale', 'Your picture changed in another window. Reload and try again.');
    if (message === personalProfileNoWorkspaceMessage)
      return refuse(409, 'no_workspace', personalProfileNoWorkspaceMessage);
    if (message === profilePictureNothingMessage)
      return refuse(409, 'no_picture', 'There is no picture to remove.');
    if (message === 'Command conflicts with original request')
      return refuse(409, 'command_conflict', 'This change conflicts with an earlier one. Reload.');
    return refuse(400, 'invalid', 'Check the request and try again.');
  }
  log('profile_picture_failed', 500);
  return refuse(500, 'failed', 'The picture could not be saved. Please try again.');
}

// Deletes the files of objects the database says are no longer needed, then their rows. A file that cannot be deleted
// stays listed and is offered again by the next change; the person's change has already happened, so this never fails it.
async function purge(
  storage: AvatarStorage,
  pending: ProfilePictureObject[],
  done: (ids: string[]) => Promise<unknown>,
) {
  if (!pending.length) return;
  const deleted: string[] = [];
  for (const item of pending) {
    try {
      await storage.delete(item.storageRef, item.id);
      deleted.push(item.id);
    } catch {
      log('profile_picture_delete_pending', 200);
    }
  }
  if (!deleted.length) return;
  try {
    await done(deleted);
  } catch {
    log('profile_picture_purge_unrecorded', 200);
  }
}

export async function GET(request: Request) {
  if (!open()) return notFound();
  try {
    const query = new URL(request.url).searchParams;
    const { s, storage } = await services();
    // ?scope=view answers whether there is a picture and its version, as JSON, without reading the store.
    if (query.get('scope') === 'view')
      return answer(200, publicPicture(await s.customerProfilePictures.view(...context(request))));
    if (query.get('scope') !== null) return refuse(400, 'invalid', 'Unknown scope');
    const size = z.enum(['large', 'small']).parse(query.get('size') ?? 'large');
    const view = await s.customerProfilePictures.view(...context(request));
    if (!view.picture) return refuse(404, 'no_picture', 'There is no picture.');
    const p = view.picture;
    const expected =
      size === 'large'
        ? { sha256: p.largeSha256, bytes: p.largeBytes }
        : { sha256: p.smallSha256, bytes: p.smallBytes };
    const body = await storage.get(p.storageRef, p.id, size);
    if (
      body.length !== expected.bytes ||
      createHash('sha256').update(body).digest('hex') !== expected.sha256
    ) {
      log('profile_picture_integrity', 409);
      return refuse(409, 'integrity', 'The picture could not be shown.');
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'image/webp',
        'Content-Length': String(body.length),
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!open()) return notFound();
  try {
    const { s, storage } = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      return refuse(403, 'origin_refused', 'Request origin is not allowed');
    const declared = request.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(declared.split(';')[0]!.trim()))
      throw new PictureRejected('wrong_type');
    const length = Number(request.headers.get('content-length') ?? '0');
    if (length > pictureLimits.maxBytes) throw new PictureRejected('too_large');
    const { commandId, expectedVersion } = profilePictureUploadHeaders.parse({
      commandId: request.headers.get('x-command-id'),
      expectedVersion: request.headers.get('x-expected-version'),
    });
    let bytes: Buffer;
    try {
      bytes = await boundedBody(request, pictureLimits.maxBytes);
    } catch (error) {
      if (error instanceof DomainError && error.status === 413)
        throw new PictureRejected('too_large');
      throw error;
    }
    // The cheap check of the real bytes comes before the budget, so a wrong file costs nothing.
    sniffPicture(bytes);
    const budget = await s.customerProfilePictures.uploadBudget(...context(request));
    if (budget.limited)
      return refuse(429, 'rate_limited', 'Too many picture uploads. Try again in an hour.');
    const picture = await processPicture(bytes);
    const requestHash = profilePictureRequestHash(
      s.config.AUTH_SECRET,
      'set',
      picture.uploadSha256,
    );
    const reserved = await s.customerProfilePictures.reserve(
      commandId,
      expectedVersion,
      requestHash,
      storage.storageRef,
      ...context(request),
    );
    if (reserved.replayed)
      return answer(200, { ...publicPicture(reserved), commandId, replayed: true });
    // Files written for a reservation that never becomes the picture are deleted at once, best effort. A file that cannot
    // be deleted keeps its reservation row and is offered for deletion again once the reservation is an hour old.
    const discard = async () => {
      try {
        await storage.delete(storage.storageRef, reserved.objectId);
      } catch {
        log('profile_picture_discard_pending', 200);
      }
    };
    try {
      await storage.put(storage.storageRef, reserved.objectId, 'large', picture.large.body);
      await storage.put(storage.storageRef, reserved.objectId, 'small', picture.small.body);
    } catch {
      log('profile_picture_store_failed', 503);
      await discard();
      return refuse(
        503,
        'storage_unavailable',
        'The picture could not be stored. Try again in a few minutes.',
      );
    }
    let result: Awaited<ReturnType<typeof s.customerProfilePictures.commit>>;
    try {
      result = await s.customerProfilePictures.commit(
        {
          commandId,
          expectedVersion,
          requestHash,
          objectId: reserved.objectId,
          large: picture.large,
          small: picture.small,
        },
        ...context(request),
      );
    } catch (error) {
      // A stale version, a conflicting command, a closed account or an erasure request: nothing points at these files.
      await discard();
      throw error;
    }
    await purge(storage, result.pending, (ids) =>
      s.customerProfilePictures.purged(ids, ...context(request)),
    );
    return answer(200, { ...publicPicture(result), commandId, replayed: result.replayed });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  if (!open()) return notFound();
  try {
    const { s, storage } = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      return refuse(403, 'origin_refused', 'Request origin is not allowed');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return refuse(415, 'json_required', 'JSON required');
    const input = profilePictureRemoveInput.parse(
      JSON.parse((await boundedBody(request, 1024)).toString('utf8')),
    );
    const result = await s.customerProfilePictures.remove(input, ...context(request));
    await purge(storage, result.pending, (ids) =>
      s.customerProfilePictures.purged(ids, ...context(request)),
    );
    return answer(200, {
      ...publicPicture(result),
      commandId: input.commandId,
      replayed: result.replayed,
    });
  } catch (error) {
    return failure(error);
  }
}
