import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { dataRights } from '@corridra/domain/policy';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import {
  IntelligenceGateway,
  modelPolicy,
  checkGrounding,
  type GatewayStore,
  type Source,
} from './index';
import { taskInput, registeredTask, taskId } from './registry';
import { SdkInferenceAdapter, adapterId, type InferenceAdapter } from './adapters';
import {
  connectionCommand,
  connectLocationLimit,
  guidedConnection,
  legacyLocationLimit,
} from './connect-form';

const runCommand = z
  .object({
    commandId: z.uuid().toLowerCase(),
    missionId: z.uuid().toLowerCase(),
    policyId: z.uuid().toLowerCase(),
    input: taskInput,
  })
  .strict();
const policyCommand = z
  .object({
    policy: modelPolicy,
    key: z.string().min(3).max(80),
    termsSourceId: z.uuid().toLowerCase(),
    dailyBudgetMinor: z.string().regex(/^[1-9][0-9]{0,5}$/),
    effectiveFrom: z.iso.datetime({ offset: true }),
    reason: z.string().min(3).max(500),
  })
  .strict();
const reviewCommand = z
  .object({
    commandId: z.uuid().toLowerCase(),
    resultId: z.uuid().toLowerCase(),
    decision: z.enum(['ACCEPT', 'EDIT', 'REJECT']),
    editedOutput: z.unknown().optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();
type PolicyCommand = z.infer<typeof policyCommand>;
async function insertPolicy(t: TenantTransaction, v: PolicyCommand) {
  return (
    await t.db.query(
      `INSERT INTO app.ai_model_policy(id,tenant_id,key,version,configuration,terms_source_id,daily_budget_minor,effective_from,created_by,reason) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING id,version`,
      [
        v.policy.id,
        t.tenantId,
        v.key,
        v.policy.version,
        JSON.stringify(v.policy),
        v.termsSourceId,
        v.dailyBudgetMinor,
        v.effectiveFrom,
        t.actorId,
        v.reason,
      ],
    )
  ).rows[0];
}
// The marker the module adds; without it the database still enforces the old limit of 20 countries and sample workspaces only.
async function locationMarker(t: TenantTransaction) {
  const found = await t.db.query(
    "SELECT to_regprocedure('app.ai_model_policy_location_limit()') IS NOT NULL AS present",
  );
  if (!found.rows[0].present) return false;
  return (
    Number((await t.db.query('SELECT app.ai_model_policy_location_limit() AS n')).rows[0].n) >=
    connectLocationLimit
  );
}
async function isRealWorkspace(t: TenantTransaction) {
  const row = (await t.db.query('SELECT synthetic FROM app.tenant WHERE id=$1', [t.tenantId]))
    .rows[0];
  return !row || row.synthetic !== true;
}
// ADR-089. Why a guided connection cannot be made, read as app.guard_ai() reads it: a real workspace needs the module and
// real use switched on (app.real_use_allowed). The database still enforces both; this only answers plainly before the insert.
type ConnectBlock = 'MODULE_NOT_INSTALLED' | 'REAL_USE_OFF';
const connectBlockMessage: Record<ConnectBlock, string> = {
  MODULE_NOT_INSTALLED:
    'Connecting an AI provider is not available for this workspace yet. Ask the owner to install the AI connection module.',
  REAL_USE_OFF:
    'Connecting an AI provider is not available while real use is switched off for this workspace. Ask the owner to switch real use on.',
};
async function connectBlock(
  t: TenantTransaction,
  markerInstalled: boolean,
): Promise<ConnectBlock | null> {
  if (!(await isRealWorkspace(t))) return null;
  if (!markerInstalled) return 'MODULE_NOT_INSTALLED';
  // The module installs only over the real-use modules, so app.real_use_allowed exists whenever the marker does.
  const allowed = await t.db.query('SELECT app.real_use_allowed($1) AS allowed', [t.tenantId]);
  return allowed.rows[0].allowed === true ? null : 'REAL_USE_OFF';
}
// A policy a run can use as a fallback: current, in this workspace and the latest version of its key, the same test
// app.ai_run_authorized applies. An older version of a key passes the guard on insert but never authorizes a run.
const currentLatestPolicy = `p.tenant_id=$1 AND p.effective_from<=now() AND (p.configuration->>'effectiveUntil')::timestamptz>now() AND p.version=(SELECT max(version) FROM app.ai_model_policy latest WHERE latest.tenant_id=p.tenant_id AND latest.key=p.key AND latest.effective_from<=now())`;
// The members of the EU market in force today, as stored. Only country codes are ever kept in a policy.
async function euMembers(t: TenantTransaction) {
  const rows = (
    await t.db.query(
      "SELECT country_code,effective_from::text AS from FROM app.market_member WHERE market_key='EU' AND effective_from<=current_date AND (effective_until IS NULL OR effective_until>current_date) ORDER BY country_code",
    )
  ).rows;
  return {
    codes: rows.map((r) => r.country_code as string),
    recordedOn: rows.map((r) => r.from as string).sort()[rows.length - 1] ?? null,
  };
}
export class IntelligenceService {
  private gateway: IntelligenceGateway;
  constructor(
    private pool: DatabasePool,
    private enabled: boolean,
    adapter: InferenceAdapter = new SdkInferenceAdapter(),
  ) {
    this.gateway = new IntelligenceGateway(adapter, enabled);
  }
  async configure(ctx: RequestContext, raw: unknown) {
    const v = policyCommand.parse(raw);
    return withTenant(this.pool, ctx, 'opportunities.accounting', (t) => insertPolicy(t, v));
  }
  // ADR-089. What the guided Connect AI form needs to draw itself. Reads only; no secret and no key presence.
  // A connection is never its own fallback, because saving it supersedes its own latest version. With an adapter, the
  // fallback candidates leave out that adapter's connection key. Without one (no provider chosen yet), every current
  // candidate is returned with its key, so the screen leaves out the key of the provider chosen later.
  async connectOptions(ctx: RequestContext, rawAdapter?: unknown) {
    const adapter = adapterId.optional().parse(rawAdapter);
    const ownKey = adapter ? `connect-${adapter}` : null;
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const markerInstalled = await locationMarker(t);
      const real = await isRealWorkspace(t);
      const blocked = await connectBlock(t, markerInstalled);
      const latest = (
        await t.db.query(
          `SELECT DISTINCT ON (key) key,id,version,configuration,configuration->>'adapter' AS adapter,configuration->>'model' AS model,configuration->>'effectiveUntil' AS "effectiveUntil",terms_source_id AS "termsSourceId",daily_budget_minor::text AS "dailyBudgetMinor" FROM app.ai_model_policy WHERE tenant_id=$1 ORDER BY key,version DESC LIMIT 50`,
          [t.tenantId],
        )
      ).rows;
      const candidates = (
        await t.db.query(
          `SELECT p.id,p.key,p.version,p.configuration->>'adapter' AS adapter,p.configuration->>'model' AS model FROM app.ai_model_policy p WHERE ${currentLatestPolicy} AND ($2::text IS NULL OR p.key<>$2) ORDER BY p.created_at DESC LIMIT 50`,
          [t.tenantId, ownKey],
        )
      ).rows;
      const eu = await euMembers(t);
      return {
        moduleInstalled: markerInstalled,
        realWorkspace: real,
        canConnect: blocked === null,
        blockedReason: blocked,
        locationLimit: markerInstalled ? connectLocationLimit : legacyLocationLimit,
        latest,
        fallbackFor: ownKey,
        fallbackCandidates: candidates,
        eu: { codes: eu.codes, recordedOn: eu.recordedOn },
      };
    });
  }
  // ADR-089. The guided connection: the same insert as configure, built on the server inside one transaction.
  async connect(ctx: RequestContext, raw: unknown) {
    const v = guidedConnection.parse(raw);
    return withTenant(this.pool, ctx, 'opportunities.accounting', async (t) => {
      const markerInstalled = await locationMarker(t);
      const blocked = await connectBlock(t, markerInstalled);
      if (blocked) throw new DomainError(connectBlockMessage[blocked], 403, blocked);
      const key = `connect-${v.adapter}`;
      const latest = Number(
        (
          await t.db.query(
            'SELECT coalesce(max(version),0)::int AS version FROM app.ai_model_policy WHERE tenant_id=$1 AND key=$2',
            [t.tenantId, key],
          )
        ).rows[0].version,
      );
      if (latest !== v.expectedVersion)
        throw new DomainError(
          'This connection changed since you opened it. Refresh to see the latest version, then try again.',
          409,
        );
      if (v.fallbackPolicyId) {
        const fallback = await t.db.query(
          `SELECT p.key FROM app.ai_model_policy p WHERE ${currentLatestPolicy} AND p.id=$2`,
          [t.tenantId, v.fallbackPolicyId],
        );
        // The new version replaces the latest of its own key, so a fallback of the same key would stop being current at once.
        if (fallback.rows[0]?.key === key)
          throw new DomainError(
            'A connection cannot be its own fallback. Choose another connection or save without one.',
            409,
          );
        if (!fallback.rowCount)
          throw new DomainError(
            'The fallback connection is not a current connection. Refresh and choose a current fallback, or save without one.',
            409,
          );
      }
      let processingLocations: string[];
      if (v.processingScope.kind === 'market') {
        if (!markerInstalled)
          throw new DomainError(
            'EU member countries are not available yet. Choose the countries one by one.',
            409,
          );
        const eu = await euMembers(t);
        if (eu.codes.length < 1 || eu.codes.length > connectLocationLimit)
          throw new DomainError(
            'The EU member list could not be used. Choose the countries one by one.',
            409,
          );
        processingLocations = eu.codes;
      } else {
        processingLocations = [...v.processingScope.codes].sort();
        if (!markerInstalled && processingLocations.length > legacyLocationLimit)
          throw new DomainError(
            `Choose at most ${legacyLocationLimit} countries until the AI connection module is installed.`,
            409,
          );
      }
      for (const [label, id] of [
        ['provider terms', v.termsSourceId],
        ['evaluation record', v.evaluationSourceId],
      ] as const) {
        const ok = await t.db.query(
          'SELECT 1 FROM app.source_record WHERE tenant_id=$1 AND id=$2 AND retention_until>now() AND observed_at<=now() AND app.can_access(tenant_id,classification,purpose)',
          [t.tenantId, id],
        );
        if (!ok.rowCount)
          throw new DomainError(
            `The ${label} source is expired or not available to you. Choose a current source.`,
            400,
          );
      }
      return insertPolicy(
        t,
        policyCommand.parse(
          connectionCommand(v, {
            id: randomUUID(),
            version: latest + 1,
            processingLocations,
            effectiveFrom: new Date().toISOString(),
          }),
        ),
      );
    });
  }
  rights(ctx: RequestContext, raw: unknown) {
    const v = z
        .object({
          id: z.uuid().toLowerCase(),
          version: z.number().int().positive(),
          policy: dataRights,
          effectiveFrom: z.iso.datetime({ offset: true }),
          reason: z.string().min(3).max(500),
        })
        .strict()
        .parse(raw),
      p = v.policy;
    return withTenant(
      this.pool,
      ctx,
      'opportunities.accounting',
      async (t) =>
        (
          await t.db.query(
            `INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,legal_hold,ai_permission,transfer_status,transfer_mechanism,effective_from,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id,version`,
            [
              v.id,
              t.tenantId,
              p.sourceId,
              v.version,
              p.licence,
              p.permittedReuse,
              p.role,
              p.purpose,
              p.classification,
              p.jurisdictions,
              p.subjectLocations,
              p.processingLocations,
              p.retentionUntil,
              p.legalHold,
              p.aiPermission,
              p.transferStatus,
              p.transferMechanism,
              v.effectiveFrom,
              v.reason,
              t.actorId,
            ],
          )
        ).rows[0],
    );
  }
  async sources(ctx: RequestContext, runId: string) {
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const r = await t.db.query('SELECT app.ai_scoped_sources($1,$2) AS sources', [
        t.tenantId,
        runId,
      ]);
      return (r.rows[0]?.sources ?? []).map((s: Source) => ({
        ...s,
        rights: dataRights.parse(s.rights),
      })) as Source[];
    });
  }
  async run(ctx: RequestContext, raw: unknown) {
    ctx = { ...ctx, tenantId: ctx.tenantId.toLowerCase() };
    if (!this.enabled) throw new DomainError('AI assistance is disabled', 503);
    const v = runCommand.parse(raw),
      hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
    const existing = await withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const old = (
        await t.db.query('SELECT * FROM app.ai_run WHERE tenant_id=$1 AND id=$2', [
          t.tenantId,
          v.commandId,
        ])
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash || old.created_by !== t.actorId)
          throw new DomainError('Command key reused', 409);
        return { existing: true };
      }
      await t.db.query(
        'INSERT INTO app.ai_run(id,tenant_id,mission_id,policy_id,task,input,input_hash,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
        [
          v.commandId,
          t.tenantId,
          v.missionId,
          v.policyId,
          v.input.task,
          JSON.stringify(v.input),
          hash,
          t.actorId,
        ],
      );
      return { existing: false };
    });
    // A lost response never causes another inference bill. Refresh reads the saved run.
    if (existing.existing)
      return {
        runId: v.commandId,
        status: 'ALREADY_RECEIVED',
        message:
          'Refresh the review panel for the saved result. A pending request requires manual review.',
      };
    let attemptId: string | undefined;
    const store: GatewayStore = {
      authorize: async () => {
        const sources = await this.sources(ctx, v.commandId);
        const p = await withTenant(
          this.pool,
          ctx,
          'trust.write',
          async (t) =>
            (
              await t.db.query(
                'SELECT configuration FROM app.ai_model_policy WHERE tenant_id=$1 AND id=$2',
                [t.tenantId, v.policyId],
              )
            ).rows[0],
        );
        if (!p) throw new DomainError('Model policy unavailable');
        const primary = modelPolicy.parse(p.configuration);
        const fallback = primary.fallbackPolicyIds.length
          ? await withTenant(
              this.pool,
              ctx,
              'trust.write',
              async (t) =>
                (
                  await t.db.query(
                    'SELECT configuration FROM app.ai_model_policy WHERE tenant_id=$1 AND id=$2',
                    [t.tenantId, primary.fallbackPolicyIds[0]],
                  )
                ).rows[0],
            )
          : null;
        if (primary.fallbackPolicyIds.length && !fallback)
          throw new DomainError('Approved fallback unavailable');
        return {
          tenantId: ctx.tenantId,
          sources,
          models: [primary, fallback?.configuration ?? primary],
        };
      },
      reserve: async (p, worst) => {
        const id = randomUUID();
        try {
          await withTenant(this.pool, ctx, 'trust.write', async (t) =>
            t.db.query(
              'INSERT INTO app.ai_attempt(id,tenant_id,run_id,policy_id,reserved_minor,created_by) VALUES($1,$2,$3,$4,$5,$6)',
              [id, t.tenantId, v.commandId, p.id, worst, t.actorId],
            ),
          );
          attemptId = id;
          return true;
        } catch (e) {
          if ((e as { code?: string }).code === '54000') return false;
          throw e;
        }
      },
      record: async (a, output) => {
        if (!attemptId) throw new DomainError('Missing inference reservation');
        await withTenant(this.pool, ctx, 'trust.write', async (t) =>
          t.db.query(
            'INSERT INTO app.ai_result(id,tenant_id,attempt_id,status,output,metadata,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
            [
              randomUUID(),
              t.tenantId,
              attemptId,
              a.status,
              output ? JSON.stringify(output) : null,
              JSON.stringify(a),
              t.actorId,
            ],
          ),
        );
      },
    };
    const outcome = await this.gateway.execute(v.input, store);
    await withTenant(this.pool, ctx, 'trust.write', async (t) =>
      t.db.query(
        'INSERT INTO app.ai_completion(id,tenant_id,run_id,status,reason_code,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [
          randomUUID(),
          t.tenantId,
          v.commandId,
          outcome.output ? 'DRAFT_READY' : 'MANUAL_REVIEW',
          outcome.output ? 'VALIDATED_DRAFT' : 'PROVIDER_OR_BUDGET_UNAVAILABLE',
          t.actorId,
        ],
      ),
    );
    return { runId: v.commandId, ...outcome };
  }
  async review(ctx: RequestContext, raw: unknown) {
    const v = reviewCommand.parse(raw);
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const row = (
        await t.db.query(
          "SELECT r.output,run.task,run.id AS run_id FROM app.ai_result r JOIN app.ai_attempt a ON a.tenant_id=r.tenant_id AND a.id=r.attempt_id JOIN app.ai_run run ON run.tenant_id=a.tenant_id AND run.id=a.run_id WHERE r.tenant_id=$1 AND r.id=$2 AND r.status='SUCCEEDED'",
          [t.tenantId, v.resultId],
        )
      ).rows[0];
      if (!row) throw new DomainError('Draft unavailable', 404);
      let edited = null;
      if (v.decision === 'EDIT') {
        edited = registeredTask(taskId.parse(row.task)).schema.parse(v.editedOutput);
        const sources = (
          await t.db.query('SELECT app.ai_scoped_sources($1,$2) AS sources', [
            t.tenantId,
            row.run_id,
          ])
        ).rows[0].sources;
        checkGrounding(edited, sources);
      } else if (v.editedOutput !== undefined)
        throw new DomainError('Only an edit can replace a draft', 400);
      await t.db.query(
        'INSERT INTO app.ai_review(id,tenant_id,result_id,decision,edited_output,reason,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
        [
          v.commandId,
          t.tenantId,
          v.resultId,
          v.decision,
          edited ? JSON.stringify(edited) : null,
          v.reason,
          t.actorId,
        ],
      );
      return {
        decision: v.decision,
        authority: 'REVIEWED_DRAFT',
        message: 'Apply any change separately through the existing mission command.',
      };
    });
  }
  workspace(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'trust.write', async (t) => ({
      enabled:
        this.enabled &&
        (await t.db.query("SELECT app.part4_enabled($1,'ai.enabled') AS enabled", [t.tenantId]))
          .rows[0].enabled,
      policies: (
        await t.db.query(
          'SELECT id,key,version,configuration,daily_budget_minor::text FROM app.ai_model_policy WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',
          [t.tenantId],
        )
      ).rows,
      drafts: (
        await t.db.query(
          `SELECT run.id AS run_id,run.mission_id,run.task,r.id AS result_id,coalesce(r.status,completion.status,'PENDING') AS status,r.output,r.metadata,rv.decision,rv.edited_output FROM app.ai_run run LEFT JOIN app.ai_completion completion ON completion.tenant_id=run.tenant_id AND completion.run_id=run.id LEFT JOIN app.ai_attempt a ON a.tenant_id=run.tenant_id AND a.run_id=run.id LEFT JOIN app.ai_result r ON r.tenant_id=a.tenant_id AND r.attempt_id=a.id LEFT JOIN app.ai_review rv ON rv.tenant_id=r.tenant_id AND rv.result_id=r.id WHERE run.tenant_id=$1 ORDER BY run.created_at DESC,a.created_at DESC LIMIT 100`,
          [t.tenantId],
        )
      ).rows,
    }));
  }
}
