import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { routePack, initialRoutes, type RouteConfiguration } from '@corridra/domain/corridors';
import {
  missionCatalogue,
  machineryFields,
  requirementFields,
} from '@corridra/domain/commercial-missions';
const endpoints = z
  .object({
    id: z.uuid(),
    origin: z.string().min(2).max(80),
    destination: z.string().min(2).max(80),
    reason: z.string().min(3).max(500),
  })
  .strict()
  .refine((v) => v.origin !== v.destination);
export class CorridorService {
  constructor(private pool: DatabasePool) {}
  catalogue(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'missions.read', async ({ db }) => ({
      packs: (
        await db.query(
          `SELECT p.*,r.origin_market,r.destination_market FROM app.corridor_pack_version p JOIN app.corridor_route r ON r.tenant_id=p.tenant_id AND r.id=p.route_id WHERE p.tenant_id=$1 AND p.effective_from<=now() AND p.version=(SELECT max(version) FROM app.corridor_pack_version n WHERE n.tenant_id=p.tenant_id AND n.route_id=p.route_id AND n.effective_from<=now()) ORDER BY r.origin_market,r.destination_market`,
          [ctx.tenantId],
        )
      ).rows,
      types: (
        await db.query(
          'SELECT * FROM app.mission_type_definition WHERE tenant_id=$1 ORDER BY key,version DESC',
          [ctx.tenantId],
        )
      ).rows,
      requirements: (
        await db.query(
          'SELECT * FROM app.requirement_definition WHERE tenant_id=$1 ORDER BY key,version DESC',
          [ctx.tenantId],
        )
      ).rows,
      assessments: (
        await db.query(
          'SELECT * FROM app.assessment_definition WHERE tenant_id=$1 ORDER BY key,version DESC',
          [ctx.tenantId],
        )
      ).rows,
    }));
  }
  installTemplates(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'config.manage', async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        ctx.tenantId + ':corridor',
      ]);
      for (const template of missionCatalogue) {
        for (const table of [
          'mission_type_definition',
          'requirement_definition',
          'assessment_definition',
        ]) {
          const key =
            table === 'mission_type_definition' ? template.key : template.key + '.commercial';
          if (
            (
              await db.query(
                `SELECT id FROM app.${table} WHERE tenant_id=$1 AND key=$2 AND version=1`,
                [ctx.tenantId, key],
              )
            ).rowCount
          )
            continue;
          const schema = {
            schemaVersion: 1,
            typeKey: template.key,
            fields: Object.keys(requirementFields.shape),
            machineryFields: template.key === 'machinery_procurement' ? [...machineryFields] : [],
            criteria: [...template.criteria, 'evidence_completeness'],
          };
          const columns = table === 'mission_type_definition' ? '' : ',schema';
          await db.query(
            `INSERT INTO app.${table}(id,tenant_id,key,version,description,created_by,reason${columns}) VALUES($1,$2,$3,1,$4,$5,$6${columns ? ',$7' : ''})`,
            [
              randomUUID(),
              ctx.tenantId,
              key,
              template.label,
              actorId,
              'Install generic commercial mission template',
              ...(columns ? [schema] : []),
            ],
          );
        }
      }
      return { installed: true };
    });
  }
  seedInitialRoutes(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'config.manage', async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        ctx.tenantId + ':corridor',
      ]);
      const ids: string[] = [];
      for (const route of initialRoutes) {
        const existing = (
          await db.query(
            'SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market=$2 AND destination_market=$3',
            [ctx.tenantId, route.origin, route.destination],
          )
        ).rows[0];
        if (existing) {
          ids.push(existing.id);
          continue;
        }
        const markets = [route.origin, route.destination].sort();
        let corridor = (
          await db.query(
            'SELECT id FROM app.corridor_definition WHERE tenant_id=$1 AND market_a=$2 AND market_b=$3',
            [ctx.tenantId, ...markets],
          )
        ).rows[0]?.id;
        if (!corridor) {
          corridor = randomUUID();
          await db.query(
            'INSERT INTO app.corridor_definition(id,tenant_id,market_a,market_b,created_by,reason) VALUES($1,$2,$3,$4,$5,$6)',
            [
              corridor,
              ctx.tenantId,
              ...markets,
              actorId,
              'Initial draft configuration, no coverage claim',
            ],
          );
        }
        const id = randomUUID();
        await db.query(
          'INSERT INTO app.corridor_route(id,tenant_id,corridor_id,origin_market,destination_market,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            id,
            ctx.tenantId,
            corridor,
            route.origin,
            route.destination,
            actorId,
            'Initial draft route, no launch approval',
          ],
        );
        for (const key of route.missions) {
          if (
            !(
              await db.query(
                'SELECT id FROM app.mission_type_definition WHERE tenant_id=$1 AND key=$2',
                [ctx.tenantId, key],
              )
            ).rowCount
          )
            await db.query(
              'INSERT INTO app.mission_type_definition(id,tenant_id,key,version,description,created_by,reason) VALUES($1,$2,$3,1,$3,$4,$5)',
              [randomUUID(), ctx.tenantId, key, actorId, 'Initial mission type definition'],
            );
        }
        await db.query(
          "INSERT INTO app.corridor_pack_version(id,tenant_id,route_id,version,status,configuration,effective_from,created_by,reason) VALUES($1,$2,$3,1,'DRAFT',$4,now(),$5,$6)",
          [
            randomUUID(),
            ctx.tenantId,
            id,
            initialRouteConfiguration(route),
            actorId,
            'Unreviewed draft, synthetic configuration only',
          ],
        );
        ids.push(id);
      }
      return ids;
    });
  }
  createRoute(ctx: RequestContext, input: unknown) {
    const v = endpoints.parse(input);
    return withTenant(this.pool, ctx, 'config.manage', async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        ctx.tenantId + ':corridor',
      ]);
      const markets = [v.origin, v.destination].sort();
      let corridor = (
        await db.query(
          'SELECT id FROM app.corridor_definition WHERE tenant_id=$1 AND market_a=$2 AND market_b=$3',
          [ctx.tenantId, ...markets],
        )
      ).rows[0]?.id;
      if (!corridor) {
        corridor = randomUUID();
        await db.query(
          'INSERT INTO app.corridor_definition(id,tenant_id,market_a,market_b,created_by,reason) VALUES($1,$2,$3,$4,$5,$6)',
          [corridor, ctx.tenantId, ...markets, actorId, v.reason],
        );
      }
      await db.query(
        'INSERT INTO app.corridor_route(id,tenant_id,corridor_id,origin_market,destination_market,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [v.id, ctx.tenantId, corridor, v.origin, v.destination, actorId, v.reason],
      );
      return { id: v.id };
    });
  }
  appendPack(ctx: RequestContext, input: unknown) {
    const v = routePack.parse(input);
    return withTenant(this.pool, ctx, 'config.manage', async ({ db, actorId }) => {
      await db.query(
        'INSERT INTO app.corridor_pack_version(id,tenant_id,route_id,version,status,configuration,effective_from,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          v.id,
          ctx.tenantId,
          v.routeId,
          v.version,
          v.status,
          v.configuration,
          v.effectiveFrom,
          actorId,
          v.reason,
        ],
      );
      return { id: v.id, version: v.version };
    });
  }
  assign(ctx: RequestContext, input: unknown) {
    const v = z
      .object({
        id: z.uuid(),
        missionId: z.uuid(),
        packId: z.uuid(),
        missionTypeId: z.uuid(),
        version: z.int().positive(),
        reason: z.string().min(3).max(500),
      })
      .strict()
      .parse(input);
    return withTenant(this.pool, ctx, 'config.manage', async ({ db, actorId }) => {
      await db.query(
        "INSERT INTO app.mission_route_assignment(id,tenant_id,mission_id,pack_id,mission_type_id,status,version,created_by,reason) VALUES($1,$2,$3,$4,$5,'ASSIGNED',$6,$7,$8)",
        [v.id, ctx.tenantId, v.missionId, v.packId, v.missionTypeId, v.version, actorId, v.reason],
      );
      return { id: v.id, version: v.version };
    });
  }
}
// Explicit operator seed input. No deployment automatically activates these routes.
export function initialRouteConfiguration(
  route: (typeof initialRoutes)[number],
): RouteConfiguration {
  return {
    missionTypes: [...route.missions],
    requiredCapabilities: [],
    languages: [],
    currencies: [],
    timeZones: [],
    localities: [],
    clusters: [],
    requirements: [],
    assessments: [],
    sourceCategories: [],
    channels: ['SYNTHETIC'],
    jurisdictionPolicyRefs: [],
    evidenceTypes: [],
    reviewRequired: true,
    operatorCapabilities: [],
    coverage: [],
    aiPolicyRef: null,
    pricingRef: null,
  };
}
