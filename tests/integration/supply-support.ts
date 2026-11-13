import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { migrateSupplySources } from '../../packages/db/src/supply-source-migrate';
import { configureSupplySources } from '../../packages/auth/src/supply-source-configuration';
import { SupplyProfileService } from '../../packages/counterparties/src/supply-profiles';
import { SupplyCandidateService } from '../../packages/counterparties/src/supply-candidates';
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

// ADR-082 slice S3 test world: the S2 world with the candidate service and owner-run helpers that open a control, write a source
// record, a data rights policy, a route pack and an organisation. They write as the table owner in the isolated test database,
// which is also how the other six controls are opened in tests; nothing here is reachable from the application.
export type CandidateWorld = Awaited<ReturnType<typeof candidateWorld>>;
export const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const day = 86400000;
type Queryable = Pick<DatabaseClient, 'query'>;

export async function candidateWorld(options: Parameters<typeof supplyWorld>[0] = {}) {
  const w = await supplyWorld(options);
  const candidates = new SupplyCandidateService(w.runtime);
  /** Runs SQL as the table owner with the service principal as the event actor. `quiet` skips triggers (fixtures only). */
  async function owned<T>(work: (db: Queryable) => Promise<T>, quiet = false): Promise<T> {
    const client = await w.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
        [w.serviceId, randomUUID(), randomUUID()],
      );
      if (quiet) await client.query('SET LOCAL session_replication_role=replica');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const openControl = (control: string, enabled = true) =>
    owned(async (db) => {
      const next = (
        await db.query(
          'SELECT coalesce(max(version),0)::int+1 AS v FROM app.supply_source_control WHERE control=$1',
          [control],
        )
      ).rows[0].v;
      await db.query(
        'INSERT INTO app.supply_source_control(control,version,enabled,reason) VALUES($1,$2,$3,$4)',
        [control, next, enabled, `Test world ${enabled ? 'opens' : 'closes'} ${control}`],
      );
    });
  /** A source record of the staff tenant. Retention in milliseconds from now. */
  const sourceRecord = (retentionMs = 200 * day, tenant = w.tenantA) =>
    owned(async (db) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO app.source_record(id,tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by)
         VALUES($1,$2,'document','https://agreement.example/record',now()-interval '1 hour','PUBLIC',app.tenant_processing_purpose($2),now()+($3||' milliseconds')::interval,'DENY',$4)`,
        [id, tenant, String(retentionMs), w.users.owner.id],
      );
      return id;
    });
  /** A current data rights policy on a source record; written with triggers skipped, as the staff guard needs a signed-in session. */
  const rightsPolicy = (
    sourceId: string,
    retentionMs = 150 * day,
    reuse = ['INTERNAL_REVIEW', 'PUBLICATION'],
    effectiveMs = -day,
  ) =>
    owned(async (db) => {
      const version = (
        await db.query(
          'SELECT coalesce(max(version),0)::int+1 AS v FROM app.data_rights_policy WHERE source_id=$1',
          [sourceId],
        )
      ).rows[0].v;
      await db.query(
        `INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,effective_from,reason,created_by)
         VALUES($1,$2,$3,$4,'Synthetic agreement licence',$5,'CONTROLLER',app.tenant_processing_purpose($2),'PUBLIC',ARRAY['DE'],ARRAY['DE'],ARRAY['DE'],now()+($6||' milliseconds')::interval,now()+($7||' milliseconds')::interval,'Synthetic rights for the test',$8)`,
        [
          randomUUID(),
          w.tenantA,
          sourceId,
          version,
          reuse,
          String(retentionMs),
          String(effectiveMs),
          w.users.owner.id,
        ],
      );
    }, true);
  /** Assigns a route pack with the given status and source categories to a mission. Fixture rows, written with triggers skipped. */
  const routePack = (missionId: string, status: string, categories: string[]) =>
    owned(async (db) => {
      const stamp = randomUUID().slice(0, 8);
      const type = randomUUID(),
        pack = randomUUID();
      await db.query(
        "INSERT INTO app.corridor_definition(id,tenant_id,market_a,market_b,created_by,reason) VALUES($1,$2,'BD','DE',$3,'Synthetic corridor') ON CONFLICT DO NOTHING",
        [randomUUID(), w.tenantA, w.users.owner.id],
      );
      const corridor = (
        await db.query(
          "SELECT id FROM app.corridor_definition WHERE tenant_id=$1 AND market_a='BD' AND market_b='DE'",
          [w.tenantA],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO app.corridor_route(id,tenant_id,corridor_id,origin_market,destination_market,created_by,reason) VALUES($1,$2,$3,'BD','DE',$4,'Synthetic route') ON CONFLICT DO NOTHING",
        [randomUUID(), w.tenantA, corridor, w.users.owner.id],
      );
      const routeId = (
        await db.query(
          "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='DE'",
          [w.tenantA],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO app.mission_type_definition(id,tenant_id,key,version,description,created_by,reason) VALUES($1,$2,$3,1,'Synthetic type',$4,'Synthetic type')",
        [type, w.tenantA, `type_${stamp}`, w.users.owner.id],
      );
      const version = (
        await db.query(
          'SELECT coalesce(max(version),0)::int+1 AS v FROM app.corridor_pack_version WHERE route_id=$1',
          [routeId],
        )
      ).rows[0].v;
      const configuration = {
        missionTypes: [`type_${stamp}`],
        requiredCapabilities: [],
        languages: ['en'],
        currencies: ['EUR'],
        timeZones: ['Europe/Berlin'],
        localities: [],
        clusters: [],
        requirements: [],
        assessments: [],
        sourceCategories: categories,
        channels: ['SYNTHETIC'],
        jurisdictionPolicyRefs: [],
        evidenceTypes: [],
        reviewRequired: true,
        operatorCapabilities: [],
        coverage: [],
        aiPolicyRef: null,
        pricingRef: null,
      };
      await db.query(
        "INSERT INTO app.corridor_pack_version(id,tenant_id,route_id,version,status,configuration,effective_from,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 hour',$7,'Synthetic pack')",
        [
          pack,
          w.tenantA,
          routeId,
          version,
          status,
          JSON.stringify(configuration),
          w.users.owner.id,
        ],
      );
      const next = (
        await db.query(
          'SELECT coalesce(max(version),0)::int+1 AS v FROM app.mission_route_assignment WHERE mission_id=$1',
          [missionId],
        )
      ).rows[0].v;
      await db.query(
        "INSERT INTO app.mission_route_assignment(id,tenant_id,mission_id,pack_id,mission_type_id,status,version,created_by,reason) VALUES($1,$2,$3,$4,$5,'ASSIGNED',$6,$7,'Synthetic assignment')",
        [randomUUID(), w.tenantA, missionId, pack, type, next, w.users.owner.id],
      );
      return pack as string;
    }, true);
  /** An organisation of the catalogue with an optional rights record of the given source type. */
  const organisation = (name: string, country = 'DE', rights?: string, synthetic = true) =>
    owned(async (db) => {
      const id = randomUUID();
      await db.query(
        'INSERT INTO app.organisation(id,name,country,synthetic) VALUES($1,$2,$3,$4)',
        [id, name, country, synthetic],
      );
      if (rights) {
        const record = await sourceRecord(300 * day);
        await db.query(
          `INSERT INTO customer_private.organisation_source_rights(organisation_id,version,source_type,basis_note,personal_name_flag,warnings,review_by,source_tenant_id,source_record_id,staff_actor)
           VALUES($1,1,$2,'Synthetic basis note',false,'{}',now()+interval '6 months',$3,$4,$5)`,
          [id, rights, w.tenantA, record, w.users.owner.id],
        );
      }
      return id as string;
    }, true);
  /** A staff research source (no agreement) created through the service, active unless said otherwise. */
  const staffSource = async (over: Record<string, unknown> = {}) =>
    (await candidates.createSource(w.users.operator.ctx, {
      commandId: randomUUID(),
      kind: 'staff_research',
      status: 'active',
      label: 'Public registers and websites',
      defaultRetentionMonths: 6,
      reason: 'Staff research from public pages',
      ...over,
    })) as { sourceId: string; sourceVersionId: string; version: number };
  /** A partner or platform source made active the way the rules say: control open, agreement record and rights, owner with MFA. */
  const agreementSource = async (
    kind: 'partner_organisation' | 'partner_person' | 'data_platform',
    missionId?: string,
    over: Record<string, unknown> = {},
  ) => {
    await openControl(kind === 'data_platform' ? 'platform_kind' : 'partner_kinds');
    const record = await sourceRecord();
    await rightsPolicy(record);
    if (missionId) await routePack(missionId, 'TESTING', [`supply.${kind}`]);
    const made = (await candidates.createSource(w.users.owner.ctx, {
      commandId: randomUUID(),
      kind,
      status: 'active',
      label: `Agreement source ${kind}`,
      sourceRecordId: record,
      defaultRetentionMonths: 6,
      reason: 'Synthetic agreement for the test',
      ...over,
    })) as { sourceId: string; sourceVersionId: string; version: number };
    return { ...made, record };
  };
  const profile = async (missionId = w.missionId) =>
    (await w.save('operator', missionId)).profileVersionId as string;
  const candidateInput = (over: Record<string, unknown> = {}) => ({
    commandId: randomUUID(),
    companyName: `Acme Trading ${randomUUID().slice(0, 6)} Ltd`,
    country: 'DE',
    websiteHost: 'acme.example',
    publicIdentifier: 'HRB 123456',
    sizeBand: 'small',
    counterpartyTypes: ['importer'],
    observedAt: iso(-day),
    sourceLocator: 'https://registry.example/entry/1',
    ...over,
  });
  /** Adds one manual candidate as the given person to the given mission, profile version and source version. */
  const addCandidate = (
    who: keyof typeof w.users,
    ids: { missionId: string; profileVersionId: string; sourceVersionId: string },
    over: Record<string, unknown> = {},
  ) =>
    candidates.addCandidate(w.users[who].ctx, { ...candidateInput(over), ...ids }) as Promise<{
      candidateId: string;
      warnings: string[];
    }>;
  return {
    ...w,
    candidates,
    owned,
    openControl,
    sourceRecord,
    rightsPolicy,
    routePack,
    organisation,
    staffSource,
    agreementSource,
    profile,
    candidateInput,
    addCandidate,
  };
}
