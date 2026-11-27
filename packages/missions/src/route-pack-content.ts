import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
import { DomainError, stepUpRequired } from '@corridra/domain';
import { routeConfiguration, routePack, type RouteConfiguration } from '@corridra/domain/corridors';
import {
  customKeyConflicts,
  deriveCompleteness,
  goLiveCheck,
  goLiveMessage,
  latestCustomLabels,
  parseContentDocument,
  routePackWords,
  type Completeness,
  type ContentDocument,
  type GoLiveResult,
  type GoLiveWarning,
  type PackView,
  type PackStatus,
} from '@corridra/domain/route-pack-standard';

// ADR-093 Phase 2b: the database side of route pack content and the one go-live check every pack write calls. The module
// acts only while CORRIDRA_ROUTE_PACK_FORM is on and the 2b marker app.route_pack_content_installed() exists. Off, or before
// the install, every pack path behaves exactly as before: the check returns before any lock or read, the content service
// answers Not found and no path reads the content table. Rules live in @corridra/domain/route-pack-standard.
export function routePackFormOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CORRIDRA_ROUTE_PACK_FORM === 'true';
}
async function markerPresent(db: DatabaseClient, signature: string) {
  const row = (
    await db.query<{ present: boolean }>('SELECT to_regprocedure($1) IS NOT NULL AS present', [
      signature,
    ])
  ).rows[0];
  return row?.present === true;
}
export async function routePackContentActive(db: DatabaseClient): Promise<boolean> {
  return routePackFormOn() && markerPresent(db, 'app.route_pack_content_installed()');
}
async function lockCorridor(db: DatabaseClient, tenantId: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [tenantId + ':corridor']);
}
type CurrentPack = {
  id: string;
  version: number;
  status: PackStatus;
  configuration: RouteConfiguration;
};
// The go-live check judges the pack in force, and also the latest pack by version when that one is LIMITED or ACTIVE or
// nothing is in force yet. So a route is live while either is live: neither a pack published live for a later date nor a
// later DRAFT scheduled after a live pack lets a Core field turn Pending, and a scheduled DRAFT alone never holds back a
// write. A live latest pack, which a new version follows, is judged first; the same pack is judged once.
async function packsOf(db: DatabaseClient, tenantId: string, routeId: string) {
  const rows = (
    await db.query<CurrentPack & { in_force: boolean }>(
      `(SELECT id,version,status,configuration,true AS in_force FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2 AND effective_from<=now() ORDER BY version DESC LIMIT 1)
       UNION ALL
       (SELECT id,version,status,configuration,false AS in_force FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2 ORDER BY version DESC LIMIT 1)`,
      [tenantId, routeId],
    )
  ).rows;
  return judgedPacks(
    rows.find((row) => row.in_force),
    rows.find((row) => !row.in_force),
  );
}
export function judgedPacks(
  inForce: CurrentPack | undefined,
  latest: CurrentPack | undefined,
): PackView[] {
  const judgedLatest =
    latest && (!inForce || latest.status === 'LIMITED' || latest.status === 'ACTIVE')
      ? latest
      : undefined;
  const packs = [judgedLatest, inForce].flatMap((pack) => (pack ? [pack] : []));
  if (!packs.length) return [null];
  return packs
    .filter((pack, index) => packs.findIndex((other) => other.id === pack.id) === index)
    .map((pack) => ({ status: pack.status, configuration: pack.configuration }));
}
// The go-live check against every judged pack; the first refusal wins, else the warnings of every judged pack, each key once
// per code. With no new pack, each judged pack stays as it is.
export function judge(
  packs: PackView[],
  before: ContentDocument | null,
  after: { pack?: PackView; document: ContentDocument | null },
): GoLiveResult {
  const warned = new Map<GoLiveWarning['code'], Set<string>>();
  for (const pack of packs) {
    const result = goLiveCheck({
      before: { pack, document: before },
      after: { pack: after.pack === undefined ? pack : after.pack, document: after.document },
    });
    if (!result.ok) return result;
    for (const warning of result.warnings)
      warned.set(warning.code, new Set([...(warned.get(warning.code) ?? []), ...warning.keys]));
  }
  return {
    ok: true,
    warnings: [...warned].map(([code, keys]) => ({ code, keys: [...keys] })),
  };
}
async function latestDocument(db: DatabaseClient, tenantId: string, routeId: string) {
  const row = (
    await db.query<{ document: unknown }>(
      'SELECT document FROM app.route_pack_content WHERE tenant_id=$1 AND route_id=$2 ORDER BY version DESC LIMIT 1',
      [tenantId, routeId],
    )
  ).rows[0];
  return row ? parseContentDocument(row.document) : null;
}
// Throws the one refusal; otherwise the warnings, which never hold a write back.
export function warningsOrRefuse(result: GoLiveResult): GoLiveWarning[] {
  if (!result.ok) throw new DomainError(goLiveMessage(result), 409, result.code);
  return result.warnings;
}
// Called by every path that writes a pack version, inside its transaction and before the insert: appendPack (so the raw
// corridor-pack command too), the reviewed publish and so the guided form and the status change. Returns the warnings, or
// undefined while the module is inactive, so a caller then answers exactly as before.
export async function assertPackGoLive(
  db: DatabaseClient,
  tenantId: string,
  pack: { routeId: string; status: PackStatus; configuration: RouteConfiguration },
): Promise<GoLiveWarning[] | undefined> {
  if (!(await routePackContentActive(db))) return undefined;
  await lockCorridor(db, tenantId);
  const packs = await packsOf(db, tenantId, pack.routeId);
  const document = await latestDocument(db, tenantId, pack.routeId);
  return warningsOrRefuse(
    judge(packs, document, {
      pack: { status: pack.status, configuration: pack.configuration },
      document,
    }),
  );
}
// A stable id for one step of a retried command: the same command and step always give the same id, shaped as a UUID with
// version nibble 5, so every step of a save or a publish can be repeated without a duplicate.
export function commandStepId(commandId: string, ...parts: string[]): string {
  const hex = createHash('sha256')
    .update([commandId, ...parts].join(':'))
    .digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const contentAppendItem = z
  .object({
    id: z.uuid(),
    routeId: z.uuid(),
    version: z.int().positive(),
    document: z.unknown(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const appendBatchInput = z
  .object({
    items: z
      .array(contentAppendItem)
      .min(1)
      .max(20)
      .refine(
        (items) => new Set(items.map((item) => item.routeId)).size === items.length,
        'Give each route once',
      )
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Give each item its own id',
      ),
  })
  .strict();
const routeIdInput = z.object({ routeId: z.uuid() }).strict();
const overviewInput = z
  .object({ routeIds: z.array(z.uuid()).min(1).max(100).optional() })
  .strict()
  .default({});
const goLiveInput = z
  .object({
    routeId: z.uuid(),
    pack: z
      .object({
        status: z.enum(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED']),
        configuration: routeConfiguration,
      })
      .strict()
      .optional(),
    document: z.unknown().optional(),
  })
  .strict();

export type ExistingProposal = {
  basePackId: string | null;
  reason: string;
  pack: z.infer<typeof routePack>;
};
export type ContentAppendResult = {
  id: string;
  routeId: string;
  version: number;
  packId: string | null;
  duplicate: boolean;
  // The go-live warnings of this save; a retried save wrote nothing now, so it carries none.
  warnings: GoLiveWarning[];
};
export type Capabilities = {
  routePackForm: boolean;
  contentInstalled: boolean;
  onePersonPublication: boolean;
};
export type RouteView = {
  routeId: string;
  key: string;
  origin: string;
  destination: string;
  pack: {
    id: string;
    version: number;
    status: PackStatus;
    configuration: RouteConfiguration;
    effectiveFrom: string;
    createdBy: string;
    reason: string;
  } | null;
  content: {
    id: string;
    version: number;
    packId: string | null;
    document: ContentDocument;
    createdAt: string;
    createdBy: string;
    reason: string;
  } | null;
  completeness: Completeness;
  readiness: { packId: string; completeMissionTypes: string[] } | null;
};
type RouteRow = { id: string; origin: string; destination: string };
type PackRow = CurrentPack & {
  route_id: string;
  effective_from: Date;
  created_by: string;
  reason: string;
};
type ContentRow = {
  id: string;
  route_id: string;
  version: number;
  pack_id: string | null;
  document: unknown;
  created_at: Date;
  created_by: string;
  reason: string;
};
async function readState(db: DatabaseClient, tenantId: string) {
  const routes = await db.query<RouteRow>(
    'SELECT id,origin_market AS origin,destination_market AS destination FROM app.corridor_route WHERE tenant_id=$1 ORDER BY origin_market,destination_market',
    [tenantId],
  );
  const markets = await db.query<{ key: string }>('SELECT key FROM app.market_scope ORDER BY key');
  const packs = await db.query<PackRow>(
    'SELECT DISTINCT ON(route_id) id,route_id,version,status,configuration,effective_from,created_by,reason FROM app.corridor_pack_version WHERE tenant_id=$1 AND effective_from<=now() ORDER BY route_id,version DESC',
    [tenantId],
  );
  const latest = await db.query<CurrentPack & { route_id: string }>(
    'SELECT DISTINCT ON(route_id) id,route_id,version,status,configuration FROM app.corridor_pack_version WHERE tenant_id=$1 ORDER BY route_id,version DESC',
    [tenantId],
  );
  const contents = await db.query<ContentRow>(
    'SELECT DISTINCT ON(route_id) id,route_id,version,pack_id,document,created_at,created_by,reason FROM app.route_pack_content WHERE tenant_id=$1 ORDER BY route_id,version DESC',
    [tenantId],
  );
  return {
    routes: routes.rows,
    markets: new Set(markets.rows.map((row) => row.key)),
    packs: new Map(packs.rows.map((row) => [row.route_id, row])),
    latestPacks: new Map(latest.rows.map((row) => [row.route_id, row])),
    contents: new Map(
      contents.rows.map((row) => [
        row.route_id,
        { ...row, document: parseContentDocument(row.document) },
      ]),
    ),
  };
}
// One snapshot of every route of the workspace with its current pack and latest content, for the sheet and the service.
// routes is keyed by route key (ORIGIN-DESTINATION); packs and contents by route id. Callers hold the corridor lock when they
// write from it. Reads the content table, so call it only while the module is active.
export async function loadRoutePackState(db: DatabaseClient, tenantId: string) {
  const state = await readState(db, tenantId);
  return {
    routes: new Map(state.routes.map((route) => [`${route.origin}-${route.destination}`, route])),
    markets: state.markets,
    packs: new Map(
      [...state.packs].map(([routeId, pack]) => [
        routeId,
        {
          id: pack.id,
          version: pack.version,
          status: pack.status,
          configuration: pack.configuration,
        },
      ]),
    ),
    // The latest pack by version, scheduled or in force: what the go-live check judges.
    latestPacks: new Map(
      [...state.latestPacks].map(([routeId, pack]) => [
        routeId,
        {
          id: pack.id,
          version: pack.version,
          status: pack.status,
          configuration: pack.configuration,
        },
      ]),
    ),
    contents: new Map(
      [...state.contents].map(([routeId, content]) => [
        routeId,
        {
          id: content.id,
          version: content.version,
          document: content.document,
          createdAt: content.created_at.toISOString(),
        },
      ]),
    ),
  };
}
const today = () => new Date().toISOString().slice(0, 10);
const notFound = () => new DomainError(routePackWords.notFound, 404);

export class RoutePackContentService {
  constructor(private pool: DatabasePool) {}
  // Works before the install too, so a page can decide what to show.
  capabilities(ctx: RequestContext): Promise<Capabilities> {
    return withTenant(this.pool, ctx, 'missions.read', ({ db }) => capabilitiesOf(db));
  }
  overview(
    ctx: RequestContext,
    input: unknown = {},
  ): Promise<{
    capabilities: Capabilities;
    customLabels: Record<string, string>;
    routes: RouteView[];
  }> {
    const v = overviewInput.parse(input);
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, role }) => {
      const capabilities = await capabilitiesOf(db);
      if (!active(capabilities)) throw notFound();
      const state = await readState(db, ctx.tenantId);
      const keyOf = new Map(
        state.routes.map((route) => [route.id, `${route.origin}-${route.destination}`]),
      );
      const customLabels = latestCustomLabels(
        [...state.contents.values()].map((content) => ({
          routeKey: keyOf.get(content.route_id) ?? '',
          version: content.version,
          createdAt: content.created_at.toISOString(),
          document: content.document,
        })),
      );
      const routes = v.routeIds
        ? state.routes.filter((route) => v.routeIds?.includes(route.id))
        : state.routes;
      const readiness =
        role === 'owner' || role === 'admin'
          ? await completeReadiness(
              db,
              ctx.tenantId,
              routes.flatMap((route) => state.packs.get(route.id)?.id ?? []),
            )
          : null;
      return {
        capabilities,
        customLabels,
        routes: routes.map((route): RouteView => {
          const pack = state.packs.get(route.id);
          const content = state.contents.get(route.id);
          return {
            routeId: route.id,
            key: `${route.origin}-${route.destination}`,
            origin: route.origin,
            destination: route.destination,
            pack: pack
              ? {
                  id: pack.id,
                  version: pack.version,
                  status: pack.status,
                  configuration: pack.configuration,
                  effectiveFrom: pack.effective_from.toISOString(),
                  createdBy: pack.created_by,
                  reason: pack.reason,
                }
              : null,
            content: content
              ? {
                  id: content.id,
                  version: content.version,
                  packId: content.pack_id,
                  document: content.document,
                  createdAt: content.created_at.toISOString(),
                  createdBy: content.created_by,
                  reason: content.reason,
                }
              : null,
            completeness: deriveCompleteness(
              pack ? { status: pack.status, configuration: pack.configuration } : null,
              content?.document ?? null,
              today(),
            ),
            readiness:
              readiness && pack
                ? { packId: pack.id, completeMissionTypes: readiness.get(pack.id) ?? [] }
                : null,
          };
        }),
      };
    });
  }
  // Content versions of one route, newest first, without their documents.
  history(ctx: RequestContext, input: unknown) {
    const v = routeIdInput.parse(input);
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, actorId }) => {
      if (!(await routePackContentActive(db))) throw notFound();
      const rows = (
        await db.query<Omit<ContentRow, 'route_id' | 'document'>>(
          'SELECT id,version,pack_id,created_at,created_by,reason FROM app.route_pack_content WHERE tenant_id=$1 AND route_id=$2 ORDER BY version DESC LIMIT 100',
          [ctx.tenantId, v.routeId],
        )
      ).rows;
      return rows.map((row) => ({
        id: row.id,
        version: row.version,
        packId: row.pack_id,
        createdAt: row.created_at.toISOString(),
        createdBy: row.created_by,
        createdByYou: row.created_by === actorId,
        reason: row.reason,
      }));
    });
  }
  // Pack versions of one route with the proposal and decision behind each. Proposals and decisions are readable by owners and
  // admins only, so this read needs the same authority as the Control Center.
  packHistory(ctx: RequestContext, input: unknown) {
    const v = routeIdInput.parse(input);
    return withTenant(this.pool, ctx, 'audit.read', async ({ db, actorId }) => {
      if (!(await routePackContentActive(db))) throw notFound();
      const rows = (
        await db.query<{
          pack_id: string;
          version: number;
          status: PackStatus;
          effective_from: Date;
          reason: string;
          published_by: string;
          proposed_by: string | null;
          proposal_reason: string | null;
          decision_reason: string | null;
        }>(
          `SELECT p.id AS pack_id,p.version,p.status,p.effective_from,p.reason,p.created_by AS published_by,q.created_by AS proposed_by,
            q.reason AS proposal_reason,d.reason AS decision_reason
           FROM app.corridor_pack_version p
           LEFT JOIN app.configuration_decision d ON d.tenant_id=p.tenant_id AND d.published_pack_id=p.id AND d.decision='PUBLISH'
           LEFT JOIN app.configuration_proposal q ON q.tenant_id=d.tenant_id AND q.id=d.proposal_id
           WHERE p.tenant_id=$1 AND p.route_id=$2 ORDER BY p.version DESC LIMIT 100`,
          [ctx.tenantId, v.routeId],
        )
      ).rows;
      return rows.map((row) => ({
        packId: row.pack_id,
        version: row.version,
        status: row.status,
        effectiveFrom: row.effective_from.toISOString(),
        reason: row.reason,
        publishedBy: row.published_by,
        proposedBy: row.proposed_by,
        proposalReason: row.proposal_reason,
        decisionReason: row.decision_reason,
        reviewed: row.proposed_by !== null,
        proposedAndPublishedByYou: row.proposed_by === actorId && row.published_by === actorId,
      }));
    });
  }
  async append(ctx: RequestContext, input: unknown): Promise<ContentAppendResult> {
    const [result] = (await this.appendBatch(ctx, { items: [input] })).items;
    if (!result) throw notFound();
    return result;
  }
  // All content of one save, in one transaction: either every route's new version is stored or none is.
  appendBatch(ctx: RequestContext, input: unknown): Promise<{ items: ContentAppendResult[] }> {
    const v = appendBatchInput.parse(input);
    return withTenant(this.pool, ctx, 'config.manage', async ({ db, actorId, freshMfa }) => {
      if (!(await routePackContentActive(db))) throw notFound();
      if (!freshMfa) throw stepUpRequired();
      await lockCorridor(db, ctx.tenantId);
      const items = v.items.map((item) => ({
        ...item,
        document: parseContentDocument(item.document),
      }));
      const existing = (
        await db.query<{
          id: string;
          route_id: string;
          version: number;
          pack_id: string | null;
          reason: string;
          same: boolean;
        }>(
          `SELECT c.id,c.route_id,c.version,c.pack_id,c.reason,c.document=i.document AS same
           FROM app.route_pack_content c JOIN jsonb_to_recordset($2::jsonb) AS i(id uuid,document jsonb) ON i.id=c.id
           WHERE c.tenant_id=$1`,
          [ctx.tenantId, JSON.stringify(items.map(({ id, document }) => ({ id, document })))],
        )
      ).rows;
      if (existing.length) {
        const replay = items.map((item) =>
          existing.find(
            (row) =>
              row.id === item.id &&
              row.route_id === item.routeId &&
              row.version === item.version &&
              row.reason === item.reason &&
              row.same,
          ),
        );
        if (replay.some((row) => !row))
          throw new DomainError(routePackWords.commandReused, 409, 'ROUTE_PACK_COMMAND_REUSED');
        return {
          items: replay.flatMap((row) =>
            row
              ? [
                  {
                    id: row.id,
                    routeId: row.route_id,
                    version: row.version,
                    packId: row.pack_id,
                    duplicate: true,
                    warnings: [],
                  },
                ]
              : [],
          ),
        };
      }
      const state = await readState(db, ctx.tenantId);
      for (const item of items) {
        if (!state.routes.some((route) => route.id === item.routeId))
          throw new DomainError('Route unavailable', 404);
        if (item.version !== (state.contents.get(item.routeId)?.version ?? 0) + 1)
          throw new DomainError(routePackWords.contentChanged, 409, 'ROUTE_PACK_CONTENT_CHANGED');
      }
      const after = new Map(
        [...state.contents].map(([routeId, content]) => [routeId, content.document]),
      );
      for (const item of items) after.set(item.routeId, item.document);
      const batchRoutes = new Set(items.map((item) => item.routeId));
      const conflict = customKeyConflicts(after).find((c) =>
        c.routeIds.some((routeId) => batchRoutes.has(routeId)),
      );
      if (conflict)
        throw new DomainError(
          routePackWords.customKeyConflict(conflict.key),
          409,
          'ROUTE_PACK_CUSTOM_KEY_CONFLICT',
        );
      const results: ContentAppendResult[] = [];
      for (const item of items) {
        // Content names the pack in force (the database checks the same); the go-live check judges it and the latest pack.
        const pack = state.packs.get(item.routeId);
        const warnings = warningsOrRefuse(
          judge(
            judgedPacks(pack, state.latestPacks.get(item.routeId)),
            state.contents.get(item.routeId)?.document ?? null,
            { document: item.document },
          ),
        );
        await db.query(
          'INSERT INTO app.route_pack_content(id,tenant_id,route_id,pack_id,version,standard_version,document,reason,created_by) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',
          [
            item.id,
            ctx.tenantId,
            item.routeId,
            pack?.id ?? null,
            item.version,
            item.document,
            item.reason,
            actorId,
          ],
        );
        results.push({
          id: item.id,
          routeId: item.routeId,
          version: item.version,
          packId: pack?.id ?? null,
          duplicate: false,
          warnings,
        });
      }
      return { items: results };
    });
  }
  // A what-if of the go-live check for a pack and content that are not saved yet. Owner and admin, no step-up, as the pack
  // preview.
  goLive(ctx: RequestContext, input: unknown): Promise<GoLiveResult> {
    const v = goLiveInput.parse(input);
    return withTenant(this.pool, ctx, 'audit.read', async ({ db }) => {
      if (!(await routePackContentActive(db))) throw notFound();
      const packs = await packsOf(db, ctx.tenantId, v.routeId);
      const document = await latestDocument(db, ctx.tenantId, v.routeId);
      return judge(packs, document, {
        pack: v.pack,
        document: v.document === undefined ? document : parseContentDocument(v.document),
      });
    });
  }
  // The proposal a reviewed publish created under this id, so a retry can prove it carries the same values.
  proposalOf(ctx: RequestContext, id: string): Promise<ExistingProposal | null> {
    const proposalId = z.uuid().parse(id);
    return withTenant(this.pool, ctx, 'config.manage', async ({ db }) => {
      const row = (
        await db.query<{ base_pack_id: string | null; proposed_pack: unknown; reason: string }>(
          'SELECT base_pack_id,proposed_pack,reason FROM app.configuration_proposal WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, proposalId],
        )
      ).rows[0];
      return row
        ? {
            basePackId: row.base_pack_id,
            reason: row.reason,
            pack: routePack.parse(row.proposed_pack),
          }
        : null;
    });
  }
  async proposalExists(ctx: RequestContext, id: string): Promise<boolean> {
    return (await this.proposalOf(ctx, id)) !== null;
  }
  // A carried communication policy or AI policy reference that is no longer current makes the pack guard refuse every new
  // version. These references are obligations, and a key left out is never removed (ADR-093 B), so only a move to PAUSED
  // drops them, named in removedRefs, which keeps a route pausable. Any other target status is refused with the expired
  // policies named, and nothing is written. The tests are the guard's own; the guard itself is unchanged.
  withoutExpiredRefs(
    ctx: RequestContext,
    configuration: RouteConfiguration,
    status: PackStatus,
  ): Promise<{ configuration: RouteConfiguration; removedRefs: string[]; removedNames: string[] }> {
    return withTenant(this.pool, ctx, 'config.manage', async ({ db }) => {
      const expiredPolicies = (
        await db.query<{ id: string; name: string | null }>(
          `SELECT x AS id,(SELECT 'communication policy '||p.jurisdiction||' '||p.channel||' '||p.contact_purpose||' version '||p.version
             FROM app.communication_policy p WHERE p.tenant_id=$1 AND p.id::text=x) AS name
           FROM unnest($2::text[]) x WHERE NOT EXISTS(SELECT FROM app.communication_policy WHERE tenant_id=$1 AND id::text=x AND effective_from<=now() AND valid_until>now())`,
          [ctx.tenantId, configuration.jurisdictionPolicyRefs],
        )
      ).rows;
      const aiPolicy = configuration.aiPolicyRef
        ? ((
            await db.query<{ name: string; current: boolean }>(
              "SELECT 'AI policy '||p.key||' version '||p.version AS name,(p.effective_from<=now() AND (p.configuration->>'effectiveUntil')::timestamptz>now() AND p.version=(SELECT max(version) FROM app.ai_model_policy n WHERE n.tenant_id=p.tenant_id AND n.key=p.key AND n.effective_from<=now())) AS current FROM app.ai_model_policy p WHERE p.tenant_id=$1 AND p.id::text=$2",
              [ctx.tenantId, configuration.aiPolicyRef],
            )
          ).rows[0] ?? { name: null, current: false })
        : null;
      const expired = [
        ...expiredPolicies,
        ...(configuration.aiPolicyRef && aiPolicy && !aiPolicy.current
          ? [{ id: configuration.aiPolicyRef, name: aiPolicy.name }]
          : []),
      ];
      if (expired.length && status !== 'PAUSED')
        throw new DomainError(
          routePackWords.policyExpired(expired.map((ref) => ref.name ?? ref.id).join(', ')),
          409,
          'ROUTE_PACK_POLICY_EXPIRED',
        );
      const removedRefs = expired.map((ref) => ref.id);
      return {
        configuration: {
          ...configuration,
          jurisdictionPolicyRefs: configuration.jurisdictionPolicyRefs.filter(
            (ref) => !removedRefs.includes(ref),
          ),
          aiPolicyRef:
            configuration.aiPolicyRef && removedRefs.includes(configuration.aiPolicyRef)
              ? null
              : configuration.aiPolicyRef,
        },
        removedRefs,
        removedNames: expired.map((ref) => ref.name ?? ref.id),
      };
    });
  }
}
async function capabilitiesOf(db: DatabaseClient): Promise<Capabilities> {
  return {
    routePackForm: routePackFormOn(),
    contentInstalled: await markerPresent(db, 'app.route_pack_content_installed()'),
    onePersonPublication: await markerPresent(db, 'app.route_pack_one_person_publication()'),
  };
}
const active = (capabilities: Capabilities) =>
  capabilities.routePackForm && capabilities.contentInstalled;
// The mission types of each pack whose 13 readiness dimensions (the database allows only those 13) all have an unexpired,
// not BLOCKED latest observation on that exact pack.
async function completeReadiness(db: DatabaseClient, tenantId: string, packIds: string[]) {
  const result = new Map<string, string[]>();
  if (!packIds.length) return result;
  const rows = (
    await db.query<{ pack_id: string; mission_type: string }>(
      `SELECT r.pack_id,r.mission_type FROM (
         SELECT DISTINCT ON(route_id,mission_type,dimension) pack_id,mission_type,dimension,status,valid_until
         FROM app.route_readiness WHERE tenant_id=$1 ORDER BY route_id,mission_type,dimension,version DESC) r
       WHERE r.pack_id=ANY($2::uuid[]) AND r.valid_until>now() AND r.status<>'BLOCKED'
       GROUP BY r.pack_id,r.mission_type HAVING count(DISTINCT r.dimension)=13 ORDER BY r.mission_type`,
      [tenantId, packIds],
    )
  ).rows;
  for (const row of rows)
    result.set(row.pack_id, [...(result.get(row.pack_id) ?? []), row.mission_type]);
  return result;
}
