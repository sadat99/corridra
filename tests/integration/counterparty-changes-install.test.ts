import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import {
  changesWorld,
  refused,
  storedRow,
  withdrawContact,
  noteOn,
  recordingPool,
  type World,
} from './counterparty-changes-support';
import { migrateCounterpartyChanges } from '../../packages/db/src/counterparty-change-migrate';
import { configureCounterpartyChanges } from '../../packages/auth/src/counterparty-change-configuration';
import { SyntheticChannel } from '../../packages/communications/src/adapters';
import { OutboxDispatcher } from '../../packages/workflows/src/index';

// CRUD G11, the optional module. Nothing installs it unless the owner asks; it installs with its one control closed, is
// repeatable, refuses changed files and a missing core schema, and replaces no existing function or trigger. With the
// module absent every read and command works as before, and withdraw, correct and hide answer that they are not
// available yet, never with a server error.
const schema = 'counterparty_change_migrations';
const existingFunctions = [
  'app.guard_research_record()',
  'app.guard_communication()',
  'app.communication_allowed(uuid,boolean)',
  'app.record_change()',
  'app.reject_rewrite()',
  'app.research_relationship_access(uuid,uuid,boolean)',
  'app.queue_communication(uuid,text)',
  'app.claim_communication(uuid,text,uuid)',
  'app.deliver_synthetic(uuid,text,uuid)',
  'app.finish_communication(uuid,text,uuid,text)',
  'app.retry_communication(uuid,text)',
  'app.buyer_view(text)',
  'app.buyer_decide(text,uuid,text,boolean)',
  'app.buyer_optout(text)',
  'app.guard_research_controls()',
];
const triggeredTables = [
  'private_contact_data',
  'private_note',
  'target_contact',
  'communication',
  'communication_dispatch',
  'communication_receipt',
];
const newTriggers = [
  'target_contact_contact_state',
  'communication_contact_state',
  'communication_dispatch_contact_state',
  'communication_dispatch_retry_contact_state',
  'communication_receipt_contact_state',
];
const definitions = async (f: World) =>
  (
    await f.owner.query(
      `SELECT p::text AS name,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(p)),'UTF8')),'hex') AS hash FROM unnest($1::text[]) AS p ORDER BY 1`,
      [existingFunctions],
    )
  ).rows;
const triggers = async (f: World) =>
  (
    await f.owner.query(
      `SELECT c.relname,t.tgname,t.tgfoid::regprocedure::text AS fn FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='app' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal AND NOT t.tgname=ANY($2::text[]) ORDER BY 1,2`,
      [triggeredTables, newTriggers],
    )
  ).rows;
const installed = async (f: World) =>
  (await f.owner.query("SELECT to_regclass('app.private_contact_state') IS NOT NULL AS present"))
    .rows[0].present as boolean;

let f: World;
let before: { definitions: unknown; triggers: unknown; core: unknown };
let t: Awaited<ReturnType<World['target']>>;
let note: { id: string; body: string };
let queued: Awaited<ReturnType<World['introduction']>>;
let original: { contact: string; note: string };
beforeAll(async () => {
  f = await changesWorld({ install: false });
  t = await f.target();
  note = await noteOn(f, t);
  queued = await f.introduction();
  original = {
    contact: await storedRow(f, 'private_contact_data', t.contactId),
    note: await storedRow(f, 'private_note', note.id),
  };
  before = {
    definitions: await definitions(f),
    triggers: await triggers(f),
    core: (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name')).rows,
  };
});
afterAll(async () => {
  await f?.close();
});

describe('with the module absent', () => {
  test('detail, shortlist, export, communications lists and existing research commands work as today; withdraw, correct and hide answer 409 CHANGES_UNAVAILABLE', async () => {
    const detail = await f.research.detail(
      f.ctx,
      (
        await f.owner.query('SELECT organisation_id FROM app.relationship WHERE id=$1', [
          t.relationshipId,
        ])
      ).rows[0].organisation_id,
    );
    expect(detail.changes).toEqual({ installed: false, open: false });
    expect(detail.contacts.find((c) => c.id === t.contactId)).toMatchObject({
      name: 'Synthetic Buyer Person',
      status: 'SOURCE_REPORTED',
    });
    expect(detail.notes.find((n) => n.id === note.id)).toMatchObject({ body: note.body });
    const list = await f.research.shortlist(f.ctx, t.missionId);
    expect(list.changes).toEqual({ installed: false, open: false });
    expect(list.targets[0].contacts[0]).toMatchObject({ status: 'SOURCE_REPORTED' });
    expect((await f.research.shortlistExport(f.ctx, t.missionId)).targets[0].contacts).toEqual(
      list.targets[0].contacts,
    );
    const lists = await f.communications.workspace(f.ctx);
    expect(lists.contacts.some((c) => c.id === t.contactId)).toBe(true);
    expect(lists.messages.every((m) => !('contact_status' in m))).toBe(true);
    await noteOn(f, t);
    const events = async () =>
      (await f.owner.query('SELECT count(*)::int n FROM app.domain_event')).rows[0].n;
    const before = await events();
    for (const input of [
      withdrawContact(t.contactId),
      { action: 'withdraw_note', commandId: randomUUID(), noteId: note.id, reason: 'Wrong fair' },
    ]) {
      const error = await refused(f.research.command(f.ctx, input), 409, 'CHANGES_UNAVAILABLE');
      expect(error.message).toBe(
        'Withdraw, correct and hide are not available in this workspace yet.',
      );
    }
    expect(await events()).toBe(before);
  });

  test('configuring the control refuses before the module is installed', async () => {
    await expect(
      configureCounterpartyChanges(f.owner, { enabled: true, reason: 'Opening too early here' }),
    ).rejects.toThrow('Contact and note changes are not installed');
  });

  test('the dispatcher sends a queued synthetic message exactly as today, with no contact check', async () => {
    const recorded = recordingPool(f.runtime);
    const worker = new OutboxDispatcher(recorded.pool, new SyntheticChannel(f.runtime));
    expect(await worker.attempt(queued.id, f.communications.dispatchCapability(queued.id))).toBe(
      'DELIVERED',
    );
    expect(recorded.calls).toEqual([
      ...['BEGIN', 'claim_communication', 'probe', 'COMMIT', 'release'].map((step) => ({
        client: 1,
        step,
      })),
      { client: 'pool', step: 'finish_communication DELIVERED' },
    ]);
  });
});

describe('installing the module', () => {
  test('refuses, writing nothing, without the core research and communication schema', async () => {
    const g = await fixture('corridra_upgrade', '0007_mission_core.sql');
    try {
      await expect(migrateCounterpartyChanges(g.owner)).rejects.toThrow(
        'The core research and communication schema is not installed',
      );
      expect(
        (await g.owner.query(`SELECT to_regclass('${schema}.applied') IS NOT NULL AS present`))
          .rows[0].present,
      ).toBe(false);
    } finally {
      await g.close();
    }
  });

  test('installs closed, is idempotent and leaves every existing function, trigger, core hash and row unchanged', async () => {
    await migrateCounterpartyChanges(f.owner);
    await migrateCounterpartyChanges(f.owner);
    expect(await installed(f)).toBe(true);
    expect(
      (await f.owner.query(`SELECT name FROM ${schema}.applied ORDER BY name`)).rows.map(
        (r) => r.name,
      ),
    ).toEqual(['0001_contact_and_note_changes.sql']);
    expect(
      (await f.owner.query('SELECT app.counterparty_change_enabled() AS open')).rows[0].open,
    ).toBe(false);
    expect(await definitions(f)).toEqual(before.definitions);
    expect(await triggers(f)).toEqual(before.triggers);
    expect(
      (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name')).rows,
    ).toEqual(before.core);
    expect(await storedRow(f, 'private_contact_data', t.contactId)).toBe(original.contact);
    expect(await storedRow(f, 'private_note', note.id)).toBe(original.note);
  });

  test('each new function pins its search path to pg_catalog, and only the stated ones run as their owner', async () => {
    const rows = (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text AS name,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='app' AND p.proname=ANY($1::text[]) ORDER BY 1`,
        [
          [
            'counterparty_change_enabled',
            'guard_private_record_change',
            'private_contact_inactive',
            'refuse_inactive_contact',
            'private_contact_message_active',
            'private_record_redaction_reasons',
          ],
        ],
      )
    ).rows;
    expect(rows).toEqual([
      {
        name: 'app.counterparty_change_enabled()',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
      },
      {
        name: 'app.guard_private_record_change()',
        prosecdef: false,
        proconfig: ['search_path=pg_catalog'],
      },
      {
        name: 'app.private_contact_inactive(uuid,uuid,boolean)',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
      },
      {
        name: 'app.private_contact_message_active(uuid,text)',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
      },
      {
        name: 'app.private_record_redaction_reasons(uuid,uuid[])',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
      },
      {
        name: 'app.refuse_inactive_contact()',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
      },
    ]);
    expect(
      (
        await f.owner.query(
          `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app'
           AND p.proname IN ('guard_private_record_change','private_contact_inactive','refuse_inactive_contact')
           AND has_function_privilege('corridra_runtime',p.oid,'EXECUTE')`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('refuses a changed applied file', async () => {
    const row = (await f.owner.query(`SELECT sha256 FROM ${schema}.applied`)).rows[0];
    await f.owner.query(`UPDATE ${schema}.applied SET sha256=$1`, ['0'.repeat(64)]);
    try {
      await expect(migrateCounterpartyChanges(f.owner)).rejects.toThrow(
        'Contact and note change migration history mismatch',
      );
    } finally {
      await f.owner.query(`UPDATE ${schema}.applied SET sha256=$1`, [row.sha256]);
    }
  });
});

describe('the one control', () => {
  test('installed and closed: reads show states, commands answer 409 with the not open words', async () => {
    const list = await f.research.shortlist(f.ctx, t.missionId);
    expect(list.changes).toEqual({ installed: true, open: false });
    const error = await refused(
      f.research.command(f.ctx, withdrawContact(t.contactId)),
      409,
      'CHANGES_UNAVAILABLE',
    );
    expect(error.message).toBe('Withdraw, correct and hide are not open yet in this workspace.');
  });

  test('open and pause each need a reason; pause blocks commands and keeps reads and states', async () => {
    await expect(
      configureCounterpartyChanges(f.owner, { enabled: true, reason: 'short' }),
    ).rejects.toThrow();
    const opened = await configureCounterpartyChanges(f.owner, {
      enabled: true,
      reason: 'Owner opened contact and note changes',
    });
    expect(opened).toEqual({ enabled: true, changed: true });
    expect(
      await configureCounterpartyChanges(f.owner, {
        enabled: true,
        reason: 'Owner opened contact and note changes',
      }),
    ).toEqual({ enabled: true, changed: false });
    const done = await f.research.command(f.ctx, withdrawContact(t.contactId));
    expect(done).toMatchObject({ kind: 'WITHDRAW', contactId: t.contactId });
    await configureCounterpartyChanges(f.owner, {
      enabled: false,
      reason: 'Owner paused contact and note changes',
    });
    await refused(
      f.research.command(f.ctx, {
        action: 'withdraw_note',
        commandId: randomUUID(),
        noteId: note.id,
        reason: 'Wrong fair',
      }),
      409,
      'CHANGES_UNAVAILABLE',
    );
    const list = await f.research.shortlist(f.ctx, t.missionId);
    expect(list.targets.find((x) => x.id === t.targetId)?.contacts[0]).toMatchObject({
      status: 'WITHDRAWN',
      name: 'Synthetic Buyer Person',
    });
    expect(
      (
        await f.owner.query(
          'SELECT version,enabled FROM app.counterparty_change_control ORDER BY version',
        )
      ).rows,
    ).toEqual([
      { version: 1, enabled: true },
      { version: 2, enabled: false },
    ]);
  });
});
