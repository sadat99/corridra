import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { realStaffFixture, future } from './real-staff-fixture';
import { rawContext } from './support';
import { DeliveryService } from '../../packages/delivery/src/index';
import { realReportPublicLinkEnabled } from '../../packages/auth/src/real-report-access';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';
import {
  migrateViewerReplyMetadata,
  refreshViewerReplyMetadata,
} from '../../packages/db/src/viewer-reply-metadata-migrate';
import { migrateViewerExportAccess } from '../../packages/db/src/viewer-export-access-migrate';

// ADR-087 U2 and U3 on a real PostgreSQL database, in a sample tenant and in the real intake tenant. The tests run in order:
// every viewer case is first shown to read rows on the code before the modules (so each "after" case fails on the old
// policies), then the modules are installed and the same reads return nothing for a viewer and exactly what they returned
// before for every other role. The rows are seeded by the table owner with triggers and foreign keys switched off for that
// one transaction, so each policy is tested on its own; the link holder's token paths are exercised through the service.
const issuer = 'https://ep-adr087-viewer.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const secret = 'adr087-viewer-policy-secret';
const replyWords = 'Synthetic supplier reply words for ADR-087 U2';
const answerWords = 'Synthetic participant answer words for ADR-087 U2';
const revisionWords = 'Synthetic corrected answer words for ADR-087 U2';
type Role = 'owner' | 'admin' | 'operator' | 'reviewer' | 'viewer' | 'removed';
type Seeded = {
  tenant: string;
  purpose: string;
  team: string;
  ownPrivate: string;
  otherPrivate: string;
  replies: Record<'team' | 'ownPrivate' | 'otherPrivate', string>;
  request: string;
};
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let publicDelivery: DeliveryService;
const extra: Record<'admin' | 'removed', { id: string; token: string }> = {} as never;
let sample: Seeded;
let real: Seeded;
let link: { id: string; token: string };
let realRequest: string;

const ctxFor = (who: Role, place: Seeded) => {
  const token = who === 'admin' || who === 'removed' ? extra[who].token : s.f.users[who]!.ctx.token;
  return { token, tenantId: place.tenant, purpose: place.purpose };
};
const read = async (who: Role, place: Seeded, sql: string, args: unknown[] = []) =>
  (await rawContext(s.f.runtime, ctxFor(who, place), sql, [place.tenant, ...args])).rows;
const replyBodies = (who: Role, place: Seeded) =>
  read(who, place, 'SELECT link_id,body FROM app.recipient_detail_response WHERE tenant_id=$1');
const revisionBodies = (who: Role, place: Seeded) =>
  read(
    who,
    place,
    'SELECT link_id,body FROM app.recipient_detail_response_revision WHERE tenant_id=$1',
  );
const answerBodies = (who: Role, place: Seeded) =>
  read(who, place, 'SELECT body FROM app.delivery_response WHERE tenant_id=$1');
const exportRows = async (who: Role, place: Seeded) => [
  ...(await read(who, place, 'SELECT id,snapshot FROM app.delivery_export WHERE tenant_id=$1')),
  ...(await read(
    who,
    place,
    'SELECT id,content FROM app.delivery_export_artifact WHERE tenant_id=$1',
  )),
];
const links = (rows: { link_id: string }[]) => rows.map((r) => r.link_id).sort();

// A staff member who is not in the base fixture: an admin, and an operator whose membership was revoked.
async function addStaff(label: 'admin' | 'removed', tenants: [string, string[]][]) {
  const id = randomUUID(),
    identityId = randomUUID(),
    token = randomBytes(32).toString('hex'),
    sessionId = randomUUID();
  const db = await s.f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [s.f.serviceId, randomUUID(), randomUUID()],
    );
    await db.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
      [identityId, `Synthetic ${label}`, `${label}-adr087@example.invalid`],
    );
    await db.query(
      "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
      [id, identityId],
    );
    await db.query(
      'INSERT INTO identity.session(id,"userId",token,"expiresAt") VALUES($1,$2,$3,now()+interval \'1 hour\')',
      [sessionId, identityId, token],
    );
    await db.query("INSERT INTO identity.assurance VALUES($1,now(),'totp')", [sessionId]);
    for (const [tenant, purposes] of tenants)
      await db.query(
        "INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications) VALUES($1,$2,$3,$4,ARRAY['PUBLIC','INTERNAL'])",
        [tenant, id, label === 'admin' ? 'admin' : 'operator', purposes],
      );
    if (label === 'removed')
      await db.query('UPDATE app.membership SET revoked_at=now() WHERE user_id=$1', [id]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  extra[label] = { id, token };
}

// Three replies on three relationships (one shared with the team and owned by the workspace owner, one private to the
// operator, one private to the workspace owner), one evidence answer, and one export with its file, all in one tenant.
async function seed(tenant: string, purpose: string): Promise<Seeded> {
  const owner = s.f.users.owner.id,
    operator = s.f.users.operator.id;
  const db = await s.f.owner.connect();
  const replies = {} as Seeded['replies'];
  const place = { tenant, purpose } as Seeded;
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL session_replication_role=replica');
    for (const [key, holder, visibility] of [
      ['team', owner, 'TEAM'],
      ['ownPrivate', operator, 'OWNER'],
      ['otherPrivate', owner, 'OWNER'],
    ] as const) {
      const relationship = randomUUID(),
        target = randomUUID(),
        message = randomUUID(),
        linkId = randomUUID();
      await db.query(
        "INSERT INTO app.relationship(id,tenant_id,organisation_id,owner_id,note,classification,purpose,version,visibility) VALUES($1,$2,$3,$4,'Synthetic ADR-087 relationship','INTERNAL',$5,1,$6)",
        [relationship, tenant, randomUUID(), holder, purpose, visibility],
      );
      await db.query(
        "INSERT INTO app.target_account(id,tenant_id,mission_id,relationship_id,classification,purpose,created_by) VALUES($1,$2,$3,$4,'INTERNAL',$5,$6)",
        [target, tenant, randomUUID(), relationship, purpose, owner],
      );
      await db.query(
        "INSERT INTO app.communication(id,tenant_id,target_id,contact_id,policy_id,template_id,presentation,expires_at,classification,purpose,created_by) VALUES($1,$2,$3,$4,$5,$6,'{}',now()+interval '1 day','INTERNAL',$7,$8)",
        [message, tenant, target, randomUUID(), randomUUID(), randomUUID(), purpose, owner],
      );
      await db.query(
        "INSERT INTO app.buyer_link(id,tenant_id,message_id,token_hash,classification,purpose,created_by) VALUES($1,$2,$3,$4,'INTERNAL',$5,$6)",
        [linkId, tenant, message, randomBytes(32).toString('hex'), purpose, owner],
      );
      await db.query(
        "INSERT INTO app.recipient_detail_response(id,tenant_id,link_id,body,source_kind,retention_until,created_by) VALUES($1,$2,$3,$4,'SELF_DECLARATION',now()+interval '7 days',$5)",
        [randomUUID(), tenant, linkId, JSON.stringify({ body: `${replyWords} (${key})` }), owner],
      );
      replies[key] = linkId;
      place[key] = relationship;
    }
    place.request = randomUUID();
    await db.query(
      "INSERT INTO app.delivery_request(id,tenant_id,publication_id,title,instructions,owner_id,due_at,created_by) VALUES($1,$2,$3,'Synthetic evidence request','Describe the synthetic requirement.',$4,now()+interval '1 day',$4)",
      [place.request, tenant, randomUUID(), owner],
    );
    await db.query(
      "INSERT INTO app.delivery_response(id,tenant_id,request_id,link_id,body,source_kind,claim_status) VALUES($1,$2,$3,$4,$5,'self_declaration','self_declared')",
      [randomUUID(), tenant, place.request, randomUUID(), answerWords],
    );
    const exportId = randomUUID(),
      content = Buffer.from('synthetic,export\n');
    await db.query(
      "INSERT INTO app.delivery_export(id,tenant_id,link_id,format,reporting_purpose,snapshot) VALUES($1,$2,$3,'CSV','Synthetic ADR-087 export check','{}')",
      [exportId, tenant, randomUUID()],
    );
    await db.query(
      'INSERT INTO app.delivery_export_artifact(id,tenant_id,content,content_hash) VALUES($1,$2,$3,$4)',
      [exportId, tenant, content, createHash('sha256').update(content).digest('hex')],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  return { ...place, replies };
}

async function seedRevisions(place: Seeded) {
  const db = await s.f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL session_replication_role=replica');
    for (const linkId of Object.values(place.replies))
      await db.query(
        "INSERT INTO app.recipient_detail_response_revision(id,tenant_id,response_id,link_id,version,body,source_kind,retention_until,created_by) SELECT $1,tenant_id,id,link_id,1,$2,'SELF_DECLARATION',now()+interval '7 days',created_by FROM app.recipient_detail_response WHERE tenant_id=$3 AND link_id=$4",
        [randomUUID(), JSON.stringify({ body: revisionWords }), place.tenant, linkId],
      );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

// Every function body and every policy expression in the database, by name, to prove an install changed only what it names.
async function definitions() {
  const functions = await s.f.owner.query<{ name: string; hash: string }>(
    `SELECT p.oid::regprocedure::text AS name,md5(pg_get_functiondef(p.oid)) AS hash FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname NOT IN ('pg_catalog','information_schema')
     AND n.nspname NOT LIKE 'pg_%'`,
  );
  const policies = await s.f.owner.query<{ name: string; hash: string }>(
    `SELECT c.oid::regclass::text||':'||p.polname AS name,
      md5(concat_ws('|',p.polcmd,p.polpermissive,p.polroles::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))) AS hash
     FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid`,
  );
  return {
    functions: Object.fromEntries(functions.rows.map((r) => [r.name, r.hash])),
    policies: Object.fromEntries(policies.rows.map((r) => [r.name, r.hash])),
  };
}
const without = (record: Record<string, string>, names: string[]) =>
  Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)));

beforeAll(async () => {
  s = await realStaffFixture(issuer, secret);
  publicDelivery = new DeliveryService(s.f.runtime, s.missions, secret, () =>
    realReportPublicLinkEnabled(),
  );
  // The base fixture's sample tenant has owner, operator, reviewer and viewer; the real intake tenant has only the owner.
  for (const who of ['operator', 'reviewer', 'viewer'] as const)
    await s.f.owner.query(
      "INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications) VALUES($1,$2,$3,ARRAY['commercial_qualification'],ARRAY['PUBLIC','INTERNAL']) ON CONFLICT DO NOTHING",
      [s.intakeTenantId, s.f.users[who]!.id, who],
    );
  await addStaff('admin', [
    [s.f.tenantA, ['synthetic_validation']],
    [s.intakeTenantId, ['commercial_qualification']],
  ]);
  await addStaff('removed', [
    [s.f.tenantA, ['synthetic_validation']],
    [s.intakeTenantId, ['commercial_qualification']],
  ]);
  sample = await seed(s.f.tenantA, 'synthetic_validation');
  real = await seed(s.intakeTenantId, 'commercial_qualification');

  // The link holder's own paths in the real tenant, through the service: an answer through the link and an export file.
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
  const missionId = await s.mission();
  const publication = await s.delivery.publication(s.ctx, {
    commandId: randomUUID(),
    missionId,
    title: 'Approved sourcing report',
    company: 'Machinery participant',
    objective: 'Source suppliers',
    brief: 'Approved requirement without private contacts.',
    nextAction: 'Review the approved supplier',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  link = await s.delivery.share(s.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Private report for the participating company',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  realRequest = (
    await s.delivery.request(s.ctx, {
      commandId: randomUUID(),
      publicationId: publication.id,
      ownerId: s.f.users.owner.id,
      title: 'Supporting evidence request',
      instructions: 'Send a short written confirmation of the delivery schedule',
      dueAt: future(),
    })
  ).id;
  await publicDelivery.external({
    action: 'respond',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: realRequest,
    body: 'The delivery schedule is confirmed for the second week of November',
    acknowledged: true,
  });
}, 240000);
beforeEach(async () => {
  await s.f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await s?.f.close();
});

const places = () =>
  [
    ['sample', sample],
    ['real', real],
  ] as const;
// The link holder reads through the token functions (security definer, so no read policy applies to them). The report is read
// through the service; the export functions are proved unchanged by the definition snapshot and checked to be definer below.
const linkHolderReads = async () => {
  const report = (await publicDelivery.external({
    action: 'view',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
  })) as Record<string, unknown>;
  // The time the report was drawn is the only field that may differ between two reads.
  return { report: JSON.stringify({ ...report, generatedAt: null }) };
};

// Shared by the "before" and "after" runs: everything that must read the same on both versions.
async function regression() {
  for (const [, place] of places()) {
    // An operator reads the team's replies and their own private ones, never another member's private reply.
    expect(links(await replyBodies('operator', place))).toEqual(
      [place.replies.team, place.replies.ownPrivate].sort(),
    );
    // Owner, admin and reviewer read every reply.
    for (const who of ['owner', 'admin', 'reviewer'] as const)
      expect(links(await replyBodies(who, place))).toEqual(Object.values(place.replies).sort());
    for (const who of ['owner', 'admin', 'operator', 'reviewer'] as const) {
      expect((await answerBodies(who, place)).map((r) => r.body)).toContain(answerWords);
      expect(await exportRows(who, place)).toHaveLength(2);
    }
    // A member whose membership was revoked reads nothing.
    expect(await replyBodies('removed', place)).toEqual([]);
    expect(await answerBodies('removed', place)).toEqual([]);
    expect(await exportRows('removed', place)).toEqual([]);
  }
}

describe('before the modules (the code today)', () => {
  test('a viewer reads reply and answer bodies and export rows, in a sample and a real tenant', async () => {
    for (const [, place] of places()) {
      // The team's reply only: the private relationships are hidden from a viewer by the relationship rule.
      expect(links(await replyBodies('viewer', place))).toEqual([place.replies.team]);
      expect((await replyBodies('viewer', place))[0].body.body).toContain(replyWords);
      expect((await answerBodies('viewer', place)).map((r) => r.body)).toContain(answerWords);
      expect(await exportRows('viewer', place)).toHaveLength(2);
    }
  });
  test('every other role reads what the ADR keeps', regression);
  test('the meta functions do not exist yet', async () => {
    const r = await s.f.owner.query(
      "SELECT to_regprocedure('app.reply_meta(uuid,uuid)') a,to_regprocedure('app.delivery_response_meta(uuid,uuid)') b",
    );
    expect(r.rows[0]).toEqual({ a: null, b: null });
  });
});

describe('the hash guard', () => {
  test('U2 refuses a changed policy and changes nothing', async () => {
    const before = await definitions();
    await s.f.owner.query(
      "ALTER POLICY read ON app.delivery_response USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND true)",
    );
    try {
      await expect(migrateViewerReplyMetadata(s.f.owner)).rejects.toThrow(
        /prerequisite policy differs: delivery_response\.read/,
      );
    } finally {
      await s.f.owner.query(
        "ALTER POLICY read ON app.delivery_response USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation'))",
      );
    }
    expect(await definitions()).toEqual(before);
    // The whole install was one transaction: not even the registry was left behind.
    expect(await refreshViewerReplyMetadata(s.f.owner)).toBeNull();
  });
  test('U3 refuses a changed policy and changes nothing', async () => {
    const before = await definitions();
    await s.f.owner.query(
      'ALTER POLICY real_use_read ON app.delivery_export_artifact USING (app.real_use_allowed(tenant_id))',
    );
    try {
      await expect(migrateViewerExportAccess(s.f.owner)).rejects.toThrow(
        /prerequisite policy differs: delivery_export_artifact\.real_use_read/,
      );
    } finally {
      await s.f.owner.query(
        "ALTER POLICY real_use_read ON app.delivery_export_artifact USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))))",
      );
    }
    expect(await definitions()).toEqual(before);
  });
});

describe('U2 installed (viewer reply metadata)', () => {
  let linkHolder: Awaited<ReturnType<typeof linkHolderReads>>;
  test('install changes only the four named policies and adds the two meta reads; answer correction waits', async () => {
    linkHolder = await linkHolderReads();
    const before = await definitions();
    expect(await refreshViewerReplyMetadata(s.f.owner)).toBeNull();
    expect(await migrateViewerReplyMetadata(s.f.owner)).toEqual({
      applied: ['0001_viewer_reply_metadata.sql'],
      waiting: ['0002_viewer_revision_metadata.sql'],
    });

    const after = await definitions();
    const named = [
      'app.recipient_detail_response:read',
      'app.recipient_detail_response:real_use_read',
      'app.delivery_response:read',
      'app.delivery_response:real_use_read',
    ];
    for (const name of named) expect(after.policies[name]).not.toBe(before.policies[name]);
    expect(without(after.policies, named)).toEqual(without(before.policies, named));
    expect(
      without(after.functions, [
        'app.reply_meta_list(uuid)',
        'app.reply_meta(uuid,uuid)',
        'app.reply_review_meta(uuid)',
        'app.delivery_response_meta(uuid,uuid)',
      ]),
    ).toEqual(before.functions);
    const text = await s.f.owner.query(
      "SELECT polname,pg_get_expr(polqual,polrelid) q FROM pg_policy WHERE polrelid='app.delivery_response'::regclass ORDER BY polname",
    );
    expect(text.rows).toEqual([
      {
        polname: 'read',
        q: "(app.can_access(tenant_id, 'INTERNAL'::text, 'synthetic_validation'::text) AND (app.member_role(tenant_id) <> 'viewer'::text))",
      },
      {
        polname: 'real_use_read',
        q: "(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(tenant_id)) AND (app.member_role(tenant_id) <> 'viewer'::text))",
      },
    ]);
  });
  test('a second run applies nothing and changes nothing', async () => {
    const before = await definitions();
    expect(await migrateViewerReplyMetadata(s.f.owner)).toEqual({
      applied: [],
      waiting: ['0002_viewer_revision_metadata.sql'],
    });
    expect(await definitions()).toEqual(before);
  });
  test('a viewer selecting a reply or answer body gets no row, in a sample and a real tenant', async () => {
    for (const [, place] of places()) {
      expect(await replyBodies('viewer', place)).toEqual([]);
      expect(await answerBodies('viewer', place)).toEqual([]);
    }
  });
  test('every other role reads exactly what it read before', regression);
  test('the link holder reads the same report, answer included, through token functions that no policy governs', async () => {
    expect(await linkHolderReads()).toEqual(linkHolder);
    expect(linkHolder.report).toContain('second week of November');
    const definer = await s.f.owner.query(
      `SELECT bool_and(prosecdef) d,count(*)::int n FROM pg_proc WHERE oid IN ('app.delivery_report(text,text)'::regprocedure,
        'app.delivery_respond(text,uuid,uuid,text)'::regprocedure)
        OR (pronamespace='app'::regnamespace AND proname IN ('delivery_export_prepare','delivery_export_finish'))`,
    );
    expect(definer.rows[0]).toEqual({ d: true, n: 4 });
  });
  test('the meta reads give a viewer the reply and the answer without the body, within the same scope', async () => {
    for (const [, place] of places()) {
      const reply = await read('viewer', place, 'SELECT * FROM app.reply_meta($1,$2)', [
        place.replies.team,
      ]);
      expect(reply).toHaveLength(1);
      expect(Object.keys(reply[0]).sort()).toEqual(
        [
          'created_at',
          'id',
          'latest_at',
          'latest_version',
          'link_id',
          'retention_until',
          'source_kind',
        ].sort(),
      );
      expect(reply[0]).toMatchObject({
        link_id: place.replies.team,
        source_kind: 'SELF_DECLARATION',
        latest_version: null,
      });
      expect(JSON.stringify(reply)).not.toContain(replyWords);
      const answer = await read(
        'viewer',
        place,
        'SELECT * FROM app.delivery_response_meta($1,$2)',
        [place.request],
      );
      expect(answer).toHaveLength(1);
      expect(answer[0]).toMatchObject({
        request_id: place.request,
        source_kind: 'self_declaration',
        claim_status: 'self_declared',
      });
      expect(JSON.stringify(answer)).not.toContain(answerWords);
      // Scope: no reply on a relationship the viewer cannot see; nothing for a revoked member.
      expect(
        await read('viewer', place, 'SELECT * FROM app.reply_meta($1,$2)', [
          place.replies.otherPrivate,
        ]),
      ).toEqual([]);
      expect(
        await read('operator', place, 'SELECT * FROM app.reply_meta($1,$2)', [
          place.replies.otherPrivate,
        ]),
      ).toEqual([]);
      for (const query of [
        ['SELECT * FROM app.reply_meta($1,$2)', place.replies.team],
        ['SELECT * FROM app.delivery_response_meta($1,$2)', place.request],
      ] as const)
        expect(await read('removed', place, query[0], [query[1]])).toEqual([]);
    }
    // The real tenant's answer through the link is visible to a viewer as metadata only.
    const linkAnswer = await read(
      'viewer',
      real,
      'SELECT * FROM app.delivery_response_meta($1,$2)',
      [realRequest],
    );
    expect(linkAnswer).toHaveLength(1);
    expect(JSON.stringify(linkAnswer)).not.toContain('second week of November');
  });
  test('the meta reads are definer functions with a fixed path that only the runtime role may call', async () => {
    const names = [
      'app.delivery_response_meta(uuid,uuid)',
      'app.reply_meta(uuid,uuid)',
      'app.reply_meta_list(uuid)',
      'app.reply_review_meta(uuid)',
    ];
    const r = await s.f.owner.query(
      `SELECT p.oid::regprocedure::text f,p.prosecdef,p.proconfig,has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,
        has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth FROM pg_proc p
       WHERE p.oid=ANY($1::regprocedure[]) ORDER BY 1`,
      [names],
    );
    expect(r.rows).toEqual(
      names.map((f) => ({
        f,
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        runtime: true,
        auth: false,
      })),
    );
  });
  test('a call naming another workspace returns nothing from any meta read', async () => {
    for (const [from, to] of [
      [sample, real],
      [real, sample],
    ] as const)
      for (const who of ['owner', 'viewer'] as const) {
        const ctx = ctxFor(who, from);
        for (const [sql, args] of [
          ['SELECT * FROM app.reply_meta_list($1)', [to.tenant]],
          ['SELECT * FROM app.reply_meta($1,$2)', [to.tenant, to.replies.team]],
          ['SELECT * FROM app.reply_review_meta($1)', [to.tenant]],
          ['SELECT * FROM app.delivery_response_meta($1,$2)', [to.tenant, to.request]],
        ] as const)
          expect((await rawContext(s.f.runtime, ctx, sql, [...args])).rows).toEqual([]);
      }
    // The same calls naming the reader's own workspace do return rows, so the empty answers above are the scope check.
    expect(
      (await read('viewer', sample, 'SELECT * FROM app.reply_meta_list($1)')).length,
    ).toBeGreaterThan(0);
  });
  test('the reply list gives exactly the rows each role read before U2, without bodies', async () => {
    for (const [, place] of places()) {
      expect(links(await read('viewer', place, 'SELECT * FROM app.reply_meta_list($1)'))).toEqual([
        place.replies.team,
      ]);
      expect(links(await read('operator', place, 'SELECT * FROM app.reply_meta_list($1)'))).toEqual(
        [place.replies.team, place.replies.ownPrivate].sort(),
      );
      for (const who of ['owner', 'admin', 'reviewer'] as const)
        expect(links(await read(who, place, 'SELECT * FROM app.reply_meta_list($1)'))).toEqual(
          Object.values(place.replies).sort(),
        );
      expect(await read('removed', place, 'SELECT * FROM app.reply_meta_list($1)')).toEqual([]);
      expect(await read('viewer', place, 'SELECT * FROM app.reply_review_meta($1)')).toEqual([]);
    }
  });
  test('the rollback text restores the original policies exactly and gives the viewer the rows back', async () => {
    const before = await definitions();
    const db = await s.f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        readFileSync(
          resolve(
            'packages/db/viewer-reply-metadata-migrations/rollback/0001_restore_original_reads.sql',
          ),
          'utf8',
        ),
      );
      const restored = await db.query(
        "SELECT polname,pg_get_expr(polqual,polrelid) q FROM pg_policy WHERE polrelid='app.delivery_response'::regclass ORDER BY polname",
      );
      expect(restored.rows.map((r) => r.q)).toEqual([
        "app.can_access(tenant_id, 'INTERNAL'::text, 'synthetic_validation'::text)",
        "(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(tenant_id)))",
      ]);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(await definitions()).toEqual(before);
  });
});

describe('U2 after answer correction is installed', () => {
  test('the revision policies keep the old rule until the module re-runs, then a viewer reads no corrected body', async () => {
    await migrateRecipientResponseRevision(s.f.owner);
    await seedRevisions(sample);
    await seedRevisions(real);
    // Old rule on the revision table: the viewer still reads the team's corrected answer (this is what 0002 fixes).
    for (const [, place] of places())
      expect(links(await revisionBodies('viewer', place))).toEqual([place.replies.team]);
    const before = await definitions();
    // The install workflow refreshes this module after installing answer correction; this is that call.
    expect(await refreshViewerReplyMetadata(s.f.owner)).toEqual({
      applied: ['0002_viewer_revision_metadata.sql'],
      waiting: [],
    });
    const after = await definitions();
    const named = [
      'app.recipient_detail_response_revision:read',
      'app.recipient_detail_response_revision:real_use_read',
    ];
    expect(without(after.policies, named)).toEqual(without(before.policies, named));
    expect(after.functions).toEqual(before.functions);
    for (const [, place] of places()) {
      expect(await revisionBodies('viewer', place)).toEqual([]);
      expect(links(await revisionBodies('operator', place))).toEqual(
        [place.replies.team, place.replies.ownPrivate].sort(),
      );
      for (const who of ['owner', 'admin', 'reviewer'] as const)
        expect(links(await revisionBodies(who, place))).toEqual(
          Object.values(place.replies).sort(),
        );
      expect(await revisionBodies('removed', place)).toEqual([]);
      // The meta read now carries the correction's version and date, still without words.
      const reply = await read('viewer', place, 'SELECT * FROM app.reply_meta($1,$2)', [
        place.replies.team,
      ]);
      expect(reply).toHaveLength(1);
      expect(reply[0].latest_version).toBe(1);
      expect(reply[0].latest_at).toBeTruthy();
      expect(JSON.stringify(reply)).not.toContain(revisionWords);
    }
    expect(await migrateViewerReplyMetadata(s.f.owner)).toEqual({ applied: [], waiting: [] });
  });
});

describe('U3 installed (viewer export access)', () => {
  test('install changes only the four named policies; a second run changes nothing', async () => {
    const linkHolder = await linkHolderReads();
    const before = await definitions();
    expect(await migrateViewerExportAccess(s.f.owner)).toEqual({
      applied: ['0001_viewer_export_access.sql'],
      waiting: [],
    });
    const after = await definitions();
    const named = [
      'app.delivery_export:read',
      'app.delivery_export:real_use_read',
      'app.delivery_export_artifact:read',
      'app.delivery_export_artifact:real_use_read',
    ];
    for (const name of named) expect(after.policies[name]).not.toBe(before.policies[name]);
    expect(without(after.policies, named)).toEqual(without(before.policies, named));
    expect(after.functions).toEqual(before.functions);
    expect(await migrateViewerExportAccess(s.f.owner)).toEqual({ applied: [], waiting: [] });
    expect(await definitions()).toEqual(after);
    expect(await linkHolderReads()).toEqual(linkHolder);
  });
  test('a viewer gets no export or file row, in a sample and a real tenant; every other role still does', async () => {
    for (const [, place] of places()) expect(await exportRows('viewer', place)).toEqual([]);
    await regression();
  });
  test('the rollback text restores the original export policies exactly', async () => {
    const db = await s.f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        readFileSync(
          resolve(
            'packages/db/viewer-export-access-migrations/rollback/0001_restore_original_export_reads.sql',
          ),
          'utf8',
        ),
      );
      const restored = await db.query(
        "SELECT polname,pg_get_expr(polqual,polrelid) q FROM pg_policy WHERE polrelid='app.delivery_export'::regclass ORDER BY polname",
      );
      expect(restored.rows.map((r) => r.q)).toEqual([
        "app.can_access(tenant_id, 'INTERNAL'::text, 'synthetic_validation'::text)",
        "(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(tenant_id)))",
      ]);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
});

describe('the module runner', () => {
  test('a file that waited is refused once a later file of the module is recorded', async () => {
    const { mkdtemp, writeFile: write } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { migrateViewerModule } = await import('../../packages/db/src/viewer-module-run');
    const dir = await mkdtemp(join(tmpdir(), 'adr087-order-'));
    await write(
      join(dir, '0001_waits.sql'),
      '-- requires-table: app.adr087_order_probe\nSELECT 1;\n',
    );
    await write(join(dir, '0002_later.sql'), 'SELECT 2;\n');
    const module = {
      directory: pathToFileURL(dir + '/'),
      schema: 'adr087_order_test_migrations',
      label: 'Order test',
    };
    expect(await migrateViewerModule(s.f.owner, module)).toEqual({
      applied: ['0002_later.sql'],
      waiting: ['0001_waits.sql'],
    });
    await s.f.owner.query('CREATE TABLE app.adr087_order_probe(id int)');
    try {
      await expect(migrateViewerModule(s.f.owner, module)).rejects.toThrow(
        /0001_waits\.sql waited for app\.adr087_order_probe, but the later file 0002_later\.sql is already recorded/,
      );
    } finally {
      await s.f.owner.query('DROP TABLE app.adr087_order_probe');
      await s.f.owner.query('DROP SCHEMA adr087_order_test_migrations CASCADE');
    }
  });
});
