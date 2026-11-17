import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import {
  CustomerSessionBoundary,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from './customer-session';

// ADR-088: the signed-in person's own profile picture. Server-only. The database decides who the person is
// (customer.actor_id() from the fresh provider session); nothing here takes a person id from the browser. The rows hold
// references only (storage backend, object id, SHA-256 and size of each re-encoded file); the files are on private object
// storage and only the picture route reads them.
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().min(0).max(2147483646);
const storageRef = z.string().regex(/^(vercel-blob|s3):[a-zA-Z0-9._-]{1,200}$/);
export const profilePictureRemoveInput = z
  .object({ commandId: z.uuid(), expectedVersion: version })
  .strict();
export const profilePictureUploadHeaders = z.object({
  commandId: z.uuid(),
  expectedVersion: z.coerce.number().int().min(0).max(2147483646),
});
// Uploads per person per rolling hour, counted before any image work; a replay counts too.
export const profilePictureHourlyUploads = 20;
export const profilePictureStaleMessage = 'Picture changed; reload before saving';
export const profilePictureNothingMessage = 'There is no picture to remove';
export type ProfilePictureObject = { id: string; storageRef: string };
export type ProfilePictureStored = {
  id: string;
  storageRef: string;
  largeSha256: string;
  largeBytes: number;
  smallSha256: string;
  smallBytes: number;
  updatedAt: string;
};
export type ProfilePictureView = { currentVersion: number; picture: ProfilePictureStored | null };
export type ProfilePictureChange = ProfilePictureView & {
  commandId: string;
  replayed: boolean;
  superseded: boolean;
  pending: ProfilePictureObject[];
};
export type ProfilePictureReservation =
  | (ProfilePictureChange & { replayed: true })
  | {
      commandId: string;
      replayed: false;
      objectId: string;
      currentVersion: number;
      pending: ProfilePictureObject[];
    };
// What the browser receives: no storage reference, no hash, no object id beyond the version it shows.
export type ProfilePicturePublic = {
  currentVersion: number;
  picture: { version: number; updatedAt: string } | null;
};
export const publicPicture = (view: ProfilePictureView): ProfilePicturePublic => ({
  currentVersion: view.currentVersion,
  picture: view.picture
    ? { version: view.currentVersion, updatedAt: view.picture.updatedAt }
    : null,
});
// The per-person budget key: no name and no email, only the issuer and subject, keyed with the server secret.
export function profilePictureBudgetKey(secret: string, issuer: string, subject: string) {
  return createHmac('sha256', secret)
    .update('account:picture:' + issuer + ':' + subject)
    .digest('hex');
}
// A keyed one-way hash of what was asked: for a new picture the SHA-256 of the uploaded bytes, for a removal a fixed word.
// The same command with another picture is refused; the hash cannot be turned back into the picture.
export function profilePictureRequestHash(secret: string, kind: 'set' | 'remove', bytesSha = '') {
  return createHmac('sha256', secret)
    .update('account:picture-request:' + kind + ':' + bytesSha)
    .digest('hex');
}

export class CustomerProfilePictureService extends CustomerSessionBoundary {
  constructor(
    runtime: DatabasePool,
    auth: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
    private readonly secret: string,
  ) {
    super(runtime, auth, options, readSession);
  }
  private one<T>(text: string, values: unknown[], subject?: string, issuer?: string) {
    return this.transaction(
      async (db) => (await db.query<{ result: T }>(text, values)).rows[0]!.result,
      subject,
      issuer,
    );
  }
  view(subject?: string, issuer?: string) {
    return this.one<ProfilePictureView>(
      'SELECT customer.profile_picture_view() AS result',
      [],
      subject,
      issuer,
    );
  }
  // Before any image work: the account refusals (through the view) and the hourly budget. Answers whether it is spent.
  async uploadBudget(subject?: string, issuer?: string) {
    return this.transaction(
      async (db, proof) => {
        await db.query('SELECT customer.profile_picture_view()');
        const ok = (
          await db.query<{ ok: boolean }>('SELECT app.intake_budget($1,$2) AS ok', [
            profilePictureBudgetKey(this.secret, proof.issuer, proof.subject),
            profilePictureHourlyUploads,
          ])
        ).rows[0]!.ok;
        return { limited: !ok };
      },
      subject,
      issuer,
    );
  }
  reserve(
    commandId: string,
    expectedVersion: number,
    requestHash: string,
    ref: string,
    subject?: string,
    issuer?: string,
  ) {
    return this.one<ProfilePictureReservation>(
      'SELECT customer.profile_picture_reserve($1,$2,$3,$4) AS result',
      [
        z.uuid().parse(commandId),
        version.parse(expectedVersion),
        sha.parse(requestHash),
        storageRef.parse(ref),
      ],
      subject,
      issuer,
    );
  }
  commit(
    input: {
      commandId: string;
      expectedVersion: number;
      requestHash: string;
      objectId: string;
      large: { sha256: string; bytes: number };
      small: { sha256: string; bytes: number };
    },
    subject?: string,
    issuer?: string,
  ) {
    const bytes = z.number().int().min(1).max(1048576);
    return this.one<ProfilePictureChange>(
      'SELECT customer.profile_picture_commit($1,$2,$3,$4,$5,$6,$7,$8) AS result',
      [
        z.uuid().parse(input.commandId),
        version.parse(input.expectedVersion),
        sha.parse(input.requestHash),
        z.uuid().parse(input.objectId),
        sha.parse(input.large.sha256),
        bytes.parse(input.large.bytes),
        sha.parse(input.small.sha256),
        bytes.parse(input.small.bytes),
      ],
      subject,
      issuer,
    );
  }
  remove(input: unknown, subject?: string, issuer?: string) {
    const { commandId, expectedVersion } = profilePictureRemoveInput.parse(input);
    return this.one<ProfilePictureChange>(
      'SELECT customer.profile_picture_remove($1,$2,$3) AS result',
      [commandId, expectedVersion, profilePictureRequestHash(this.secret, 'remove')],
      subject,
      issuer,
    );
  }
  // After the files of these objects were deleted, their rows go.
  purged(objects: string[], subject?: string, issuer?: string) {
    return this.one<number>(
      'SELECT customer.profile_picture_purged($1::uuid[]) AS result',
      [z.array(z.uuid()).max(20).parse(objects)],
      subject,
      issuer,
    );
  }
}

// Staff side, inside the erasure queue (members.manage with a fresh authenticator check; the database repeats the privacy
// check). Retires every picture of the person named by the erasure request and lists the objects whose files to delete.
export class CustomerProfilePictureErasure {
  constructor(private runtime: DatabasePool) {}
  erase(ctx: RequestContext, commandId: string, erasureRequest: string) {
    return withTenant(this.runtime, ctx, 'members.manage', async (t) => {
      return (
        await t.db.query<{
          result: { reference: string; retired: number; pending: ProfilePictureObject[] };
        }>('SELECT customer.profile_picture_erase($1,$2) AS result', [
          z.uuid().parse(commandId),
          z.uuid().parse(erasureRequest),
        ])
      ).rows[0]!.result;
    });
  }
  purged(ctx: RequestContext, erasureRequest: string, objects: string[]) {
    return withTenant(this.runtime, ctx, 'members.manage', async (t) => {
      return (
        await t.db.query<{ result: number }>(
          'SELECT customer.profile_picture_erase_purged($1,$2::uuid[]) AS result',
          [z.uuid().parse(erasureRequest), z.array(z.uuid()).max(100).parse(objects)],
        )
      ).rows[0]!.result;
    });
  }
}
