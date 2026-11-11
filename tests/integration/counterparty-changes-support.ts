import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { accessFixture, command, future } from './access-fixture';
import { migrateCounterpartyChanges } from '../../packages/db/src/counterparty-change-migrate';
import { configureCounterpartyChanges } from '../../packages/auth/src/counterparty-change-configuration';
import type { RequestContext } from '../../packages/db/src/index';

// CRUD G11 test world: the Part 06 access fixture (relationships, contacts, targets and synthetic messages), extra
// members for the role cases, and short helpers for each command. The relationship of every target() is owned by
// the operator with OWNER visibility.
export type World = Awaited<ReturnType<typeof accessFixture>>;
export type Member = { id: string; sessionId: string; ctx: RequestContext };
export const reasonText = 'The buyer asked us to stop using this entry';
export const hideReason = 'Request from the person to stop showing their details';
export const ticket = 'REQ-2026-0142';

export async function changesWorld({ install = true, open = true } = {}) {
  const f = await accessFixture();
  if (install) await migrateCounterpartyChanges(f.owner);
  if (install && open)
    await configureCounterpartyChanges(f.owner, {
      enabled: true,
      reason: 'Open contact and note changes for the test world',
    });
  return f;
}

/** A further member of a tenant. `staleMfa` signs them in with an authenticator check older than five minutes. */
export async function addMember(
  f: World,
  role: string,
  { tenantId = f.tenantA, staleMfa = false } = {},
): Promise<Member> {
  const id = randomUUID(),
    identityId = randomUUID(),
    token = randomBytes(32).toString('hex'),
    sessionId = randomUUID();
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [f.serviceId, randomUUID(), randomUUID()],
    );
    await client.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
      [identityId, `Synthetic ${role} ${id.slice(0, 4)}`, `${id}@example.invalid`],
    );
    await client.query(
      "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
      [id, identityId],
    );
    await client.query(
      'INSERT INTO identity.session(id,"userId",token,"expiresAt") VALUES($1,$2,$3,now()+interval \'1 hour\')',
      [sessionId, identityId, token],
    );
    await client.query(`INSERT INTO identity.assurance VALUES($1,now()-$2::interval,'totp')`, [
      sessionId,
      staleMfa ? '1 hour' : '0 seconds',
    ]);
    await client.query('INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenantId,
      id,
      role,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { id, sessionId, ctx: { token, tenantId, purpose: 'synthetic_validation' } };
}

/** Runs one statement as the schema owner with a bootstrap actor, for setup changes such as revoking a member. */
export async function asOwner(f: World, sql: string, args: unknown[] = []) {
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [f.serviceId, randomUUID(), randomUUID()],
    );
    const result = await client.query(sql, args);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const withdrawContact = (contactId: string, reason = reasonText) =>
  command('withdraw_contact', { contactId, reason });
export const correctContact = (
  contactId: string,
  sourceId: string,
  values: { name?: string; jobTitle?: string; email?: string } = {},
) =>
  command('correct_contact', {
    contactId,
    sourceId,
    name: values.name ?? 'Synthetic Buyer Corrected',
    jobTitle: values.jobTitle ?? 'Head of Procurement',
    email: values.email ?? `${randomUUID()}@example.invalid`,
    validUntil: future(6),
    reason: 'The job title was wrong',
  });
export const hideContact = (contactId: string, confirmId = contactId) =>
  command('redact_contact', { contactId, confirmId, reason: hideReason, ticketReference: ticket });
export const withdrawNote = (noteId: string, reason = reasonText) =>
  command('withdraw_note', { noteId, reason });
export const correctNote = (noteId: string, sourceId: string, body = 'Corrected private note') =>
  command('correct_note', { noteId, sourceId, body, reason: 'The note named the wrong fair' });
export const hideNote = (noteId: string, confirmId = noteId) =>
  command('redact_note', { noteId, confirmId, reason: hideReason, ticketReference: ticket });

/** A private note on the target's relationship, written by the relationship owner. */
export async function noteOn(
  f: World,
  t: { relationshipId: string; sourceId: string },
  body = `Private note ${randomUUID()}`,
) {
  const note = await f.research.command(
    f.ctx,
    command('note', { relationshipId: t.relationshipId, sourceId: t.sourceId, body }),
  );
  return { id: note.id as string, body };
}

/** The contact row as stored, for the byte-identical checks. */
export async function storedRow(
  f: World,
  table: 'private_contact_data' | 'private_note',
  id: string,
) {
  return (
    await f.owner.query(
      `SELECT encode(sha256(convert_to(row_to_json(r)::text,'UTF8')),'hex') h FROM app.${table} r WHERE id=$1`,
      [id],
    )
  ).rows[0].h as string;
}

export const counts = async (f: World) =>
  (
    await f.owner
      .query(`SELECT (SELECT count(*) FROM app.private_contact_change)::int contact_changes,
      (SELECT count(*) FROM app.private_note_change)::int note_changes,
      (SELECT count(*) FROM app.private_record_redaction)::int redactions,
      (SELECT count(*) FROM app.domain_event)::int events,(SELECT count(*) FROM app.audit_event)::int audits,
      (SELECT count(*) FROM app.outbox)::int outbox`)
  ).rows[0];

/** Expects the promise to be refused with this HTTP status (and code, when given), returning the error. */
export async function refused(promise: Promise<unknown>, status: number, code?: string) {
  const error = await promise.then(
    () => {
      throw new Error('Expected a refusal');
    },
    (e: unknown) => e as { status?: number; code?: string; message: string },
  );
  expect(error.status, error.message).toBe(status);
  if (code) expect(error.code).toBe(code);
  return error;
}
