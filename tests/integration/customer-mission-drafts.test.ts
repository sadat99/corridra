import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../../packages/db/src/customer-mission-draft-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import {
  CustomerMissionDraftService,
  missionDraftSaveInput,
  type MissionDraftDetails,
} from '../../packages/auth/src/customer-mission-drafts';
import {
  composeBrief,
  composeOffer,
  draftCommandId,
  draftProblems,
  draftReadiness,
  missionDraftObjectives,
  requirementPrompts,
  sourcingContextLabels,
} from '../../packages/domain/src/mission-drafts';
import { briefSchema } from '../../packages/domain/src/missions';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-draft-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'eve', 'outsider'];
let f: Awaited<ReturnType<typeof fixture>>,
  missions: MissionService,
  workspaceId: string,
  otherWorkspace: string;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const principals: Record<string, string> = {};
const memberIds: Record<string, string> = {};
const subject = (p: string) => 'synthetic-draft-' + p;
const session = (p: string): CustomerSession => ({
  subject: subject(p),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspaces = (p = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(p));
const drafts = (p = 'alice') =>
  new CustomerMissionDraftService(f.runtime, f.auth, options, async () => session(p));
const requests = (p = 'alice') =>
  new CustomerRequestService(f.runtime, f.auth, options, async () => session(p));
const profiles = (p = 'alice') =>
  new CustomerOrganisationProfileService(f.runtime, f.auth, options, async () => session(p));

const details = (over: Partial<MissionDraftDetails> = {}): MissionDraftDetails => ({
  title: 'Synthetic towel buyers in Spain',
  family: 'BUYERS_PARTNERS',
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels made in Bangladesh',
  website: 'https://towels.example',
  outcomes: ['Relevant meetings'],
  notes: '',
  requirements: [{ label: 'Event or fair', value: 'Synthetic Home Textiles fair in Madrid' }],
  contactName: 'Test Person',
  contactEmail: 'mission@example.invalid',
  profileVersion: null,
  sourcingContext: null,
  companyName: 'Synthetic Dhaka Towels Limited',
  ...over,
});
const save = (
  over: Partial<MissionDraftDetails> = {},
  draftId: string | null = null,
  expectedVersion = 0,
  target = workspaceId,
) => ({
  commandId: randomUUID(),
  workspaceId: target,
  draftId,
  expectedVersion,
  details: details(over),
  acknowledged: true as const,
});
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.mission_draft) drafts,
 (SELECT count(*)::int FROM customer_private.mission_draft_revision) revisions,
 (SELECT count(*)::int FROM customer_private.mission_draft_command) commands,
 (SELECT count(*)::int FROM customer_private.mission_draft_close) closes,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_mission_draft') events,
 (SELECT count(*)::int FROM app.audit_event WHERE action LIKE 'customer.mission_draft.%') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_mission_draft') outbox,
 (SELECT count(*)::int FROM app.mission) missions,
 (SELECT count(*)::int FROM customer_private.owned_request) requests,
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
    profileHistory: (
      await f.owner.query('SELECT * FROM customer_organisation_profile_migrations.applied')
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
const submitRequest = async (p = 'alice', target = workspaceId) => {
  const briefInput = composeBrief({
    ...details(),
    objective: 'Sell in a new market',
  })!;
  const result = await requests(p).submit(
    {
      commandId: randomUUID(),
      workspaceId: target,
      brief: { ...briefInput, offer: briefInput.offer + ' ' + randomUUID() },
    },
    (context, brief) => missions.prepareCustomerIntake(context, brief),
  );
  return result.id as string;
};

beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'synthetic-only-draft-secret');
  await migrateCustomerAuthority(f.owner);
  for (const p of people)
    principals[p] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: subject(p),
        executorId: f.serviceId,
        reason: 'Explicit invented mission draft test identity; no real account or email',
      })
    ).id;
  // Everyone except dave (no request admission) and outsider (no workspace) may author requests.
  for (const p of ['alice', 'bob', 'carol', 'eve', 'outsider'])
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[p],
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic draft workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('carol').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate draft workspace',
    })
  ).id;
  for (const p of ['bob', 'dave', 'eve']) {
    const invitation = await workspaces().access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic draft teammate ' + p,
    });
    memberIds[p] = (
      await workspaces(p).access({
        action: 'accept',
        commandId: randomUUID(),
        token: invitation.token,
      })
    ).memberId!;
  }
  await migrateCustomerOrganisationProfiles(f.owner);
  await profiles().command({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 0,
    legalName: 'Synthetic Dhaka Towels Limited',
    countryCode: 'BD',
    website: 'https://towels.example',
    commercialRoles: ['SELLER'],
    sectors: ['Textiles'],
    sizeBand: '51-200',
    summary: 'Synthetic towel exporter for hotels',
    reason: 'Initial synthetic profile',
    acknowledged: true,
  });
  oldSnapshot = await snapshot();
  await migrateCustomerMissionDrafts(f.owner);
  await migrateCustomerMissionDrafts(f.owner);
});
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
  ).toEqual([
    'mission_draft',
    'mission_draft_close',
    'mission_draft_command',
    'mission_draft_revision',
  ]);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  expect(after.customerHistory).toEqual(oldSnapshot.customerHistory);
  expect(after.profileHistory).toEqual(oldSnapshot.profileHistory);
  expect(
    (await f.owner.query('SELECT name FROM customer_mission_draft_migrations.applied')).rows,
  ).toEqual([{ name: '0001_private_mission_drafts.sql' }]);
});

let aliceDraft: string;
test('a partly written draft saves, pins the saved profile and records one content-free event chain', async () => {
  const before = await counts();
  const partial = save({
    title: 'Synthetic early towel idea',
    objective: null,
    market: '',
    offer: '',
    outcomes: [],
    requirements: [],
    contactName: '',
    contactEmail: '',
    companyName: '',
    website: '',
    attendance: 'Not decided',
    startDate: '',
    endDate: '',
    profileVersion: 1,
  });
  const saved = await drafts().save(partial);
  aliceDraft = saved.draft.id;
  expect(saved).toMatchObject({
    workspaceId,
    replayed: false,
    draft: { version: 1, status: 'OPEN', requestId: null },
  });
  expect(saved.draft.details).toEqual(partial.details);
  expect(Date.parse(saved.expiresAt) - Date.now()).toBeLessThanOrEqual(61000);
  const after = await counts();
  expect(after).toEqual({
    ...before,
    drafts: before.drafts + 1,
    revisions: before.revisions + 1,
    commands: before.commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  expect(after.missions).toBe(before.missions);
  expect(after.organisations).toBe(before.organisations);
  expect(after.proofs).toBe(0);
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE aggregate_type='customer_mission_draft'",
    )
  ).rows;
  expect(Object.keys(events[0].payload).sort()).toEqual([
    'draftId',
    'initiator_id',
    'initiator_kind',
    'revisionId',
    'synthetic',
    'version',
  ]);
  expect(JSON.stringify(events)).not.toContain('towel');
});

test('a draft continues as a new version, a stale tab is refused and an exact retry returns the original', async () => {
  const next = save(
    { market: 'Spain', offer: 'Synthetic cotton towels for hotels' },
    aliceDraft,
    1,
  );
  const v2 = await drafts().save(next);
  expect(v2.draft.version).toBe(2);
  const before = await counts();
  const stale = await rejected(drafts().save(save({ market: 'Italy' }, aliceDraft, 1)));
  expect(stale.code).toBe('23514');
  expect(stale.message).toContain('reload');
  expect(await counts()).toEqual(before);
  const again = await drafts().save(next);
  expect(again).toMatchObject({ replayed: true, draft: { version: 2 } });
  expect(await counts()).toEqual(before);
  const v3 = await drafts().save(save({ market: 'Spain and Portugal' }, aliceDraft, 2));
  expect(v3.draft.version).toBe(3);
  const late = await drafts().save(next);
  expect(late).toMatchObject({
    replayed: true,
    superseded: true,
    currentVersion: 3,
    draft: { version: 2 },
  });
  const clash = await rejected(
    drafts().save({ ...save({ market: 'France' }, aliceDraft, 3), commandId: next.commandId }),
  );
  expect(clash.code).toBe('23514');
  expect(clash.message).toContain('conflicts');
});

test('each person sees only their own drafts, including the workspace owner', async () => {
  const bobDraft = (await drafts('bob').save(save({ title: 'Synthetic bob sourcing idea' }))).draft
    .id;
  const aliceList = await drafts().list({ workspaceId });
  const bobList = await drafts('bob').list({ workspaceId });
  expect(aliceList.drafts.map((d: { id: string }) => d.id)).toEqual([aliceDraft]);
  expect(bobList.drafts.map((d: { id: string }) => d.id)).toEqual([bobDraft]);
  expect(aliceList.drafts[0]).toMatchObject({ title: expect.any(String), status: 'OPEN' });
  expect(aliceList.drafts[0]).not.toHaveProperty('details');
  // Owner cannot read, save to or close a member's draft; a member cannot touch the owner's.
  expect((await rejected(drafts().view({ workspaceId, draftId: bobDraft }))).code).toBe('42501');
  expect((await rejected(drafts().save(save({}, bobDraft, 1)))).code).toBe('42501');
  expect(
    (
      await rejected(
        drafts().close({
          commandId: randomUUID(),
          workspaceId,
          draftId: bobDraft,
          outcome: 'DISCARDED',
          requestId: null,
        }),
      )
    ).code,
  ).toBe('42501');
  expect((await rejected(drafts('bob').view({ workspaceId, draftId: aliceDraft }))).code).toBe(
    '42501',
  );
  expect((await rejected(drafts('bob').save(save({}, aliceDraft, 3)))).code).toBe('42501');
});

test('request admission, workspace membership and workspace identity are all required', async () => {
  const before = await counts();
  for (const p of ['dave', 'outsider', 'carol']) {
    expect((await rejected(drafts(p).save(save()))).code).toBe('42501');
    expect((await rejected(drafts(p).list({ workspaceId }))).code).toBe('42501');
  }
  expect((await rejected(drafts().save(save({}, null, 0, randomUUID())))).code).toBe('42501');
  expect((await rejected(drafts().view({ workspaceId, draftId: randomUUID() }))).code).toBe(
    '42501',
  );
  // carol belongs to another workspace and may draft only there.
  const carols = await drafts('carol').save(
    save({ title: 'Synthetic carol only idea' }, null, 0, otherWorkspace),
  );
  expect(carols.workspaceId).toBe(otherWorkspace);
  expect((await rejected(drafts('carol').save(save({}, carols.draft.id, 1)))).code).toBe('42501');
  expect(await counts()).toEqual({
    ...before,
    drafts: before.drafts + 1,
    revisions: before.revisions + 1,
    commands: before.commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
});

test('V3 sourcing contexts: machinery detail belongs to supplier requests only, and objectives must fit the family', async () => {
  const machinery = await drafts().save(
    save({
      title: 'Synthetic packaging machine sourcing',
      family: 'SUPPLIERS_PRODUCTS',
      objective: 'Source suppliers',
      sourcingContext: 'MACHINERY',
      requirements: [{ label: 'Capacity', value: 'Synthetic 4000 units per hour' }],
    }),
  );
  expect(machinery.draft.details.sourcingContext).toBe('MACHINERY');
  for (const bad of [
    { family: 'BUYERS_PARTNERS' as const, sourcingContext: 'MACHINERY' as const },
    {
      family: 'DELEGATION' as const,
      objective: 'Run a multi-company mission' as const,
      sourcingContext: 'OEM_CUSTOM' as const,
    },
    {
      family: 'OTHER' as const,
      objective: 'Something else' as const,
      sourcingContext: 'FINISHED_PRODUCTS' as const,
    },
  ]) {
    expect(missionDraftSaveInput.safeParse(save(bad)).success).toBe(false);
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.mission_draft_save($1,$2,$3,$4,$5)', [
            randomUUID(),
            workspaceId,
            null,
            0,
            JSON.stringify(details(bad)),
          ]),
        )
      ).code,
    ).toBe('23514');
  }
  for (const bad of [
    { family: 'BUYERS_PARTNERS' as const, objective: 'Source suppliers' as const },
    { family: 'SUPPLIERS_PRODUCTS' as const, objective: 'Sell in a new market' as const },
    { family: 'DELEGATION' as const, objective: 'Find customers or distributors' as const },
  ]) {
    expect(missionDraftSaveInput.safeParse(save(bad)).success).toBe(false);
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.mission_draft_save($1,$2,$3,$4,$5)', [
            randomUUID(),
            workspaceId,
            null,
            0,
            JSON.stringify(details(bad)),
          ]),
        )
      ).code,
    ).toBe('23514');
  }
  // Every objective listed for a family is accepted by both layers.
  for (const [family, objectives] of Object.entries(missionDraftObjectives))
    for (const objective of objectives)
      expect(
        missionDraftSaveInput.safeParse(
          save({ family: family as MissionDraftDetails['family'], objective }),
        ).success,
      ).toBe(true);
});

test('SQL independently rejects non-synthetic, real-looking and malformed drafts and unknown profile versions', async () => {
  const valid = async (value: unknown) =>
    (
      await f.owner.query('SELECT customer_private.mission_draft_valid($1::jsonb,$2) AS ok', [
        JSON.stringify(value),
        workspaceId,
      ])
    ).rows[0].ok;
  expect(await valid(details())).toBe(true);
  expect(await valid(details({ profileVersion: 1 }))).toBe(true);
  const twenty = Array.from({ length: 20 }, (_, i) => ({
    label: 'Line ' + i,
    value: 'Synthetic value number ' + i,
  }));
  expect(await valid(details({ requirements: twenty }))).toBe(true);
  for (const bad of [
    details({ title: 'Towel buyers in Spain' }),
    details({ offer: 'Hotel towels made in Bangladesh' }),
    details({ notes: 'Please call me soon' }),
    details({ companyName: 'Dhaka Towels Limited' }),
    details({ website: 'https://towels.com' }),
    details({ contactEmail: 'person@gmail.com' }),
    details({ profileVersion: 99 }),
    details({ startDate: '2026-02-31', endDate: '' }),
    details({ startDate: '2026-11-07', endDate: '2026-11-01' }),
    details({ timezone: 'Not/AZone' }),
    details({ outcomes: ['Relevant meetings', 'Relevant meetings'] }),
    details({
      requirements: [...twenty, { label: 'Line 21', value: 'Synthetic value number 21' }],
    }),
    details({
      requirements: [
        { label: 'Same', value: 'Synthetic first value' },
        { label: 'same', value: 'Synthetic second value' },
      ],
    }),
    details({ requirements: [{ label: 'Quantity', value: '500 units' }] }),
    { ...details(), extra: 'x' },
    { title: 'Synthetic only a title here' },
  ])
    expect(await valid(bad), JSON.stringify(bad).slice(0, 90)).toBe(false);
  expect(missionDraftSaveInput.safeParse(save({ contactEmail: 'person@gmail.com' })).success).toBe(
    false,
  );
  expect(missionDraftSaveInput.safeParse({ ...save(), acknowledged: false }).success).toBe(false);
  expect(missionDraftSaveInput.safeParse({ ...save(), extra: 1 }).success).toBe(false);
});

test('original wording and non-Latin script are stored exactly', async () => {
  const text = 'Synthetic ঢাকা তোয়ালে 毛巾 handtücher';
  const saved = await drafts().save(
    save({ title: 'Synthetic multi script towel note', offer: text }),
  );
  expect(saved.draft.details.offer).toBe(text);
  const read = await drafts().view({ workspaceId, draftId: saved.draft.id });
  expect(read.draft.details.offer).toBe(text);
});

test('closing as discarded freezes the draft and an exact retry returns the same result', async () => {
  const d = (await drafts().save(save({ title: 'Synthetic idea to discard' }))).draft.id;
  const closeInput = {
    commandId: randomUUID(),
    workspaceId,
    draftId: d,
    outcome: 'DISCARDED' as const,
    requestId: null,
  };
  const closed = await drafts().close(closeInput);
  expect(closed.draft.status).toBe('DISCARDED');
  const before = await counts();
  expect((await drafts().close(closeInput)).replayed).toBe(true);
  expect(await counts()).toEqual(before);
  expect((await rejected(drafts().save(save({}, d, 1)))).message).toContain('closed');
  expect((await rejected(drafts().close({ ...closeInput, commandId: randomUUID() }))).code).toBe(
    '23514',
  );
  expect((await drafts().list({ workspaceId })).drafts.find((x) => x.id === d)?.status).toBe(
    'DISCARDED',
  );
});

test("a draft becomes a submitted request only against the creator's own current request", async () => {
  const mine = await submitRequest('alice');
  const bobs = await submitRequest('bob');
  const carols = await submitRequest('carol', otherWorkspace);
  const make = async (p = 'alice', target = workspaceId) =>
    (await drafts(p).save(save({ title: 'Synthetic draft for ' + p }, null, 0, target))).draft.id;
  const close = (p: string, d: string, requestId: string | null, target = workspaceId) =>
    drafts(p).close({
      commandId: randomUUID(),
      workspaceId: target,
      draftId: d,
      outcome: requestId ? 'SUBMITTED' : 'DISCARDED',
      requestId,
    });
  const d1 = await make();
  for (const foreign of [bobs, carols, randomUUID()])
    expect((await rejected(close('alice', d1, foreign))).code).toBe('42501');
  expect((await drafts().view({ workspaceId, draftId: d1 })).draft.status).toBe('OPEN');
  const ok = await close('alice', d1, mine);
  expect(ok.draft).toMatchObject({ status: 'SUBMITTED', requestId: mine });
  // One request can close only one draft.
  const d2 = await make();
  expect((await rejected(close('alice', d2, mine))).code).toBe('42501');
  // The database itself refuses a second draft claiming the same request, even past the function checks.
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.mission_draft_close(draft_id,outcome,request_id,actor_id,command_id) VALUES($1,'SUBMITTED',$2,$3,$4)",
      [d2, mine, principals.alice, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  // A revoked request is no longer a valid link.
  const revoked = await submitRequest('alice');
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: revoked,
    reason: 'Explicit invented revocation for draft test',
  });
  expect((await rejected(close('alice', d2, revoked))).code).toBe('42501');
  expect(
    (
      await rejected(
        raw('alice', 'SELECT customer.mission_draft_close($1,$2,$3,$4,$5)', [
          randomUUID(),
          workspaceId,
          d2,
          'SUBMITTED',
          null,
        ]),
      )
    ).code,
  ).toBe('23514');
  expect(
    (
      await rejected(
        raw('alice', 'SELECT customer.mission_draft_close($1,$2,$3,$4,$5)', [
          randomUUID(),
          workspaceId,
          d2,
          'DISCARDED',
          mine,
        ]),
      )
    ).code,
  ).toBe('23514');
});

test('runtime and auth roles cannot read or write draft tables or call private helpers directly', async () => {
  for (const pool of [f.runtime, f.auth])
    for (const sql of [
      'SELECT * FROM customer_private.mission_draft',
      'SELECT * FROM customer_private.mission_draft_revision',
      'SELECT * FROM customer_private.mission_draft_command',
      'SELECT * FROM customer_private.mission_draft_close',
      "UPDATE customer_private.mission_draft_revision SET details='{}'",
      'DELETE FROM customer_private.mission_draft',
      'INSERT INTO customer_private.mission_draft(tenant_id,principal_id) VALUES(gen_random_uuid(),gen_random_uuid())',
    ])
      expect((await rejected(pool.query(sql))).code).toBe('42501');
  for (const sql of [
    "SELECT customer_private.mission_draft_valid('{}',gen_random_uuid())",
    'SELECT customer_private.mission_draft_actor(gen_random_uuid())',
    'SELECT customer_private.mission_draft_expiry()',
    'SELECT customer_private.mission_draft_result(gen_random_uuid(),gen_random_uuid(),NULL)',
    'SELECT customer_private.mission_draft_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$$x$$,gen_random_uuid(),1,$${}$$)',
  ])
    expect((await rejected(raw('alice', sql))).code).toBe('42501');
  expect(
    (await rejected(f.auth.query('SELECT customer.mission_draft_list($1)', [workspaceId]))).code,
  ).toBe('42501');
  expect(
    (await rejected(f.runtime.query('SELECT customer.mission_draft_list($1)', [workspaceId]))).code,
  ).toBe('42501');
});

test('even the schema owner cannot rewrite or delete draft history', async () => {
  for (const sql of [
    "UPDATE customer_private.mission_draft_revision SET details='{}'",
    'DELETE FROM customer_private.mission_draft_revision',
    'DELETE FROM customer_private.mission_draft',
    'DELETE FROM customer_private.mission_draft_command',
    'DELETE FROM customer_private.mission_draft_close',
  ])
    expect(await rejected(f.owner.query(sql))).toBeTruthy();
});

test('concurrent saves on one version have exactly one winner and contiguous versions', async () => {
  const d = (await drafts().save(save({ title: 'Synthetic race draft here' }))).draft.id;
  const before = await counts();
  const results = await Promise.allSettled([
    drafts().save(save({ market: 'Winner one' }, d, 1)),
    drafts().save(save({ market: 'Winner two' }, d, 1)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    (
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as {
        code: string;
      }
    ).code,
  ).toBe('23514');
  expect((await counts()).revisions).toBe(before.revisions + 1);
  const versions = (
    await f.owner.query(
      'SELECT version FROM customer_private.mission_draft_revision WHERE draft_id=$1 ORDER BY version',
      [d],
    )
  ).rows.map((r) => r.version);
  expect(versions).toEqual([1, 2]);
});

test('a revoked member and a disabled account lose draft access immediately', async () => {
  const mine = (await drafts('eve').save(save({ title: 'Synthetic eve working draft' }))).draft.id;
  expect((await drafts('eve').view({ workspaceId, draftId: mine })).draft.status).toBe('OPEN');
  await workspaces().access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: memberIds.eve,
  });
  expect((await rejected(drafts('eve').view({ workspaceId, draftId: mine }))).code).toBe('42501');
  expect((await rejected(drafts('eve').save(save({}, mine, 1)))).code).toBe('42501');
  // Another member is unaffected by that revocation.
  expect((await drafts('bob').list({ workspaceId })).drafts.length).toBeGreaterThan(0);
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    [subject('bob')],
  );
  expect((await rejected(drafts('bob').list({ workspaceId }))).code).toBe('42501');
});

test('the account-context guard and session checks run before any database work', async () => {
  const before = await counts();
  expect((await rejected(drafts().list({ workspaceId }, 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        drafts().list(
          { workspaceId },
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const unverified = new CustomerMissionDraftService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    emailVerified: false,
  }));
  expect((await rejected(unverified.list({ workspaceId }))).message).toContain('Verify');
  const expired = new CustomerMissionDraftService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  expect((await rejected(expired.list({ workspaceId }))).message).toContain('Sign in');
  const off = new CustomerMissionDraftService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  expect((await rejected(off.list({ workspaceId }))).message).toContain('unavailable');
  expect(await counts()).toEqual(before);
});

test('V3 prompts match the contract: Product 2 sourcing contexts, Product 1, delegation and no machinery for others', () => {
  // V3-02-034..038 exactly as written in the contract tables.
  expect(requirementPrompts('SUPPLIERS_PRODUCTS', 'MACHINERY')).toEqual([
    'Technical requirements',
    'Commercial requirements',
    'Regulatory requirements',
    'Delivery requirements',
    'Application',
    'Capacity',
    'Power',
    'Installation',
    'Commissioning',
    'Acceptance tests',
    'Warranties',
    'Spares',
    'Maintenance',
    'After-sales support',
  ]);
  const only = (c: Parameters<typeof requirementPrompts>[1]) =>
    requirementPrompts('SUPPLIERS_PRODUCTS', c).slice(4);
  expect(only('FINISHED_PRODUCTS')).toEqual([
    'Specifications',
    'Quality',
    'Packaging',
    'Certifications where applicable',
    'MOQ',
    'Lead times',
    'Delivery',
  ]);
  expect(only('MATERIALS_COMPONENTS')).toEqual([
    'Grades',
    'Tolerances',
    'Consistency',
    'Testing',
    'Supply continuity',
    'Traceability',
  ]);
  expect(only('OEM_CUSTOM')).toEqual([
    'Drawings',
    'Tooling',
    'Samples',
    'IP and confidentiality',
    'Production capacity',
    'Quality acceptance',
  ]);
  expect(only('OTHER_PROCUREMENT')).toEqual([]);
  expect(only(null)).toEqual([]);
  expect(Object.keys(sourcingContextLabels)).toHaveLength(5);
  // A buyer or delegation request never offers machinery commissioning controls (V3-04-076).
  for (const family of ['BUYERS_PARTNERS', 'DELEGATION', 'OTHER'] as const)
    for (const word of ['Commissioning', 'Acceptance tests', 'Spares', 'Power'])
      expect(requirementPrompts(family, null)).not.toContain(word);
  expect(requirementPrompts('BUYERS_PARTNERS', null)).toEqual(
    expect.arrayContaining([
      'Event or fair',
      'Preferred meeting location',
      'Target buyer or distributor profile',
    ]),
  );
  expect(requirementPrompts('DELEGATION', null)).toEqual([
    'Destination, event or programme',
    'Objectives',
    'Sectors',
    'Eligibility',
    'Capacity',
    'Participation terms',
  ]);
});

test('a draft becomes the existing request unchanged: wording preserved, gaps named in plain language, no profile required', () => {
  const complete = details({ profileVersion: null });
  const ready = draftReadiness(complete);
  expect(ready).toEqual({ ready: true, gaps: [] });
  const brief = composeBrief(complete)!;
  expect(briefSchema.safeParse(brief).success).toBe(true);
  expect(brief.offer.startsWith(complete.offer)).toBe(true);
  expect(brief.offer).toContain('Event or fair: Synthetic Home Textiles fair in Madrid');
  expect(brief.company).toBe(complete.companyName);
  expect(composeOffer({ offer: 'Synthetic only an offer', requirements: [] })).toBe(
    'Synthetic only an offer',
  );
  const empty = draftReadiness(
    details({
      objective: null,
      market: '',
      offer: '',
      outcomes: [],
      contactName: '',
      contactEmail: '',
      companyName: '',
    }),
  );
  expect(empty.ready).toBe(false);
  expect(empty.gaps).toEqual(
    expect.arrayContaining([
      'what you want to do',
      'the target country or market',
      'at least one outcome you want',
      'your name',
      'your company name',
      'a test email address',
    ]),
  );
  expect(composeBrief(details({ offer: '' }))).toBeNull();
  // Visit dates are required only when attending in person.
  expect(
    draftReadiness(details({ attendance: 'Not decided', startDate: '', endDate: '' })).ready,
  ).toBe(true);
  expect(draftReadiness(details({ attendance: 'Yes', startDate: '', endDate: '' })).gaps).toEqual(
    expect.arrayContaining(['the visit start date', 'the visit end date']),
  );
  // Requirement lines that would overflow the 2000-character request are named, not silently cut.
  const long = details({
    requirements: Array.from({ length: 12 }, (_, i) => ({
      label: 'Line ' + i,
      value: 'Synthetic ' + 'x'.repeat(280),
    })),
  });
  expect(draftReadiness(long).ready).toBe(false);
});

test('derived command ids are stable per draft version, differ by purpose and version, and are valid UUIDs', async () => {
  const d = randomUUID();
  const a = await draftCommandId('send', d, 3);
  expect(a).toBe(await draftCommandId('send', d, 3));
  expect(a).not.toBe(await draftCommandId('send', d, 4));
  expect(a).not.toBe(await draftCommandId('close', d, 3));
  expect(a).not.toBe(await draftCommandId('send', randomUUID(), 3));
  expect(missionDraftSaveInput.shape.commandId.safeParse(a).success).toBe(true);
});

test('the browser validator agrees with the server schema on every save rule it mirrors', () => {
  const cases: Partial<MissionDraftDetails>[] = [
    {},
    { title: 'Towel buyers in Spain' },
    { title: 'Synthetic' },
    { offer: 'Hotel towels' },
    { offer: '' },
    { notes: 'call me please' },
    { companyName: 'Dhaka Towels Limited' },
    { website: 'https://towels.com' },
    { website: '' },
    { contactEmail: 'person@gmail.com' },
    { contactEmail: '' },
    { contactName: 'T' },
    { startDate: '2026-02-31', endDate: '' },
    { startDate: '2026-11-07', endDate: '2026-11-01' },
    { outcomes: ['Relevant meetings', 'Relevant meetings'] },
    { requirements: [{ label: 'Quantity', value: '500 units' }] },
    {
      requirements: [
        { label: 'Same', value: 'Synthetic first value' },
        { label: 'SAME', value: 'Synthetic second value' },
      ],
    },
    {
      requirements: Array.from({ length: 21 }, (_, i) => ({
        label: 'Line ' + i,
        value: 'Synthetic value ' + i,
      })),
    },
    { market: 'x'.repeat(121) },
  ];
  for (const over of cases) {
    const d = details(over);
    const server = missionDraftSaveInput.safeParse(save(over)).success;
    const browser = draftProblems(d).length === 0;
    expect(browser, JSON.stringify(over).slice(0, 100)).toBe(server);
  }
});
