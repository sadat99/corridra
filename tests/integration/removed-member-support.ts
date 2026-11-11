import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture } from './support';
import { REMOVED_FILES } from './removed-member-hide';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerAssignedMissionService } from '../../packages/auth/src/customer-assigned-missions';
import { configureRequestWithdrawal } from '../../packages/auth/src/customer-request-withdrawal-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { MissionService } from '../../packages/missions/src/index';
import { MissionMoveService } from '../../packages/missions/src/moves';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';
import { InboxService } from '../../packages/communications/src/inbox';

// Shared set-up for the removed member suites (owner decision, 11 Nov 2026: "No, remove access (Recommended)"; ADR-033
// amendment). Real PostgreSQL, the real restricted logins, invented synthetic customers. Nothing here is a real account.
//
// REMOVED_BASE_CHECK=1 hides the seven new files from every migrator (see removed-member-hide.ts) and makes fileSql() throw
// as it would on the commit before this change, so every suite is shown to fail on main.
export const baseCheck = process.env.REMOVED_BASE_CHECK === '1';
export const issuer =
  'https://ep-removed-member.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
export const options = { enabled: true, synthetic: true, production: false, issuer };
export const OWNER_WORDS = 'No, remove access (Recommended)';
export const hideNewFiles = () => {
  (globalThis as { __removedHide?: boolean }).__removedHide = true;
};
export const openNewFiles = () => {
  (globalThis as { __removedHide?: boolean }).__removedHide = false;
};
export const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Row = Record<string, unknown>;
export type Outcome =
  { ok: true; row: Row } | { ok: false; code: string | undefined; message: string };

// The seven files, with the module registry each one is recorded in and the file that comes before it in that module.
export const NEW_FILES = {
  customer: {
    directory: 'customer-migrations',
    registry: 'customer_migrations',
    name: REMOVED_FILES['customer-migrations']!,
    previous: '0003_private_customer_requests.sql',
  },
  realUse: {
    directory: 'customer-real-use-migrations',
    registry: 'customer_real_use_migrations',
    name: REMOVED_FILES['customer-real-use-migrations']!,
    previous: '0013_organisation_link_provenance_and_search.sql',
  },
  readiness: {
    directory: 'commercial-readiness-migrations',
    registry: 'commercial_readiness_migrations',
    name: REMOVED_FILES['commercial-readiness-migrations']!,
    previous: '0002_request_received.sql',
  },
  move: {
    directory: 'customer-move-migrations',
    registry: 'customer_move_migrations',
    name: REMOVED_FILES['customer-move-migrations']!,
    previous: '0001_move_records.sql',
  },
  withdrawal: {
    directory: 'customer-request-withdrawal-migrations',
    registry: 'customer_request_withdrawal_migrations',
    name: REMOVED_FILES['customer-request-withdrawal-migrations']!,
    previous: '0002_staff_withdrawal_signal.sql',
  },
  mail: {
    directory: 'customer-mission-mail-migrations',
    registry: 'customer_mission_mail_migrations',
    name: REMOVED_FILES['customer-mission-mail-migrations']!,
    previous: '0003_withdrawn_requests.sql',
  },
  notifications: {
    directory: 'customer-notification-migrations',
    registry: 'customer_notification_migrations',
    name: REMOVED_FILES['customer-notification-migrations']!,
    previous: '0005_withdrawn_requests.sql',
  },
} as const;
export type FileKey = keyof typeof NEW_FILES;
export const FILE_KEYS = Object.keys(NEW_FILES) as FileKey[];

// The text of a new file. On the base commit the file does not exist, so under REMOVED_BASE_CHECK this fails like main.
export function fileSql(key: FileKey) {
  const file = NEW_FILES[key];
  if (baseCheck) throw new Error(`${file.name} does not exist on the base commit`);
  return readFileSync(
    new URL(`../../packages/db/${file.directory}/${file.name}`, import.meta.url),
    'utf8',
  );
}
export const fileHash = (key: FileKey) => sha(fileSql(key));
export const stripComments = (sql: string) => sql.replace(/^\s*--.*$/gm, '');
const between = (sql: string, name: string) => {
  const open = `-- ${name}-begin`;
  const a = sql.indexOf(open);
  const b = sql.indexOf(`-- ${name}-end`);
  if (a < 0 || b < a) throw new Error('Missing marker ' + name);
  return sql.slice(a + open.length, b);
};
// What the file claims the fingerprints of the functions it replaces are.
export function fileFingerprints(key: FileKey) {
  return [
    ...between(fileSql(key), 'fingerprint').matchAll(/\('([^']+)','([0-9a-f]{64})','([^']*)'\)/g),
  ].map((m) => ({ signature: m[1]!, fingerprint: m[2]!, grantees: m[3]! }));
}
// The live values, read with the query the file carries for the owner (between the fingerprint-query markers).
export async function liveFingerprints(owner: Fixture['owner'], key: FileKey) {
  const query = between(fileSql(key), 'fingerprint-query');
  return (
    await owner.query<{ signature: string; fp: string | null; grantees: string | null }>(query)
  ).rows.map((r) => ({ signature: r.signature, fingerprint: r.fp, grantees: r.grantees }));
}
export const fileSignatures = (key: FileKey) => fileFingerprints(key).map((r) => r.signature);

// One function: its stored text and every setting, owner and grantees, for before and after comparisons.
export async function functionState(owner: Fixture['owner'], signature: string) {
  const r = await owner.query(
    `SELECT p.prosrc,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proretset,p.proparallel,p.proleakproof,
      p.proargtypes::regtype[]::text AS argtypes,p.prorettype::regtype::text AS ret,l.lanname,p.proargnames,p.pronargdefaults,
      pg_get_expr(p.proargdefaults,0) AS defaults,p.proowner::regrole::text AS owner,p.proacl::text AS acl
     FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1)`,
    [signature],
  );
  return r.rows[0] as Row | undefined;
}
export const bodyHash = async (owner: Fixture['owner'], signature: string) => {
  const state = await functionState(owner, signature);
  return state ? sha(String(state.prosrc)) : null;
};
// pg_get_functiondef is used here, in a test, to prove a function was NOT touched. The files themselves never use it.
export const definitionHash = async (owner: Fixture['owner'], signature: string) =>
  sha(
    (await owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature])).rows[0]
      .d as string,
  );

// md5 over every row of the named tables, to show history is untouched.
export async function digest(owner: Fixture['owner'], tables: string[]) {
  const result: Record<string, string> = {};
  for (const table of tables)
    result[table] = (
      await owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS d, count(*)::int AS n FROM ${table} t`,
      )
    ).rows.map((row) => `${row.n}:${row.d}`)[0]!;
  return result;
}
export const HISTORY_TABLES = [
  'customer_private.owned_request',
  'customer_private.workspace_member',
  'customer_private.workspace_access_revocation',
  'customer_private.request_revocation',
  'customer_private.request_withdrawal_event',
  'customer.membership',
  'app.domain_event',
  'app.audit_event',
  'app.outbox',
];

// A customer session as the application opens one: a short proof, then one transaction on the restricted runtime login.
export class Probe extends CustomerSessionBoundary {
  run<T>(work: (db: DatabaseClient) => Promise<T>) {
    return this.transaction(async (db) => work(db));
  }
}

export const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels ' + randomUUID(),
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
});
export const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();

export type World = Awaited<ReturnType<typeof buildWorld>>;

// The world: one shared workspace W owned by olive with members lena (will leave), rex (will be removed by the owner),
// sam (never touched) and rita (removed, then invited again), each with their own requests and, for the four members and
// the owner, a saved report that arrived by an assignment of staff. Lena and rex also hold bearer-saved reports. Hana is a
// member of a second workspace that olive hands over to her. Every module that has a file in this change is installed.
export async function buildWorld(
  config: {
    database?: string;
    modules?: boolean;
    requestsPerPerson?: number;
  } = {},
) {
  const f = await fixture(config.database ?? 'corridra_integration');
  const people = ['olive', 'lena', 'rex', 'sam', 'rita', 'hana', 'bea', 'stranger'] as const;
  const session = (person: string) => ({
    subject: `synthetic-removed-${person}`,
    emailVerified: true,
    expiresAt: new Date(Date.now() + 3600000),
    signedInAt: new Date(),
  });
  const secret = 'removed-member-local-secret';
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await migrateCustomerRealUse(f.owner);
  await migrateCommercialReadiness(f.owner);
  if (config.modules !== false) {
    await migrateCustomerRequestWithdrawal(f.owner);
    await migrateCustomerMoves(f.owner);
    await migrateCustomerMissionMail(f.owner);
    await migrateCustomerNotifications(f.owner);
    await migrateCustomerWorkspaceLifecycle(f.owner);
    await configureRequestWithdrawal(f.owner, {
      enabled: true,
      reason: 'Owner approved request withdrawal for the removed member fixture',
    });
    await configureMoveRecords(f.owner, {
      enabled: true,
      reason: 'Owner approved Move records for the removed member fixture',
    });
    await f.owner.query(
      `INSERT INTO customer_private.workspace_lifecycle_control(version,enabled,executor_id,reason)
       VALUES((SELECT coalesce(max(version),0)+1 FROM customer_private.workspace_lifecycle_control),true,$1,'Fixture control for the removed member tests')`,
      [f.serviceId],
    );
  }
  const missions = new MissionService(f.runtime, secret);
  const delivery = new DeliveryService(f.runtime, missions, secret);
  const moves = new MissionMoveService(f.runtime);
  const staff = new CustomerDeliveryService(f.runtime, async (db, id) => {
    await new InboxService(f.runtime).recordReportPublished(db, id);
    return async () => undefined;
  });
  const staffCtx = f.users.owner.ctx;
  const operatorCtx = f.users.operator.ctx;

  const principals: Record<string, string> = {};
  for (const person of people) {
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Explicit fictional removed member test principal, never real provider data',
      })
    ).id;
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person]!,
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  }

  const as = <T>(person: string, work: (db: DatabaseClient) => Promise<T>) =>
    new Probe(f.runtime, f.auth, options, async () => session(person)).run(work);
  const row = (person: string, sql: string, args: unknown[] = []) =>
    as(person, async (db) => (await db.query(sql, args)).rows[0] as Row);
  const attempt = async (person: string, sql: string, args: unknown[] = []): Promise<Outcome> => {
    try {
      return { ok: true, row: await row(person, sql, args) };
    } catch (error) {
      const e = error as { code?: string; message: string };
      return { ok: false, code: e.code, message: e.message };
    }
  };
  const workspaces = (person: string) =>
    new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
  const roles = (person: string) =>
    new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(person));
  const requestService = (person: string) =>
    new CustomerRequestService(f.runtime, f.auth, options, async () => session(person));
  const saved = (person: string) =>
    new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(person));
  const assigned = (person: string) =>
    new CustomerAssignedMissionService(f.runtime, f.auth, options, async () => session(person));
  const prepare = (context: Parameters<MissionService['prepareCustomerIntake']>[0], b: unknown) =>
    missions.prepareCustomerIntake(context, b);

  const provision = async (person: string, name: string) =>
    (await workspaces(person).provision({ commandId: randomUUID(), name })).id as string;
  // An invitation and its acceptance. Every call makes a NEW member row, which is how a person is let back in.
  const join = async (owner: string, person: string, target: string) => {
    const invitation = await workspaces(owner).access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId: target,
      label: `Synthetic invited ${person}`,
    });
    return (
      await workspaces(person).access({
        action: 'accept',
        commandId: randomUUID(),
        token: invitation.token!,
      })
    ).memberId as string;
  };
  const leave = (person: string, target: string) =>
    roles(person).command({ action: 'leave', commandId: randomUUID(), workspaceId: target });
  const revoke = (owner: string, target: string, memberId: string) =>
    workspaces(owner).access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId: target,
      kind: 'membership',
      targetId: memberId,
    });
  const submitInput = (target: string) => ({
    commandId: randomUUID(),
    workspaceId: target,
    brief: brief(),
  });
  const submit = async (person: string, target: string) =>
    (await requestService(person).submit(submitInput(target), prepare)).id as string;
  const missionOf = async (requestId: string) =>
    (
      await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
        requestId,
      ])
    ).rows[0].mission_id as string;

  // Staff: an approved report on the mission of a request, a private link to it, and optionally the assignment to the author.
  async function publish(requestId: string) {
    const missionId = await missionOf(requestId);
    const publication = await delivery.publication(staffCtx, {
      commandId: randomUUID(),
      missionId,
      title: 'Approved fictional commercial mission',
      company: 'Fictional Customer',
      objective: 'Review permitted supplier and buyer progress',
      brief: 'Approved report without original private contact details',
      nextAction: 'Review qualified evidence with the operator',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    });
    const link = await delivery.share(staffCtx, {
      commandId: randomUUID(),
      programmeId: null,
      publicationIds: [publication.id],
      audience: 'CLIENT_PROGRESS',
      purpose: 'Explicit private fictional customer report',
      expiresAt: future(),
      allowExport: false,
      approved: true,
    });
    return {
      missionId,
      publicationId: publication.id as string,
      link: { id: link.id as string, token: link.token as string },
    };
  }
  const assign = async (requestId: string, linkId: string) =>
    (
      await staff.assign(staffCtx, {
        commandId: randomUUID(),
        requestId,
        linkId,
        reason: 'Explicit synthetic account report delivery review',
        approved: true,
      })
    ).id as string;
  const accept = async (person: string, assignmentId: string) =>
    (await assigned(person).accept({ commandId: randomUUID(), assignmentId, acknowledged: true }))
      .id as string;
  const saveByLink = async (person: string, token: string) =>
    (
      await saved(person).command({
        action: 'save',
        commandId: randomUUID(),
        token,
        acknowledged: true,
      })
    ).id as string;
  const setMove = async (missionId: string, object: string) =>
    moves.command(operatorCtx, {
      action: 'set',
      commandId: randomUUID(),
      missionId,
      expectedVersion: await moves.version(operatorCtx, missionId),
      moves: [{ holder: 'customer', dueOn: null, verb: 'Read', object }],
    });

  // All request ids a person can list, page by page (the loop is also the check that no page ends in a phantom next page).
  async function listRequests(person: string, pageSize = 25) {
    const ids: string[] = [];
    const pages: { count: number; nextAfter: string | null }[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 400; guard++) {
      const page: Row = (
        await row(person, 'SELECT customer.private_requests($1,$2) AS r', [after, pageSize])
      ).r as Row;
      const requests = page.requests as { id: string }[];
      ids.push(...requests.map((r) => r.id));
      pages.push({ count: requests.length, nextAfter: (page.nextAfter as string | null) ?? null });
      after = (page.nextAfter as string | null) ?? null;
      if (!after) break;
    }
    return { ids, pages };
  }
  const savedIds = async (person: string) =>
    ((await saved(person).list()).missions as { id: string }[]).map((m) => m.id);
  const assignedIds = async (person: string) =>
    ((await assigned(person).list()).assignments as { id: string }[]).map((a) => a.id);

  // ---- the world itself
  const W = await provision('olive', 'Synthetic removed member workspace');
  const members: Record<string, string> = {};
  for (const person of ['lena', 'rex', 'sam', 'rita'] as const)
    members[person] = await join('olive', person, W);
  const personal: Record<string, string> = {};
  for (const person of ['lena', 'rex', 'sam', 'olive'] as const)
    personal[person] = await provision(person, `Synthetic own workspace of ${person}`);
  const perPerson = config.requestsPerPerson ?? 2;
  const requests: Record<string, string[]> = {};
  for (const person of ['olive', 'lena', 'rex', 'sam', 'rita'] as const) {
    requests[person] = [];
    for (let i = 0; i < perPerson; i++) requests[person]!.push(await submit(person, W));
  }
  const ownWorkspaceRequest: Record<string, string> = {};
  for (const person of ['lena', 'rex'] as const)
    ownWorkspaceRequest[person] = await submit(person, personal[person]!);
  const reports: Record<
    string,
    {
      requestId: string;
      publicationId: string;
      link: { id: string; token: string };
      assignmentId: string;
      savedId: string;
    }
  > = {};
  for (const person of ['olive', 'lena', 'rex', 'sam', 'rita'] as const) {
    const requestId = requests[person]![0]!;
    const made = await publish(requestId);
    const assignmentId = await assign(requestId, made.link.id);
    reports[person] = {
      requestId,
      ...made,
      assignmentId,
      savedId: await accept(person, assignmentId),
    };
  }
  // A private link on another member's request that staff did NOT assign to anyone: only a bearer can save it.
  const unassigned = await publish(requests.sam![1]!);
  const bearer: Record<string, { assignedToSam: string; unassigned: string }> = {};
  for (const person of ['lena', 'rex'] as const)
    bearer[person] = {
      // A link delivered for sam's request, saved by lena or rex: the request is not theirs, so the report stays theirs.
      assignedToSam: await saveByLink(person, reports.sam!.link.token),
      // A link with no assignment at all.
      unassigned: await saveByLink(person, unassigned.link.token),
    };
  for (const person of ['lena', 'rex', 'sam'] as const)
    await setMove(await missionOf(requests[person]![0]!), `a move for ${person}`);
  // Second workspace, handed over: olive owns it, hana is a member, olive then gives it to hana.
  const W2 = await provision('olive', 'Synthetic handed over workspace');
  const hanaMember = await join('olive', 'hana', W2);
  const w2Requests = { olive: await submit('olive', W2), hana: await submit('hana', W2) };
  if (config.modules !== false) {
    const made = (
      await row('olive', 'SELECT customer.workspace_ownership_command($1,$2,$3) AS r', [
        randomUUID(),
        'offer',
        JSON.stringify({
          workspaceId: W2,
          memberId: hanaMember,
          confirmName: 'Synthetic handed over workspace',
          expectedVersion: 0,
        }),
      ])
    ).r as { offerId: string };
    await row('hana', 'SELECT customer.workspace_ownership_command($1,$2,$3) AS r', [
      randomUUID(),
      'accept',
      JSON.stringify({ offerId: made.offerId }),
    ]);
  }

  return {
    f,
    people,
    session,
    principals,
    as,
    row,
    attempt,
    workspaces,
    roles,
    requestService,
    saved,
    assigned,
    prepare,
    provision,
    join,
    leave,
    revoke,
    submit,
    submitInput,
    missionOf,
    publish,
    assign,
    accept,
    saveByLink,
    setMove,
    listRequests,
    savedIds,
    assignedIds,
    missions,
    delivery,
    staff,
    moves,
    staffCtx,
    operatorCtx,
    W,
    W2,
    members,
    hanaMember,
    personal,
    requests,
    ownWorkspaceRequest,
    reports,
    unassigned,
    bearer,
    w2Requests,
  };
}

// The same refusal an unknown id gets, byte for byte: the code and the exact text.
export function sameBytes(a: Outcome, b: Outcome) {
  if (a.ok || b.ok) return false;
  return a.code === b.code && Buffer.compare(Buffer.from(a.message), Buffer.from(b.message)) === 0;
}

// The state production is in before this change, built by hand: the files of a module are applied as text and recorded, the
// way the installer-order suites do it.
export async function applyFiles(
  owner: Fixture['owner'],
  directory: string,
  schema: string,
  files: string[],
) {
  await owner.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await owner.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC,corridra_runtime,corridra_auth`);
  await owner.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  for (const name of files) {
    const sql = readFileSync(
      new URL(`../../packages/db/${directory}/${name}`, import.meta.url),
      'utf8',
    );
    await owner.query(sql);
    await owner.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [name, sha(sql)]);
  }
}
export const appliedNames = async (owner: Fixture['owner'], schema: string) =>
  (await owner.query(`SELECT name FROM ${schema}.applied ORDER BY name`)).rows.map(
    (r) => r.name as string,
  );
