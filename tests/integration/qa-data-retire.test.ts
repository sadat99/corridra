import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { digest, harness, issuer, options, type Fixture } from './revamp-g4-support';
import { watching } from './problem-report-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureRequestWithdrawal } from '../../packages/auth/src/customer-request-withdrawal-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { MissionService } from '../../packages/missions/src/index';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import {
  qaDataRetirePlan,
  reportQaDataRetire,
  type QaDataRetirePlan,
  type QaDataRetireReport,
} from '../../packages/auth/src/customer-qa-data-retire';

// B11b, real database, real restricted roles (owner decision 23 Nov 2026: "dont delete any existing users"). The QA test
// data retirement step only reports. Each item is retired here the way a person retires it, through the real lifecycle
// function under that person's own session, and the report is read before and after each one. Nothing here is a real
// account, email or workspace: the made-up fixture runs in sample mode, where every name starts with "Synthetic", so the
// report is given those names; the installer always uses the fixed owner-approved names (qa-data-retire-installer.test.ts).
const reason = qaDataRetirePlan.reason;
let f: Fixture;
let h: ReturnType<typeof harness>;
let missions: MissionService;
let plan: QaDataRetirePlan;
let workspaceId: string;
let programmeId: string;
let requestId: string;
let registrationId: string;
let openInvitationId: string;
let reportId: string;
let missingModule: unknown;

const session = (person: string) => async () => h.session(person);
const requests = (person: string) =>
  new CustomerRequestService(f.runtime, f.auth, options, session(person));
const programmes = (person: string) =>
  new CustomerProgrammeService(f.runtime, f.auth, options, session(person));
const participants = (person: string) =>
  new CustomerParticipantService(f.runtime, f.auth, options, session(person));
const prepare = (context: Parameters<MissionService['prepareCustomerIntake']>[0], body: unknown) =>
  missions.prepareCustomerIntake(context, body);
const brief = (objective: string, market: string) => ({
  objective,
  market,
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Asia/Shanghai',
  offer: 'Synthetic cotton towels for the retirement report tests',
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
});
const file = (person: string) =>
  h
    .sql<{ r: { reference: string } }>(
      person,
      'SELECT customer.problem_report_command($1,$2) AS r',
      [
        randomUUID(),
        JSON.stringify({
          category: 'did_not_work',
          pageKind: 'this_page',
          page: '/account/requests',
        }),
      ],
    )
    .then((row) => row.r.reference);
const report = (over: Partial<QaDataRetirePlan> = {}) =>
  reportQaDataRetire(f.owner, { ...plan, ...over });
const states = (result: QaDataRetireReport) =>
  result.steps.map((step) => `${step.kind}: ${step.state}, ${step.detail}`);
// Every table a retirement touches, plus the people. A report must leave each of them exactly as it was.
const tables = [
  'identity."user"',
  'identity.principal',
  'customer_private.principal',
  'customer.membership',
  'app.tenant',
  'customer_private.workspace_revision',
  'customer_private.programme_lifecycle_revision',
  'customer_private.programme_invitation',
  'customer_private.programme_registration',
  'customer_private.programme_participant_revocation',
  'customer_private.owned_request',
  'customer_private.request_withdrawal_event',
  'customer_private.problem_report',
  'customer_private.problem_report_status_event',
  'app.domain_event',
  'app.audit_event',
];
const people = async () =>
  (
    await f.owner.query(`SELECT (SELECT count(*)::int FROM identity."user") AS users,
      (SELECT count(*)::int FROM identity.account) AS accounts,
      (SELECT count(*)::int FROM identity.principal) AS principals,
      (SELECT count(*)::int FROM customer_private.principal) AS customers,
      (SELECT count(*)::int FROM customer.membership) AS memberships,
      (SELECT count(*)::int FROM app.tenant) AS workspaces`)
  ).rows[0] as Record<string, number>;

beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'synthetic-only-qa-retire-secret');
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerProgrammeLifecycle(f.owner);
  // Before the workspace lifecycle is installed the report refuses, naming the module.
  missingModule = await reportQaDataRetire(f.owner).catch((error: unknown) => error);
  await migrateCustomerWorkspaceLifecycle(f.owner);
  await migrateCustomerProblemReports(f.owner);
  await migrateCustomerRequestWithdrawal(f.owner);
  h = harness(f, 'qaret');
  const ids = await h.admit(['olga', 'pat', 'zed']);
  for (const person of ['olga', 'zed'])
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: ids[person]!,
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner!.id);
  await h.setControl(true);
  // Withdrawing a request is open only while real use is open; the people here stay made-up sample accounts.
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Fixture configuration row for the retirement report tests',
  });
  await configureRequestWithdrawal(f.owner, {
    enabled: true,
    reason: 'Fixture control for the retirement report tests',
  });
  plan = {
    ...qaDataRetirePlan,
    workspace: 'Synthetic QA-Organiser Workspace',
    programme: 'Synthetic QA-Test Programme',
    companyProfile: 'Synthetic QA-Test Co',
    keep: ['Synthetic QA kept workspace'],
  };
  workspaceId = await h.provision('olga', plan.workspace);
  await h.provision('zed', 'Synthetic QA kept workspace');
  const sent = await requests('olga').submit(
    { commandId: randomUUID(), workspaceId, brief: brief('Source suppliers', 'CN') },
    prepare,
  );
  requestId = sent.id as string;
  // Another request in the same workspace, with another title: it is never listed.
  await requests('olga').submit(
    { commandId: randomUUID(), workspaceId, brief: brief('Sell in a new market', 'Spain') },
    prepare,
  );
  programmeId = (
    await programmes('olga').create({
      commandId: randomUUID(),
      workspaceId,
      name: plan.programme,
      reportingPurpose: 'Synthetic planning of a buyer visit for the retirement report tests',
      acknowledged: true,
    })
  ).id;
  const invite = () =>
    participants('olga').command({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      label: 'Synthetic participant invitation',
      acknowledged: true,
    });
  const accepted = await invite();
  registrationId = (
    await participants('pat').command({
      action: 'accept',
      commandId: randomUUID(),
      token: accepted.token,
      programmeId,
      displayLabel: 'Synthetic participant Pat',
      consented: true,
    })
  ).id as string;
  openInvitationId = (await invite()).id as string;
  plan.problemReport = await file('olga');
  reportId = (
    await f.owner.query('SELECT id FROM customer_private.problem_report WHERE reference=$1', [
      plan.problemReport,
    ])
  ).rows[0].id as string;
});
afterAll(async () => {
  await f?.close();
});

describe('before anything is retired', () => {
  test('a needed module that is not installed is named, and the fixed names are refused where they do not exist', async () => {
    expect(String(missingModule)).toContain('Install the workspace lifecycle module first');
    await expect(reportQaDataRetire(f.owner)).rejects.toThrow(
      'Expected exactly one workspace named "QA-Organiser Workspace (madeup)", found 0',
    );
  });

  test('every item is listed as still to retire, in an order that is safe, with who and where', async () => {
    const result = await report();
    expect(result.state).toBe('still to retire');
    expect(states(result)).toEqual([
      'request: still to retire, not withdrawn',
      'registration: still to retire, active',
      'invitation: nothing to do, accepted, covered by its registration',
      'invitation: still to retire, open',
      'programme: still to retire, not archived',
      'workspace: still to retire, not archived',
      'problem report: still to retire, received',
    ]);
    expect(result.steps.map((step) => step.id)).toEqual(
      [requestId, registrationId, result.steps[2]!.id, openInvitationId, programmeId, workspaceId]
        .map((id) => id.slice(0, 8))
        .concat(reportId.slice(0, 8)),
    );
    expect(result.checklist).toEqual([
      `1. [to do] request "Source suppliers in China" (${requestId.slice(0, 8)}), the person who sent the request, while still a member of the QA workspace: withdraw the request at /account/requests/{request id starting ${requestId.slice(0, 8)}}`,
      `2. [to do] registration (${registrationId.slice(0, 8)}), the participant who registered (or an owner or admin of the QA workspace, who can remove them): withdraw the registration at /account/delegations (the participant), or /account/delegations/{workspace id starting ${workspaceId.slice(0, 8)}}`,
      `3. [skip] invitation (${result.steps[2]!.id}), revoke the invitation: accepted, covered by its registration`,
      `4. [to do] invitation (${openInvitationId.slice(0, 8)}), an owner or admin of the QA workspace: revoke the invitation at /account/delegations/{workspace id starting ${workspaceId.slice(0, 8)}}`,
      `5. [to do] programme "Synthetic QA-Test Programme" (${programmeId.slice(0, 8)}), an owner or admin of the QA workspace: archive the programme at /account/delegations/{workspace id starting ${workspaceId.slice(0, 8)}}`,
      `6. [to do] workspace "Synthetic QA-Organiser Workspace" (${workspaceId.slice(0, 8)}), the owner of the QA workspace: archive the workspace at /account (the workspace list)`,
      `7. [to do] problem report ${plan.problemReport} (${reportId.slice(0, 8)}), a staff owner or admin, with a fresh authenticator check: close the report with a note at /operator/problem-reports/${plan.problemReport}`,
      `Where a screen asks for a reason or a note, type: ${reason}`,
    ]);
    const text = result.lines.join('\n');
    expect(text).toContain('company profile "Synthetic QA-Test Co": kept, no lifecycle');
    expect(text).toMatch(
      /kept, never touched: "Synthetic QA kept workspace" \(workspace [0-9a-f]{8}\)/,
    );
    expect(text).toContain('kept, never touched: "QA Test Co (madeup)"');
    expect(text).toContain(
      'kept, never touched: every user, identity, sign-in and customer account',
    );
    expect(text).toContain('6 still to retire');
    expect(result.lines.at(-1)).toBe('Nothing was written, changed or deleted.');
    // Safe for a public log: no address, no full id, and no name beyond the fixed ones.
    expect(text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toMatch(/Pat|olga|Test Person|Example Test Company/);
  });

  test('a report writes nothing: one read-only transaction that is rolled back, and every record is as it was', async () => {
    const before = { rows: await digest(f, tables), people: await people() };
    const seen: string[] = [];
    await reportQaDataRetire(watching(f.owner, seen, { next: false }, /./), plan);
    expect(seen[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(seen.at(-1)).toBe('ROLLBACK');
    expect(seen.filter((text) => /^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text))).toHaveLength(2);
    for (const text of seen.slice(1, -1)) expect(text).toMatch(/^\s*SELECT\b/);
    // A refused report is rolled back too.
    await expect(report({ programme: 'Synthetic programme nobody made' })).rejects.toThrow(
      'Expected exactly one programme named "Synthetic programme nobody made" in the workspace "Synthetic QA-Organiser Workspace", found 0',
    );
    expect({ rows: await digest(f, tables), people: await people() }).toEqual(before);
    // The database itself refuses a write inside such a transaction.
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await expect(
        db.query('UPDATE app.tenant SET name=name WHERE id=$1', [workspaceId]),
      ).rejects.toMatchObject({ code: '25006' });
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });

  test('a paused control is named on the step it would stop', async () => {
    const pause = async (enabled: boolean) => {
      await h.setControl(enabled);
      await configureRequestWithdrawal(f.owner, {
        enabled,
        reason: 'Fixture control for the retirement report tests',
      });
    };
    await pause(false);
    const paused = states(await report());
    await pause(true);
    expect(paused[0]).toBe(
      'request: still to retire, not withdrawn, and request withdrawal is paused: open it first',
    );
    expect(paused[5]).toBe(
      'workspace: still to retire, not archived, and workspace changes are paused: open them first',
    );
    expect(states(await report())[0]).toBe('request: still to retire, not withdrawn');
  });

  test('only the schema owner may read it, a kept name is never a target, and a report from elsewhere is left alone', async () => {
    await expect(reportQaDataRetire(f.runtime, plan)).rejects.toThrow();
    await expect(report({ workspace: 'Synthetic QA kept workspace' })).rejects.toThrow(
      'A kept name cannot be a retirement target',
    );
    await expect(report({ workspace: 'QA Test Co (madeup)' })).rejects.toThrow(
      'A kept name cannot be a retirement target',
    );
    await expect(
      report({
        request: {
          title: 'Find customers in Spain',
          objective: 'Find customers',
          markets: ['Spain'],
        },
      }),
    ).rejects.toThrow(
      'Expected exactly one request "Find customers in Spain" in the workspace "Synthetic QA-Organiser Workspace", found 0',
    );
    await expect(report({ problemReport: 'RP-999999' })).rejects.toThrow(
      'Expected exactly one problem report RP-999999, found 0',
    );
    // Filed by a person who is not a member of the QA workspace: listed as left alone, never as a step to do.
    const other = await file('zed');
    const result = await report({ problemReport: other });
    expect(states(result).at(-1)).toBe(
      'problem report: left alone, not filed by a member of the QA workspace, so it is not confirmed as QA test data',
    );
    expect(result.checklist[6]).toMatch(/^7\. \[skip\] problem report /);
  });
});

describe('each item retired by its own person through its own lifecycle', () => {
  const after = async () => states(await report());

  test('the sender withdraws the request', async () => {
    await h.sql('olga', 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
      requestId,
      randomUUID(),
      reason,
    ]);
    expect((await after())[0]).toBe('request: retired, withdrawn');
  });

  test('the participant withdraws the registration', async () => {
    await participants('pat').command({
      action: 'withdraw',
      commandId: randomUUID(),
      registrationId,
      reason,
      acknowledged: true,
    });
    expect((await after())[1]).toBe('registration: retired, withdrawn by the participant');
  });

  test('the organiser revokes the open invitation', async () => {
    await participants('olga').command({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      kind: 'invitation',
      targetId: openInvitationId,
      reason,
      acknowledged: true,
    });
    expect((await after()).slice(2, 4)).toEqual([
      'invitation: nothing to do, accepted, covered by its registration',
      'invitation: retired, revoked',
    ]);
  });

  test('the organiser archives the programme', async () => {
    await programmes('olga').change({
      operation: 'archive',
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      expectedVersion: 0,
    });
    expect((await after())[4]).toBe('programme: retired, archived');
  });

  test('the owner archives the workspace', async () => {
    await h.lifecycle('olga', 'archive', {
      workspaceId,
      expectedVersion: 0,
      confirmName: plan.workspace,
    });
    expect((await after())[5]).toBe('workspace: retired, archived');
  });

  test('a staff owner closes the problem report, and the report then says all retired, twice the same', async () => {
    expect((await report()).state).toBe('still to retire');
    await rawContext(
      f.runtime,
      f.users.owner!.ctx,
      'SELECT customer.problem_report_transition($1,$2,$3,$4,$5) AS r',
      [randomUUID(), reportId, 'received', 'closed', reason],
    );
    const before = await people();
    const first = await report();
    expect(first.state).toBe('all retired');
    expect(states(first)).toEqual([
      'request: retired, withdrawn',
      'registration: retired, withdrawn by the participant',
      'invitation: nothing to do, accepted, covered by its registration',
      'invitation: retired, revoked',
      'programme: retired, archived',
      'workspace: retired, archived',
      'problem report: retired, closed',
    ]);
    expect(first.checklist.slice(0, 7).map((line) => line.match(/\[(\w+ ?\w*)\]/)![1])).toEqual([
      'done',
      'done',
      'skip',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(first.lines).toContain('all retired');
    expect(await report()).toEqual(first);
    // Retiring removed nobody and nothing: every person, sign-in, membership and workspace is still there.
    expect(await people()).toEqual(before);
    expect(
      (
        await f.owner.query(
          `SELECT (SELECT count(*)::int FROM customer_private.owned_request WHERE workspace_id=$1) AS requests,
          (SELECT count(*)::int FROM customer_private.programme_registration WHERE programme_id=$2) AS registrations,
          (SELECT count(*)::int FROM customer_private.programme_invitation WHERE programme_id=$2) AS invitations,
          (SELECT count(*)::int FROM customer.membership WHERE tenant_id=$1) AS members`,
          [workspaceId, programmeId],
        )
      ).rows[0],
    ).toEqual({ requests: 2, registrations: 1, invitations: 2, members: 1 });
  });

  test('two workspaces with the same name are refused', async () => {
    await h.provision('zed', plan.workspace);
    await expect(report()).rejects.toThrow(
      'Expected exactly one workspace named "Synthetic QA-Organiser Workspace", found 2',
    );
  });
});
