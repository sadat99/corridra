import type { TenantTransaction } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import type { RecordChangeCommand } from '@corridra/domain/counterparties';

// CRUD G11 (ADR-017 amendment, 10 November 2026): withdraw, correct and hide private contacts and notes.
// The optional module adds append-only change and hide records and two state views. When the module is installed, every
// read of contact or note text goes through the views, which return no text for a hidden chain. When it is not
// installed, the existing reads run unchanged and the commands answer that the feature is not available yet.
export const changeWords = {
  notInstalled: 'Withdraw, correct and hide are not available in this workspace yet.',
  closed: 'Withdraw, correct and hide are not open yet in this workspace.',
  denied: 'Only the relationship owner or a workspace owner or admin can change this.',
  hideContactDenied: 'Only a workspace owner or admin can hide contact details.',
  hideNoteDenied: 'Only a workspace owner or admin can hide notes.',
  stepUpContact: 'Verify your authenticator again to hide contact details.',
  stepUpNote: 'Verify your authenticator again to hide this note.',
  contactChanged: 'This contact changed. Refresh to see the latest.',
  noteChanged: 'This note changed. Refresh to see the latest.',
  contactHidden: 'This contact is hidden.',
  noteHidden: 'This note is hidden.',
  confirmContact: 'Type the contact id exactly to confirm',
  confirmNote: 'Type the note id exactly to confirm',
} as const;
export const CHANGES_UNAVAILABLE = 'CHANGES_UNAVAILABLE';
export const CHANGED = 'CHANGED';
export const HIDDEN = 'HIDDEN';
export type ChangeState = { installed: boolean; open: boolean };

/** G10-style capability probe, in the caller's transaction. The function is only parsed once the view exists. */
export async function changeState(t: TenantTransaction): Promise<ChangeState> {
  const probe = await t.db.query<{ installed: boolean }>(
    "SELECT to_regclass('app.private_contact_state') IS NOT NULL AS installed",
  );
  if (!probe.rows[0]?.installed) return { installed: false, open: false };
  const control = await t.db.query<{ open: boolean }>(
    'SELECT app.counterparty_change_enabled() AS open',
  );
  return { installed: true, open: control.rows[0]?.open === true };
}

const contactColumns = `id,chain_id,relationship_id,name,job_title,email,source_id,valid_until,status,change_kind,change_reason,replacement_id,changed_by,changed_at,redaction_id,hidden_at,hidden_by,created_by,created_at`;
const noteColumns = `id,chain_id,relationship_id,body,source_id,created_at,status,change_kind,change_reason,replacement_id,changed_by,changed_at,redaction_id,hidden_at,hidden_by,created_by`;

/** Relationship detail through the state views. Owners and admins also get the hide reason and ticket reference. */
export async function stateDetail(t: TenantTransaction, relationshipIds: string[]) {
  const contacts = (
    await t.db.query(
      `SELECT ${contactColumns} FROM app.private_contact_state WHERE tenant_id=$1 AND relationship_id=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 100`,
      [t.tenantId, relationshipIds],
    )
  ).rows;
  const notes = (
    await t.db.query(
      `SELECT ${noteColumns} FROM app.private_note_state WHERE tenant_id=$1 AND relationship_id=ANY($2::uuid[]) ORDER BY created_at DESC,id LIMIT 100`,
      [t.tenantId, relationshipIds],
    )
  ).rows;
  const writable = (
    await t.db.query<{ id: string; can_change: boolean }>(
      'SELECT r.id,app.research_relationship_access($1,r.id,true) AS can_change FROM unnest($2::uuid[]) AS r(id)',
      [t.tenantId, relationshipIds],
    )
  ).rows;
  if (['owner', 'admin'].includes(t.role)) {
    const hidden = (
      await t.db.query<{ id: string; reason: string; ticket_reference: string }>(
        'SELECT id,reason,ticket_reference FROM app.private_record_redaction WHERE tenant_id=$1 AND relationship_id=ANY($2::uuid[])',
        [t.tenantId, relationshipIds],
      )
    ).rows;
    for (const row of [...contacts, ...notes]) {
      const match = hidden.find((h) => h.id === row.redaction_id);
      if (match) {
        row.redaction_reason = match.reason;
        row.ticket_reference = match.ticket_reference;
      }
    }
  }
  const manage = ['owner', 'admin', 'operator'].includes(t.role);
  return {
    contacts,
    notes,
    canChange: new Map(writable.map((r) => [r.id, manage && r.can_change])),
  };
}

/** Shortlist target contacts through the contact state view: the exact version the target used, with its state. */
export async function stateShortlistContacts(t: TenantTransaction, targetIds: string[]) {
  return (
    await t.db.query(
      `SELECT tc.target_id,c.name,c.job_title,c.email,c.valid_until,c.status FROM app.target_contact tc JOIN app.private_contact_state c ON c.tenant_id=tc.tenant_id AND c.id=tc.contact_id WHERE tc.tenant_id=$1 AND tc.target_id=ANY($2::uuid[])`,
      [t.tenantId, targetIds],
    )
  ).rows;
}

/** The export mapper: a hidden contact reads "Hidden" in every text field, never null, "null" or an empty cell. */
export function shortlistExport<T extends { targets: { contacts?: unknown }[] }>(list: T): T {
  return {
    ...list,
    targets: list.targets.map((target) => ({
      ...target,
      contacts: ((target.contacts ?? []) as Record<string, unknown>[]).map((contact) =>
        contact.status === HIDDEN
          ? { ...contact, name: 'Hidden', job_title: 'Hidden', email: 'Hidden' }
          : contact,
      ),
    })),
  };
}

type Subject = 'contact' | 'note';
type Item = {
  id: string;
  chain_id: string;
  relationship_id: string;
  status: string;
  change_kind: string | null;
  classification: string;
  purpose: string;
};
const subjectOf = (v: RecordChangeCommand): Subject =>
  v.action.endsWith('_contact') ? 'contact' : 'note';
const itemOf = (v: RecordChangeCommand) => ('contactId' in v ? v.contactId : v.noteId);
async function readItem(t: TenantTransaction, subject: Subject, id: string) {
  const r = await t.db.query<Item>(
    `SELECT id,chain_id,relationship_id,status,change_kind,classification,purpose FROM ${subject === 'contact' ? 'app.private_contact_state' : 'app.private_note_state'} WHERE tenant_id=$1 AND id=$2`,
    [t.tenantId, id],
  );
  if (!r.rows[0]) throw new DomainError('Record unavailable', 404);
  return r.rows[0];
}

type Written = {
  subject: Subject;
  id: string;
  kind: string;
  item_id: string | null;
  replacement_id: string | null;
  chain_id: string;
  request_hash: string;
};
/** Ids only: a replay never returns text, a reason or a ticket reference. */
function result(row: Written) {
  if (row.kind === 'HIDE') return { id: row.id, kind: row.kind, chainId: row.chain_id };
  return {
    id: row.id,
    kind: row.kind,
    [row.subject === 'contact' ? 'contactId' : 'noteId']: row.item_id,
    ...(row.replacement_id ? { replacementId: row.replacement_id } : {}),
  };
}

/** A command id already used by this person for a change or a hide: the same request answers with the first ids. */
export async function replayChange(t: TenantTransaction, commandId: string, hash: string) {
  const row = (
    await t.db.query<Written>(
      `SELECT 'contact' subject,id,kind,contact_id item_id,replacement_id,chain_id,request_hash FROM app.private_contact_change WHERE tenant_id=$1 AND command_id=$2 AND created_by=$3
       UNION ALL SELECT 'note',id,kind,note_id,replacement_id,chain_id,request_hash FROM app.private_note_change WHERE tenant_id=$1 AND command_id=$2 AND created_by=$3
       UNION ALL SELECT subject,id,'HIDE',NULL,NULL,chain_id,request_hash FROM app.private_record_redaction WHERE tenant_id=$1 AND command_id=$2 AND created_by=$3`,
      [t.tenantId, commandId, t.actorId],
    )
  ).rows[0];
  if (!row) return null;
  if (row.request_hash !== hash)
    throw new DomainError('Command ID reused with different values', 409);
  return result(row);
}

/**
 * Writes one withdraw, correct or hide. The caller has already taken the command lock, checked the module and control,
 * and the record switch for a correction. The chain lock serialises every change and hide of one contact or note, and
 * the typed id is compared only after it, so a hide never acts on a version that changed while it waited.
 */
export async function writeChange(t: TenantTransaction, v: RecordChangeCommand, hash: string) {
  const subject = subjectOf(v),
    contact = subject === 'contact',
    id = itemOf(v);
  const seen = await readItem(t, subject, id);
  await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${t.tenantId}:${contact ? 'private-contact' : 'private-note'}:${seen.chain_id}`,
  ]);
  const item = await readItem(t, subject, id);
  if (item.status === HIDDEN)
    throw new DomainError(
      contact ? changeWords.contactHidden : changeWords.noteHidden,
      409,
      HIDDEN,
    );
  const hide = v.action === 'redact_contact' || v.action === 'redact_note';
  if (item.change_kind && !(hide && item.change_kind === 'WITHDRAW'))
    throw new DomainError(
      contact ? changeWords.contactChanged : changeWords.noteChanged,
      409,
      CHANGED,
    );
  const owner = [t.tenantId, item.relationship_id];
  const provenance = [v.commandId, hash, item.classification, item.purpose, t.actorId];
  if (v.action === 'redact_contact' || v.action === 'redact_note') {
    if (v.confirmId.toLowerCase() !== id.toLowerCase())
      throw new DomainError(contact ? changeWords.confirmContact : changeWords.confirmNote, 400);
    const row = await t.db.query<Written>(
      `INSERT INTO app.private_record_redaction(tenant_id,relationship_id,subject,chain_id,${contact ? 'contact_chain_id' : 'note_chain_id'},reason,ticket_reference,command_id,request_hash,classification,purpose,created_by)
       VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING subject,id,'HIDE' kind,NULL::uuid item_id,NULL::uuid replacement_id,chain_id,request_hash`,
      [...owner, subject, item.chain_id, v.reason, v.ticketReference, ...provenance],
    );
    return result(row.rows[0]!);
  }
  let replacement: string | null = null;
  if (v.action === 'correct_contact')
    replacement = (
      await t.db.query<{ id: string }>(
        'INSERT INTO app.private_contact_data(tenant_id,purpose,created_by,relationship_id,source_id,name,job_title,email,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [
          t.tenantId,
          t.purpose,
          t.actorId,
          item.relationship_id,
          v.sourceId,
          v.name,
          v.jobTitle,
          v.email,
          v.validUntil,
        ],
      )
    ).rows[0]!.id;
  if (v.action === 'correct_note')
    replacement = (
      await t.db.query<{ id: string }>(
        'INSERT INTO app.private_note(tenant_id,purpose,created_by,relationship_id,source_id,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [t.tenantId, t.purpose, t.actorId, item.relationship_id, v.sourceId, v.body],
      )
    ).rows[0]!.id;
  const row = await t.db.query<Written>(
    `INSERT INTO app.${contact ? 'private_contact_change' : 'private_note_change'}(tenant_id,relationship_id,chain_id,${contact ? 'contact_id' : 'note_id'},kind,replacement_id,reason,command_id,request_hash,classification,purpose,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING '${subject}' subject,id,kind,${contact ? 'contact_id' : 'note_id'} item_id,replacement_id,chain_id,request_hash`,
    [
      ...owner,
      item.chain_id,
      id,
      replacement ? 'CORRECT' : 'WITHDRAW',
      replacement,
      v.reason,
      ...provenance,
    ],
  );
  return result(row.rows[0]!);
}

/** Plain words for a refused change. Nothing here reveals whether a record exists in another workspace. */
export function changeFailure(error: unknown, v: RecordChangeCommand): never {
  const contact = subjectOf(v) === 'contact',
    hide = v.action === 'redact_contact' || v.action === 'redact_note';
  const denied = hide
    ? contact
      ? changeWords.hideContactDenied
      : changeWords.hideNoteDenied
    : changeWords.denied;
  if (error instanceof DomainError) {
    if (error.status === 403) throw new DomainError(denied, 403);
    throw error;
  }
  const failure = error as { code?: string; message?: string };
  if (failure.code === '42501') {
    if (failure.message === 'Record unavailable') throw new DomainError('Record unavailable', 404);
    throw new DomainError(denied, 403);
  }
  // Another person's command id: the same plain words as a reused id, never "this contact changed".
  if (
    failure.code === '23505' &&
    /command_id/.test((failure as { constraint?: string }).constraint ?? '')
  )
    throw new DomainError('Command ID reused with different values', 409);
  if (failure.code === '23505')
    throw new DomainError(
      contact ? changeWords.contactChanged : changeWords.noteChanged,
      409,
      CHANGED,
    );
  if (failure.code === 'P0001') {
    const message = failure.message ?? '';
    const code = message.includes('changed')
      ? CHANGED
      : message.includes('hidden')
        ? HIDDEN
        : message === changeWords.closed
          ? CHANGES_UNAVAILABLE
          : undefined;
    throw new DomainError(message || 'Check the current record state', 409, code);
  }
  if (failure.code === '23503')
    throw new DomainError('Linked record unavailable for this relationship or workspace', 409);
  if (failure.code === '23514')
    throw new DomainError('Check source validity and the submitted record values', 400);
  throw error;
}
