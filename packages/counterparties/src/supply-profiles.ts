import { createHash } from 'node:crypto';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  canonicalJson,
  readCounterpartyProfile,
  profileWords,
  saveCounterpartyProfile,
} from '@corridra/domain/counterparty-profiles';

// ADR-082 section 3.1: staff save and read the structured counterparty profile of a mission. Every write is the one
// SECURITY DEFINER command function of the supply sources module, which checks the role, the closed or paused control,
// the stale version and the exact retry. With the module absent every call answers that supply sources are not available.
export const SUPPLY_UNAVAILABLE = 'SUPPLY_UNAVAILABLE';
export type SupplyState = { installed: boolean; open: boolean };

/** Capability probe in the caller's transaction. The function is only parsed once the module exists. */
export async function supplyState(t: TenantTransaction): Promise<SupplyState> {
  const probe = await t.db.query<{ installed: boolean }>(
    "SELECT to_regclass('app.counterparty_profile_version') IS NOT NULL AS installed",
  );
  if (!probe.rows[0]?.installed) return { installed: false, open: false };
  const control = await t.db.query<{ open: boolean }>('SELECT app.supply_module_enabled() AS open');
  return { installed: true, open: control.rows[0]?.open === true };
}

// The exact words the command function raises, answered as a conflict rather than a server error.
const refusals = new Set<string>([
  profileWords.paused,
  profileWords.missionClosed,
  profileWords.missionUnavailable,
  profileWords.stale,
  profileWords.reused,
]);

const profileColumns = `id,mission_id,role,version,target_profile_id,fields,fields_digest,reason,created_by,created_at`;
const readQuery = readCounterpartyProfile;

export class SupplyProfileService {
  constructor(private pool: DatabasePool) {}

  /** Saves version n+1 of the profile for one mission and role. An exact retry returns the first result. */
  async save(ctx: RequestContext, input: unknown) {
    const v = saveCounterpartyProfile.parse(input);
    const hash = createHash('sha256')
      .update(
        canonicalJson({
          action: 'save_profile',
          missionId: v.missionId,
          role: v.role,
          expectedVersion: v.expectedVersion,
          fields: v.fields,
          reason: v.reason,
          targetProfileId: v.targetProfileId ?? null,
        }),
      )
      .digest('hex');
    return withTenant(this.pool, ctx, 'research.manage', async (t) => {
      const state = await supplyState(t);
      if (!state.installed)
        throw new DomainError(profileWords.notInstalled, 409, SUPPLY_UNAVAILABLE);
      try {
        const saved = await t.db.query<{ result: { profileVersionId: string; version: number } }>(
          'SELECT app.save_counterparty_profile($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) AS result',
          [
            t.tenantId,
            v.commandId,
            hash,
            v.missionId,
            v.role,
            v.expectedVersion,
            JSON.stringify(v.fields),
            v.reason,
            v.targetProfileId ?? null,
          ],
        );
        return saved.rows[0]!.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (refusals.has(message)) throw new DomainError(message, 409);
        throw error;
      }
    });
  }

  /** The newest profile of a mission and role, or null before the first one. Readable while the control is paused. */
  async latest(ctx: RequestContext, input: unknown) {
    const v = readQuery.parse(input);
    return withTenant(this.pool, ctx, 'research.read', async (t) => {
      if (!(await supplyState(t)).installed)
        throw new DomainError(profileWords.notInstalled, 409, SUPPLY_UNAVAILABLE);
      const rows = await t.db.query(
        `SELECT ${profileColumns} FROM app.counterparty_profile_version WHERE tenant_id=$1 AND mission_id=$2 AND role=$3 ORDER BY version DESC LIMIT 1`,
        [t.tenantId, v.missionId, v.role],
      );
      return rows.rows[0] ?? null;
    });
  }

  /** Every version of a mission and role, newest first. Earlier tasks keep the version they were made for. */
  async history(ctx: RequestContext, input: unknown) {
    const v = readQuery.parse(input);
    return withTenant(this.pool, ctx, 'research.read', async (t) => {
      if (!(await supplyState(t)).installed)
        throw new DomainError(profileWords.notInstalled, 409, SUPPLY_UNAVAILABLE);
      const rows = await t.db.query(
        `SELECT ${profileColumns} FROM app.counterparty_profile_version WHERE tenant_id=$1 AND mission_id=$2 AND role=$3 ORDER BY version DESC LIMIT 100`,
        [t.tenantId, v.missionId, v.role],
      );
      return rows.rows;
    });
  }
}
