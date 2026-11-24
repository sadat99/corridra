import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import type { DatabasePool } from '../../packages/db/src/index';
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
  shown,
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
  // The moment of the owner decision in this made-up world: the QA workspace exists, and anything made later is not it.
  plan.workspaceCreatedBefore = (await f.owner.query('SELECT clock_timestamp()::text AS at'))
    .rows[0].at as string;
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
  test('a needed module that is not installed is named, and the fixed names resolve to nothing where they do not exist', async () => {
    expect(String(missingModule)).toContain('Install the workspace lifecycle module first');
    // The fixed plan in a database without the QA workspace: a report, never a crash, and nothing to act on.
    const result = await reportQaDataRetire(f.owner);
    expect(result.state).toBe('targets not resolved');
    expect(result.targets).toEqual([
      {
        kind: 'workspace',
        label: 'workspace "QA-Organiser Workspace (madeup)"',
        status: 'not found',
        matches: 0,
      },
      {
        kind: 'programme',
        label: 'programme "QA-Test Programme (madeup)"',
        status: 'not checked',
        matches: null,
      },
      {
        kind: 'request',
        label: 'request "Source suppliers in China"',
        status: 'not checked',
        matches: null,
      },
      {
        kind: 'problem report',
        label: 'problem report RP-000001',
        status: 'not checked',
        matches: null,
      },
    ]);
    expect(result.steps).toEqual([]);
    expect(result.checklist).toEqual([]);
    expect(result.lines).toEqual([
      'target workspace "QA-Organiser Workspace (madeup)": not found',
      'target programme "QA-Test Programme (madeup)": not checked, it is looked up inside the QA workspace',
      'target request "Source suppliers in China": not checked, it is looked up inside the QA workspace',
      'target problem report RP-000001: not checked, it is looked up inside the QA workspace',
      '4 of 4 targets not resolved exactly once',
      'No checklist: nothing is to be retired until every target is found exactly once.',
      'kept, never touched: every user, identity, sign-in and customer account',
      'Nothing was written, changed or deleted.',
    ]);
  });

  test('a request that matches nothing is reported with what the QA workspace holds, and no checklist is given', async () => {
    const before = { rows: await digest(f, tables), people: await people() };
    // The production dry run of 24 Nov 2026: the workspace and programme resolve, the request title matches nothing.
    const result = await report({
      request: {
        title: 'Find customers in Spain',
        objective: 'Find customers',
        markets: ['Spain'],
      },
    });
    expect(result.state).toBe('targets not resolved');
    expect(result.targets.map((target) => `${target.kind}: ${target.status}`)).toEqual([
      'workspace: found',
      'programme: found',
      'request: not found',
      'problem report: found',
    ]);
    expect(result.steps).toEqual([]);
    expect(result.checklist).toEqual([]);
    const short = workspaceId.slice(0, 8);
    expect(result.lines).toEqual([
      'target workspace "Synthetic QA-Organiser Workspace": found',
      'target programme "Synthetic QA-Test Programme": found',
      'target request "Find customers in Spain": not found',
      `target problem report ${plan.problemReport}: found`,
      `requests in the workspace "Synthetic QA-Organiser Workspace" (${short}): 2`,
      `request ${requestId.slice(0, 8)}: objective "Source suppliers", market "CN", status DRAFT`,
      expect.stringMatching(
        /^request [0-9a-f]{8}: objective "Sell in a new market", market "Spain", status DRAFT$/,
      ),
      'the same title, sent by a member of the QA workspace into another workspace: 0 (never a target: the plan names the QA workspace only)',
      '1 of 4 targets not resolved exactly once',
      'No checklist: nothing is to be retired until every target is found exactly once.',
      'kept, never touched: every user, identity, sign-in and customer account',
      'Nothing was written, changed or deleted.',
    ]);
    // Safe for a public log: no address, no full id, and nothing a person typed beyond the objective and market.
    const text = result.lines.join('\n');
    expect(text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toMatch(/Pat|olga|Test Person|Example Test Company|cotton towels/);
    expect({ rows: await digest(f, tables), people: await people() }).toEqual(before);
  });

  test('a request title that matches two requests is reported as more than one', async () => {
    // A third request with the same objective and another spelling of the market: "CN" and "China" both make the title.
    const before = await report();
    expect(before.state).toBe('still to retire');
    const third = await requests('olga').submit(
      { commandId: randomUUID(), workspaceId, brief: brief('Source suppliers', 'China') },
      prepare,
    );
    const result = await report();
    expect(result.state).toBe('targets not resolved');
    expect(result.targets[2]).toEqual({
      kind: 'request',
      label: 'request "Source suppliers in China"',
      status: 'more than one',
      matches: 2,
    });
    expect(result.checklist).toEqual([]);
    expect(result.lines).toContain(
      'target request "Source suppliers in China": more than one (2 match)',
    );
    expect(result.lines).toContain(
      `request ${(third.id as string).slice(0, 8)}: objective "Source suppliers", market "China", status DRAFT`,
    );
    // Nothing is guessed between the two. The tests below name the one spelling the first request has, so the plan
    // resolves again; the extra request stays in the workspace untouched (three requests from here on).
    plan.request = { ...plan.request, markets: ['CN'] };
    expect((await report()).state).toBe('still to retire');
  });

  test('text a customer typed is hidden from the public log when it holds an address, a link, a domain or a number', () => {
    for (const value of [
      'pat@example.invalid',
      'see https://example.invalid/x',
      'ftp://files',
      'www.example',
      'WWW.Example.invalid',
      'example.invalid',
      'China, example.co/path',
      'shop.example-site.invalid',
      'call 5550100',
      '+880 1711-000 000',
      '65 6555 0100',
      'account 072-123456-7',
    ])
      expect(shown(value, 60), value).toBe('(hidden)');
    // A place name, a code and a short number stay readable; an empty value says so; a long one is cut.
    expect(shown('China', 40)).toBe('China');
    expect(shown('CN', 40)).toBe('CN');
    expect(shown('  Guangdong   and\nZhejiang ', 40)).toBe('Guangdong and Zhejiang');
    expect(shown('Top 20 cities, 2027', 40)).toBe('Top 20 cities, 2027');
    expect(shown(null, 40)).toBe('(empty)');
    expect(shown('   ', 40)).toBe('(empty)');
    expect(shown('a'.repeat(70), 60)).toBe('a'.repeat(60) + '...');
  });

  test('the request list is capped at 50 rows and hides unsafe text in the report itself', async () => {
    // The list query is answered with 51 made-up rows, so the cap and the printing are tested on the real report path
    // without sending 51 requests. Every other statement goes to the database unchanged.
    const unsafe = [
      'pat@example.invalid',
      'https://example.invalid',
      'www.example',
      'example.invalid',
      '+65 6555 0100',
    ];
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: index.toString(16).padStart(8, '0'),
      objective: 'Source suppliers',
      market: unsafe[index] ?? `Market ${index}`,
      status: 'DRAFT',
      withdrawn: index === 5,
    }));
    const many: DatabasePool = {
      query: f.owner.query.bind(f.owner),
      end: f.owner.end.bind(f.owner),
      connect: async () => {
        const client = await f.owner.connect();
        return new Proxy(client, {
          get(target, key, receiver) {
            if (key !== 'query') return Reflect.get(target, key, receiver);
            return (text: unknown, ...rest: unknown[]) =>
              typeof text === 'string' && text.includes('LIMIT 51')
                ? Promise.resolve({ rows, rowCount: rows.length })
                : Reflect.apply(target.query, target, [text, ...rest]);
          },
        });
      },
    } as DatabasePool;
    const result = await reportQaDataRetire(many, {
      ...plan,
      request: {
        title: 'Find customers in Spain',
        objective: 'Find customers',
        markets: ['Spain'],
      },
    });
    expect(result.state).toBe('targets not resolved');
    const listed = result.lines.filter((line) => /^request [0-9a-f]{8}: /.test(line));
    expect(listed).toHaveLength(50);
    expect(result.lines).toContain(
      `requests in the workspace "Synthetic QA-Organiser Workspace" (${workspaceId.slice(0, 8)}): the first 50`,
    );
    expect(listed.slice(0, 5)).toEqual(
      [0, 1, 2, 3, 4].map(
        (index) =>
          `request 0000000${index}: objective "Source suppliers", market "(hidden)", status DRAFT`,
      ),
    );
    expect(listed[5]).toBe(
      'request 00000005: objective "Source suppliers", market "Market 5", status DRAFT, withdrawn',
    );
    // The 51st row is never printed.
    expect(result.lines.join('\n')).not.toMatch(/00000032|Market 50/);
    expect(result.lines.join('\n')).not.toMatch(/@|example|6555/);
  });

  test('a missing programme or problem report is named while the request still resolves', async () => {
    const many = await reportQaDataRetire(f.owner, {
      ...plan,
      // Both markets in the workspace are named, but only one request has this objective.
      request: { ...plan.request, markets: ['CN', 'Spain'] },
      programme: 'Synthetic programme nobody made',
      problemReport: 'RP-999999',
    });
    expect(many.targets.map((target) => `${target.kind}: ${target.status}`)).toEqual([
      'workspace: found',
      'programme: not found',
      'request: found',
      'problem report: not found',
    ]);
    expect(many.state).toBe('targets not resolved');
    expect(many.checklist).toEqual([]);
    expect(many.lines).toContain('2 of 4 targets not resolved exactly once');
    // The request resolved, so the request list of the workspace is not printed.
    expect(many.lines.join('\n')).not.toMatch(/requests in the workspace|objective "/);
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
    // A report with a target that does not resolve is read only and rolled back in the same way.
    const unresolved: string[] = [];
    const none = await reportQaDataRetire(watching(f.owner, unresolved, { next: false }, /./), {
      ...plan,
      request: {
        title: 'Find customers in Spain',
        objective: 'Find customers',
        markets: ['Spain'],
      },
    });
    expect(none.state).toBe('targets not resolved');
    expect(unresolved[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(unresolved.at(-1)).toBe('ROLLBACK');
    for (const text of unresolved.slice(1, -1)) expect(text).toMatch(/^\s*SELECT\b/);
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

  test('the connection is always released, and discarded when the rollback fails', async () => {
    const released: unknown[] = [];
    const breaking: DatabasePool = {
      query: f.owner.query.bind(f.owner),
      end: f.owner.end.bind(f.owner),
      connect: async () => {
        const client = await f.owner.connect();
        return new Proxy(client, {
          get(target, key, receiver) {
            if (key === 'query')
              return (text: unknown, ...rest: unknown[]) =>
                text === 'ROLLBACK'
                  ? Promise.reject(new Error('the rollback could not be sent'))
                  : Reflect.apply(target.query, target, [text, ...rest]);
            if (key === 'release')
              return (error?: Error) => {
                released.push(error);
                return target.release(error);
              };
            return Reflect.get(target, key, receiver);
          },
        });
      },
    };
    expect((await reportQaDataRetire(breaking, plan)).state).toBe('still to retire');
    expect(released).toHaveLength(1);
    expect(released[0]).toBeInstanceOf(Error);
    // A refused report releases its connection too, with a clean rollback.
    const seen: unknown[] = [];
    const counting: DatabasePool = {
      ...breaking,
      connect: async () => {
        const client = await f.owner.connect();
        return new Proxy(client, {
          get(target, key, receiver) {
            if (key !== 'release') return Reflect.get(target, key, receiver);
            return (error?: Error) => {
              seen.push(error);
              return target.release(error);
            };
          },
        });
      },
    };
    expect(
      (await reportQaDataRetire(counting, { ...plan, problemReport: 'RP-999999' })).state,
    ).toBe('targets not resolved');
    expect(seen).toEqual([undefined]);
    // A report that is refused outright (a kept name as a target) releases its connection too.
    await expect(
      reportQaDataRetire(counting, { ...plan, workspace: 'Synthetic QA kept workspace' }),
    ).rejects.toThrow('A kept name cannot be a retirement target');
    expect(seen).toEqual([undefined, undefined]);
  });

  test('a same-named workspace made after the owner decision is never taken for the QA workspace', async () => {
    await h.provision('zed', 'Synthetic late QA workspace');
    const late = await report({ workspace: 'Synthetic late QA workspace' });
    expect(late.state).toBe('targets not resolved');
    expect(late.steps).toEqual([]);
    expect(late.checklist).toEqual([]);
    expect(late.targets[0]).toMatchObject({ kind: 'workspace', status: 'not found', matches: 0 });
    expect(late.targets.slice(1).map((target) => target.status)).toEqual([
      'not checked',
      'not checked',
      'not checked',
    ]);
    expect(late.lines[0]).toBe(
      'target workspace "Synthetic late QA workspace": not found, a workspace of that name was made after the owner decision, so it is not the QA workspace',
    );
    // The real cut-off is the end of the day of the decision, fixed in the module.
    expect(qaDataRetirePlan.workspaceCreatedBefore).toBe('2026-11-24T00:00:00Z');
    // The QA workspace itself would be refused the same way if it had been made after the cut-off.
    const early = await report({ workspaceCreatedBefore: '2000-01-01T00:00:00Z' });
    expect(early.state).toBe('targets not resolved');
    expect(early.checklist).toEqual([]);
    expect(early.lines[0]).toContain('was made after the owner decision');
  });

  test('only the schema owner may read it, a kept name is never a target, and a report from elsewhere is left alone', async () => {
    await expect(reportQaDataRetire(f.runtime, plan)).rejects.toThrow();
    await expect(report({ workspace: 'Synthetic QA kept workspace' })).rejects.toThrow(
      'A kept name cannot be a retirement target',
    );
    await expect(report({ workspace: 'QA Test Co (madeup)' })).rejects.toThrow(
      'A kept name cannot be a retirement target',
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
    ).toEqual({ requests: 3, registrations: 1, invitations: 2, members: 1 });
  });

  test('two workspaces with the same name are refused', async () => {
    await h.provision('zed', plan.workspace);
    const result = await report();
    expect(result.state).toBe('targets not resolved');
    expect(result.targets[0]).toEqual({
      kind: 'workspace',
      label: 'workspace "Synthetic QA-Organiser Workspace"',
      status: 'more than one',
      matches: 2,
    });
    expect(result.lines[0]).toBe(
      'target workspace "Synthetic QA-Organiser Workspace": more than one (2 match)',
    );
    // Neither is taken for the QA workspace: nothing inside either is looked up and no checklist is given.
    expect(result.targets.slice(1).map((target) => target.status)).toEqual([
      'not checked',
      'not checked',
      'not checked',
    ]);
    expect(result.steps).toEqual([]);
    expect(result.checklist).toEqual([]);
  });
});
