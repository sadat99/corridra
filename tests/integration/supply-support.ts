import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { migrateSupplySources } from '../../packages/db/src/supply-source-migrate';
import { configureSupplySources } from '../../packages/auth/src/supply-source-configuration';
import { SupplyProfileService } from '../../packages/counterparties/src/supply-profiles';
import type { CounterpartyProfileFields } from '../../packages/domain/src/counterparty-profiles';

// ADR-082 slice S2 test world: the foundation fixture (two synthetic tenants, owner, operator, reviewer, viewer and an
// owner of the other tenant), the real-use, network and service request modules the supply module needs, one mission in
// each tenant, and short helpers. Nothing here opens any control except the `module` one, and only when asked.
export type World = Awaited<ReturnType<typeof supplyWorld>>;

export const goodFields = (extra: Record<string, unknown> = {}) => ({
  productCategory: { key: 'home_textiles', words: 'Cotton hotel towels and bed linen' },
  counterpartyTypes: ['importer', 'distributor'],
  candidatesWanted: 20,
  deadline: '2026-12-15',
  ...extra,
});

export async function supplyWorld({ install = true, open = true } = {}) {
  const f = await fixture();
  await migrateNetworkRealUse(f.owner);
  if (install) await migrateSupplySources(f.owner);
  if (install && open)
    await configureSupplySources(f.owner, {
      enabled: true,
      reason: 'Open supply sources for the test world',
    });
  const service = new SupplyProfileService(f.runtime);
  async function mission(tenantId: string, ownerId: string, status = 'DRAFT') {
    const id = randomUUID();
    const client = await f.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
        [f.serviceId, randomUUID(), randomUUID()],
      );
      await client.query(
        `INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by,status) VALUES($1,$2,$3,'Find counterparties',now()+interval '1 day','Synthetic supply mission',$3,$4)`,
        [id, tenantId, ownerId, status],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return id;
  }
  const missionId = await mission(f.tenantA, f.users.operator.id);
  const otherMissionId = await mission(f.tenantB, f.users.other.id);
  const save = (
    who: keyof typeof f.users,
    missionIdArg: string,
    over: Record<string, unknown> = {},
    fields: Record<string, unknown> = goodFields(),
  ) =>
    service.save(f.users[who].ctx, {
      commandId: randomUUID(),
      missionId: missionIdArg,
      role: 'BUYER',
      expectedVersion: 0,
      fields,
      reason: 'Synthetic profile from the brief',
      ...over,
    });
  return { ...f, service, missionId, otherMissionId, mission, save };
}

/** The message of a rejected promise, or null when it resolved. */
export async function refused(work: Promise<unknown>) {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
export type { CounterpartyProfileFields };
