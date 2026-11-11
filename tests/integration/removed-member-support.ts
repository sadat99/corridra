import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture } from './support';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { migrateCustomerSpecificationConfirmation } from '../../packages/db/src/customer-specification-confirmation-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
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
// REMOVED_BASE_CHECK=1 hides the ten new files from every migrator (see removed-member-hide.ts) and makes fileSql() throw
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
// The erasure file (account lifecycle 0005) has its own switch: it is hidden alone while the ten files stay in place, which is the
// state of main. ERASURE_BASE_CHECK=1 hides it for the whole run, and the erasure suite is then shown to fail on main.
export const erasureBaseCheck = baseCheck || process.env.ERASURE_BASE_CHECK === '1';
export const hideErasureFile = () => {
  (globalThis as { __erasureHide?: boolean }).__erasureHide = true;
};
export const openErasureFile = () => {
  (globalThis as { __erasureHide?: boolean }).__erasureHide = false;
};
export const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Row = Record<string, unknown>;
export type Outcome =
  { ok: true; row: Row } | { ok: false; code: string | undefined; message: string };

// The ten files, with the module registry each one is recorded in and the file that comes before it in that module.
export const NEW_FILES = {
  customer: {
    directory: 'customer-migrations',
    registry: 'customer_migrations',
    name: '0004_workspace_member_current.sql',
    previous: '0003_private_customer_requests.sql',
  },
  realUse: {
    directory: 'customer-real-use-migrations',
    registry: 'customer_real_use_migrations',
    name: '0014_removed_member_access.sql',
    previous: '0013_organisation_link_provenance_and_search.sql',
  },
  readiness: {
    directory: 'commercial-readiness-migrations',
    registry: 'commercial_readiness_migrations',
    name: '0011_removed_member_request_received.sql',
    previous: '0010_team_invitation_cancel_audit.sql',
  },
  inbox: {
    directory: 'commercial-readiness-migrations',
    registry: 'commercial_readiness_migrations',
    name: '0012_removed_member_inbox.sql',
    previous: '0011_removed_member_request_received.sql',
  },
  move: {
    directory: 'customer-move-migrations',
    registry: 'customer_move_migrations',
    name: '0002_removed_member_moves.sql',
    previous: '0001_move_records.sql',
  },
  withdrawal: {
    directory: 'customer-request-withdrawal-migrations',
    registry: 'customer_request_withdrawal_migrations',
    name: '0003_removed_member_withdrawals.sql',
    previous: '0002_staff_withdrawal_signal.sql',
  },
  mail: {
    directory: 'customer-mission-mail-migrations',
    registry: 'customer_mission_mail_migrations',
    name: '0004_removed_member_mail.sql',
    previous: '0003_withdrawn_requests.sql',
  },
  notifications: {
    directory: 'customer-notification-migrations',
    registry: 'customer_notification_migrations',
    name: '0006_removed_member_notifications.sql',
    previous: '0005_withdrawn_requests.sql',
  },
  projection: {
    directory: 'customer-programme-projection-migrations',
    registry: 'customer_programme_projection_migrations',
    name: '0003_removed_member_projection.sql',
    previous: '0002_projection_source_and_retention.sql',
  },
  decisionCards: {
    directory: 'customer-decision-card-migrations',
    registry: 'customer_decision_card_migrations',
    name: '0002_removed_member_decision_cards.sql',
    previous: '0001_decision_cards.sql',
  },
} as const;
export type FileKey = keyof typeof NEW_FILES;
export const FILE_KEYS = Object.keys(NEW_FILES) as FileKey[];
// The files that replace functions. The inbox file alters a row level security policy instead, and is tested on its own.
export const FUNCTION_KEYS = FILE_KEYS.filter((key) => key !== 'inbox');
// One entry per module registry, with the key of the file that arrives there (the readiness registry gets two).
export const REGISTRY_KEYS = FUNCTION_KEYS;

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

// The eleventh file: the erasure file of the account lifecycle module. It is not one of the ten (FILE_KEYS), because it replaces
// functions of a module the ten suites do not all install. Under ERASURE_BASE_CHECK it throws, as it would on main.
export const ERASURE_FILE = {
  directory: 'customer-account-lifecycle-migrations',
  registry: 'customer_account_lifecycle_migrations',
  name: '0005_removed_member_erasure.sql',
  previous: '0004_erasure_scope_by_workspaces.sql',
} as const;
export function erasureSql() {
  if (erasureBaseCheck) throw new Error(`${ERASURE_FILE.name} does not exist on the base commit`);
  return readFileSync(
    new URL(`../../packages/db/${ERASURE_FILE.directory}/${ERASURE_FILE.name}`, import.meta.url),
    'utf8',
  );
}
export const stripComments = (sql: string) => sql.replace(/^\s*--.*$/gm, '');
const between = (sql: string, name: string) => {
  const open = new RegExp(`^\\s*-- ${name}-begin\\s*$`, 'm').exec(sql);
  const close = new RegExp(`^\\s*-- ${name}-end\\s*$`, 'm').exec(sql);
  if (!open || !close || close.index < open.index) throw new Error('Missing marker ' + name);
  return sql.slice(open.index + open[0].length, close.index);
};
// What a file claims the fingerprints of the functions it replaces are, and the live values read with the query the file
// carries for the owner (between the fingerprint-query markers).
const fingerprintsIn = (sql: string) =>
  [...between(sql, 'fingerprint').matchAll(/\('([^']+)','([0-9a-f]{64})','([^']*)'\)/g)].map(
    (m) => ({ signature: m[1]!, fingerprint: m[2]!, grantees: m[3]! }),
  );
const liveFingerprintsIn = async (owner: Fixture['owner'], sql: string) =>
  (
    await owner.query<{ signature: string; fp: string | null; grantees: string | null }>(
      between(sql, 'fingerprint-query'),
    )
  ).rows.map((r) => ({ signature: r.signature, fingerprint: r.fp, grantees: r.grantees }));
export const fileFingerprints = (key: FileKey) => fingerprintsIn(fileSql(key));
export const liveFingerprints = (owner: Fixture['owner'], key: FileKey) =>
  liveFingerprintsIn(owner, fileSql(key));
export const fileSignatures = (key: FileKey) => fileFingerprints(key).map((r) => r.signature);
export const erasureFingerprints = () => fingerprintsIn(erasureSql());
export const liveErasureFingerprints = (owner: Fixture['owner']) =>
  liveFingerprintsIn(owner, erasureSql());

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
    extraPeople?: string[];
  } = {},
) {
  const f = await fixture(config.database ?? 'corridra_integration');
  const people: string[] = [
    'olive',
    'lena',
    'rex',
    'sam',
    'rita',
    'hana',
    'bea',
    'stranger',
    ...(config.extraPeople ?? []),
  ];
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
    // The base installers that bring more of the saved report surface: specification confirmation, books and decision cards.
    // Without them their functions do not exist and a refusal test would pass for the wrong reason.
    await migrateCustomerSpecificationConfirmation(f.owner);
    await migrateCustomerBooks(f.owner);
    await migrateCustomerDecisionCards(f.owner);
    await migrateCustomerProgrammeProjections(f.owner);
    await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
    await configureCustomerRealUse(f.owner, {
      enabled: true,
      reason: 'Owner approved real work for the removed member fixture',
    });
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
  // Sam always has a second request: the unassigned link and the programme objective are made on it.
  const perPerson = Math.max(2, config.requestsPerPerson ?? 2);
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

// Owned requests written straight into the table as the owner with triggers and foreign keys off, as weight and as the requests
// of a person: each gets a mission row in the named staff workspace. Nothing here is a real person or a real request.
export async function bulkOwnedRequests(
  w: World,
  config: { person: string; workspace: string; count: number; missionTenant?: string },
) {
  const db = await w.f.owner.connect();
  try {
    await db.query('SET session_replication_role = replica');
    await db.query(
      'CREATE TEMP TABLE bulk AS SELECT n,gen_random_uuid() AS mid FROM generate_series(1,$1::int) n',
      [config.count],
    );
    await db.query(
      `INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by)
       SELECT mid,$1,$2,'Synthetic bulk row',now()+interval '1 day','Synthetic bulk row',$2 FROM bulk`,
      [config.missionTenant ?? w.f.tenantA, w.f.users.owner.id],
    );
    await db.query(
      `INSERT INTO customer_private.owned_request(principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
       SELECT $1,gen_random_uuid(),$2,$3,mid,gen_random_uuid(),encode(sha256(mid::text::bytea),'hex'),encode(sha256(('r'||mid::text)::bytea),'hex') FROM bulk`,
      [w.principals[config.person], config.workspace, config.missionTenant ?? w.f.tenantA],
    );
    await db.query('DROP TABLE bulk');
  } finally {
    await db.query('RESET session_replication_role').catch(() => undefined);
    db.release();
  }
}

// A control row for the account lifecycle module, appended as the owner, as a fixture does.
export async function setAccountLifecycleControl(w: World, enabled: boolean, label: string) {
  const latest = (
    await w.f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await w.f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, w.f.serviceId, `Fixture control for the ${label} tests`],
  );
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
