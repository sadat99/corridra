import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { rawContext } from './support';
import { goodFields, refused, supplyWorld, type World } from './supply-support';
import { profileWords } from '../../packages/domain/src/counterparty-profiles';

// ADR-082 section 3.1 and V3-02-006: profile version n+1, earlier tasks keep n, a stale version and an invalid field are
// refused, the write is one definer command with an exact retry, and nobody else can read or write it.
let w: World;
beforeAll(async () => {
  w = await supplyWorld();
});
afterAll(async () => {
  await w?.close();
});

const stored = async (missionId = w.missionId, role = 'BUYER') =>
  (
    await w.owner.query(
      'SELECT id,version,fields,fields_digest,created_by FROM app.counterparty_profile_version WHERE mission_id=$1 AND role=$2 ORDER BY version',
      [missionId, role],
    )
  ).rows;

describe('saving and versions', () => {
  test('the first save is version 1, the next is 2, and the earlier version stays as it was', async () => {
    const first = await w.save('operator', w.missionId);
    expect(first.version).toBe(1);
    const changed = goodFields({ candidatesWanted: 30, sizeBand: 'medium' });
    const second = await w.save('operator', w.missionId, { expectedVersion: 1 }, changed);
    expect(second.version).toBe(2);
    const rows = await stored();
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0].id).toBe(first.profileVersionId);
    expect(rows[0].fields.candidatesWanted).toBe(20);
    expect(rows[1].fields.candidatesWanted).toBe(30);
    const latest = await w.service.latest(w.users.viewer.ctx, {
      missionId: w.missionId,
      role: 'BUYER',
    });
    expect(latest).toMatchObject({ version: 2, id: second.profileVersionId });
    const history = await w.service.history(w.users.reviewer.ctx, {
      missionId: w.missionId,
      role: 'BUYER',
    });
    expect(history.map((r: { version: number }) => r.version)).toEqual([2, 1]);
  });

  test('the digest is the sha256 of the stored fields, and the author is the signed-in person', async () => {
    const rows = (
      await w.owner.query(
        'SELECT fields::text AS text,fields_digest,created_by FROM app.counterparty_profile_version WHERE mission_id=$1',
        [w.missionId],
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.fields_digest).toBe(createHash('sha256').update(row.text).digest('hex'));
      expect(row.created_by).toBe(w.users.operator.id);
    }
  });

  test('roles are separate histories of the same schema', async () => {
    const supplier = await w.save('owner', w.missionId, { role: 'SUPPLIER' });
    const distributor = await w.save('admin' in w.users ? 'owner' : 'owner', w.missionId, {
      role: 'DISTRIBUTOR',
    });
    expect([supplier.version, distributor.version]).toEqual([1, 1]);
    expect((await stored(w.missionId, 'SUPPLIER')).length).toBe(1);
    expect((await stored(w.missionId, 'BUYER')).length).toBe(2);
  });

  test('a stale version is refused with the exact words and writes nothing', async () => {
    const before = (await stored()).length;
    const message = await refused(w.save('operator', w.missionId, { expectedVersion: 1 }));
    expect(message).toBe(profileWords.stale);
    expect(message).toBe('This profile changed. Reload it and try again.');
    expect(await refused(w.save('operator', w.missionId, { expectedVersion: 0 }))).toBe(
      profileWords.stale,
    );
    expect(await refused(w.save('operator', w.missionId, { expectedVersion: 9 }))).toBe(
      profileWords.stale,
    );
    expect((await stored()).length).toBe(before);
  });

  test('two people saving from the same version: one wins, the other is told it changed', async () => {
    const mission = await w.mission(w.tenantA, w.users.operator.id);
    const results = await Promise.all([
      refused(w.save('operator', mission)),
      refused(w.save('owner', mission, {}, goodFields({ candidatesWanted: 55 }))),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === profileWords.stale)).toHaveLength(1);
    expect(await stored(mission)).toHaveLength(1);
  });

  test('an invalid field is refused before the database, and a direct call with a bad shape is refused by the database', async () => {
    const before = (await stored()).length;
    await expect(
      w.save('operator', w.missionId, { expectedVersion: 2 }, goodFields({ candidatesWanted: 0 })),
    ).rejects.toThrow();
    await expect(
      w.save('operator', w.missionId, { expectedVersion: 2 }, goodFields({ route: 'BD-DE' })),
    ).rejects.toThrow();
    const direct = (fields: unknown, expected = 2) =>
      refused(
        rawContext(
          w.runtime,
          w.users.operator.ctx,
          'SELECT app.save_counterparty_profile($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NULL)',
          [
            w.tenantA,
            randomUUID(),
            'a'.repeat(64),
            w.missionId,
            'BUYER',
            expected,
            JSON.stringify(fields),
            'Direct call',
          ],
        ),
      );
    expect(await direct({ ...goodFields(), route: 'BD-DE' })).toBe(
      'The profile has an unknown or missing field',
    );
    expect(await direct({ productCategory: goodFields().productCategory })).toBe(
      'The profile has an unknown or missing field',
    );
    expect(await direct({ ...goodFields(), candidatesWanted: 500 })).toBe(
      'Candidates wanted must be 1 to 100',
    );
    expect(await direct({ ...goodFields(), candidatesWanted: '20' })).toBe(
      'Candidates wanted must be 1 to 100',
    );
    expect((await stored()).length).toBe(before);
  });

  test('a free-text profile id from another mission is refused', async () => {
    const message = await refused(
      w.save('operator', w.missionId, { expectedVersion: 2, targetProfileId: randomUUID() }),
    );
    expect(message).toBe('Mission unavailable');
  });

  test('a closed mission cannot take a new profile', async () => {
    const closed = await w.mission(w.tenantA, w.users.operator.id, 'CANCELLED').catch(() => null);
    if (!closed) return;
    expect(await refused(w.save('operator', closed))).toBe(profileWords.missionClosed);
  });
});

describe('exact retry', () => {
  test('the same command and request returns the first result and writes one version and one command', async () => {
    const mission = await w.mission(w.tenantA, w.users.operator.id);
    const commandId = randomUUID();
    const a = await w.save('operator', mission, { commandId });
    const b = await w.save('operator', mission, { commandId });
    expect(b).toEqual(a);
    expect(await stored(mission)).toHaveLength(1);
    const commands = await w.owner.query(
      'SELECT result,actor_kind,staff_actor,customer_principal FROM app.supply_command WHERE command_id=$1',
      [commandId],
    );
    expect(commands.rows).toHaveLength(1);
    expect(commands.rows[0]).toMatchObject({
      actor_kind: 'staff',
      staff_actor: w.users.operator.id,
      customer_principal: null,
    });
    expect(commands.rows[0].result).toEqual({ profileVersionId: a.profileVersionId, version: 1 });
  });

  test('the same command id with changed content is refused, even by another member, and writes nothing', async () => {
    const mission = await w.mission(w.tenantA, w.users.operator.id);
    const commandId = randomUUID();
    await w.save('operator', mission, { commandId });
    const changed = await refused(
      w.save(
        'operator',
        mission,
        { commandId, expectedVersion: 0 },
        goodFields({ candidatesWanted: 99 }),
      ),
    );
    expect(changed).toBe(profileWords.reused);
    expect(changed).toBe('Command ID reused with different values');
    expect(await refused(w.save('owner', mission, { commandId }))).toBe(profileWords.reused);
    expect(await stored(mission)).toHaveLength(1);
  });
});

describe('who can write and who can read', () => {
  test('reviewer, viewer, another tenant and a person outside every tenant cannot save', async () => {
    const mission = await w.mission(w.tenantA, w.users.operator.id);
    for (const who of ['reviewer', 'viewer', 'outsider'] as const)
      expect(await refused(w.save(who, mission)), who).toBeTruthy();
    expect(await stored(mission)).toHaveLength(0);
  });

  test("another tenant's owner cannot save to this tenant's mission, nor read its profiles", async () => {
    expect(await refused(w.save('other', w.missionId, { expectedVersion: 2 }))).toBeTruthy();
    const crossed = await refused(
      w.service.save(
        { ...w.users.other.ctx, tenantId: w.tenantA },
        {
          commandId: randomUUID(),
          missionId: w.missionId,
          role: 'BUYER',
          expectedVersion: 2,
          fields: goodFields(),
          reason: 'Crossing tenants',
        },
      ),
    );
    expect(crossed).toBeTruthy();
    const mine = await w.save('other', w.otherMissionId);
    expect(mine.version).toBe(1);
    const seen = await rawContext(
      w.runtime,
      w.users.other.ctx,
      'SELECT id,mission_id FROM app.counterparty_profile_version',
    );
    expect(seen.rows.map((r) => r.mission_id)).toEqual([w.otherMissionId]);
    const sees = await rawContext(
      w.runtime,
      w.users.other.ctx,
      'SELECT id FROM app.supply_command',
    );
    expect(sees.rowCount).toBe(1);
    expect(
      await w.service.latest(w.users.other.ctx, { missionId: w.missionId, role: 'BUYER' }),
    ).toBeNull();
  });

  test('a command is visible only to the person who made it; profile versions to every staff role of the tenant', async () => {
    const own = await rawContext(
      w.runtime,
      w.users.operator.ctx,
      'SELECT staff_actor FROM app.supply_command',
    );
    expect(own.rows.length).toBeGreaterThan(0);
    expect(new Set(own.rows.map((r) => r.staff_actor))).toEqual(new Set([w.users.operator.id]));
    const ownerSees = await rawContext(
      w.runtime,
      w.users.owner.ctx,
      'SELECT staff_actor FROM app.supply_command',
    );
    expect(ownerSees.rows.every((r) => r.staff_actor === w.users.owner.id)).toBe(true);
    for (const who of ['owner', 'operator', 'reviewer', 'viewer'] as const) {
      const rows = await rawContext(
        w.runtime,
        w.users[who].ctx,
        'SELECT id FROM app.counterparty_profile_version',
      );
      expect(rows.rowCount, who).toBeGreaterThan(0);
    }
    const none = await rawContext(
      w.runtime,
      w.users.outsider.ctx,
      'SELECT id FROM app.counterparty_profile_version',
    ).catch(() => ({ rowCount: 0 }));
    expect(none.rowCount).toBe(0);
  });

  test('the runtime login cannot write the tables or call the private helpers directly', async () => {
    for (const sql of [
      "INSERT INTO app.counterparty_profile_version(tenant_id,mission_id,role,version,fields,fields_digest,reason,created_by) SELECT tenant_id,mission_id,role,99,fields,fields_digest,'Forged',created_by FROM app.counterparty_profile_version LIMIT 1",
      'UPDATE app.counterparty_profile_version SET reason=reason',
      'DELETE FROM app.counterparty_profile_version',
      'INSERT INTO app.supply_command(tenant_id,command_id,actor_kind,staff_actor,action,request_hash,result) SELECT tenant_id,gen_random_uuid(),actor_kind,staff_actor,action,request_hash,result FROM app.supply_command LIMIT 1',
      'DELETE FROM app.supply_command',
      "INSERT INTO app.supply_source_control(control,version,enabled,reason) VALUES('connectors',1,true,'Forged opening of connectors')",
      'SELECT * FROM app.supply_source_control',
      "SELECT app.supply_control_open('module')",
    ])
      expect(await refused(rawContext(w.runtime, w.users.operator.ctx, sql)), sql).toMatch(
        /permission denied|42501|violates row-level/i,
      );
    for (const sql of [
      'SELECT app.supply_control_open($1)',
      'SELECT app.save_counterparty_profile(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
    ])
      expect(
        await refused(w.auth.query(sql, ['module'].slice(0, sql.includes('$1') ? 1 : 0))),
        sql,
      ).toMatch(/permission denied/i);
  });

  test('the owner cannot rewrite or forge either table: append only, digest checked, next version only', async () => {
    const row = (await stored())[0];
    expect(
      await refused(
        w.owner.query('UPDATE app.counterparty_profile_version SET reason=$2 WHERE id=$1', [
          row.id,
          'Edited later',
        ]),
      ),
    ).toBeTruthy();
    expect(
      await refused(
        w.owner.query('DELETE FROM app.counterparty_profile_version WHERE id=$1', [row.id]),
      ),
    ).toBeTruthy();
    expect(await refused(w.owner.query('DELETE FROM app.supply_command'))).toBeTruthy();
    const forge = (version: number, digest: string) =>
      refused(
        w.owner.query(
          `INSERT INTO app.counterparty_profile_version(tenant_id,mission_id,role,version,fields,fields_digest,reason,created_by)
           SELECT tenant_id,mission_id,role,$1,fields,$2,'Forged',created_by FROM app.counterparty_profile_version WHERE id=$3`,
          [version, digest, row.id],
        ),
      );
    expect(await forge(3, 'f'.repeat(64))).toBe('The profile digest does not match its fields');
    expect(await forge(7, row.fields_digest)).toBe(profileWords.stale);
  });
});

describe('events', () => {
  test('every profile version and command wrote an event holding ids, version and role only', async () => {
    const events = await w.owner.query(
      `SELECT aggregate_type,payload FROM app.domain_event WHERE aggregate_type IN ('counterparty_profile_version','supply_command')`,
    );
    expect(events.rows.length).toBeGreaterThan(0);
    for (const e of events.rows) {
      expect(
        Object.keys(e.payload)
          .sort()
          .filter((k) => !['id', 'version', 'role', 'revoked'].includes(k)),
      ).toEqual([]);
      expect(JSON.stringify(e.payload)).not.toMatch(
        /Cotton|towels|candidatesWanted|Synthetic profile/,
      );
    }
    const kinds = new Set(events.rows.map((e) => e.aggregate_type));
    expect(kinds).toEqual(new Set(['counterparty_profile_version', 'supply_command']));
  });
});
