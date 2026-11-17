import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { realStaffFixture } from './real-staff-fixture';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { ReplyReviewService } from '../../packages/delivery/src/reply-review';
import { getTeamToday } from '../../packages/auth/src/team-today';
import { migrateReplyReview } from '../../packages/db/src/recipient-reply-review-migrate';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';
import { migrateViewerReplyMetadata } from '../../packages/db/src/viewer-reply-metadata-migrate';

// ADR-087 U2, the application side, in a sample tenant and in the real intake tenant. Once U2 is installed a staff viewer's
// read policies return no reply, answer or review row, so the staff readers that show existence, state and dates (the
// delivery experience, the delivery workspace, the Today count and the reply review list) read them through the meta
// functions for a role without delivery.read_body. Every role must read after U2 exactly what it read before, and the viewer
// must see exactly the owner's rows for the replies the viewer may know of, minus the words (body, review note, reason and
// asked terms). Rows are seeded by the table owner with triggers and foreign keys off for that one transaction.
const replyWords = 'Synthetic supplier reply words for the U2 readers';
const revisionWords = 'Synthetic corrected reply words for the U2 readers';
const answerWords = 'Synthetic participant answer words for the U2 readers';
const noteWords = 'Synthetic reviewer note words';
type Role = 'owner' | 'operator' | 'reviewer' | 'viewer' | 'removed';
type Place = {
  tenant: string;
  purpose: string;
  links: Record<'team' | 'ownPrivate' | 'otherPrivate', string[]>;
  replies: Record<
    'open' | 'published' | 'askedThenCorrected' | 'ownPrivate' | 'otherPrivate',
    string
  >;
  answered: string;
  unanswered: string;
};
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let removed: { id: string; token: string };
let sample: Place;
let real: Place;
let experience: DeliveryExperienceService;
let delivery: DeliveryService;
let reviews: ReplyReviewService;

const ctxFor = (who: Role, place: Place) => ({
  token: who === 'removed' ? removed.token : s.f.users[who]!.ctx.token,
  tenantId: place.tenant,
  purpose: place.purpose,
});

async function addRemoved() {
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
      [identityId, 'Synthetic removed', 'removed-u2-readers@example.invalid'],
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
    for (const [tenant, purpose] of [
      [s.f.tenantA, 'synthetic_validation'],
      [s.intakeTenantId, 'commercial_qualification'],
    ])
      await db.query(
        "INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications,revoked_at) VALUES($1,$2,'operator',ARRAY[$3],ARRAY['PUBLIC','INTERNAL'],now())",
        [tenant, id, purpose],
      );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  removed = { id, token };
}

// Three relationships (one shared with the team and owned by the workspace owner, one private to the operator, one private to
// the owner), each with a link. On the team link: a reply nobody reviewed, a published reply (with a reviewer note), and a
// reply the team asked about that the supplier then corrected. One open reply on each private link. One answered and one
// unanswered evidence request. Times are set apart so every list has one order.
async function seed(tenant: string, purpose: string): Promise<Place> {
  const owner = s.f.users.owner.id,
    operator = s.f.users.operator.id;
  const db = await s.f.owner.connect();
  const links = {} as Place['links'];
  const replies = {} as Place['replies'];
  let minute = -120;
  const at = () => `now()+interval '${minute++} minutes'`;
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL session_replication_role=replica');
    const relationships = {} as Record<keyof Place['links'], string>;
    for (const [key, holder, visibility] of [
      ['team', owner, 'TEAM'],
      ['ownPrivate', operator, 'OWNER'],
      ['otherPrivate', owner, 'OWNER'],
    ] as const) {
      relationships[key] = randomUUID();
      links[key] = [];
      await db.query(
        "INSERT INTO app.relationship(id,tenant_id,organisation_id,owner_id,note,classification,purpose,version,visibility) VALUES($1,$2,$3,$4,'Synthetic U2 reader relationship','INTERNAL',$5,1,$6)",
        [relationships[key], tenant, randomUUID(), holder, purpose, visibility],
      );
    }
    // One private link (and one reply) per introduction, as the reply table allows one reply per link.
    const link = async (key: keyof Place['links']) => {
      const target = randomUUID(),
        message = randomUUID(),
        id = randomUUID();
      await db.query(
        "INSERT INTO app.target_account(id,tenant_id,mission_id,relationship_id,classification,purpose,created_by) VALUES($1,$2,$3,$4,'INTERNAL',$5,$6)",
        [target, tenant, randomUUID(), relationships[key], purpose, owner],
      );
      await db.query(
        "INSERT INTO app.communication(id,tenant_id,target_id,contact_id,policy_id,template_id,presentation,expires_at,classification,purpose,created_by) VALUES($1,$2,$3,$4,$5,$6,'{\"company\":\"Synthetic Buyer\"}',now()+interval '1 day','INTERNAL',$7,$8)",
        [message, tenant, target, randomUUID(), randomUUID(), randomUUID(), purpose, owner],
      );
      await db.query(
        "INSERT INTO app.buyer_link(id,tenant_id,message_id,token_hash,classification,purpose,created_by) VALUES($1,$2,$3,$4,'INTERNAL',$5,$6)",
        [id, tenant, message, randomBytes(32).toString('hex'), purpose, owner],
      );
      links[key].push(id);
      return id;
    };
    const reply = async (key: keyof Place['replies'], on: keyof Place['links']) => {
      replies[key] = randomUUID();
      const linkId = await link(on);
      await db.query(
        `INSERT INTO app.recipient_detail_response(id,tenant_id,link_id,body,source_kind,retention_until,created_by,created_at) VALUES($1,$2,$3,$4,'SELF_DECLARATION',now()+interval '7 days',$5,${at()})`,
        [replies[key], tenant, linkId, JSON.stringify({ body: `${replyWords} (${key})` }), owner],
      );
    };
    const review = async (response: string, decision: 'PUBLISH' | 'ASK') =>
      db.query(
        `INSERT INTO app.recipient_reply_review(tenant_id,response_id,command_id,decision,ask_terms,note,reviewed_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,${at()})`,
        [
          tenant,
          response,
          randomUUID(),
          decision,
          decision === 'ASK' ? ['leadTime'] : null,
          noteWords,
          owner,
        ],
      );
    await reply('open', 'team');
    await reply('published', 'team');
    await review(replies.published, 'PUBLISH');
    await reply('askedThenCorrected', 'team');
    await review(replies.askedThenCorrected, 'ASK');
    await db.query(
      `INSERT INTO app.recipient_detail_response_revision(id,tenant_id,response_id,link_id,version,body,source_kind,retention_until,created_by,created_at) VALUES($1,$2,$3,$4,1,$5,'SELF_DECLARATION',now()+interval '7 days',$6,${at()})`,
      [
        randomUUID(),
        tenant,
        replies.askedThenCorrected,
        links.team[2],
        JSON.stringify({ body: revisionWords }),
        owner,
      ],
    );
    await reply('ownPrivate', 'ownPrivate');
    await reply('otherPrivate', 'otherPrivate');
    const answered = randomUUID(),
      unanswered = randomUUID();
    for (const request of [answered, unanswered])
      await db.query(
        `INSERT INTO app.delivery_request(id,tenant_id,publication_id,title,instructions,owner_id,due_at,created_by,created_at) VALUES($1,$2,$3,'Synthetic evidence request','Describe the synthetic requirement.',$4,now()+interval '1 day',$4,${at()})`,
        [request, tenant, randomUUID(), owner],
      );
    await db.query(
      `INSERT INTO app.delivery_response(id,tenant_id,request_id,link_id,body,source_kind,claim_status,created_at) VALUES($1,$2,$3,$4,$5,'self_declaration','self_declared',${at()})`,
      [randomUUID(), tenant, answered, randomUUID(), answerWords],
    );
    await db.query('COMMIT');
    return { tenant, purpose, links, replies, answered, unanswered };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

beforeAll(async () => {
  s = await realStaffFixture(
    'https://ep-adr087-readers.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    'adr087-u2-readers-secret',
  );
  await migrateReplyReview(s.f.owner);
  await migrateRecipientResponseRevision(s.f.owner);
  for (const who of ['operator', 'reviewer', 'viewer'] as const)
    await s.f.owner.query(
      "INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications) VALUES($1,$2,$3,ARRAY['commercial_qualification'],ARRAY['PUBLIC','INTERNAL']) ON CONFLICT DO NOTHING",
      [s.intakeTenantId, s.f.users[who]!.id, who],
    );
  await addRemoved();
  sample = await seed(s.f.tenantA, 'synthetic_validation');
  real = await seed(s.intakeTenantId, 'commercial_qualification');
  experience = new DeliveryExperienceService(s.f.runtime);
  delivery = new DeliveryService(s.f.runtime, s.missions, 'adr087-u2-readers-secret');
  reviews = new ReplyReviewService(s.f.runtime);
}, 240000);
beforeEach(async () => {
  await s.f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
afterAll(async () => {
  await s?.f.close();
});

const places = () =>
  [
    ['sample', () => sample],
    ['real', () => real],
  ] as const;
const ours = (place: Place) => new Set(Object.values(place.replies));

// Everything a role reads from the four readers, limited to this test's seeded rows.
async function readAll(who: Exclude<Role, 'removed'>, place: Place) {
  const ctx = ctxFor(who, place);
  const mine = ours(place);
  const responses = (await experience.workspace(ctx)).responses.filter((r: { id: string }) =>
    mine.has(r.id),
  );
  const requests = (await delivery.workspace(ctx)).requests
    .filter((r: { id: string }) => [place.answered, place.unanswered].includes(r.id))
    .map((r: Record<string, unknown>) => ({
      id: r.id,
      status: r.status,
      answered: r.answered,
      response: r.response,
      claim_status: r.claim_status,
    }));
  const list = (await reviews.list(ctx)).reviews.filter((r) => mine.has(r.responseId));
  const waiting = (await getTeamToday(s.f.runtime, ctx)).repliesToReview;
  return { responses, requests, reviews: list, waiting };
}
type Seen = Awaited<ReturnType<typeof readAll>>;
const visible = (place: Place, who: Exclude<Role, 'removed'>) =>
  ({
    viewer: [...place.links.team],
    operator: [...place.links.team, ...place.links.ownPrivate],
    owner: Object.values(place.links).flat(),
    reviewer: Object.values(place.links).flat(),
  })[who];
// What the owner reads, cut to the replies another role may know of, with the words that role may not read removed.
function ownerAs(owner: Seen, place: Place, who: Exclude<Role, 'removed'>, words: boolean): Seen {
  const links = new Set(visible(place, who));
  const responses = owner.responses.filter((r: { link_id: string }) => links.has(r.link_id));
  const ids = new Set(responses.map((r: { id: string }) => r.id));
  return {
    responses: words ? responses : responses.map((r: object) => ({ ...r, body: null })),
    requests: words
      ? owner.requests
      : owner.requests.map((r: Record<string, unknown>) => ({ ...r, response: null })),
    reviews: owner.reviews
      .filter((r) => ids.has(r.responseId))
      .map((r) => (words ? r : { ...r, reasonCode: null, askTerms: null, note: null })),
    waiting: -1,
  };
}

const before = new Map<string, Seen>();

describe('before U2 (the meta functions do not exist)', () => {
  test('every role reads its scope; the viewer reads it without reply or answer words', async () => {
    for (const [name, get] of places()) {
      const place = get();
      for (const who of ['owner', 'operator', 'reviewer', 'viewer'] as const)
        before.set(`${name}:${who}`, await readAll(who, place));
      const owner = before.get(`${name}:owner`)!;
      // Five replies, the corrected one carries its correction.
      expect(owner.responses).toHaveLength(5);
      const corrected = owner.responses.find(
        (r: { id: string }) => r.id === place.replies.askedThenCorrected,
      );
      expect(corrected).toMatchObject({ revision: 1, body: { body: revisionWords } });
      expect(corrected.revised_at).toBeTruthy();
      expect(owner.waiting).toBe(4);
      expect(before.get(`${name}:reviewer`)!.waiting).toBe(4);
      expect(before.get(`${name}:operator`)!.waiting).toBe(3);
      expect(before.get(`${name}:viewer`)!.waiting).toBe(2);
      for (const who of ['operator', 'reviewer'] as const)
        expect({ ...before.get(`${name}:${who}`)!, waiting: -1 }).toEqual(
          ownerAs(owner, place, who, true),
        );
      const viewer = before.get(`${name}:viewer`)!;
      expect({ ...viewer, reviews: [], waiting: -1 }).toEqual({
        ...ownerAs(owner, place, 'viewer', false),
        reviews: [],
      });
      expect(JSON.stringify(viewer.responses)).not.toContain(replyWords);
      expect(JSON.stringify(viewer.requests)).not.toContain(answerWords);
    }
  });
  test('a revoked member reads nothing', async () => {
    for (const [, get] of places()) {
      const ctx = ctxFor('removed', get());
      await expect(experience.workspace(ctx)).rejects.toThrow();
      await expect(delivery.workspace(ctx)).rejects.toThrow();
      await expect(reviews.list(ctx)).rejects.toThrow();
      await expect(getTeamToday(s.f.runtime, ctx)).rejects.toThrow();
    }
  });
});

describe('U2 installed', () => {
  test('the viewer policies now return no reply, correction, answer or review row', async () => {
    expect(await migrateViewerReplyMetadata(s.f.owner)).toEqual({
      applied: ['0001_viewer_reply_metadata.sql', '0002_viewer_revision_metadata.sql'],
      waiting: [],
    });
    for (const [, get] of places()) {
      const place = get();
      for (const table of [
        'recipient_detail_response',
        'recipient_detail_response_revision',
        'delivery_response',
        'recipient_reply_review',
      ]) {
        const db = await s.f.runtime.connect();
        try {
          await db.query('BEGIN');
          await db.query(
            "SELECT set_config('corridra.session_hash',encode(sha256(convert_to($1,'UTF8')),'hex'),true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose',$3,true)",
            [s.f.users.viewer.ctx.token, place.tenant, place.purpose],
          );
          const n = await db.query(`SELECT count(*)::int n FROM app.${table} WHERE tenant_id=$1`, [
            place.tenant,
          ]);
          expect(n.rows[0].n, table).toBe(0);
        } finally {
          await db.query('ROLLBACK');
          db.release();
        }
      }
    }
  });
  test('owner, operator and reviewer read exactly what they read before', async () => {
    for (const [name, get] of places())
      for (const who of ['owner', 'operator', 'reviewer'] as const)
        expect(await readAll(who, get())).toEqual(before.get(`${name}:${who}`));
  });
  test('the delivery experience gives the viewer the same reply rows as before, the corrected one included, without words', async () => {
    for (const [name, get] of places()) {
      const seen = await readAll('viewer', get());
      expect(seen.responses).toEqual(before.get(`${name}:viewer`)!.responses);
      const corrected = seen.responses.find(
        (r: { id: string }) => r.id === get().replies.askedThenCorrected,
      );
      expect(corrected).toMatchObject({ revision: 1, body: null });
      expect(corrected.revised_at).toBeTruthy();
      expect(JSON.stringify(seen.responses)).not.toMatch(/Synthetic (supplier|corrected) reply/);
    }
  });
  test('the delivery workspace shows the viewer the answered request as answered, without the answer', async () => {
    for (const [name, get] of places()) {
      const seen = await readAll('viewer', get());
      expect(seen.requests).toEqual(before.get(`${name}:viewer`)!.requests);
      expect(seen.requests.find((r) => r.id === get().answered)).toMatchObject({
        status: 'RESPONDED',
        answered: true,
        response: null,
      });
    }
  });
  test('the review list gives the viewer the owner decisions and dates for its replies, without reason, terms or note', async () => {
    for (const [name, get] of places()) {
      const seen = await readAll('viewer', get());
      expect(seen.reviews).toEqual(
        ownerAs(before.get(`${name}:owner`)!, get(), 'viewer', false).reviews,
      );
      expect(seen.reviews.map((r) => r.decision).sort()).toEqual(['ASK', 'PUBLISH']);
      expect(JSON.stringify(seen.reviews)).not.toContain(noteWords);
    }
  });
  test('Today counts for the viewer only the replies still waiting for review, as before', async () => {
    for (const [name] of places())
      expect((await readAll('viewer', places().find((p) => p[0] === name)![1]())).waiting).toBe(2);
  });
  test('a revoked member still reads nothing', async () => {
    for (const [, get] of places()) {
      const ctx = ctxFor('removed', get());
      await expect(experience.workspace(ctx)).rejects.toThrow();
      await expect(delivery.workspace(ctx)).rejects.toThrow();
      await expect(reviews.list(ctx)).rejects.toThrow();
      await expect(getTeamToday(s.f.runtime, ctx)).rejects.toThrow();
    }
  });
});
