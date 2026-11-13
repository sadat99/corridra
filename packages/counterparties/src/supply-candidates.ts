import { createHash } from 'node:crypto';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError, stepUpRequired } from '@corridra/domain';
import { canonicalJson } from '@corridra/domain/counterparty-profiles';
import {
  addCandidate,
  addSourceVersion,
  blockCompany,
  createSource,
  importMeta,
  liftCompany,
  matchCandidate,
  reviewCandidate,
  supplyId,
  supplyKindsOnRoute,
  supplyList,
  supplyWords,
  type SupplySourceKind,
} from '@corridra/domain/supply-sources';

// ADR-082 slice S3: staff work on the source registry, counterparty candidates, the supply file import, review and match
// decisions, and the company do-not-contact record. Every write is one SECURITY DEFINER command function of the supply sources
// module, which checks the role, the paused control, the stale version and the exact retry. A candidate is what one source
// reported about a company: it reads "source-reported", never verified. With the S3 file not installed every call answers that
// supply sources are not available. The web route parses a file and passes its rows here, so this package never reads files.
export const SUPPLY_CANDIDATES_UNAVAILABLE = 'SUPPLY_UNAVAILABLE';

/** The candidate tables exist only once 0002 is installed. Probed in the caller's transaction, before any function is parsed. */
async function candidatesInstalled(t: TenantTransaction) {
  const probe = await t.db.query<{ installed: boolean }>(
    "SELECT to_regclass('app.supply_candidate') IS NOT NULL AND to_regclass('app.counterparty_profile_version') IS NOT NULL AS installed",
  );
  return probe.rows[0]?.installed === true;
}

// The exact words the SQL raises, answered as a conflict rather than a server error.
const refusals = new Set<string>(
  (Object.values(supplyWords) as unknown[]).filter(
    (word): word is string => typeof word === 'string',
  ),
);

type Guard = <T>(work: () => Promise<T>) => Promise<T>;
const guarded: Guard = async (work) => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const message = error instanceof Error ? error.message : '';
    const code = (error as { code?: string }).code;
    if (code === '42501') throw new DomainError('Access denied', 403);
    if (refusals.has(message)) throw new DomainError(message, 409);
    throw error;
  }
};

const hashOf = (action: string, value: Record<string, unknown>) =>
  createHash('sha256')
    .update(canonicalJson({ action, ...value }))
    .digest('hex');
const without = (v: { commandId: string } & Record<string, unknown>) =>
  Object.fromEntries(Object.entries(v).filter(([key]) => key !== 'commandId'));
export type SupplyCommandResult = Record<string, unknown>;
export type SupplySourceRow = {
  id: string;
  kind: SupplySourceKind;
  createdAt: string;
  versionId: string;
  version: number;
  status: 'no_agreement' | 'active' | 'paused' | 'expired' | 'retired';
  label: string;
  sourceRecordId: string | null;
  defaultRetentionMonths: number;
  agreementEndsAt: string | null;
  reason: string;
};
export type SupplyCandidateRow = {
  id: string;
  missionId: string;
  profileVersionId: string;
  sourceVersionId: string;
  sourceKind: SupplySourceKind;
  sourceLabel: string;
  sourceVersion: number;
  method: 'manual' | 'file_import' | 'partner_submission' | 'connector';
  /** Always "source-reported". Nothing in this module is verified. */
  state: 'source-reported';
  companyName: string | null;
  country: string;
  websiteHost: string | null;
  publicIdentifier: string | null;
  nominationNote: string | null;
  sizeBand: string | null;
  counterpartyTypes: string[];
  warnings: string[];
  observedAt: string;
  retentionUntil: string;
  expired: boolean;
  licenceScope: 'internal_only' | 'publication';
  createdAt: string;
  latestReview: { decision: string; reasonCode: string; at: string } | null;
  latestMatch: { id: string; decision: string; organisationId: string; at: string } | null;
  /** The newest un-reversed MATCH, the only decision that can be reversed. Null when there is none. */
  currentMatch: { id: string; decision: string; organisationId: string; at: string } | null;
};
export type SupplyCandidateDetail = SupplyCandidateRow & {
  reviews: {
    id: string;
    decision: string;
    reasonCode: string;
    reason: string;
    reviewer: string;
    at: string;
  }[];
  matches: {
    id: string;
    decision: string;
    organisationId: string;
    organisationName: string | null;
    reverseOf: string | null;
    reason: string;
    decidedBy: string;
    at: string;
    reversed: boolean;
  }[];
};
export type SupplyMissionRow = {
  id: string;
  status: string;
  nextAction: string;
  createdAt: string;
  candidates: number;
  candidatesLive: number;
  profileVersion: number | null;
};
export type SupplyBlockRow = {
  id: string;
  state: 'BLOCKED' | 'LIFTED';
  organisationId: string | null;
  organisationName: string | null;
  nameKey: string | null;
  country: string | null;
  reason: string;
  reference: string;
  at: string;
  by: string;
  current: boolean;
};

export class SupplyCandidateService {
  constructor(private pool: DatabasePool) {}

  /** One staff write: parse, hash, probe, then the module's command function. An exact retry returns the first result. */
  private async write(
    ctx: RequestContext,
    sql: string,
    params: (tenantId: string) => unknown[],
  ): Promise<SupplyCommandResult> {
    return withTenant(this.pool, ctx, 'research.manage', async (t) => {
      if (!(await candidatesInstalled(t)))
        throw new DomainError(supplyWords.notInstalled, 409, SUPPLY_CANDIDATES_UNAVAILABLE);
      return guarded(async () => {
        const done = await t.db.query<{ result: SupplyCommandResult }>(
          `SELECT ${sql} AS result`,
          params(t.tenantId),
        );
        return done.rows[0]!.result;
      });
    });
  }

  /** A staff read, answered while the module is paused. */
  private async read<T>(
    ctx: RequestContext,
    work: (t: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return withTenant(this.pool, ctx, 'research.read', async (t) => {
      if (!(await candidatesInstalled(t)))
        throw new DomainError(supplyWords.notInstalled, 409, SUPPLY_CANDIDATES_UNAVAILABLE);
      return guarded(() => work(t));
    });
  }

  // ---- source registry -----------------------------------------------------------------------------------------------

  /** A new source and its version 1. Activating a kind that needs an agreement takes an owner or admin with fresh MFA. */
  async createSource(ctx: RequestContext, input: unknown) {
    const v = createSource.parse(input);
    const hash = hashOf('create_source', without(v));
    return this.write(
      ctx,
      'app.supply_create_source($1,$2,$3,$4,$5,$6::uuid,$7,$8::timestamptz,$9,$10)',
      (tenant) => [
        tenant,
        v.commandId,
        hash,
        v.kind,
        v.label,
        v.sourceRecordId ?? null,
        v.defaultRetentionMonths,
        v.agreementEndsAt ?? null,
        v.status,
        v.reason,
      ],
    ) as Promise<{ sourceId: string; sourceVersionId: string; version: number }>;
  }

  /** The next version of a source. Pause, resume and retire are this command with another status. */
  async addSourceVersion(ctx: RequestContext, input: unknown) {
    const v = addSourceVersion.parse(input);
    const hash = hashOf('add_source_version', without(v));
    return this.write(
      ctx,
      'app.supply_add_source_version($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10::timestamptz,$11)',
      (tenant) => [
        tenant,
        v.commandId,
        hash,
        v.sourceId,
        v.expectedVersion,
        v.status,
        v.label,
        v.sourceRecordId ?? null,
        v.defaultRetentionMonths,
        v.agreementEndsAt ?? null,
        v.reason,
      ],
    ) as Promise<{ sourceId: string; sourceVersionId: string; version: number }>;
  }

  /** Every source of the tenant with its latest version, newest first. Readable while the module is paused. */
  async listSources(ctx: RequestContext): Promise<SupplySourceRow[]> {
    return this.read(ctx, async (t) => {
      const rows = await t.db.query<SupplySourceRow>(
        `SELECT s.id,s.kind,s.created_at AS "createdAt",v.id AS "versionId",v.version,v.status,v.label,v.source_record_id AS "sourceRecordId",
          v.default_retention_months AS "defaultRetentionMonths",v.agreement_ends_at AS "agreementEndsAt",v.reason
         FROM app.supply_source s JOIN LATERAL (SELECT * FROM app.supply_source_version x WHERE x.tenant_id=s.tenant_id AND x.source_id=s.id ORDER BY x.version DESC LIMIT 1) v ON true
         WHERE s.tenant_id=$1 ORDER BY s.created_at DESC,s.id LIMIT 200`,
        [t.tenantId],
      );
      return rows.rows;
    });
  }

  /** Every version of one source, newest first. */
  async sourceVersions(ctx: RequestContext, sourceId: unknown) {
    const id = supplyId.parse(sourceId);
    return this.read(ctx, async (t) => {
      const rows = await t.db.query(
        `SELECT id,source_id AS "sourceId",version,status,label,source_record_id AS "sourceRecordId",default_retention_months AS "defaultRetentionMonths",
          agreement_ends_at AS "agreementEndsAt",reason,created_by AS "createdBy",created_at AS "createdAt"
         FROM app.supply_source_version WHERE tenant_id=$1 AND source_id=$2 ORDER BY version DESC LIMIT 100`,
        [t.tenantId, id],
      );
      return rows.rows;
    });
  }

  /**
   * The source kinds a mission's route offers (ADR-082 section 5): staff research always; any other kind only when the mission's
   * current route assignment points at a TESTING, LIMITED or ACTIVE pack whose source categories list it.
   */
  async kindsOnRoute(ctx: RequestContext, missionId: unknown): Promise<SupplySourceKind[]> {
    const id = supplyId.parse(missionId);
    return this.read(ctx, async (t) => {
      const pack = await t.db.query<{
        pack: { status: string; sourceCategories: string[] } | null;
      }>('SELECT app.supply_route_pack($1,$2) AS pack', [t.tenantId, id]);
      const found = pack.rows[0]?.pack ?? null;
      return supplyKindsOnRoute(
        found
          ? { status: found.status, configuration: { sourceCategories: found.sourceCategories } }
          : null,
      );
    });
  }

  // ---- candidates ------------------------------------------------------------------------------------------------------

  /** One candidate from a public source staff read: its nomination source and one self-declared claim per fact. */
  async addCandidate(ctx: RequestContext, input: unknown) {
    const v = addCandidate.parse(input);
    const hash = hashOf('add_candidate', without(v));
    return this.write(
      ctx,
      'app.supply_add_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9::text,$10::text,$11::text,$12::text[],$13::text,$14::timestamptz,$15)',
      (tenant) => [
        tenant,
        v.commandId,
        hash,
        v.missionId,
        v.profileVersionId,
        v.sourceVersionId,
        v.companyName,
        v.country,
        v.websiteHost ?? null,
        v.publicIdentifier ?? null,
        v.sizeBand ?? null,
        v.counterpartyTypes,
        v.nominationNote ?? null,
        v.observedAt,
        v.sourceLocator,
      ],
    ) as Promise<{ candidateId: string; warnings: string[] }>;
  }

  /**
   * The rows of a parsed candidate file (the web route parses it; at most 100 rows). Valid rows land, the others are reported by
   * row number and reason code, never by text. The same bytes for the same mission, source version and profile version return the
   * first batch with `duplicate: true`. Needs the staff_file_import control, which nothing in the build opens.
   */
  async importFile(ctx: RequestContext, input: unknown) {
    const v = importMeta.parse(input);
    const hash = hashOf('import_file', {
      missionId: v.missionId,
      profileVersionId: v.profileVersionId,
      sourceVersionId: v.sourceVersionId,
      digest: v.digest,
    });
    return this.write(ctx, 'app.supply_import_file($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', (tenant) => [
      tenant,
      v.commandId,
      hash,
      v.missionId,
      v.profileVersionId,
      v.sourceVersionId,
      v.digest,
      JSON.stringify(v.rows),
    ]) as Promise<{ batchId: string; accepted: number; rejected: number; duplicate: boolean }>;
  }

  /** The candidates of a mission, newest first. Words are null and `expired` is true once the retention date has passed. */
  async listCandidates(ctx: RequestContext, input: unknown): Promise<SupplyCandidateRow[]> {
    const v = supplyList.extend({ missionId: supplyId }).parse(input);
    return this.read(ctx, async (t) => {
      const rows = await t.db.query<{ rows: SupplyCandidateRow[] }>(
        'SELECT app.supply_candidate_read($1,$2,$3) AS rows',
        [t.tenantId, v.missionId, v.limit],
      );
      return rows.rows[0]?.rows ?? [];
    });
  }

  /** One candidate with its review and match history, or null when it is not of this tenant. */
  async candidate(
    ctx: RequestContext,
    candidateId: unknown,
  ): Promise<SupplyCandidateDetail | null> {
    const id = supplyId.parse(candidateId);
    return this.read(ctx, async (t) => {
      const rows = await t.db.query<{ detail: SupplyCandidateDetail | null }>(
        'SELECT app.supply_candidate_detail($1,$2) AS detail',
        [t.tenantId, id],
      );
      return rows.rows[0]?.detail ?? null;
    });
  }

  /** Missions of the tenant with their candidate counts, newest first. */
  async listMissions(ctx: RequestContext, input: unknown = {}): Promise<SupplyMissionRow[]> {
    const v = supplyList.parse(input);
    return this.read(ctx, async (t) => {
      const rows = await t.db.query<{ rows: SupplyMissionRow[] }>(
        'SELECT app.supply_missions_read($1,$2) AS rows',
        [t.tenantId, v.limit],
      );
      return rows.rows[0]?.rows ?? [];
    });
  }

  /** The file imports of a mission, newest first: counts and per-row reason codes, never row text. */
  async listBatches(ctx: RequestContext, missionId: unknown) {
    const id = supplyId.parse(missionId);
    return this.read(ctx, async (t) => {
      const rows = await t.db.query(
        `SELECT id,source_version_id AS "sourceVersionId",profile_version_id AS "profileVersionId",row_count AS "rowCount",
          accepted_count AS accepted,rejected_count AS rejected,row_results AS "rowResults",created_at AS "createdAt"
         FROM app.supply_import_batch WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at DESC,id LIMIT 50`,
        [t.tenantId, id],
      );
      return rows.rows;
    });
  }

  /** An append-only review: QUALIFIED, WRONG_FIT, DUPLICATE, EXPIRED or REJECTED_SOURCE, with a reason code and a reason. */
  async review(ctx: RequestContext, input: unknown) {
    const v = reviewCandidate.parse(input);
    const hash = hashOf('review_candidate', without(v));
    return this.write(ctx, 'app.supply_review_candidate($1,$2,$3,$4,$5,$6,$7)', (tenant) => [
      tenant,
      v.commandId,
      hash,
      v.candidateId,
      v.decision,
      v.reasonCode,
      v.reason,
    ]) as Promise<{ reviewId: string; candidateId: string }>;
  }

  /** An append-only match, no match or reverse of a candidate against one organisation (the ADR-017 pattern). */
  async match(ctx: RequestContext, input: unknown) {
    const v = matchCandidate.parse(input);
    const hash = hashOf('match_candidate', without(v));
    return this.write(
      ctx,
      'app.supply_match_candidate($1,$2,$3,$4,$5,$6::uuid,$7::uuid,$8)',
      (tenant) => [
        tenant,
        v.commandId,
        hash,
        v.candidateId,
        v.decision,
        v.organisationId ?? null,
        v.reverseOf ?? null,
        v.reason,
      ],
    ) as Promise<{ matchId: string; candidateId: string }>;
  }

  // ---- do not contact ------------------------------------------------------------------------------------------------

  /**
   * A company asked not to be contacted. Works while the module is paused: it protects a third party. The subject is an
   * organisation, a company name and country, or an earlier do-not-contact row, whose subject is then used exactly as recorded.
   */
  async blockCompany(ctx: RequestContext, input: unknown) {
    const v = blockCompany.parse(input);
    const hash = hashOf('block_company', without(v));
    return this.write(
      ctx,
      'app.supply_block_company($1,$2,$3,$4::uuid,$5::text,$6::text,$7,$8,$9::uuid)',
      (tenant) => [
        tenant,
        v.commandId,
        hash,
        v.organisationId ?? null,
        v.companyName ?? null,
        v.country ?? null,
        v.reason,
        v.reference,
        v.blockId ?? null,
      ],
    ) as Promise<{ blockId: string }>;
  }

  /** Lifts a block, by the same three subjects. Owner or admin with fresh MFA; also works while the module is paused. */
  async liftCompany(ctx: RequestContext, input: unknown) {
    const v = liftCompany.parse(input);
    const hash = hashOf('lift_company', without(v));
    return this.write(
      ctx,
      'app.supply_lift_company($1,$2,$3,$4::uuid,$5::text,$6::text,$7,$8,$9::uuid)',
      (tenant) => [
        tenant,
        v.commandId,
        hash,
        v.organisationId ?? null,
        v.companyName ?? null,
        v.country ?? null,
        v.reason,
        v.reference,
        v.blockId ?? null,
      ],
    ) as Promise<{ blockId: string }>;
  }

  /** Block and lift rows, newest first; `current` marks the row that decides for its subject. */
  async listBlocks(ctx: RequestContext, input: unknown = {}): Promise<SupplyBlockRow[]> {
    const v = supplyList.parse(input);
    return this.read(ctx, async (t) => {
      const rows = await t.db.query<{ rows: SupplyBlockRow[] }>(
        'SELECT app.supply_blocks_read($1,$2) AS rows',
        [t.tenantId, v.limit],
      );
      return rows.rows[0]?.rows ?? [];
    });
  }

  // ---- what a screen needs to know before it offers a control ------------------------------------------------------------

  /** Whether the module control is open (false while paused), and the newest profile version of a mission, if it has one. */
  async screenState(
    ctx: RequestContext,
    missionId?: unknown,
  ): Promise<{
    moduleOpen: boolean;
    profile: { id: string; version: number; role: string } | null;
  }> {
    const id = missionId === undefined ? undefined : supplyId.parse(missionId);
    return this.read(ctx, async (t) => {
      const open = await t.db.query<{ open: boolean }>(
        'SELECT app.supply_module_enabled() AS open',
      );
      const profile = id
        ? await t.db.query<{ id: string; version: number; role: string }>(
            'SELECT id,version,role FROM app.counterparty_profile_version WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at DESC LIMIT 1',
            [t.tenantId, id],
          )
        : null;
      return { moduleOpen: open.rows[0]?.open === true, profile: profile?.rows[0] ?? null };
    });
  }

  /**
   * Run before a lift by the web route: a person who may lift but whose authenticator check is old gets the step-up answer
   * (401 STEP_UP_REQUIRED) so the screen can re-verify and retry; a person who may not lift gets Access denied.
   */
  async requireFreshLift(ctx: RequestContext): Promise<void> {
    return withTenant(this.pool, ctx, 'research.manage', async (t) => {
      const who = await t.db.query<{ role: string | null; fresh: boolean | null }>(
        'SELECT app.member_role($1::uuid) AS role,app.fresh_mfa() AS fresh',
        [t.tenantId],
      );
      const row = who.rows[0];
      if (row?.role !== 'owner' && row?.role !== 'admin')
        throw new DomainError('Access denied', 403);
      if (!row.fresh) throw stepUpRequired();
    });
  }
}
