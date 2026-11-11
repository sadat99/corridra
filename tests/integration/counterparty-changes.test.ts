import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { command, future } from './access-fixture';
import { rawContext } from './support';
import {
  addMember,
  asOwner,
  changesWorld,
  correctContact,
  correctNote,
  counts,
  hideContact,
  hideReason,
  noteOn,
  reasonText,
  refused,
  storedRow,
  ticket,
  withdrawContact,
  withdrawNote,
  type Member,
  type World,
} from './counterparty-changes-support';
import { hash } from '../../packages/communications/src/index';
import { SyntheticChannel } from '../../packages/communications/src/adapters';
import { OutboxDispatcher } from '../../packages/workflows/src/index';
import { notSentForContact } from '../../apps/web/app/operator/contact-not-sent';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { EvidenceService } from '../../packages/evidence/src/index';

// CRUD G11 withdraw and correct (CRUD-1 to CRUD-6), the event payloads (Guardian C3), the send-time check (C4) and the
// real-use workspace (owner answer 4). The relationship of every target() is owned by the operator, OWNER visibility.
let f: World;
let admin: Member, otherOperator: Member, revoked: Member, disabled: Member;
const organisationOf = async (relationshipId: string) =>
  (
    await f.owner.query('SELECT organisation_id FROM app.relationship WHERE id=$1', [
      relationshipId,
    ])
  ).rows[0].organisation_id as string;
const contactIn = async (relationshipId: string, contactId: string, ctx = f.ctx) =>
  (await f.research.detail(ctx, await organisationOf(relationshipId))).contacts.find(
    (c) => c.id === contactId,
  );
beforeAll(async () => {
  f = await changesWorld();
  admin = await addMember(f, 'admin');
  otherOperator = await addMember(f, 'operator');
  revoked = await addMember(f, 'admin');
  disabled = await addMember(f, 'admin');
  await asOwner(f, 'UPDATE app.membership SET revoked_at=now() WHERE user_id=$1', [revoked.id]);
  await asOwner(f, 'UPDATE identity.principal SET disabled_at=now() WHERE id=$1', [disabled.id]);
});
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

describe('CRUD-1 who may withdraw and correct', () => {
  test('the relationship owner and a workspace owner or admin can withdraw and correct contacts and notes', async () => {
    const t = await f.target();
    const notes = [await noteOn(f, t), await noteOn(f, t)];
    const corrected = await f.research.command(
      f.users.owner.ctx,
      correctContact(t.contactId, t.sourceId),
    );
    expect(corrected).toMatchObject({ kind: 'CORRECT', contactId: t.contactId });
    expect(corrected.replacementId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await f.research.command(f.ctx, withdrawContact(corrected.replacementId))).toMatchObject(
      { kind: 'WITHDRAW', contactId: corrected.replacementId },
    );
    expect(await f.research.command(admin.ctx, withdrawNote(notes[0]!.id))).toMatchObject({
      kind: 'WITHDRAW',
      noteId: notes[0]!.id,
    });
    const note = await f.research.command(f.ctx, correctNote(notes[1]!.id, t.sourceId));
    expect(note).toMatchObject({ kind: 'CORRECT', noteId: notes[1]!.id });
    const detail = await f.research.detail(f.ctx, await organisationOf(t.relationshipId));
    expect(detail.changes).toEqual({ installed: true, open: true });
    expect(detail.relationships.find((r) => r.id === t.relationshipId)?.can_change).toBe(true);
    const states = Object.fromEntries(
      [...detail.contacts, ...detail.notes].map((row) => [row.id, row.status]),
    );
    expect(states).toMatchObject({
      [t.contactId]: 'CORRECTED',
      [corrected.replacementId]: 'WITHDRAWN',
      [notes[0]!.id]: 'WITHDRAWN',
      [notes[1]!.id]: 'CORRECTED',
      [note.replacementId]: 'SOURCE_REPORTED',
    });
  });

  test('reviewer, viewer, a non-owner operator on a team relationship, a revoked member and a disabled principal get 403 with plain words, and nothing is written', async () => {
    const t = await f.target();
    const team = await f.research.command(
      f.ctx,
      command('relationship', {
        organisationId: await organisationOf(t.relationshipId),
        ownerId: f.users.operator.id,
        visibility: 'TEAM',
        note: 'Shared team relationship',
      }),
    );
    const teamContact = await f.research.command(
      f.ctx,
      command('contact', {
        relationshipId: team.id,
        sourceId: t.sourceId,
        name: 'Team Buyer',
        jobTitle: 'Buyer',
        email: `${randomUUID()}@example.invalid`,
        validUntil: future(6),
      }),
    );
    const before = await counts(f);
    for (const [ctx, contactId] of [
      [f.users.reviewer.ctx, t.contactId],
      [f.users.viewer.ctx, t.contactId],
      [otherOperator.ctx, teamContact.id],
      [revoked.ctx, t.contactId],
      [disabled.ctx, t.contactId],
      [f.users.outsider.ctx, t.contactId],
    ] as const) {
      const error = await refused(f.research.command(ctx, withdrawContact(contactId)), 403);
      expect(error.message).toBe(
        'Only the relationship owner or a workspace owner or admin can change this.',
      );
    }
    expect(
      (
        await f.research.detail(otherOperator.ctx, await organisationOf(team.id))
      ).relationships.find((r) => r.id === team.id)?.can_change,
    ).toBe(false);
    expect(await counts(f)).toEqual(before);
  });

  test('an item on a relationship the caller cannot see, or in another workspace, answers 404 exactly like a random id', async () => {
    const t = await f.target();
    const before = await counts(f);
    const random = await refused(f.research.command(f.ctx, withdrawContact(randomUUID())), 404);
    for (const ctx of [otherOperator.ctx, f.users.other.ctx]) {
      const error = await refused(f.research.command(ctx, withdrawContact(t.contactId)), 404);
      expect({ message: error.message, code: error.code }).toEqual({
        message: random.message,
        code: random.code,
      });
    }
    await expect(
      rawContext(
        f.runtime,
        f.users.other.ctx,
        "INSERT INTO app.private_contact_change(tenant_id,relationship_id,chain_id,contact_id,kind,reason,command_id,request_hash,classification,purpose,created_by) VALUES($1,$2,$3,$3,'WITHDRAW','Cross tenant',$4,$5,'INTERNAL','synthetic_validation',$6)",
        [f.tenantA, t.relationshipId, t.contactId, randomUUID(), 'a'.repeat(64), f.users.other.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await counts(f)).toEqual(before);
  });
});

describe('CRUD-2 retries', () => {
  test('the same command id twice gives one change and the same ids; changed values are refused; a double click writes one row', async () => {
    const t = await f.target();
    const input = withdrawContact(t.contactId);
    const [first, second] = await Promise.all([
      f.research.command(f.ctx, input),
      f.research.command(f.ctx, input),
    ]);
    expect(second).toEqual(first);
    expect(await f.research.command(f.ctx, input)).toEqual(first);
    await refused(f.research.command(f.ctx, { ...input, reason: 'Another reason entirely' }), 409);
    // Another person sending the same command id gets the reused-id words, never "this contact changed".
    const other = await f.target();
    const reused = await refused(
      f.research.command(f.users.owner.ctx, {
        ...withdrawContact(other.contactId),
        commandId: input.commandId,
      }),
      409,
    );
    expect(reused.message).toBe('Command ID reused with different values');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.private_contact_change WHERE contact_id=$1',
          [t.contactId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('CRUD-3 versions', () => {
  test('a stale version is refused with code CHANGED, and a refresh shows the latest version', async () => {
    const t = await f.target();
    const corrected = await f.research.command(f.ctx, correctContact(t.contactId, t.sourceId));
    for (const input of [withdrawContact(t.contactId), correctContact(t.contactId, t.sourceId)]) {
      const error = await refused(f.research.command(f.ctx, input), 409, 'CHANGED');
      expect(error.message).toBe('This contact changed. Refresh to see the latest.');
    }
    expect(await contactIn(t.relationshipId, corrected.replacementId)).toMatchObject({
      status: 'SOURCE_REPORTED',
      name: 'Synthetic Buyer Corrected',
      chain_id: t.contactId,
    });
  });

  test('two concurrent corrections of one version: exactly one wins', async () => {
    const t = await f.target();
    const results = await Promise.allSettled([
      f.research.command(f.ctx, correctContact(t.contactId, t.sourceId)),
      f.research.command(f.users.owner.ctx, correctContact(t.contactId, t.sourceId)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409, code: 'CHANGED' });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.private_contact_data WHERE relationship_id=$1',
          [t.relationshipId],
        )
      ).rows[0].n,
    ).toBe(2);
  });
});

describe('CRUD-4 references and recovery', () => {
  test('a withdrawn or corrected contact cannot be chosen for a new target, and existing targets still show it as Withdrawn', async () => {
    const t = await f.target();
    await f.research.command(f.ctx, withdrawContact(t.contactId));
    const list = await f.research.shortlist(f.ctx, t.missionId);
    expect(list.targets.find((x) => x.id === t.targetId)?.contacts[0]).toMatchObject({
      status: 'WITHDRAWN',
      name: 'Synthetic Buyer Person',
    });
    const other = await f.target();
    const corrected = await f.research.command(
      f.ctx,
      correctContact(other.contactId, other.sourceId),
    );
    expect(corrected.kind).toBe('CORRECT');
    for (const [relationshipId, contactId] of [
      [t.relationshipId, t.contactId],
      [other.relationshipId, other.contactId],
    ])
      await expect(
        rawContext(
          f.runtime,
          f.ctx,
          'INSERT INTO app.target_contact(tenant_id,purpose,created_by,target_id,relationship_id,contact_id) SELECT $1,$2,$3,id,relationship_id,$5 FROM app.target_account WHERE relationship_id=$4',
          [f.tenantA, 'synthetic_validation', f.users.operator.id, relationshipId, contactId],
        ),
      ).rejects.toThrow('Choose a current contact. This one was withdrawn, corrected or hidden.');
  });

  test('an expired contact can still be withdrawn, and a correction needs a current source', async () => {
    const t = await f.target();
    const expired = await f.research.command(
      f.ctx,
      command('contact', {
        relationshipId: t.relationshipId,
        sourceId: t.sourceId,
        name: 'Soon Expired',
        jobTitle: 'Buyer',
        email: `${randomUUID()}@example.invalid`,
        validUntil: new Date(Date.now() + 1500).toISOString(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await contactIn(t.relationshipId, expired.id))?.status).toBe('EXPIRED');
    expect(await f.research.command(f.ctx, withdrawContact(expired.id))).toMatchObject({
      kind: 'WITHDRAW',
    });
    await refused(f.research.command(f.ctx, correctContact(t.contactId, randomUUID())), 409);
  });

  test('research intake paused: correct is refused, withdraw still works', async () => {
    const t = await f.target();
    await f.a.appendConfig(f.users.owner.ctx, { key: 'research.ingestion', enabled: false });
    try {
      await refused(f.research.command(f.ctx, correctContact(t.contactId, t.sourceId)), 409);
      expect(await f.research.command(f.ctx, withdrawContact(t.contactId))).toMatchObject({
        kind: 'WITHDRAW',
      });
    } finally {
      await f.a.appendConfig(f.users.owner.ctx, { key: 'research.ingestion', enabled: true });
    }
  });
});

describe('CRUD-5 append only', () => {
  test('UPDATE and DELETE on contacts, notes and the three new tables are refused: the runtime role has no such grant, and even the schema owner meets the append-only trigger', async () => {
    const t = await f.target();
    const note = await noteOn(f, t);
    await f.research.command(f.ctx, withdrawContact(t.contactId));
    await f.research.command(f.ctx, withdrawNote(note.id));
    await f.research.command(f.users.owner.ctx, hideContact(t.contactId));
    for (const table of [
      'private_contact_data',
      'private_note',
      'private_contact_change',
      'private_note_change',
      'private_record_redaction',
    ])
      for (const sql of [
        `UPDATE app.${table} SET created_at=created_at WHERE tenant_id=$1`,
        `DELETE FROM app.${table} WHERE tenant_id=$1`,
      ]) {
        await expect(
          rawContext(f.runtime, f.users.owner.ctx, sql, [f.tenantA]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(f.owner.query(sql, [f.tenantA])).rejects.toMatchObject({ code: '23514' });
      }
  });

  test('originals stay byte-identical, and after a correction the original stays readable with reason, actor and time to the same roles', async () => {
    const t = await f.target();
    const note = await noteOn(f, t);
    const before = {
      contact: await storedRow(f, 'private_contact_data', t.contactId),
      note: await storedRow(f, 'private_note', note.id),
    };
    const corrected = await f.research.command(f.ctx, correctContact(t.contactId, t.sourceId));
    await f.research.command(f.ctx, correctNote(note.id, t.sourceId));
    for (const ctx of [f.ctx, f.users.reviewer.ctx]) {
      const original = await contactIn(t.relationshipId, t.contactId, ctx);
      expect(original).toMatchObject({
        status: 'CORRECTED',
        name: 'Synthetic Buyer Person',
        change_kind: 'CORRECT',
        change_reason: 'The job title was wrong',
        changed_by: f.users.operator.id,
        replacement_id: corrected.replacementId,
      });
      expect(original?.changed_at).toBeTruthy();
    }
    await f.research.command(f.users.owner.ctx, hideContact(corrected.replacementId));
    expect(await storedRow(f, 'private_contact_data', t.contactId)).toBe(before.contact);
    expect(await storedRow(f, 'private_note', note.id)).toBe(before.note);
  });
});

describe('CRUD-6 and Guardian C3 events', () => {
  test('withdraw, correct and hide each write one event, audit, outbox and delivery row holding ids and version only', async () => {
    const t = await f.target();
    const note = await noteOn(f, t);
    const email = (
      await f.owner.query('SELECT email FROM app.private_contact_data WHERE id=$1', [t.contactId])
    ).rows[0].email as string;
    const corrected = await f.research.command(
      f.ctx,
      correctContact(t.contactId, t.sourceId, { email: `${randomUUID()}@example.invalid` }),
    );
    const withdrawn = await f.research.command(f.ctx, withdrawNote(note.id));
    const hidden = await f.research.command(
      f.users.owner.ctx,
      hideContact(corrected.replacementId),
    );
    const correctedEmail = (
      await f.owner.query('SELECT email FROM app.private_contact_data WHERE id=$1', [
        corrected.replacementId,
      ])
    ).rows[0].email as string;
    const hashes = (
      await f.owner.query(
        'SELECT request_hash FROM app.private_contact_change WHERE id=$1 UNION ALL SELECT request_hash FROM app.private_note_change WHERE id=$2 UNION ALL SELECT request_hash FROM app.private_record_redaction WHERE id=$3',
        [corrected.id, withdrawn.id, hidden.id],
      )
    ).rows.map((r) => r.request_hash as string);
    for (const [type, id] of [
      ['private_contact_change.insert', corrected.id],
      ['private_note_change.insert', withdrawn.id],
      ['private_record_redaction.insert', hidden.id],
    ]) {
      const rows = (
        await f.owner.query(
          `SELECT d.payload,a.action,(SELECT count(*)::int FROM app.outbox o WHERE o.event_id=d.id) outbox,(SELECT count(*)::int FROM app.outbox_delivery x WHERE x.event_id=d.id) deliveries
           FROM app.domain_event d JOIN app.audit_event a ON a.domain_event_id=d.id WHERE d.type=$1 AND d.aggregate_id=$2`,
          [type, id],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: type, outbox: 1, deliveries: 1 });
      // record_change writes id, version and the revoked flag every event carries; this table has no status or role.
      expect(Object.keys(rows[0].payload).sort()).toEqual(['id', 'revoked', 'version']);
      expect(rows[0].payload).toEqual({ id, version: 1, revoked: false });
      const text = JSON.stringify(rows);
      for (const secret of [
        'Synthetic Buyer',
        'Procurement',
        email,
        correctedEmail,
        hash(email.toLowerCase()),
        note.body,
        reasonText,
        'The job title was wrong',
        hideReason,
        ticket,
        ...hashes,
      ])
        expect(text).not.toContain(secret);
    }
  });
});

describe('Guardian C4 send-time check', () => {
  const worker = () => new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime));
  const dispatch = async (id: string) =>
    (
      await f.owner.query(
        'SELECT j.status,j.attempts,j.last_error,(SELECT count(*)::int FROM app.communication_receipt r WHERE r.id=j.id) receipts FROM app.communication_dispatch j WHERE id=$1',
        [id],
      )
    ).rows[0];

  test('a queued synthetic message to a contact withdrawn after queueing is not delivered: no receipt, dispatch DEAD after one attempt', async () => {
    const i = await f.introduction();
    await f.research.command(f.ctx, withdrawContact(i.contactId));
    expect(await worker().attempt(i.id, f.communications.dispatchCapability(i.id))).toBe('DEAD');
    expect(await dispatch(i.id)).toMatchObject({
      status: 'DEAD',
      attempts: 1,
      last_error: 'PERMANENT',
      receipts: 0,
    });
    const listed = (await f.communications.workspace(f.ctx)).messages.find((m) => m.id === i.id);
    expect(listed).toMatchObject({ contact_status: 'WITHDRAWN' });
    // The messages list says "Not sent: contact withdrawn or hidden." only for a message this check stopped.
    expect(notSentForContact(listed!)).toBe(true);
  });

  test('same for a hidden chain and for an opted-out address elsewhere in the chain', async () => {
    const hidden = await f.introduction();
    await f.research.command(f.users.owner.ctx, hideContact(hidden.contactId));
    expect(await worker().attempt(hidden.id, f.communications.dispatchCapability(hidden.id))).toBe(
      'DEAD',
    );
    expect((await dispatch(hidden.id)).receipts).toBe(0);
    const t = await f.target();
    const corrected = await f.research.command(f.ctx, correctContact(t.contactId, t.sourceId));
    const queued = await f.introduction({ ...t, contactId: corrected.replacementId });
    await f.communications.command(
      f.ctx,
      command('optout', { contactId: t.contactId, reason: 'The person asked not to be contacted' }),
    );
    expect(await worker().attempt(queued.id, f.communications.dispatchCapability(queued.id))).toBe(
      'DEAD',
    );
    expect((await dispatch(queued.id)).receipts).toBe(0);
    const messages = (await f.communications.workspace(f.ctx)).messages;
    expect(notSentForContact(messages.find((m) => m.id === hidden.id)!)).toBe(true);
    // Stopped for an opted-out address, not for a withdrawn or hidden contact: no such words.
    expect(notSentForContact(messages.find((m) => m.id === queued.id)!)).toBe(false);
    // A message stopped for an unrelated reason, or a corrected contact, never reads as withdrawn or hidden.
    expect(
      notSentForContact({
        delivery_status: 'SUPPRESSED',
        last_error: 'POLICY_BLOCKED',
        contact_status: 'WITHDRAWN',
      }),
    ).toBe(false);
    expect(
      notSentForContact({
        delivery_status: 'DEAD',
        last_error: 'PERMANENT',
        contact_status: 'CORRECTED',
      }),
    ).toBe(false);
    expect(
      notSentForContact({
        delivery_status: 'PENDING',
        last_error: 'TRANSIENT',
        contact_status: 'HIDDEN',
      }),
    ).toBe(false);
  });

  test('a message to a withdrawn contact, or to a correction of an opted-out address, is refused before it is queued', async () => {
    const t = await f.target();
    await f.research.command(f.ctx, withdrawContact(t.contactId));
    await expect(f.introduction(t)).rejects.toThrow(
      'Choose a current contact. This one was withdrawn, corrected or hidden.',
    );
    const u = await f.target();
    await f.communications.command(
      f.ctx,
      command('optout', { contactId: u.contactId, reason: 'The person asked not to be contacted' }),
    );
    const corrected = await f.research.command(f.ctx, correctContact(u.contactId, u.sourceId));
    await expect(f.introduction({ ...u, contactId: corrected.replacementId })).rejects.toThrow(
      'Choose a current contact. This one was withdrawn, corrected or hidden.',
    );
  });

  test('a staff retry of a stopped message is refused by the contact state trigger, while a retry with a current contact still works', async () => {
    const i = await f.introduction();
    await f.research.command(f.ctx, withdrawContact(i.contactId));
    await worker().attempt(i.id, f.communications.dispatchCapability(i.id));
    await expect(
      f.communications.command(
        f.ctx,
        command('retry', { messageId: i.id, reason: 'Try the message again' }),
      ),
    ).rejects.toMatchObject({
      code: 'P0001',
      message: 'Choose a current contact. This one was withdrawn, corrected or hidden.',
    });
    expect((await dispatch(i.id)).status).toBe('DEAD');
    // Control: the same retry path for a message whose contact is current. Setting DEAD directly does not fire the
    // retry trigger (it only watches a stopped message going back to PENDING).
    const current = await f.introduction();
    await asOwner(f, "UPDATE app.communication_dispatch SET status='DEAD' WHERE id=$1", [
      current.id,
    ]);
    await f.communications.command(
      f.ctx,
      command('retry', { messageId: current.id, reason: 'Try the message again' }),
    );
    expect((await dispatch(current.id)).status).toBe('PENDING');
  });
});

describe('owner answer 4: real and sample workspaces behave the same', () => {
  test('real-use workspace: withdraw, correct and hide behave as in a sample workspace, correct keeps the real email rule, and withdraw works while real use is paused', async () => {
    vi.stubEnv('DATA_ENVIRONMENT', 'real');
    vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
    const issuer =
      'https://ep-g11-real-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
    await migrateCustomerRealUse(f.owner);
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'local-bootstrap-fixture',
      executorId: f.serviceId,
      reason: 'Local fixture authority only; never a production customer',
    });
    await configureCustomerRealUse(f.owner, {
      enabled: true,
      reason: 'Local functional fixture with owner-approved real use for G11',
    });
    const tenantId = (
      await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
    ).rows[0].intake_tenant_id as string;
    const ctx = { ...f.users.owner.ctx, tenantId };
    const unexpected = async () => {
      throw new Error('No file operation in this test');
    };
    const evidence = new EvidenceService(
      f.runtime,
      { put: unexpected, get: unexpected },
      { scan: unexpected },
    );
    const source = await evidence.createSource(ctx, {
      kind: 'public_record',
      classification: 'PUBLIC',
      locator: 'https://business.test/registry',
      observedAt: new Date().toISOString(),
      purpose: 'commercial_qualification',
      retentionUntil: future(2),
      aiPolicy: 'DENY',
    });
    const org = await f.research.command(
      ctx,
      command('ingest', {
        sourceId: source.id,
        name: 'Machinery Company',
        country: 'BD',
        domain: 'business.test',
        address: 'Company business address',
        identifierType: 'registry',
        identifier: randomUUID(),
      }),
    );
    const relationship = await f.research.command(
      ctx,
      command('relationship', {
        organisationId: org.id,
        ownerId: f.users.owner.id,
        visibility: 'OWNER',
        note: 'Prepare supplier discussions',
      }),
    );
    const contact = async (email: string) =>
      (
        await f.research.command(
          ctx,
          command('contact', {
            relationshipId: relationship.id,
            sourceId: source.id,
            name: 'Company contact',
            jobTitle: 'Commercial manager',
            email,
            validUntil: future(1),
          }),
        )
      ).id as string;
    const first = await contact('contact@business.test');
    const corrected = await f.research.command(ctx, {
      ...correctContact(first, source.id, { email: 'buyer@business.test' }),
      validUntil: future(1),
    });
    expect(corrected.kind).toBe('CORRECT');
    expect(
      (
        await f.owner.query('SELECT email,purpose FROM app.private_contact_data WHERE id=$1', [
          corrected.replacementId,
        ])
      ).rows[0],
    ).toEqual({ email: 'buyer@business.test', purpose: 'commercial_qualification' });
    // The route answers a schema refusal with 400.
    await expect(
      (async () =>
        f.research.command(ctx, {
          ...correctContact(corrected.replacementId, source.id, { email: 'not an address' }),
          validUntil: future(1),
        }))(),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(await f.research.command(ctx, hideContact(corrected.replacementId))).toMatchObject({
      kind: 'HIDE',
      chainId: first,
    });
    const second = await contact('second@business.test');
    await configureCustomerRealUse(f.owner, {
      enabled: false,
      reason: 'Pause real use to check withdraw still protects people',
    });
    expect(await f.research.command(ctx, withdrawContact(second))).toMatchObject({
      kind: 'WITHDRAW',
      contactId: second,
    });
  });
});
