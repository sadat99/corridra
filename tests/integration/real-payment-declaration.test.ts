import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerProgrammeTermsService } from '../../packages/auth/src/customer-programme-terms';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';

// U10c: participant payment declaration (real-use 0016). Both a sample (synthetic) tenant and a real-use tenant run the same
// checks, because the wording rules of the ledger entry and of the free-text fields differ between them.
let f: Awaited<ReturnType<typeof fixture>>;
const issuer =
  'https://ep-payment-declaration-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const base = { enabled: true, production: false, issuer };

beforeAll(async () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCommercialReadiness(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'local-bootstrap-fixture',
    executorId: f.serviceId,
    reason: 'Local fixture authority only; never a production customer',
  });
  await f.owner.query(
    "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
    [f.tenantA, f.serviceId, f.users.owner.id],
  );
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Local functional fixture with owner-approved real use and deferred scanning',
  });
}, 240000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

const sqlText = () =>
  readFile(
    new URL(
      '../../packages/db/customer-real-use-migrations/0016_participant_payment_declaration.sql',
      import.meta.url,
    ),
    'utf8',
  );
async function rejected(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error('Expected the operation to be rejected');
}
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

for (const mode of ['synthetic', 'real'] as const) {
  describe(`${mode} tenant`, () => {
    const w = (s: string) => (mode === 'synthetic' ? 'Synthetic ' + s : s);
    const person = (p: string) => `pay-${mode}-${p}`;
    const cfg = {
      ...base,
      dataMode: mode,
      synthetic: mode === 'synthetic',
      openAdmission: mode === 'real',
    };
    const read = (p: string) => async () => ({
      subject: person(p),
      email: `${person(p)}@example.test`,
      emailVerified: true,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const make =
      <T>(Service: new (...a: never[]) => T) =>
      (p = 'org') =>
        new (Service as unknown as new (...a: unknown[]) => T)(f.runtime, f.auth, cfg, read(p));
    const workspaces = make(CustomerWorkspaceService);
    const programmes = make(CustomerProgrammeService);
    const participants = make(CustomerParticipantService);
    const terms = make(CustomerProgrammeTermsService);
    const ledger = make(CustomerProgrammeEconomicsService);
    let workspaceId = '',
      otherWorkspace = '',
      programmeId = '';
    const reg: Record<string, string> = {};
    const scope = () => ({ workspaceId, programmeId });

    async function register(who: string) {
      const invitation = await participants().command({
        action: 'invite',
        commandId: randomUUID(),
        workspaceId,
        programmeId,
        label: w('Invitation for ' + who),
        acknowledged: true,
      });
      reg[who] = (
        await participants(who).command({
          action: 'accept',
          commandId: randomUUID(),
          programmeId,
          token: invitation.token,
          displayLabel: w('Participant ' + who),
          consented: true,
        })
      ).id as string;
    }
    const record = (who: string, kind: string, amountMinor: string, currency = 'BDT') =>
      ledger().record({
        commandId: randomUUID(),
        ...scope(),
        entry: {
          kind,
          costBasis: null,
          registrationId: reg[who],
          amountMinor,
          currency,
          occurredOn: day(-5),
          description: w('Recorded by the organiser'),
        },
        acknowledged: true,
      });
    const declare = (who: string, over: Record<string, unknown> = {}, command = randomUUID()) =>
      ledger(who).declarePayment({
        commandId: command,
        registrationId: reg[who],
        currency: 'BDT',
        amountMinor: '40000',
        paidOn: day(-1),
        payerReference: w('Bank transfer 8841'),
        note: null,
        ...over,
      });
    const decide = (
      declarationId: string,
      decision: 'ACKNOWLEDGED' | 'REJECTED',
      over: Record<string, unknown> = {},
      who = 'org',
      command = randomUUID(),
    ) =>
      ledger(who).decidePayment({
        commandId: command,
        ...scope(),
        declarationId,
        decision,
        reason: decision === 'REJECTED' ? w('No such transfer reached my account') : null,
        receivedAmountMinor: null,
        receivedOn: null,
        ...over,
      });
    const feeStatus = (who: string) => terms(who).ownFeeStatus({ registrationId: reg[who] });
    const outstanding = async (who: string, currency = 'BDT') =>
      (await feeStatus(who)).amounts.find((a) => a.currency === currency)?.outstandingMinor;
    const counts = async () =>
      (
        await f.owner.query(
          `SELECT (SELECT count(*)::int FROM customer_private.programme_ledger_entry WHERE workspace_id=$1) ledger,
 (SELECT count(*)::int FROM customer_private.programme_payment_declaration WHERE workspace_id=$1) declarations,
 (SELECT count(*)::int FROM customer_private.programme_payment_decision WHERE workspace_id=$1) decisions`,
          [workspaceId],
        )
      ).rows[0];

    beforeAll(async () => {
      if (mode === 'synthetic')
        for (const p of ['org', 'pat', 'other', 'nofee', 'gone', 'member', 'stranger'])
          await admitSyntheticCustomer(f.owner, {
            issuer,
            subject: person(p),
            executorId: f.serviceId,
            reason: 'Explicit invented payment declaration test identity; no real account or email',
          });
      workspaceId = (
        await workspaces().provision({ commandId: randomUUID(), name: w('Payment organiser') })
      ).id;
      otherWorkspace = (
        await workspaces('stranger').provision({
          commandId: randomUUID(),
          name: w('Payment stranger'),
        })
      ).id;
      const invited = await workspaces().access({
        action: 'invite',
        commandId: randomUUID(),
        workspaceId,
        label: w('Invited member'),
      });
      await workspaces('member').access({
        action: 'accept',
        commandId: randomUUID(),
        token: invited.token!,
      });
      programmeId = (
        await programmes().create({
          commandId: randomUUID(),
          workspaceId,
          name: w('Payment programme'),
          reportingPurpose: w('Participant payment declaration test'),
          acknowledged: true,
        })
      ).id;
      await terms().publishTerms({
        commandId: randomUUID(),
        ...scope(),
        expectedVersion: 0,
        included: w('Ground transport and hotel nights'),
        excluded: null,
        cancellationTerms: w('Cancel up to fourteen days before'),
        changeTerms: w('Agenda may change with notice'),
        feesApply: true,
        feeNote: null,
        reason: w('First version of the terms'),
      });
      for (const p of ['pat', 'other', 'nofee', 'gone']) await register(p);
      await record('pat', 'PARTICIPANT_FEE', '120000');
      await record('other', 'PARTICIPANT_FEE', '90000');
      await record('gone', 'PARTICIPANT_FEE', '90000');
      await participants('gone').command({
        action: 'withdraw',
        commandId: randomUUID(),
        registrationId: reg.gone,
        reason: w('Withdrawal for the payment test'),
        acknowledged: true,
      });
    }, 240000);

    test('a declaration is recorded as not checked and changes no recorded or outstanding amount', async () => {
      const before = await counts();
      expect(await outstanding('pat')).toBe('120000');
      const made = await declare('pat');
      expect(made.declaration).toMatchObject({
        status: 'AWAITING_REVIEW',
        amountMinor: '40000',
        currency: 'BDT',
        reason: null,
        verified: false,
      });
      expect(await counts()).toEqual({
        ...before,
        declarations: before.declarations + 1,
      });
      expect(await outstanding('pat')).toBe('120000');
      expect(
        (await feeStatus('pat')).amounts.find((a) => a.currency === 'BDT')?.recordedMinor,
      ).toBe('0');
      const own = await ledger('pat').ownPaymentDeclarations({ registrationId: reg.pat });
      expect(own).toMatchObject({
        provenance: 'PARTICIPANT_DECLARED',
        verified: false,
        collectsPayments: false,
      });
      expect(own.declarations.map((d) => d.status)).toEqual(['AWAITING_REVIEW']);
      // The participant never sees organiser-only fields.
      expect(Object.keys(own.declarations[0]).sort()).not.toEqual(
        expect.arrayContaining(['registrationLabel']),
      );
      expect(JSON.stringify(own)).not.toMatch(/ledgerEntryId|registrationLabel/);
      // A retry with the same command is a replay, not a second declaration.
      const command = randomUUID();
      const first = await declare('pat', { amountMinor: '100' }, command);
      const again = await declare('pat', { amountMinor: '100' }, command);
      expect(again.replayed).toBe(true);
      expect(again.declaration.id).toBe(first.declaration.id);
      expect((await rejected(declare('pat', { amountMinor: '101' }, command))).code).toBe('23514');
      // The pending list shows it with the organiser-only context.
      const pending = await ledger().pendingPaymentDeclarations(scope());
      const mine = pending.declarations.find((d) => d.id === made.declaration.id)!;
      expect(mine).toMatchObject({
        registrationLabel: w('Participant pat'),
        outstandingMinor: '120000',
        status: 'AWAITING_REVIEW',
      });
    });

    test('guards: another participant, the organiser, a stranger, a withdrawn registration, no fee, bad amounts and dates', async () => {
      const same = (
        await rejected(ledger('other').ownPaymentDeclarations({ registrationId: reg.pat }))
      ).message;
      expect(
        (
          await rejected(
            ledger('other').declarePayment({
              commandId: randomUUID(),
              registrationId: reg.pat,
              currency: 'BDT',
              amountMinor: '1',
              paidOn: day(-1),
              payerReference: null,
              note: null,
            }),
          )
        ).code,
      ).toBe('42501');
      for (const who of ['other', 'org', 'stranger']) {
        const denied = await rejected(
          ledger(who).ownPaymentDeclarations({ registrationId: reg.pat }),
        );
        expect(denied.code).toBe('42501');
        expect(denied.message).toBe(same);
      }
      // The organiser cannot declare on behalf of a participant.
      expect(
        (
          await rejected(
            ledger('org').declarePayment({
              commandId: randomUUID(),
              registrationId: reg.pat,
              currency: 'BDT',
              amountMinor: '1',
              paidOn: day(-1),
              payerReference: null,
              note: null,
            }),
          )
        ).code,
      ).toBe('42501');
      // A withdrawn (inactive) registration cannot declare or read.
      expect((await rejected(declare('gone'))).code).toBe('42501');
      expect(
        (await rejected(ledger('gone').ownPaymentDeclarations({ registrationId: reg.gone }))).code,
      ).toBe('42501');
      // No fee recorded for this participant at all, and no fee in this currency.
      const nothing = await counts();
      expect((await rejected(declare('nofee'))).code).toBe('23514');
      expect((await rejected(declare('pat', { currency: 'JPY' }))).code).toBe('23514');
      // Future date: the service allows one day of time-zone slack, the database does not.
      expect((await rejected(declare('pat', { paidOn: day(1) + '' }))).code).toBe('23514');
      await expect(declare('pat', { paidOn: day(3) })).rejects.toBeTruthy();
      // Amounts: zero, negative, decimal and over-long are refused before they reach the database.
      for (const bad of ['0', '-5', '1.5', '1234567890123456789'])
        await expect(declare('pat', { amountMinor: bad })).rejects.toBeTruthy();
      expect(await counts()).toEqual(nothing);
      // The same rules hold when the database is written directly: negative amount and future date.
      const insert = (amount: string, paid: string) =>
        f.owner.query(
          `INSERT INTO customer_private.programme_payment_declaration(registration_id,workspace_id,programme_id,currency,amount_minor,paid_on,declared_by)
 SELECT r.id,r.workspace_id,r.programme_id,'BDT',$2::bigint,$3::date,r.principal_id FROM customer_private.programme_registration r WHERE r.id=$1`,
          [reg.pat, amount, paid],
        );
      expect((await rejected(insert('-1', day(-1)))).code).toBe('23514');
      expect((await rejected(insert('1', day(2)))).code).toBe('23514');
      // Pending list and decisions need the organiser's owner or admin authority.
      const made = await declare('pat', { amountMinor: '7' });
      for (const who of ['member', 'stranger', 'pat'] as const) {
        expect((await rejected(ledger(who).pendingPaymentDeclarations(scope()))).code).toBe(
          '42501',
        );
        expect((await rejected(decide(made.declaration.id, 'ACKNOWLEDGED', {}, who))).code).toBe(
          '42501',
        );
      }
      expect(
        (
          await rejected(
            ledger('stranger').decidePayment({
              commandId: randomUUID(),
              workspaceId: otherWorkspace,
              programmeId,
              declarationId: made.declaration.id,
              decision: 'ACKNOWLEDGED',
              reason: null,
              receivedAmountMinor: null,
              receivedOn: null,
            }),
          )
        ).code,
      ).toBe('42501');
    });

    test('acknowledging writes exactly one payment entry through the ledger path and lowers the outstanding amount once', async () => {
      const made = await declare('other', { amountMinor: '30000' });
      const before = await counts();
      expect(await outstanding('other')).toBe('90000');
      const command = randomUUID();
      const done = await decide(made.declaration.id, 'ACKNOWLEDGED', {}, 'org', command);
      expect(done.declaration.status).toBe('ACKNOWLEDGED');
      expect(done.entry).toMatchObject({
        kind: 'PARTICIPANT_PAYMENT',
        amountMinor: '30000',
        currency: 'BDT',
        provenance: 'ORGANISER_RECORDED',
        occurredOn: made.declaration.paidOn,
        registrationId: reg.other,
      });
      expect(done.entry!.description).toBe(
        mode === 'synthetic'
          ? 'Synthetic payment declared by the participant, acknowledged by the organiser'
          : 'Payment declared by the participant, acknowledged by the organiser',
      );
      expect(await counts()).toEqual({
        ledger: before.ledger + 1,
        declarations: before.declarations,
        decisions: before.decisions + 1,
      });
      expect(await outstanding('other')).toBe('60000');
      expect((await feeStatus('other')).amounts.find((a) => a.currency === 'BDT')).toMatchObject({
        recordedMinor: '30000',
      });
      const link = (
        await f.owner.query(
          'SELECT d.ledger_entry_id,e.kind,e.amount_minor::text amount FROM customer_private.programme_payment_decision d JOIN customer_private.programme_ledger_entry e ON e.id=d.ledger_entry_id WHERE d.declaration_id=$1',
          [made.declaration.id],
        )
      ).rows[0];
      expect(link).toEqual({
        ledger_entry_id: done.entry!.id,
        kind: 'PARTICIPANT_PAYMENT',
        amount: '30000',
      });
      // The participant now reads it as confirmed, and the pending list no longer holds it.
      const own = await ledger('other').ownPaymentDeclarations({ registrationId: reg.other });
      expect(own.declarations.find((d) => d.id === made.declaration.id)?.status).toBe(
        'ACKNOWLEDGED',
      );
      expect(
        (await ledger().pendingPaymentDeclarations(scope())).declarations.some(
          (d) => d.id === made.declaration.id,
        ),
      ).toBe(false);
      // Replay of the same decision returns the same entry and writes nothing more.
      const replay = await decide(made.declaration.id, 'ACKNOWLEDGED', {}, 'org', command);
      expect(replay.replayed).toBe(true);
      expect(replay.entry!.id).toBe(done.entry!.id);
      expect((await counts()).ledger).toBe(before.ledger + 1);
      // Deciding again with a new command, either way, is refused and writes nothing.
      expect((await rejected(decide(made.declaration.id, 'ACKNOWLEDGED'))).code).toBe('23514');
      expect((await rejected(decide(made.declaration.id, 'REJECTED'))).code).toBe('23514');
      expect((await counts()).ledger).toBe(before.ledger + 1);
      // The same command with a different payload is a conflict.
      expect(
        (await rejected(decide(made.declaration.id, 'REJECTED', {}, 'org', command))).code,
      ).toBe('23514');
      // A written decision cannot be rewritten, even by the table owner.
      expect(
        (
          await rejected(
            f.owner.query(
              "UPDATE customer_private.programme_payment_decision SET decision='REJECTED',reason=$2,ledger_entry_id=NULL WHERE declaration_id=$1",
              [made.declaration.id, w('Rewrite attempt of a decision')],
            ),
          )
        ).message,
      ).toBeTruthy();
      expect(
        (
          await rejected(
            f.owner.query('DELETE FROM customer_private.programme_payment_declaration'),
          )
        ).message,
      ).toBeTruthy();
    });

    test('the organiser can enter the amount received and the date, and the declared amount stays as declared', async () => {
      const made = await declare('pat', { amountMinor: '25000', paidOn: day(-3) });
      const done = await decide(made.declaration.id, 'ACKNOWLEDGED', {
        receivedAmountMinor: '24000',
        receivedOn: day(-2),
      });
      expect(done.entry).toMatchObject({ amountMinor: '24000', occurredOn: day(-2) });
      expect(done.declaration.amountMinor).toBe('25000');
      // A received date in the future is refused by the existing ledger rule and nothing is half written.
      const other = await declare('pat', { amountMinor: '10' });
      const before = await counts();
      expect(
        (await rejected(decide(other.declaration.id, 'ACKNOWLEDGED', { receivedOn: day(1) }))).code,
      ).toBe('23514');
      expect(await counts()).toEqual(before);
      expect(
        (await ledger().pendingPaymentDeclarations(scope())).declarations.some(
          (d) => d.id === other.declaration.id,
        ),
      ).toBe(true);
    });

    test('not accepting leaves the ledger untouched, needs a reason and shows the participant that reason', async () => {
      const made = await declare('pat', { amountMinor: '555' });
      const before = await counts();
      const owed = await outstanding('pat');
      // Reason too short or missing is refused.
      await expect(
        decide(made.declaration.id, 'REJECTED', { reason: 'short' }),
      ).rejects.toBeTruthy();
      await expect(decide(made.declaration.id, 'REJECTED', { reason: null })).rejects.toBeTruthy();
      const reason = w('The transfer did not reach my account');
      const done = await decide(made.declaration.id, 'REJECTED', { reason });
      expect(done.declaration).toMatchObject({ status: 'REJECTED', reason });
      expect(done.entry).toBeNull();
      expect(await counts()).toEqual({ ...before, decisions: before.decisions + 1 });
      expect(await outstanding('pat')).toBe(owed);
      const own = await ledger('pat').ownPaymentDeclarations({ registrationId: reg.pat });
      expect(own.declarations.find((d) => d.id === made.declaration.id)).toMatchObject({
        status: 'REJECTED',
        reason,
      });
      expect((await rejected(decide(made.declaration.id, 'ACKNOWLEDGED'))).code).toBe('23514');
      // An acknowledgement carries no reason, and a rejection carries no received amount.
      const next = await declare('pat', { amountMinor: '3' });
      await expect(
        decide(next.declaration.id, 'ACKNOWLEDGED', { reason: w('A reason here') }),
      ).rejects.toBeTruthy();
      await expect(
        decide(next.declaration.id, 'REJECTED', { receivedAmountMinor: '3' }),
      ).rejects.toBeTruthy();
    });

    test('a free-text field that breaks the tenant wording rule is refused', async () => {
      // A sample tenant needs the Synthetic marker (the database says so); a real tenant needs two characters (the service says so).
      const bad = mode === 'synthetic' ? 'A reference without the sample marker' : 'x';
      const first = await rejected(declare('pat', { payerReference: bad }));
      const second = await rejected(declare('pat', { note: bad }));
      if (mode === 'synthetic') {
        expect(first.code).toBe('23514');
        expect(second.code).toBe('23514');
      } else {
        expect(first.message).toBeTruthy();
        expect(second.message).toBeTruthy();
      }
    });
  });
}

describe('install', () => {
  test('0016 is repeatable, security definer with a pinned search path, and granted to the runtime login only', async () => {
    const sql = await sqlText();
    const tables = async () =>
      (
        await f.owner.query(
          `SELECT (SELECT count(*)::int FROM customer_private.programme_payment_declaration) d,
 (SELECT count(*)::int FROM customer_private.programme_payment_decision) x,
 (SELECT count(*)::int FROM customer_private.programme_payment_command) c`,
        )
      ).rows[0];
    const before = await tables();
    await f.owner.query(sql);
    await f.owner.query(sql);
    expect(await tables()).toEqual(before);
    const functions = [
      'customer.declare_programme_payment(uuid,jsonb)',
      'customer.own_programme_payment_declarations(uuid)',
      'customer.programme_payment_declarations_pending(uuid,uuid)',
      'customer.decide_programme_payment(uuid,uuid,uuid,jsonb)',
    ];
    for (const fn of functions) {
      const acl = (
        await f.owner.query(
          `SELECT p.prosecdef,p.proconfig,has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,
 has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth,has_function_privilege('public',p.oid,'EXECUTE') pub
 FROM pg_proc p WHERE p.oid=$1::regprocedure`,
          [fn],
        )
      ).rows[0];
      expect(acl).toMatchObject({ prosecdef: true, runtime: true, auth: false, pub: false });
      expect(acl.proconfig).toEqual(['search_path=pg_catalog']);
    }
    for (const table of [
      'programme_payment_declaration',
      'programme_payment_decision',
      'programme_payment_command',
    ]) {
      const t = (
        await f.owner.query(
          `SELECT c.relrowsecurity,has_table_privilege('corridra_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE') runtime,
 has_table_privilege('corridra_auth',c.oid,'SELECT,INSERT,UPDATE,DELETE') auth FROM pg_class c WHERE c.oid=$1::regclass`,
          ['customer_private.' + table],
        )
      ).rows[0];
      expect(t).toEqual({ relrowsecurity: true, runtime: false, auth: false });
    }
    // Direct table access by the runtime login is refused.
    expect(
      (
        await rejected(
          f.runtime.query('SELECT * FROM customer_private.programme_payment_declaration'),
        )
      ).code,
    ).toBe('42501');
  });
});
