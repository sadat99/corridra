import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { accessFixture } from './access-fixture';
import { refused } from './supply-support';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { migrateSupplySources } from '../../packages/db/src/supply-source-migrate';
import { configureSupplySources } from '../../packages/auth/src/supply-source-configuration';
import { SupplyCandidateService } from '../../packages/counterparties/src/supply-candidates';
import { supplyWords } from '../../packages/domain/src/supply-sources';

// ADR-082 section 3.6 and 3.6a, D5 (slice S3): a blocked company is refused at the four introduction points, through
// an ADR-017 merge, and again after the merge is reversed; lifting clears it; with no block row nothing changes; and the block
// and the lift work while the module is paused. The world is the controlled communications fixture with the module installed.
const blocked = supplyWords.blocked;
let f: Awaited<ReturnType<typeof accessFixture>>;
let service: SupplyCandidateService;
beforeAll(async () => {
  f = await accessFixture();
  await migrateNetworkRealUse(f.owner);
  await migrateSupplySources(f.owner);
  await configureSupplySources(f.owner, {
    enabled: true,
    reason: 'Open for the do not contact test',
  });
  service = new SupplyCandidateService(f.runtime);
}, 300000);
afterAll(async () => {
  await f?.close();
});

type Target = Awaited<ReturnType<typeof f.target>>;
const organisationOf = async (t: Target) =>
  (
    await f.owner.query('SELECT organisation_id FROM app.relationship WHERE id=$1', [
      t.relationshipId,
    ])
  ).rows[0].organisation_id as string;
const block = (organisationId: string, who: 'operator' | 'owner' = 'operator') =>
  service.blockCompany(f.users[who].ctx, {
    commandId: randomUUID(),
    organisationId,
    reason: 'The company asked to be left alone',
    reference: 'ticket 51',
  });
const lift = (organisationId: string) =>
  service.liftCompany(f.users.owner.ctx, {
    commandId: randomUUID(),
    organisationId,
    reason: 'The company agreed to be contacted',
    reference: 'ticket 52',
  });
const quiet = async <T>(
  work: (db: {
    query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  }) => Promise<T>,
) => {
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [f.serviceId, randomUUID(), randomUUID()],
    );
    await client.query('SET LOCAL session_replication_role=replica');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
const merge = async (a: string, b: string) =>
  quiet(async (db) => {
    const [left, right] = a < b ? [a, b] : [b, a];
    const candidate = randomUUID(),
      resolution = randomUUID();
    await db.query(
      "INSERT INTO app.entity_candidate(id,tenant_id,left_id,right_id,reasons,purpose,created_by) VALUES($1,$2,$3,$4,'[\"name\"]','synthetic_validation',$5)",
      [candidate, f.tenantA, left, right, f.users.operator.id],
    );
    await db.query(
      "INSERT INTO app.entity_resolution(id,tenant_id,candidate_id,decision,survivor_id,reason,purpose,created_by) VALUES($1,$2,$3,'MERGE',$4,'Same company, two records','synthetic_validation',$5)",
      [resolution, f.tenantA, candidate, left, f.users.owner.id],
    );
    return { candidate, resolution, survivor: left };
  });
const reverse = (m: { candidate: string; resolution: string; survivor: string }) =>
  quiet((db) =>
    db.query(
      "INSERT INTO app.entity_resolution(id,tenant_id,candidate_id,decision,survivor_id,reverse_of,reason,purpose,created_by) VALUES($1,$2,$3,'REVERSE',$4,$5,'Not the same company','synthetic_validation',$6)",
      [randomUUID(), f.tenantA, m.candidate, m.survivor, m.resolution, f.users.owner.id],
    ),
  );

describe('with no block row', () => {
  test('the introduction path is unchanged, and the module installed adds only four triggers that return at once', async () => {
    const t = await f.target();
    const i = await f.introduction(t);
    expect(i.id).toBeTruthy();
    expect(await f.communications.command(f.ctx, i.input)).toMatchObject({ id: i.id });
    const triggers = (
      await f.owner.query(
        "SELECT tgname FROM pg_trigger WHERE tgname LIKE '%supply\\_dnc' AND NOT tgisinternal ORDER BY 1",
      )
    ).rows.map((r) => r.tgname);
    expect(triggers).toEqual([
      'communication_dispatch_retry_supply_dnc',
      'communication_dispatch_supply_dnc',
      'communication_receipt_supply_dnc',
      'communication_supply_dnc',
    ]);
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM app.supply_do_not_contact')).rows[0].n,
    ).toBe(0);
  });
});

describe('a blocked organisation', () => {
  test('an introduction, a dispatch, a retry and a receipt are all refused with the exact sentence; lifting clears them', async () => {
    const t = await f.target();
    const sent = await f.introduction(await f.target());
    const org = await organisationOf(t);
    const put = await block(org);
    expect(put.blockId).toBeTruthy();
    // 1. A new message to the blocked organisation.
    expect(await refused(f.introduction(t))).toContain(blocked);
    expect(
      await f.owner.query('SELECT count(*)::int n FROM app.communication WHERE target_id=$1', [
        t.targetId,
      ]),
    ).toMatchObject({ rows: [{ n: 0 }] });
    // 2. A dispatch for a message that already exists: a communication written before the block, no dispatch yet.
    const before = await f.introduction(await f.target());
    const dispatch = (
      await f.owner.query('SELECT * FROM app.communication_dispatch WHERE id=$1', [before.id])
    ).rows[0];
    const blockedTarget = await f.target();
    const blockedOrg = await organisationOf(blockedTarget);
    await block(blockedOrg);
    const orphan = randomUUID();
    await quiet(async (db) => {
      const c = (await db.query('SELECT * FROM app.communication WHERE id=$1', [before.id]))
        .rows[0];
      await db.query(
        `INSERT INTO app.communication(id,tenant_id,target_id,contact_id,policy_id,template_id,presentation,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '2 days',$8)`,
        [
          orphan,
          f.tenantA,
          blockedTarget.targetId,
          blockedTarget.contactId,
          c.policy_id,
          c.template_id,
          c.presentation,
          f.users.operator.id,
        ],
      );
    });
    const insertDispatch = () =>
      f.owner.query(
        `INSERT INTO app.communication_dispatch(id,tenant_id,event_id,capability_hash) VALUES($1,$2,(SELECT e.id FROM app.domain_event e WHERE e.tenant_id=$2 AND NOT EXISTS(SELECT FROM app.communication_dispatch d WHERE d.event_id=e.id) LIMIT 1),$3)`,
        [orphan, f.tenantA, 'd'.repeat(64)],
      );
    expect(await refused(insertDispatch())).toBe(blocked);
    // 3. A retry of a stopped dispatch of a message to a blocked organisation.
    const stopped = await f.introduction(await f.target());
    await quiet((db) =>
      db.query("UPDATE app.communication_dispatch SET status='DEAD',attempts=3 WHERE id=$1", [
        stopped.id,
      ]),
    );
    const stoppedOrg = await organisationOf(stopped as unknown as Target);
    await block(stoppedOrg);
    expect(
      await refused(
        f.owner.query(
          "UPDATE app.communication_dispatch SET status='PENDING',attempts=0 WHERE id=$1",
          [stopped.id],
        ),
      ),
    ).toBe(blocked);
    // 4. A receipt with no person behind it (a session with no tenant role).
    const receipt = (id: string) =>
      f.owner.query(
        "INSERT INTO app.communication_receipt(id,tenant_id,provider,reference) VALUES($1,$2,'synthetic','blocked test')",
        [id, f.tenantA],
      );
    const blockedIntro = await f.introduction(await f.target());
    await block(await organisationOf(blockedIntro as unknown as Target));
    expect(await refused(receipt(blockedIntro.id))).toBe(blocked);
    // Others are not affected: a message to an unrelated organisation still goes through.
    expect(await refused(receipt(sent.id))).not.toBe(blocked);
    expect(
      await f.owner.query('SELECT count(*)::int n FROM app.communication_receipt WHERE id=$1', [
        blockedIntro.id,
      ]),
    ).toMatchObject({ rows: [{ n: 0 }] });
    // Lift (owner with fresh MFA) clears every one of them.
    await lift(org);
    expect((await f.introduction(t)).id).toBeTruthy();
    await lift(await organisationOf(blockedIntro as unknown as Target));
    expect(await refused(receipt(blockedIntro.id))).toBeNull();
    expect(dispatch).toBeTruthy();
  });

  test('a block holds through a merge of two organisations and ends when the merge is reversed', async () => {
    const a = await f.target();
    const b = await f.target();
    const orgA = await organisationOf(a);
    const orgB = await organisationOf(b);
    await block(orgA);
    expect((await f.introduction(b)).id).toBeTruthy();
    // After the merge the second organisation is the same company, and the guard sees it without any caller access.
    const bTwo = await f.target();
    const orgBTwo = await organisationOf(bTwo);
    const m = await merge(orgA, orgBTwo);
    expect(await refused(f.introduction(bTwo))).toContain(blocked);
    await reverse(m);
    expect((await f.introduction(bTwo)).id).toBeTruthy();
    // Blocking the second organisation after a merge covers the first.
    const c = await f.target();
    const d = await f.target();
    const second = await merge(await organisationOf(c), await organisationOf(d));
    await block(await organisationOf(d));
    expect(await refused(f.introduction(c))).toContain(blocked);
    expect(await refused(f.introduction(d))).toContain(blocked);
    // Lifting through the other organisation lifts the pair.
    await lift(await organisationOf(c));
    expect((await f.introduction(c)).id).toBeTruthy();
    expect(second.survivor).toBeTruthy();
    expect(orgB).toBeTruthy();
  });

  test('the block and the lift work while the module is paused; other commands refuse; the guard stays on', async () => {
    const t = await f.target();
    const org = await organisationOf(t);
    await configureSupplySources(f.owner, {
      enabled: false,
      reason: 'Pause for the do not contact test',
    });
    try {
      expect((await block(org)).blockId).toBeTruthy();
      expect(await refused(f.introduction(t))).toContain(blocked);
      expect(
        await refused(
          service.createSource(f.users.operator.ctx, {
            commandId: randomUUID(),
            kind: 'staff_research',
            status: 'active',
            label: 'Paused source',
            defaultRetentionMonths: 6,
            reason: 'Refused while paused',
          }),
        ),
      ).toBe(supplyWords.paused);
      expect(await service.listBlocks(f.users.viewer.ctx)).not.toHaveLength(0);
      expect((await lift(org)).blockId).toBeTruthy();
      expect((await f.introduction(t)).id).toBeTruthy();
    } finally {
      await configureSupplySources(f.owner, {
        enabled: true,
        reason: 'Reopen after the do not contact test',
      });
    }
  });
});
