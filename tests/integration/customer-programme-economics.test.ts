import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeEconomics } from '../../packages/db/src/customer-programme-economics-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import {
  CustomerProgrammeEconomicsService,
  customerProgrammeEconomicsEnabled,
  ledgerRecordInput,
} from '../../packages/auth/src/customer-programme-economics';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-ledger-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'eve', 'outsider'];
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  programmeId: string,
  secondProgramme: string,
  bobReg: string,
  carolReg: string,
  secondReg: string;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const subject = (p: string) => 'synthetic-ledger-' + p;
const session = (p: string): CustomerSession => ({
  subject: subject(p),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspaces = (p = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(p));
const programmes = (p = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(p));
const participants = (p = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(p));
const ledger = (p = 'alice') =>
  new CustomerProgrammeEconomicsService(f.runtime, f.auth, options, async () => session(p));

type Entry = Record<string, unknown>;
const fee = (reg: string, amountMinor: string, currency = 'BDT', over: Entry = {}) => ({
  kind: 'PARTICIPANT_FEE',
  costBasis: null,
  registrationId: reg,
  amountMinor,
  currency,
  occurredOn: '2026-10-01',
  description: 'Synthetic participation fee',
  ...over,
});
const payment = (reg: string, amountMinor: string, currency = 'BDT', over: Entry = {}) =>
  fee(reg, amountMinor, currency, {
    kind: 'PARTICIPANT_PAYMENT',
    description: 'Synthetic payment recorded by the organiser',
    ...over,
  });
const cost = (
  kind: string,
  basis: string,
  amountMinor: string,
  currency = 'BDT',
  over: Entry = {},
) => ({
  kind,
  costBasis: basis,
  registrationId: null,
  amountMinor,
  currency,
  occurredOn: '2026-10-01',
  description: 'Synthetic organiser cost line',
  ...over,
});
const post = (
  entry: Entry,
  p = 'alice',
  commandId = randomUUID(),
  target = workspaceId,
  programme = programmeId,
) =>
  ledger(p).record({
    commandId,
    workspaceId: target,
    programmeId: programme,
    entry,
    acknowledged: true,
  });
const scope = (target = workspaceId, programme = programmeId) => ({
  workspaceId: target,
  programmeId: programme,
});
const money = async () =>
  (await ledger().summary(scope())).currencies.find((c) => c.currency === 'BDT')!;

async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.programme_ledger_entry) entries,
 (SELECT count(*)::int FROM customer_private.programme_ledger_command) commands,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_programme_ledger') events,
 (SELECT count(*)::int FROM app.audit_event WHERE action='customer.programme_ledger.recorded') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_programme_ledger') outbox,
 (SELECT count(*)::int FROM app.commercial_record) commercial,
 (SELECT count(*)::int FROM app.organisation) organisations,
 (SELECT count(*)::int FROM customer_private.session_proof) proofs`)
  ).rows[0];
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid,p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid`,
    )
  ).rows;
  const digests = [];
  for (const row of tables)
    digests.push(
      (
        await f.owner.query(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) digest FROM "${row.nspname}"."${row.relname}" t`,
        )
      ).rows[0].digest,
    );
  return {
    functions,
    tables,
    digests,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
    coreHistory: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    customerHistory: (
      await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')
    ).rows,
  };
}
async function raw(p: string, sql: string, args: unknown[] = [], target = workspaceId) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, issuer, subject(p)],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),set_config('corridra.tenant_id',$2,true)",
      [hash, target],
    );
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
async function rejected(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error('Expected the operation to be rejected');
}
async function register(programme: string, who: string, label: string, target = workspaceId) {
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: target,
    programmeId: programme,
    label: 'Synthetic invitation for ' + who,
    acknowledged: true,
  });
  return (
    await participants(who).command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId: programme,
      token: invitation.token,
      displayLabel: label,
      consented: true,
    })
  ).id as string;
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerParticipants(f.owner);
  for (const p of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(p),
      executorId: f.serviceId,
      reason: 'Explicit invented programme ledger test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic ledger workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('eve').provision({
      commandId: randomUUID(),
      name: 'Synthetic other ledger workspace',
    })
  ).id;
  const invitation = await workspaces().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic plain member',
  });
  await workspaces('dave').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  const create = async (name: string) =>
    (
      await programmes().create({
        commandId: randomUUID(),
        workspaceId,
        name,
        reportingPurpose: 'Synthetic participant planning test only',
        acknowledged: true,
      })
    ).id as string;
  programmeId = await create('Synthetic ledger programme');
  secondProgramme = await create('Synthetic second ledger programme');
  bobReg = await register(programmeId, 'bob', 'Synthetic participant Bob');
  carolReg = await register(programmeId, 'carol', 'Synthetic participant Carol');
  secondReg = await register(secondProgramme, 'carol', 'Synthetic Carol second programme');
  oldSnapshot = await snapshot();
  await migrateCustomerProgrammeEconomics(f.owner);
  await migrateCustomerProgrammeEconomics(f.owner);
}, 90000);
afterAll(async () => {
  await f?.close();
});

test('populated additive install preserves every existing row, function, ACL, policy and receipt and is repeatable', async () => {
  const after = await snapshot();
  const knownTables = new Set(oldSnapshot.tables.map((t) => t.oid));
  const knownFunctions = new Set(oldSnapshot.functions.map((p) => p.oid));
  expect(after.functions.filter((p) => knownFunctions.has(p.oid))).toEqual(oldSnapshot.functions);
  expect(after.tables.filter((t) => knownTables.has(t.oid))).toEqual(oldSnapshot.tables);
  expect(
    after.tables
      .filter((t) => !knownTables.has(t.oid))
      .map((t) => t.relname)
      .sort(),
  ).toEqual(['programme_ledger_command', 'programme_ledger_entry']);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  expect(after.customerHistory).toEqual(oldSnapshot.customerHistory);
  expect(
    (await f.owner.query('SELECT name FROM customer_programme_economics_migrations.applied')).rows,
  ).toEqual([{ name: '0001_organiser_programme_economics.sql' }]);
});

test('the gate is independent, default-off and needs every earlier flag', () => {
  expect(customerProgrammeEconomicsEnabled({})).toBe(false);
  const all = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
  };
  expect(customerProgrammeEconomicsEnabled(all)).toBe(false);
  expect(
    customerProgrammeEconomicsEnabled({
      ...all,
      CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true',
    }),
  ).toBe(true);
  expect(
    customerProgrammeEconomicsEnabled({
      ...all,
      CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  expect(
    customerProgrammeEconomicsEnabled({ CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED: 'true' }),
  ).toBe(false);
});

test('an empty ledger shows nothing invented: no currencies, participants listed with no amounts', async () => {
  const s = await ledger().summary(scope());
  expect(s).toMatchObject({
    provenance: 'ORGANISER_RECORDED',
    verified: false,
    collectsPayments: false,
    currencies: [],
    counts: { registered: 2, active: 2, withdrawnOrRemoved: 0 },
  });
  expect(s.participants.map((p) => p.label)).toEqual([
    'Synthetic participant Bob',
    'Synthetic participant Carol',
  ]);
  expect(s.participants.every((p) => p.amounts.length === 0)).toBe(true);
  expect((await ledger().list(scope())).entries).toEqual([]);
});

test('recording a fee stores exact whole units, labels it organiser-recorded and writes one content-free event chain', async () => {
  const before = await counts();
  const r = await post(fee(bobReg, '10000000'));
  expect(r).toMatchObject({
    replayed: false,
    entry: {
      seq: 1,
      kind: 'PARTICIPANT_FEE',
      amountMinor: '10000000',
      currency: 'BDT',
      exponent: 2,
      provenance: 'ORGANISER_RECORDED',
      registrationLabel: 'Synthetic participant Bob',
      reverseOf: null,
      reversedBy: null,
    },
  });
  const after = await counts();
  expect(after).toEqual({ ...before, entries: 1, commands: 1, events: 1, audits: 1, outbox: 1 });
  expect(after.commercial).toBe(before.commercial);
  expect(after.organisations).toBe(before.organisations);
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE aggregate_type='customer_programme_ledger'",
    )
  ).rows;
  expect(Object.keys(events[0].payload).sort()).toEqual([
    'entryId',
    'initiator_id',
    'initiator_kind',
    'kind',
    'seq',
    'synthetic',
  ]);
  expect(JSON.stringify(events)).not.toMatch(/10000000|Synthetic participation|BDT/);
});

test('amounts beyond 2^53 stay exact end to end and totals are exact strings', async () => {
  const big = '999999999999999999';
  const r = await post(fee(bobReg, big, 'EUR'));
  expect(r.entry.amountMinor).toBe(big);
  await post(fee(carolReg, big, 'EUR'));
  const eur = (await ledger().summary(scope())).currencies.find((c) => c.currency === 'EUR')!;
  expect(eur.feesDue).toBe('1999999999999999998');
  expect(eur.outstanding).toBe('1999999999999999998');
  expect(Number(big)).not.toBe(BigInt(big)); // proves a JavaScript number would have rounded it
  const stored = (
    await f.owner.query(
      "SELECT amount_minor::text a FROM customer_private.programme_ledger_entry WHERE currency='EUR' ORDER BY seq",
    )
  ).rows;
  expect(stored.map((x) => x.a)).toEqual([big, big]);
});

test('totals are per currency only and nothing is converted or summed across currencies', async () => {
  await post(fee(bobReg, '777', 'JPY'));
  const s = await ledger().summary(scope());
  expect(s.currencies.map((c) => c.currency)).toEqual(['BDT', 'EUR', 'JPY']);
  expect(s.currencies.find((c) => c.currency === 'JPY')).toMatchObject({
    exponent: 0,
    feesDue: '777',
  });
  expect(s.currencies.find((c) => c.currency === 'BDT')!.feesDue).toBe('10000000');
  expect(JSON.stringify(s)).not.toMatch(/"total(Fees|Due|Amount)"|convert|rate/i);
});

test('planned and actual costs stay separate and the three margins are exact', async () => {
  await post(fee(carolReg, '5000000')); // BDT fees now 15,000,000
  await post(cost('ORGANISER_EXPENSE', 'PLANNED', '4000000'));
  await post(cost('ORGANISER_OBLIGATION', 'PLANNED', '1000000'));
  await post(cost('CORRIDRA_SERVICE_FEE', 'PLANNED', '500000'));
  await post(cost('ORGANISER_EXPENSE', 'ACTUAL', '4500000'));
  await post(cost('ORGANISER_OBLIGATION', 'ACTUAL', '800000'));
  await post(cost('CORRIDRA_SERVICE_FEE', 'ACTUAL', '500000'));
  await post(payment(bobReg, '6000000'));
  const m = await money();
  expect(m).toMatchObject({
    feesDue: '15000000',
    paymentsRecorded: '6000000',
    outstanding: '9000000',
    plannedCosts: {
      expenses: '4000000',
      obligations: '1000000',
      corridraServiceFees: '500000',
      total: '5500000',
    },
    actualCosts: {
      expenses: '4500000',
      obligations: '800000',
      corridraServiceFees: '500000',
      total: '5800000',
    },
    marginIfPlanned: '9500000',
    marginOnActual: '9200000',
    cashMargin: '200000',
  });
});

test('Corridra service fees, obligations and supplier costs never touch Corridra revenue or the commercial ledgers', async () => {
  const c = await counts();
  expect(c.commercial).toBe(0);
  const tables = (
    await f.owner.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND relname ~ 'service_ledger|reward|economic'",
    )
  ).rows.map((r) => r.relname);
  for (const t of tables) {
    const n = (await f.owner.query(`SELECT count(*)::int n FROM app.${t}`)).rows[0].n;
    expect(n, t).toBe(0);
  }
});

test('payment status is derived per participant and currency: unpaid, part paid, paid, overpaid, no fee', async () => {
  const status = async (label: string, currency = 'BDT') =>
    (await ledger().summary(scope())).participants
      .find((p) => p.label === label)!
      .amounts.find((a) => a.currency === currency)?.status;
  expect(await status('Synthetic participant Carol')).toBe('UNPAID');
  expect(await status('Synthetic participant Bob')).toBe('PART_PAID');
  await post(payment(bobReg, '4000000'));
  expect(await status('Synthetic participant Bob')).toBe('PAID');
  await post(payment(bobReg, '1'));
  expect(await status('Synthetic participant Bob')).toBe('OVERPAID');
  expect(await status('Synthetic participant Bob', 'JPY')).toBe('UNPAID');
  const second = await ledger().summary(scope(workspaceId, secondProgramme));
  expect(second.participants[0].amounts).toEqual([]);
  expect(second.currencies).toEqual([]);
});

let reversible: string;
test('a correction is a compensating entry with the exact negated amount and cancels the original in the totals', async () => {
  const wrong = await post(
    payment(carolReg, '2500000', 'BDT', { description: 'Synthetic payment entered by mistake' }),
  );
  reversible = wrong.entry.id;
  const before = await money();
  const fix = await post({
    reverseOf: reversible,
    occurredOn: '2026-10-02',
    description: 'Synthetic correction of a mistaken payment',
  });
  expect(fix.entry).toMatchObject({
    kind: 'PARTICIPANT_PAYMENT',
    amountMinor: '-2500000',
    currency: 'BDT',
    reverseOf: reversible,
    registrationId: carolReg,
  });
  const after = await money();
  expect(BigInt(after.paymentsRecorded)).toBe(BigInt(before.paymentsRecorded) - 2500000n);
  const original = (await ledger().list(scope())).entries.find((e) => e.id === reversible)!;
  expect(original.reversedBy).toBe(fix.entry.id);
  expect(original.amountMinor).toBe('2500000');
});

test('corrections cannot be repeated, nested, cross-programme or hand-built to disagree with the original', async () => {
  const fixId = (await ledger().list(scope())).entries.find((e) => e.reverseOf === reversible)!.id;
  expect(
    (
      await rejected(
        post({
          reverseOf: reversible,
          occurredOn: '2026-10-03',
          description: 'Synthetic second correction',
        }),
      )
    ).code,
  ).toBe('23505');
  expect(
    (
      await rejected(
        post({
          reverseOf: fixId,
          occurredOn: '2026-10-03',
          description: 'Synthetic reversal of a reversal',
        }),
      )
    ).code,
  ).toBe('23514');
  expect(
    (
      await rejected(
        post(
          {
            reverseOf: reversible,
            occurredOn: '2026-10-03',
            description: 'Synthetic wrong programme',
          },
          'alice',
          randomUUID(),
          workspaceId,
          secondProgramme,
        ),
      )
    ).code,
  ).toBe('42501');
  const original = (
    await f.owner.query('SELECT * FROM customer_private.programme_ledger_entry WHERE id=$1', [
      reversible,
    ])
  ).rows[0];
  const insert = (over: Record<string, unknown>) => {
    const row = {
      ...original,
      id: randomUUID(),
      seq: 9000 + Math.floor(Math.random() * 999),
      reverse_of: randomUUID(),
      amount_minor: '-1',
      description: 'Synthetic hand built row',
      ...over,
    };
    return f.owner.query(
      'INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,registration_id,amount_minor,currency,occurred_on,description,reverse_of,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        row.workspace_id,
        row.programme_id,
        row.seq,
        row.kind,
        row.cost_basis,
        row.registration_id,
        row.amount_minor,
        row.currency,
        row.occurred_on,
        row.description,
        row.reverse_of,
        row.recorded_by,
      ],
    );
  };
  const fresh = (
    await post(payment(bobReg, '300', 'BDT', { description: 'Synthetic payment to test directly' }))
  ).entry.id;
  for (const over of [
    { reverse_of: fresh, amount_minor: '-299' },
    { reverse_of: fresh, amount_minor: '-300', kind: 'PARTICIPANT_FEE' },
    { reverse_of: fresh, amount_minor: '-300', currency: 'EUR' },
    { reverse_of: fresh, amount_minor: '-300', registration_id: carolReg },
    { reverse_of: randomUUID(), amount_minor: '-300' },
  ])
    expect(await rejected(insert(over)), JSON.stringify(over)).toBeTruthy();
  // A registration from a different programme is refused by the database itself.
  expect(
    (
      await rejected(
        insert({ reverse_of: null, amount_minor: '5', registration_id: secondReg, seq: 8001 }),
      )
    ).code,
  ).toBe('23514');
});

test('a registration from another programme is refused through the function too', async () => {
  const before = await counts();
  expect((await rejected(post(fee(secondReg, '100')))).code).toBe('23514');
  expect((await rejected(post(fee(randomUUID(), '100')))).code).toBeTruthy();
  expect(await counts()).toEqual(before);
});

test('only workspace owners and admins of this programme can read or write; everyone else is denied', async () => {
  const before = await counts();
  for (const p of ['bob', 'carol', 'dave', 'eve', 'outsider']) {
    expect((await rejected(ledger(p).summary(scope()))).code, p + ' summary').toBe('42501');
    expect((await rejected(ledger(p).list(scope()))).code, p + ' list').toBe('42501');
    expect((await rejected(post(fee(bobReg, '1'), p))).code, p + ' record').toBe('42501');
  }
  // Forged scopes: another workspace's id with this programme, and a random programme.
  expect((await rejected(ledger().summary(scope(otherWorkspace, programmeId)))).code).toBe('42501');
  expect((await rejected(ledger('eve').summary(scope(otherWorkspace, programmeId)))).code).toBe(
    '42501',
  );
  expect((await rejected(ledger().summary(scope(workspaceId, randomUUID())))).code).toBe('42501');
  expect(await counts()).toEqual(before);
});

test('exact retries return the original, a changed payload under the same command is refused, and numbers stay contiguous under concurrency', async () => {
  const id = randomUUID();
  const first = await post(cost('ORGANISER_EXPENSE', 'ACTUAL', '12345'), 'alice', id);
  const before = await counts();
  const again = await post(cost('ORGANISER_EXPENSE', 'ACTUAL', '12345'), 'alice', id);
  expect(again).toMatchObject({
    replayed: true,
    entry: { id: first.entry.id, seq: first.entry.seq },
  });
  expect(await counts()).toEqual(before);
  const clash = await rejected(post(cost('ORGANISER_EXPENSE', 'ACTUAL', '12346'), 'alice', id));
  expect(clash.code).toBe('23514');
  expect(clash.message).toContain('conflicts');
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => post(cost('ORGANISER_EXPENSE', 'ACTUAL', String(100 + i)))),
  );
  const seqs = results.map((r) => r.entry.seq).sort((a, b) => a - b);
  expect(new Set(seqs).size).toBe(6);
  expect(seqs[5] - seqs[0]).toBe(5);
  const all = (
    await f.owner.query(
      'SELECT seq FROM customer_private.programme_ledger_entry WHERE programme_id=$1 ORDER BY seq',
      [programmeId],
    )
  ).rows.map((r) => r.seq);
  expect(all).toEqual(all.map((_, i) => i + 1));
});

test('invalid amounts, currencies, dates, kinds and text are refused by the application schema and by SQL independently', async () => {
  const call = (e: Record<string, unknown>) =>
    raw('alice', 'SELECT customer.programme_ledger_record($1,$2,$3,$4)', [
      randomUUID(),
      workspaceId,
      programmeId,
      JSON.stringify(e),
    ]);
  const bad: [string, Entry][] = [
    ['zero', fee(bobReg, '0')],
    ['negative', fee(bobReg, '-5')],
    ['fraction', fee(bobReg, '1.5')],
    ['leading zero', fee(bobReg, '01')],
    ['too many digits', fee(bobReg, '1000000000000000000')],
    [
      'not synthetic',
      fee(bobReg, '5', 'BDT', { description: 'Participation fee for a real company' }),
    ],
    ['bad date', fee(bobReg, '5', 'BDT', { occurredOn: '2026-02-31' })],
    ['future payment', payment(bobReg, '5', 'BDT', { occurredOn: '2099-01-01' })],
    ['fee without participant', fee(bobReg, '5', 'BDT', { registrationId: null })],
    ['cost without basis', cost('ORGANISER_EXPENSE', 'ACTUAL', '5', 'BDT', { costBasis: null })],
    ['fee with a basis', fee(bobReg, '5', 'BDT', { costBasis: 'ACTUAL' })],
    [
      'cost with a participant',
      cost('ORGANISER_EXPENSE', 'ACTUAL', '5', 'BDT', { registrationId: bobReg }),
    ],
    ['unknown kind', fee(bobReg, '5', 'BDT', { kind: 'PARTICIPANT_TRADE_VALUE' })],
    ['extra key', fee(bobReg, '5', 'BDT', { converted: '5' })],
  ];
  for (const [name, entry] of bad) {
    expect(
      ledgerRecordInput.safeParse({
        commandId: randomUUID(),
        ...scope(),
        entry,
        acknowledged: true,
      }).success,
      name + ' (schema)',
    ).toBe(false);
    expect(await rejected(call(entry)), name + ' (sql)').toBeTruthy();
  }
  expect((await rejected(call(fee(bobReg, '5', 'XXX')))).code).toBe('23503');
  expect(
    ledgerRecordInput.safeParse({
      commandId: randomUUID(),
      ...scope(),
      entry: fee(bobReg, '5'),
      acknowledged: false,
    }).success,
  ).toBe(false);
});

test('a withdrawn participant is shown as withdrawn and their money is kept', async () => {
  await participants('carol').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: carolReg,
    reason: 'Synthetic participant chooses to withdraw',
    acknowledged: true,
  });
  const s = await ledger().summary(scope());
  expect(s.counts).toEqual({ registered: 2, active: 1, withdrawnOrRemoved: 1 });
  const carol = s.participants.find((p) => p.label === 'Synthetic participant Carol')!;
  expect(carol.state).toBe('WITHDRAWN');
  expect(carol.amounts.find((a) => a.currency === 'BDT')).toMatchObject({ due: '5000000' });
  expect(
    (
      await post(
        fee(carolReg, '1000', 'BDT', {
          description: 'Synthetic cancellation fee for a withdrawal',
        }),
      )
    ).entry.seq,
  ).toBeGreaterThan(0);
});

test('history pages newest first with exact seams and no repeated or skipped entry', async () => {
  const total = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.programme_ledger_entry WHERE programme_id=$1',
      [programmeId],
    )
  ).rows[0].n;
  const seen: number[] = [];
  let before: number | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await ledger().list({
      ...scope(),
      pageSize: 7,
      ...(before ? { beforeSeq: before } : {}),
    });
    seen.push(...page.entries.map((e) => e.seq));
    if (page.nextBefore === null) break;
    before = page.nextBefore;
  }
  expect(seen).toEqual(Array.from({ length: total }, (_, i) => total - i));
  expect((await rejected(ledger().list({ ...scope(), pageSize: 0 }))).message).toBeTruthy();
});

test('runtime and auth roles cannot read or write ledger tables or call private helpers directly', async () => {
  for (const pool of [f.runtime, f.auth])
    for (const sql of [
      'SELECT * FROM customer_private.programme_ledger_entry',
      'SELECT * FROM customer_private.programme_ledger_command',
      "UPDATE customer_private.programme_ledger_entry SET description='Synthetic rewritten'",
      'DELETE FROM customer_private.programme_ledger_entry',
    ])
      expect((await rejected(pool.query(sql))).code).toBe('42501');
  for (const sql of [
    'SELECT customer_private.programme_ledger_expiry()',
    'SELECT customer_private.programme_ledger_entry_json(gen_random_uuid())',
    'SELECT customer_private.programme_ledger_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$$x$$,1)',
  ])
    expect((await rejected(raw('alice', sql))).code).toBe('42501');
  expect(
    (
      await rejected(
        f.auth.query('SELECT customer.programme_economics($1,$2)', [workspaceId, programmeId]),
      )
    ).code,
  ).toBe('42501');
  expect(
    (
      await rejected(
        f.runtime.query('SELECT customer.programme_economics($1,$2)', [workspaceId, programmeId]),
      )
    ).code,
  ).toBe('42501');
});

test('even the schema owner cannot rewrite or delete ledger history', async () => {
  for (const sql of [
    "UPDATE customer_private.programme_ledger_entry SET description='Synthetic rewritten text'",
    'DELETE FROM customer_private.programme_ledger_entry',
    'DELETE FROM customer_private.programme_ledger_command',
  ])
    expect(await rejected(f.owner.query(sql))).toBeTruthy();
});

test('the account-context guard and session checks run before any database work', async () => {
  const before = await counts();
  expect((await rejected(ledger().summary(scope(), 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        ledger().summary(
          scope(),
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const unverified = new CustomerProgrammeEconomicsService(
    f.runtime,
    f.auth,
    options,
    async () => ({ ...session('alice'), emailVerified: false }),
  );
  expect((await rejected(unverified.summary(scope()))).message).toContain('Verify');
  const expired = new CustomerProgrammeEconomicsService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  expect((await rejected(expired.summary(scope()))).message).toContain('Sign in');
  const off = new CustomerProgrammeEconomicsService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  expect((await rejected(off.summary(scope()))).message).toContain('unavailable');
  expect(await counts()).toEqual(before);
  const s = await ledger().summary(scope());
  expect(Date.parse(s.expiresAt) - Date.now()).toBeLessThanOrEqual(61000);
});
