import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { command } from './access-fixture';
import { connection, rawContext, sandbox } from './support';
import {
  addMember,
  changesWorld,
  correctContact,
  correctNote,
  counts,
  hideContact,
  hideNote,
  hideReason,
  noteOn,
  refused,
  ticket,
  withdrawContact,
  type Member,
  type World,
} from './counterparty-changes-support';
import { Pool, sessionHash } from '../../packages/db/src/index';
import { SyntheticChannel } from '../../packages/communications/src/adapters';
import { OutboxDispatcher } from '../../packages/workflows/src/index';

// CRUD G11 hiding (owner answers 1 to 3 and 8) and every reader of contact or note text (Guardian C2). The views return
// NULL with status HIDDEN; the export mapper writes "Hidden". Hidden is not deleted: stored bytes stay, so opt-outs
// keep working. Concurrency (C7) and the typed id compared after the chain lock (S26 fix to resolution 4).
const counterparties = { current: undefined as unknown };
const session = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/communication-orchestrator', () => ({ communicationOrchestrator: {} }));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: session },
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    counterparties: counterparties.current,
  }),
}));

let f: World;
let admin: Member, staleAdmin: Member;
const organisationOf = async (relationshipId: string) =>
  (
    await f.owner.query('SELECT organisation_id FROM app.relationship WHERE id=$1', [
      relationshipId,
    ])
  ).rows[0].organisation_id as string;
const detailOf = async (relationshipId: string, ctx = f.ctx) =>
  f.research.detail(ctx, await organisationOf(relationshipId));
const emailOf = async (id: string) =>
  (await f.owner.query('SELECT email FROM app.private_contact_data WHERE id=$1', [id])).rows[0]
    .email as string;
beforeAll(async () => {
  f = await changesWorld();
  counterparties.current = f.research;
  admin = await addMember(f, 'admin');
  staleAdmin = await addMember(f, 'admin', { staleMfa: true });
});
afterAll(async () => {
  await f?.close();
});

describe('who may hide (owner answer 2, Guardian C6)', () => {
  test('a workspace owner or admin with a fresh authenticator check, a reason, a ticket reference and the id typed again can hide', async () => {
    const t = await f.target();
    const typed = t.contactId.toUpperCase();
    expect(await f.research.command(admin.ctx, hideContact(t.contactId, typed))).toMatchObject({
      kind: 'HIDE',
      chainId: t.contactId,
    });
  });

  test('operator, reviewer and viewer are refused with plain words; the database also refuses an operator; nothing is written', async () => {
    const t = await f.target();
    const note = await noteOn(f, t);
    const before = await counts(f);
    for (const ctx of [f.ctx, f.users.reviewer.ctx, f.users.viewer.ctx]) {
      expect((await refused(f.research.command(ctx, hideContact(t.contactId)), 403)).message).toBe(
        'Only a workspace owner or admin can hide contact details.',
      );
      expect((await refused(f.research.command(ctx, hideNote(note.id)), 403)).message).toBe(
        'Only a workspace owner or admin can hide notes.',
      );
    }
    await expect(
      rawContext(
        f.runtime,
        f.ctx,
        "INSERT INTO app.private_record_redaction(tenant_id,relationship_id,subject,chain_id,contact_chain_id,reason,ticket_reference,command_id,request_hash,classification,purpose,created_by) VALUES($1,$2,'contact',$3,$3,$4,$5,$6,$7,'INTERNAL','synthetic_validation',$8)",
        [
          f.tenantA,
          t.relationshipId,
          t.contactId,
          hideReason,
          ticket,
          randomUUID(),
          'b'.repeat(64),
          f.users.operator.id,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await counts(f)).toEqual(before);
  });

  test('an admin with a stale authenticator check gets STEP_UP_REQUIRED and nothing is written', async () => {
    const t = await f.target();
    const before = await counts(f);
    const error = await refused(
      f.research.command(staleAdmin.ctx, hideContact(t.contactId)),
      401,
      'STEP_UP_REQUIRED',
    );
    expect(error.message).toBe('Verify your authenticator again to hide contact details.');
    expect(await counts(f)).toEqual(before);
  });

  test('a wrong typed id is 400 and a ticket reference with @ or spaces is refused at the boundary', async () => {
    const t = await f.target();
    const before = await counts(f);
    expect(
      (
        await refused(
          f.research.command(f.users.owner.ctx, hideContact(t.contactId, 'not-it')),
          400,
        )
      ).message,
    ).toBe('Type the contact id exactly to confirm');
    for (const ticketReference of ['person@example.invalid', 'REQ 1', 'ab'])
      await expect(
        (async () =>
          f.research.command(f.users.owner.ctx, {
            ...hideContact(t.contactId),
            ticketReference,
          }))(),
      ).rejects.toMatchObject({ name: 'ZodError' });
    expect(await counts(f)).toEqual(before);
  });

  test('an owner of another workspace gets the same 404 for a contact here as for a random id, and the refusal trigger reveals nothing either', async () => {
    const t = await f.target();
    const random = await refused(
      f.research.command(f.users.other.ctx, hideContact(randomUUID())),
      404,
    );
    const here = await refused(
      f.research.command(f.users.other.ctx, hideContact(t.contactId)),
      404,
    );
    expect({ message: here.message, code: here.code }).toEqual({
      message: random.message,
      code: random.code,
    });
    const probe = (contactId: string) =>
      rawContext(
        f.runtime,
        f.users.other.ctx,
        "INSERT INTO app.target_contact(tenant_id,purpose,created_by,target_id,relationship_id,contact_id) VALUES($1,'synthetic_validation',$2,$3,$4,$5)",
        [f.tenantB, f.users.other.id, randomUUID(), randomUUID(), contactId],
      ).then(
        () => ({ code: 'none', message: 'none' }),
        (e: { code: string; message: string }) => ({ code: e.code, message: e.message }),
      );
    await f.research.command(f.ctx, withdrawContact(t.contactId));
    expect(await probe(t.contactId)).toEqual(await probe(randomUUID()));
  });
});

describe('what one hide covers (owner answers 3 and 8)', () => {
  test('hiding the current version of a contact hides every version, and an older version id is refused as changed', async () => {
    const t = await f.target();
    const second = await f.research.command(f.ctx, correctContact(t.contactId, t.sourceId));
    const third = await f.research.command(f.ctx, correctContact(second.replacementId, t.sourceId));
    await refused(f.research.command(f.users.owner.ctx, hideContact(t.contactId)), 409, 'CHANGED');
    await f.research.command(f.users.owner.ctx, hideContact(third.replacementId));
    const versions = (await detailOf(t.relationshipId)).contacts.filter(
      (c) => c.chain_id === t.contactId,
    );
    expect(versions).toHaveLength(3);
    for (const v of versions)
      expect(v).toMatchObject({
        status: 'HIDDEN',
        name: null,
        job_title: null,
        email: null,
        change_reason: null,
        hidden_by: f.users.owner.id,
      });
  });

  test('hiding a note hides it and every corrected version', async () => {
    const t = await f.target();
    const note = await noteOn(f, t);
    const corrected = await f.research.command(f.ctx, correctNote(note.id, t.sourceId));
    await f.research.command(admin.ctx, hideNote(corrected.replacementId));
    const notes = (await detailOf(t.relationshipId)).notes.filter((n) => n.chain_id === note.id);
    expect(notes.map((n) => [n.status, n.body, n.change_reason])).toEqual([
      ['HIDDEN', null, null],
      ['HIDDEN', null, null],
    ]);
  });

  test('a hidden chain stays hidden through correct and withdraw in any order, and a second hide is refused', async () => {
    const t = await f.target();
    await f.research.command(f.ctx, withdrawContact(t.contactId));
    await f.research.command(f.users.owner.ctx, hideContact(t.contactId));
    for (const input of [
      withdrawContact(t.contactId),
      correctContact(t.contactId, t.sourceId),
      hideContact(t.contactId),
    ]) {
      const error = await refused(
        f.research.command(input.action === 'redact_contact' ? f.users.owner.ctx : f.ctx, input),
        409,
        'HIDDEN',
      );
      expect(error.message).toBe('This contact is hidden.');
    }
    expect(
      (await detailOf(t.relationshipId)).contacts.find((c) => c.id === t.contactId),
    ).toMatchObject({
      status: 'HIDDEN',
      change_kind: 'WITHDRAW',
      change_reason: null,
    });
  });

  test('owners and admins see the hide reason and ticket; others do not', async () => {
    const t = await f.target();
    await f.research.command(f.users.owner.ctx, hideContact(t.contactId));
    const mine = (await detailOf(t.relationshipId, admin.ctx)).contacts.find(
      (c) => c.id === t.contactId,
    );
    expect(mine).toMatchObject({ redaction_reason: hideReason, ticket_reference: ticket });
    for (const ctx of [f.ctx, f.users.reviewer.ctx]) {
      const theirs = (await detailOf(t.relationshipId, ctx)).contacts.find(
        (c) => c.id === t.contactId,
      );
      expect(theirs?.status).toBe('HIDDEN');
      expect(theirs).not.toHaveProperty('redaction_reason');
      expect(theirs).not.toHaveProperty('ticket_reference');
    }
  });
});

describe('every reader shows no hidden text (Guardian C2)', () => {
  let t: Awaited<ReturnType<World['target']>>;
  let message: Awaited<ReturnType<World['introduction']>>;
  let email: string;
  beforeAll(async () => {
    t = await f.target();
    message = await f.introduction(t);
    email = await emailOf(t.contactId);
    await f.research.command(f.users.owner.ctx, hideContact(t.contactId));
  });

  test('shortlist shows the HIDDEN status with no text, and its export reads Hidden, never null', async () => {
    const list = await f.research.shortlist(f.ctx, t.missionId);
    expect(list.targets[0].contacts[0]).toMatchObject({
      status: 'HIDDEN',
      name: null,
      email: null,
      job_title: null,
    });
    const exported = await f.research.shortlistExport(f.ctx, t.missionId);
    expect(exported.targets[0].contacts[0]).toMatchObject({
      name: 'Hidden',
      job_title: 'Hidden',
      email: 'Hidden',
      status: 'HIDDEN',
    });
    const text = JSON.stringify(exported.targets[0].contacts);
    expect(text).not.toContain('null');
    expect(text).not.toContain(email);
    expect(text).not.toContain('Synthetic Buyer Person');
  });

  test('the shortlist export route answers Hidden, never the text, null or "null", and needs a staff session', async () => {
    const { GET } = await import('../../apps/web/app/api/workspace/[action]/route');
    const url = `https://app.corridra.test/api/workspace/shortlist-export?tenant=${f.tenantA}&mission=${t.missionId}`;
    const params = { params: Promise.resolve({ action: 'shortlist-export' }) };
    session.mockResolvedValue(null);
    expect((await GET(new Request(url), params)).status).toBe(401);
    session.mockResolvedValue({ token: f.users.operator.token });
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="shortlist-page.json"',
    );
    const body = await response.text();
    const contacts = JSON.stringify(JSON.parse(body).targets[0].contacts);
    expect(contacts).toContain('"name":"Hidden"');
    expect(contacts).not.toContain('null');
    expect(body).not.toContain(email);
    expect(body).not.toContain('Synthetic Buyer Person');
  });

  test('the communications contact list omits withdrawn, corrected and hidden contacts, and the messages list carries no contact text', async () => {
    const withdrawn = await f.target();
    await f.research.command(f.ctx, withdrawContact(withdrawn.contactId));
    const corrected = await f.target();
    const c = await f.research.command(
      f.ctx,
      correctContact(corrected.contactId, corrected.sourceId),
    );
    const lists = await f.communications.workspace(f.ctx);
    const ids = lists.contacts.map((row) => row.id);
    for (const id of [t.contactId, withdrawn.contactId, corrected.contactId])
      expect(ids).not.toContain(id);
    expect(ids).toContain(c.replacementId);
    const listed = lists.messages.find((m) => m.id === message.id);
    expect(listed).toMatchObject({ contact_status: 'HIDDEN' });
    expect(JSON.stringify(lists.messages)).not.toContain(email);
    expect(JSON.stringify(lists.optouts)).not.toContain(email);
  });

  test('the buyer page for a hidden contact message holds no contact name or address', async () => {
    const view = JSON.stringify(
      await f.communications.buyer({ action: 'read', token: message.token }),
    );
    expect(view).not.toContain(email);
    expect(view).not.toContain('Synthetic Buyer Person');
  });

  test('catalogue search never finds a hidden contact name', async () => {
    expect((await f.research.catalogue(f.ctx, { q: 'Synthetic Buyer Person' })).total).toBe(0);
  });

  test('replaying create, correct and hide commands returns ids only', async () => {
    const u = await f.target();
    const create = command('note', {
      relationshipId: u.relationshipId,
      sourceId: u.sourceId,
      body: 'Replay note text',
    });
    const created = await f.research.command(f.ctx, create);
    const correct = correctContact(u.contactId, u.sourceId);
    const corrected = await f.research.command(f.ctx, correct);
    const hide = hideContact(corrected.replacementId);
    await f.research.command(f.users.owner.ctx, hide);
    const replays = [
      await f.research.command(f.ctx, create),
      await f.research.command(f.ctx, correct),
      await f.research.command(f.users.owner.ctx, hide),
    ];
    expect(replays[0]).toEqual({ id: created.id });
    expect(replays[1]).toEqual(corrected);
    expect(Object.keys(replays[2]).sort()).toEqual(['chainId', 'id', 'kind']);
    const text = JSON.stringify(replays);
    for (const secret of ['Replay note text', 'Synthetic Buyer', hideReason, ticket, 'job title'])
      expect(text).not.toContain(secret);
  });
});

describe('opt-outs keep working after hiding (owner answer 1)', () => {
  test('an existing opt-out still suppresses, a new opt-out still records, and a new message to a hidden contact is refused', async () => {
    const t = await f.target();
    await f.communications.command(
      f.ctx,
      command('optout', { contactId: t.contactId, reason: 'The person asked not to be contacted' }),
    );
    await f.research.command(f.users.owner.ctx, hideContact(t.contactId));
    const key = (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.communication_optout o JOIN app.private_contact_data pc ON pc.tenant_id=o.tenant_id AND o.recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex') WHERE pc.id=$1",
        [t.contactId],
      )
    ).rows[0].n;
    expect(key).toBe(1);
    await expect(f.introduction(t)).rejects.toThrow(
      'Choose a current contact. This one was withdrawn, corrected or hidden.',
    );
    const u = await f.target();
    await f.research.command(f.users.owner.ctx, hideContact(u.contactId));
    const recorded = await f.communications.command(
      f.ctx,
      command('optout', { contactId: u.contactId, reason: 'The person asked not to be contacted' }),
    );
    expect(recorded.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('locks (Guardian C7)', () => {
  const noDeadlock = (results: PromiseSettledResult<unknown>[]) => {
    for (const r of results)
      if (r.status === 'rejected') {
        expect((r.reason as { code?: string }).code).not.toBe('40P01');
        expect((r.reason as { status?: number }).status ?? 409).toBeLessThan(500);
      }
  };

  test('hide versus a concurrent message on the same chain: either the message is refused, or it was first and is then never delivered', async () => {
    const t = await f.target();
    const results = await Promise.allSettled([
      f.research.command(f.users.owner.ctx, hideContact(t.contactId)),
      f.introduction(t),
    ]);
    noDeadlock(results);
    expect(results[0].status).toBe('fulfilled');
    if (results[1].status === 'fulfilled') {
      const id = results[1].value.id;
      expect(
        await new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime)).attempt(
          id,
          f.communications.dispatchCapability(id),
        ),
      ).toBe('DEAD');
    } else expect(String(results[1].reason)).toContain('Choose a current contact');
  });

  test('hide versus a concurrent correct: every resulting version is hidden whichever commits first', async () => {
    const t = await f.target();
    const results = await Promise.allSettled([
      f.research.command(f.ctx, correctContact(t.contactId, t.sourceId)),
      f.research.command(f.users.owner.ctx, hideContact(t.contactId)),
    ]);
    noDeadlock(results);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const c of (await detailOf(t.relationshipId)).contacts.filter(
      (x) => x.chain_id === t.contactId,
    ))
      if (results[1].status === 'fulfilled') expect(c.status).toBe('HIDDEN');
  });

  test('a correction that commits while a hide waits on the chain lock makes the hide answer 409 with nothing written', async () => {
    const t = await f.target();
    const runtime = new Pool(
      connection('corridra_integration', 'corridra_runtime_local', sandbox.runtimePassword),
    );
    const held = await runtime.connect();
    try {
      await held.query('BEGIN');
      await held.query(
        "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose','synthetic_validation',true),set_config('corridra.correlation_id',$3,true),set_config('corridra.causation_id',$4,true)",
        [sessionHash(f.ctx.token), f.tenantA, randomUUID(), randomUUID()],
      );
      const replacement = (
        await held.query(
          "INSERT INTO app.private_contact_data(tenant_id,purpose,created_by,relationship_id,source_id,name,job_title,email,valid_until) VALUES($1,'synthetic_validation',$2,$3,$4,'Held Correction','Buyer',$5,now()+interval '2 days') RETURNING id",
          [
            f.tenantA,
            f.users.operator.id,
            t.relationshipId,
            t.sourceId,
            `${randomUUID()}@example.invalid`,
          ],
        )
      ).rows[0].id;
      await held.query(
        "INSERT INTO app.private_contact_change(tenant_id,relationship_id,chain_id,contact_id,kind,replacement_id,reason,command_id,request_hash,classification,purpose,created_by) VALUES($1,$2,$3,$3,'CORRECT',$4,'Held correction',$5,$6,'INTERNAL','synthetic_validation',$7)",
        [
          f.tenantA,
          t.relationshipId,
          t.contactId,
          replacement,
          randomUUID(),
          'c'.repeat(64),
          f.users.operator.id,
        ],
      );
      const before = await counts(f);
      const hide = f.research.command(f.users.owner.ctx, hideContact(t.contactId));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await held.query('COMMIT');
      const error = await refused(hide, 409, 'CHANGED');
      expect(error.message).toBe('This contact changed. Refresh to see the latest.');
      const after = await counts(f);
      expect(after.redactions).toBe(before.redactions);
    } finally {
      held.release();
      await runtime.end();
    }
  });

  test('hide versus a concurrent delivery: never both a receipt written after the hide and a successful hide', async () => {
    const t = await f.target();
    const queued = await f.introduction(t);
    const results = await Promise.allSettled([
      new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime)).attempt(
        queued.id,
        f.communications.dispatchCapability(queued.id),
      ),
      f.research.command(f.users.owner.ctx, hideContact(t.contactId)),
    ]);
    noDeadlock(results);
    expect(results[1].status).toBe('fulfilled');
    const row = (
      await f.owner.query(
        'SELECT (SELECT created_at FROM app.communication_receipt WHERE id=$1) receipt,(SELECT created_at FROM app.private_record_redaction WHERE chain_id=$2) hidden',
        [queued.id, t.contactId],
      )
    ).rows[0];
    if (row.receipt)
      expect(new Date(row.receipt).getTime()).toBeLessThanOrEqual(new Date(row.hidden).getTime());
  });
});

describe('source scan (Guardian C2)', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === 'node_modules' || name.startsWith('.')) return [];
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const roots = [
    ...readdirSync('packages')
      .map((p) => join('packages', p, 'src'))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      }),
    'apps/web/app',
    'apps/web/lib',
  ];

  test('no runtime reader selects contact or note text from the base tables outside the stated exceptions', () => {
    const reads: string[] = [];
    for (const file of roots.flatMap(files))
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/(FROM|JOIN)\s+app\.(private_contact_data|private_note)\b/.test(line))
            reads.push(`${file}:${index + 1}`);
        });
    // Stated exceptions: the module-absent branches of detail and shortlist (no hide can exist without the module), the
    // opt-out insert and lookup that use the address only inside sha256, and the module-absent contact list.
    const allowed = [
      /^packages\/counterparties\/src\/index\.ts:/,
      /^packages\/communications\/src\/index\.ts:/,
    ];
    expect(reads.filter((r) => !allowed.some((a) => a.test(r)))).toEqual([]);
    const counterpartyReads = reads.filter((r) => r.startsWith('packages/counterparties'));
    expect(counterpartyReads).toHaveLength(3);
    const source = readFileSync('packages/counterparties/src/index.ts', 'utf8');
    for (const r of counterpartyReads) {
      const line = Number(r.split(':')[1]);
      const window = source
        .split('\n')
        .slice(line - 12, line)
        .join('\n');
      expect(window, r).toMatch(/: \(|changes\.installed|state\s*\?/);
    }
    const communications = readFileSync('packages/communications/src/index.ts', 'utf8');
    expect(communications).toContain(
      "contactStates ? 'app.private_contact_state c' : 'app.private_contact_data c'",
    );
    expect(
      reads
        .filter((r) => r.startsWith('packages/communications'))
        .every((r) => {
          const line = communications.split('\n')[Number(r.split(':')[1]) - 1]!;
          return (
            /sha256\(convert_to\(lower\((pc\.)?email\)/.test(line) ||
            /FROM app\.private_contact_data WHERE tenant_id=\$1 AND id=\$2/.test(line)
          );
        }),
    ).toBe(true);
  });

  test('packages/intelligence reads no private contact, note, target contact or message', () => {
    for (const file of files('packages/intelligence/src'))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /private_contact|private_note|target_contact|app\.communication\b/,
      );
  });

  // Method calls such as Map.delete are code, not words a person reads.
  test('the words for hiding never say erase, delete or removed', () => {
    for (const file of [
      'packages/counterparties/src/changes.ts',
      'packages/counterparties/src/index.ts',
      'apps/web/app/operator/counterparties.tsx',
    ])
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /(?<!\.)\b(erase|erased|delete|deleted|removed|permanently)\b/i,
      );
  });
});
