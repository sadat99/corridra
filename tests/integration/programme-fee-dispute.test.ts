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

// U10d: participant fee question, record only (real-use 0018). Both a sample (synthetic) tenant and a real-use tenant run the same
// checks, because the wording rules of the ledger entry and of the free-text fields differ between them.
let f: Awaited<ReturnType<typeof fixture>>;
const issuer =
  'https://ep-fee-dispute-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
      '../../packages/db/customer-real-use-migrations/0018_participant_fee_dispute.sql',
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
    const person = (p: string) => `fd-${mode}-${p}`;
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
    const file = (who: string, reason = 'AMOUNT_WRONG', command = randomUUID()) =>
      ledger(who).fileFeeDispute({ commandId: command, registrationId: reg[who], reason });
    const answer = (
      disputeId: string,
      outcome: 'RESOLVED' | 'DECLINED',
      who = 'org',
      command = randomUUID(),
    ) => ledger(who).decideFeeDispute({ commandId: command, ...scope(), disputeId, outcome });
    const feeStatus = (who: string) => terms(who).ownFeeStatus({ registrationId: reg[who] });
    // Everything money related, as the participant and the organiser read it, plus the raw ledger rows.
    const moneySnapshot = async (who: string) => ({
      status: { ...(await feeStatus(who)), expiresAt: undefined },
      ledger: (
        await f.owner.query(
          `SELECT id,kind,amount_minor::text amount,currency,registration_id FROM customer_private.programme_ledger_entry WHERE workspace_id=$1 ORDER BY id`,
          [workspaceId],
        )
      ).rows,
      summary: JSON.stringify(
        (await ledger().summary(scope())) as unknown as Record<string, unknown>,
        (k, v) => (k === 'expiresAt' ? undefined : v),
      ),
    });
    const counts = async () =>
      (
        await f.owner.query(
          `SELECT (SELECT count(*)::int FROM customer_private.programme_ledger_entry WHERE workspace_id=$1) ledger,
 (SELECT count(*)::int FROM customer_private.programme_payment_declaration WHERE workspace_id=$1) declarations,
 (SELECT count(*)::int FROM customer_private.programme_fee_dispute WHERE workspace_id=$1) disputes,
 (SELECT count(*)::int FROM customer_private.programme_fee_dispute_resolution WHERE workspace_id=$1) resolutions`,
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
            reason: 'Explicit invented fee question test identity; no real account or email',
          });
      workspaceId = (
        await workspaces().provision({ commandId: randomUUID(), name: w('Dispute organiser') })
      ).id;
      otherWorkspace = (
        await workspaces('stranger').provision({
          commandId: randomUUID(),
          name: w('Dispute stranger'),
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
          name: w('Dispute programme'),
          reportingPurpose: w('Participant fee question test'),
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
      await record('pat', 'PARTICIPANT_PAYMENT', '20000');
      await record('other', 'PARTICIPANT_FEE', '90000');
      await record('gone', 'PARTICIPANT_FEE', '90000');
      await participants('gone').command({
        action: 'withdraw',
        commandId: randomUUID(),
        registrationId: reg.gone,
        reason: w('Withdrawal for the dispute test'),
        acknowledged: true,
      });
    }, 240000);

    test('a question is recorded, never touches money, and resolving it changes nothing either', async () => {
      const before = await moneySnapshot('pat');
      const rows = await counts();
      const made = await file('pat', 'AMOUNT_WRONG');
      expect(made).toMatchObject({ replayed: false, recordOnly: true });
      expect(made.dispute).toMatchObject({
        status: 'OPEN',
        reason: 'AMOUNT_WRONG',
        registrationId: reg.pat,
        decidedAt: null,
      });
      // The payload carries no amount, no label and no words: only the closed fields.
      expect(Object.keys(made.dispute).sort()).toEqual(
        ['decidedAt', 'filedAt', 'id', 'reason', 'registrationId', 'status'].sort(),
      );
      expect(await counts()).toEqual({ ...rows, disputes: rows.disputes + 1 });
      expect(await moneySnapshot('pat')).toEqual(before);
      const own = await ledger('pat').ownFeeDisputes({ registrationId: reg.pat });
      expect(own).toMatchObject({ recordOnly: true, collectsPayments: false });
      expect(own.disputes.map((d) => d.id)).toEqual([made.dispute.id]);
      // The organiser sees it.
      const open = await ledger().openFeeDisputes(scope());
      expect(open.recordOnly).toBe(true);
      expect(open.disputes.map((d) => d.id)).toEqual([made.dispute.id]);
      // The organiser answers it. One resolution row and no ledger change.
      const command = randomUUID();
      const done = await answer(made.dispute.id, 'RESOLVED', 'org', command);
      expect(done.dispute.status).toBe('RESOLVED');
      expect(await counts()).toEqual({
        ...rows,
        disputes: rows.disputes + 1,
        resolutions: rows.resolutions + 1,
      });
      expect(await moneySnapshot('pat')).toEqual(before);
      expect(
        (await ledger('pat').ownFeeDisputes({ registrationId: reg.pat })).disputes[0].status,
      ).toBe('RESOLVED');
      expect((await ledger().openFeeDisputes(scope())).disputes).toEqual([]);
      // Replay of the same answer is the same answer; a new answer, or the same command with another outcome, is refused.
      expect((await answer(made.dispute.id, 'RESOLVED', 'org', command)).replayed).toBe(true);
      expect((await rejected(answer(made.dispute.id, 'DECLINED'))).code).toBe('23514');
      expect((await rejected(answer(made.dispute.id, 'DECLINED', 'org', command))).code).toBe(
        '23514',
      );
      expect(await moneySnapshot('pat')).toEqual(before);
      // Declining is the other closed word and also leaves money alone.
      const second = await file('pat', 'ALREADY_PAID');
      expect((await answer(second.dispute.id, 'DECLINED')).dispute.status).toBe('DECLINED');
      expect(await moneySnapshot('pat')).toEqual(before);
    });

    test('guards: closed reasons only, own active registration only, organiser owner or admin only, no cross-workspace reach', async () => {
      for (const reason of ['amount_wrong', 'Too much', '', 'OTHER ', 'Synthetic words here'])
        expect(
          (
            await rejected(
              ledger('other').fileFeeDispute({
                commandId: randomUUID(),
                registrationId: reg.other,
                reason,
              }),
            )
          ).message,
        ).toBeTruthy();
      // A direct database call with free text or an extra key is refused too.
      for (const input of [
        { registrationId: reg.other, reason: 'OTHER', note: 'Please call me' },
        { registrationId: reg.other, reason: 'Synthetic amount is wrong' },
        { registrationId: reg.other },
      ])
        expect(
          (
            await rejected(
              f.owner.query('SELECT customer.file_programme_fee_dispute($1,$2)', [
                randomUUID(),
                JSON.stringify(input),
              ]),
            )
          ).message,
        ).toBeTruthy();
      // Another participant, the organiser and a stranger cannot file for or read someone else's registration.
      const same = (await rejected(ledger('other').ownFeeDisputes({ registrationId: reg.pat })))
        .message;
      for (const who of ['other', 'org', 'stranger']) {
        const denied = await rejected(ledger(who).ownFeeDisputes({ registrationId: reg.pat }));
        expect(denied.code).toBe('42501');
        expect(denied.message).toBe(same);
        expect(
          (
            await rejected(
              ledger(who).fileFeeDispute({
                commandId: randomUUID(),
                registrationId: reg.pat,
                reason: 'OTHER',
              }),
            )
          ).code,
        ).toBe('42501');
      }
      // A withdrawn registration cannot file.
      expect((await rejected(file('gone'))).code).toBe('42501');
      // Participants cannot read the organiser queue or answer a question.
      const mine = await file('other', 'NOT_ATTENDING');
      for (const who of ['other', 'pat', 'stranger']) {
        expect((await rejected(ledger(who).openFeeDisputes(scope()))).code).toBe('42501');
        expect((await rejected(answer(mine.dispute.id, 'RESOLVED', who))).code).toBe('42501');
      }
      // Another workspace's organiser cannot reach this programme, nor name this question under its own ids.
      expect(
        (
          await rejected(
            ledger('stranger').openFeeDisputes({ workspaceId: otherWorkspace, programmeId }),
          )
        ).code,
      ).toBe('42501');
      expect(
        (
          await rejected(
            ledger('stranger').decideFeeDispute({
              commandId: randomUUID(),
              workspaceId: otherWorkspace,
              programmeId,
              disputeId: mine.dispute.id,
              outcome: 'RESOLVED',
            }),
          )
        ).code,
      ).toBe('42501');
      // A member who is not owner or admin cannot read or answer.
      expect((await rejected(ledger('member').openFeeDisputes(scope()))).code).toBe('42501');
      expect((await rejected(answer(mine.dispute.id, 'RESOLVED', 'member'))).code).toBe('42501');
      // The organiser can answer it.
      expect((await answer(mine.dispute.id, 'RESOLVED')).dispute.status).toBe('RESOLVED');
    });

    test('a question is bounded and replays safely', async () => {
      const command = randomUUID();
      const first = await file('nofee', 'OTHER', command);
      expect((await file('nofee', 'OTHER', command)).dispute.id).toBe(first.dispute.id);
      // Same command with a different reason conflicts.
      expect((await rejected(file('nofee', 'AMOUNT_WRONG', command))).code).toBe('23514');
      // The same reason cannot be open twice.
      expect((await rejected(file('nofee', 'OTHER'))).code).toBe('23514');
      // At most four open questions at once: the fifth distinct reason does not exist, so the limit is the reason set.
      for (const reason of ['AMOUNT_WRONG', 'ALREADY_PAID', 'NOT_ATTENDING'])
        await file('nofee', reason);
      expect(
        (await ledger('nofee').ownFeeDisputes({ registrationId: reg.nofee })).disputes,
      ).toHaveLength(4);
      // The history of answered questions stays readable and the same reason can be raised again once answered.
      const open = await ledger().openFeeDisputes(scope());
      const mineOpen = open.disputes.find((d) => d.id === first.dispute.id)!;
      await answer(mineOpen.id, 'DECLINED');
      expect((await file('nofee', 'OTHER')).dispute.status).toBe('OPEN');
    });

    test('rows cannot be rewritten or removed, even by the table owner', async () => {
      const made = await file('pat', 'NOT_ATTENDING');
      await answer(made.dispute.id, 'DECLINED');
      for (const sql of [
        "UPDATE customer_private.programme_fee_dispute SET reason='OTHER'",
        'DELETE FROM customer_private.programme_fee_dispute',
        "UPDATE customer_private.programme_fee_dispute_resolution SET outcome='RESOLVED'",
        'DELETE FROM customer_private.programme_fee_dispute_resolution',
        'DELETE FROM customer_private.programme_fee_dispute_command',
      ])
        expect((await rejected(f.owner.query(sql))).message).toBeTruthy();
      // The database refuses a reason outside the closed set and a registration of another person.
      expect(
        (
          await rejected(
            f.owner.query(
              `INSERT INTO customer_private.programme_fee_dispute(registration_id,workspace_id,programme_id,reason,filed_by)
 SELECT id,workspace_id,programme_id,'free words here',principal_id FROM customer_private.programme_registration WHERE id=$1`,
              [reg.pat],
            ),
          )
        ).code,
      ).toBe('23514');
      expect(
        (
          await rejected(
            f.owner.query(
              `INSERT INTO customer_private.programme_fee_dispute(registration_id,workspace_id,programme_id,reason,filed_by)
 SELECT id,workspace_id,programme_id,'OTHER',(SELECT principal_id FROM customer_private.programme_registration WHERE id=$2) FROM customer_private.programme_registration WHERE id=$1`,
              [reg.pat, reg.other],
            ),
          )
        ).code,
      ).toBe('23514');
    });
  });
}

describe('install', () => {
  test('0018 is repeatable, security definer with a pinned search path, granted to the runtime login only and has no free text column', async () => {
    const sql = await sqlText();
    const tables = async () =>
      (
        await f.owner.query(
          `SELECT (SELECT count(*)::int FROM customer_private.programme_fee_dispute) d,
 (SELECT count(*)::int FROM customer_private.programme_fee_dispute_resolution) x,
 (SELECT count(*)::int FROM customer_private.programme_fee_dispute_command) c`,
        )
      ).rows[0];
    const before = await tables();
    await f.owner.query(sql);
    await f.owner.query(sql);
    expect(await tables()).toEqual(before);
    const functions = [
      'customer.file_programme_fee_dispute(uuid,jsonb)',
      'customer.own_programme_fee_disputes(uuid)',
      'customer.programme_fee_disputes_open(uuid,uuid)',
      'customer.decide_programme_fee_dispute(uuid,uuid,uuid,jsonb)',
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
      'programme_fee_dispute',
      'programme_fee_dispute_resolution',
      'programme_fee_dispute_command',
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
    // No text column in the module: every column is an id, a time, a closed code or a jsonb command echo.
    const textColumns = (
      await f.owner.query(
        `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='customer_private'
 AND table_name IN ('programme_fee_dispute','programme_fee_dispute_resolution') AND data_type='text' ORDER BY 1,2`,
      )
    ).rows;
    expect(textColumns).toEqual([
      { table_name: 'programme_fee_dispute', column_name: 'reason' },
      { table_name: 'programme_fee_dispute_resolution', column_name: 'outcome' },
    ]);
    // The module's source never names the ledger table: it cannot read or write money.
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(
      /programme_ledger_entry|programme_ledger_record|amount_minor/,
    );
    // Direct table access by the runtime login is refused.
    expect(
      (await rejected(f.runtime.query('SELECT * FROM customer_private.programme_fee_dispute')))
        .code,
    ).toBe('42501');
  });
});
