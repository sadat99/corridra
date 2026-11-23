import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only (B11a, owner decision 23 Nov 2026). No request handler imports this module.
// "Corridra founder" becomes the owner of new real requests, then the two sample members lose their roles in the real
// workspace "Corridra request operations" only. The names are fixed here, never taken from input. Nothing is deleted: the
// owner is appended to customer_private.real_intake_owner_version (the one immutable configuration row is never written),
// and a membership is ended by its revoked_at, as the staff team screen does. Sample workspaces, the sample intake
// (app.intake_destination), every user, identity and customer account, and the owner recorded on existing requests stay.
// The way back: append a later owner version that points back, and grant the two memberships again on the staff team screen.
export const realIntakeOwnerPlan = {
  workspace: 'Corridra request operations',
  owner: 'Corridra founder',
  remove: ['Synthetic operator', 'Synthetic reviewer'],
} as const;

export type RealIntakeOwnerResult = {
  state: 'unchanged' | 'dry_run' | 'applied';
  /** Safe to print in a public log: names and 8-character ids only, never an email address. */
  lines: string[];
};

type Member = {
  user_id: string;
  role: string;
  revoked: boolean;
  real_purpose: boolean;
  disabled: boolean;
  country_ok: boolean;
  name: string;
};

const short = (id: string) => id.slice(0, 8);

export async function changeRealIntakeOwner(
  pool: DatabasePool,
  input: unknown,
): Promise<RealIntakeOwnerResult> {
  const value = z
    .object({
      // false is the dry run: a read-only transaction that lists what would change and writes nothing.
      apply: z.boolean(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  const plan = realIntakeOwnerPlan;
  const db = await pool.connect();
  try {
    await db.query(value.apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.real_use_configuration'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:real-intake-owner'))");
    const configuration = (
      await db.query<{ intake_tenant_id: string; executor_id: string; owner_id: string }>(
        'SELECT intake_tenant_id,executor_id,owner_id FROM customer_private.real_use_configuration',
      )
    ).rows[0];
    if (!configuration) throw new Error('Real-use configuration has not been initialized');
    const executor = await db.query(
      "SELECT FROM identity.principal WHERE id=$1 AND kind='service' AND disabled_at IS NULL",
      [configuration.executor_id],
    );
    if (!executor.rowCount) throw new Error('The pinned service identity is not active');
    const workspaces = await db.query<{ id: string }>(
      'SELECT id FROM app.tenant WHERE name=$1 AND NOT synthetic',
      [plan.workspace],
    );
    if (workspaces.rowCount !== 1)
      throw new Error(
        `Expected exactly one real workspace named "${plan.workspace}", found ${workspaces.rowCount}`,
      );
    const workspaceId = workspaces.rows[0]!.id;
    if (workspaceId !== configuration.intake_tenant_id)
      throw new Error(`"${plan.workspace}" is not the real intake workspace`);
    // The lock the staff team screen takes for a member change (AccessService.changeMember), so neither runs on a stale view.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [workspaceId]);
    const members = (
      await db.query<Member>(
        `SELECT m.user_id,m.role,m.revoked_at IS NOT NULL AS revoked,
          'commercial_qualification'=ANY(m.allowed_purposes) AS real_purpose,
          p.disabled_at IS NOT NULL AS disabled,
          p.operating_country=ANY(m.allowed_countries) AS country_ok,u.name
        FROM app.membership m JOIN identity.principal p ON p.id=m.user_id
        JOIN identity."user" u ON u.id=p.identity_id
        WHERE m.tenant_id=$1 ORDER BY m.user_id${value.apply ? ' FOR UPDATE OF m' : ''}`,
        [workspaceId],
      )
    ).rows;
    const owners = members.filter(
      (member) =>
        member.name === plan.owner && !member.revoked && ['owner', 'admin'].includes(member.role),
    );
    if (owners.length !== 1)
      throw new Error(
        `Expected exactly one active owner or admin named "${plan.owner}" in the real workspace, found ${owners.length}`,
      );
    const owner = owners[0]!;
    // The test app.submit_mission applies to a recorded owner (without it real intake would refuse every request), plus the
    // operating country rule of the offline network step, which reads the same owner.
    const failures = (member: Member | undefined) => {
      if (!member || member.revoked || !['owner', 'admin'].includes(member.role))
        return ['not an active owner or admin'];
      return [
        ...(member.disabled ? ['account disabled'] : []),
        ...(member.real_purpose ? [] : ['no real processing purpose']),
        ...(member.country_ok ? [] : ['operating country not allowed']),
      ];
    };
    const verdict = (member: Member | undefined) => {
      const found = failures(member);
      return found.length ? `does not pass: ${found.join(', ')}` : 'passes';
    };
    if (failures(owner).length)
      throw new Error(
        'The new owner needs an active account, the real processing purpose and an allowed operating country in the real workspace',
      );
    const leaving = plan.remove.map((name) => {
      const named = members.filter((member) => member.name === name);
      if (named.length !== 1)
        throw new Error(
          `Expected exactly one member named "${name}" in the real workspace, found ${named.length}`,
        );
      return named[0]!;
    });
    const toRemove = leaving.filter((member) => !member.revoked);
    if (
      toRemove.length &&
      !members.some(
        (member) => member.role === 'owner' && !member.revoked && !toRemove.includes(member),
      )
    )
      throw new Error('The real workspace must keep an active owner');
    // Before the module is installed there is no owner record, and the configuration owner is the owner.
    const installed = (
      await db.query<{ present: boolean }>(
        "SELECT to_regclass('customer_private.real_intake_owner_version') IS NOT NULL AS present",
      )
    ).rows[0]!.present;
    const latest = installed
      ? (
          await db.query<{ id: number; owner_id: string }>(
            'SELECT id,owner_id FROM customer_private.real_intake_owner_version ORDER BY id DESC LIMIT 1',
          )
        ).rows[0]
      : undefined;
    const currentOwnerId = latest?.owner_id ?? configuration.owner_id;
    const ownerChanges = currentOwnerId !== owner.user_id;
    const lines = [`real workspace: ${plan.workspace} (${short(workspaceId)})`];
    // Only the names this operation searched for are printed; every other identity appears as a short id, never by a name
    // read from the database.
    if (ownerChanges)
      lines.push(
        `owner of new real requests: ${value.apply ? 'changed' : 'would change'} from the current owner (${short(currentOwnerId)}) to ${plan.owner} (${short(owner.user_id)})`,
      );
    else lines.push(`owner of new real requests: already ${plan.owner} (${short(owner.user_id)})`);
    // Whether each owner would pass the check real intake applies once an owner is recorded.
    const configurationOwner = members.find((member) => member.user_id === configuration.owner_id);
    lines.push(
      `owner check: configuration owner (${short(configuration.owner_id)}) ${verdict(configurationOwner)}`,
      `owner check: new owner ${plan.owner} (${short(owner.user_id)}) ${verdict(owner)}`,
    );
    // Open work the leaving members still own. A staff update needs an owner who is an active member, and the staff screens
    // then preselect another owner, so the work would move silently. Nothing here reassigns it: the mission guard accepts an
    // owner change only from a signed-in member. The apply refuses until staff have reassigned it on their own screens.
    const open = (
      await db.query<{ missions: number; cases: number; opportunities: number }>(
        `SELECT
          (SELECT count(*) FROM app.mission m WHERE m.tenant_id=$1 AND m.owner_id=ANY($2::uuid[])
            AND m.status NOT IN ('CLOSED','CANCELLED'))::int AS missions,
          (SELECT count(*) FROM app.operations_case c WHERE c.tenant_id=$1 AND c.owner_id=ANY($2::uuid[])
            AND c.state IN ('OPEN','BLOCKED') AND c.version=(SELECT max(v.version) FROM app.operations_case v
            WHERE v.tenant_id=c.tenant_id AND v.key=c.key))::int AS cases,
          (SELECT count(*) FROM app.opportunity o WHERE o.tenant_id=$1 AND o.owner_id=ANY($2::uuid[])
            AND o.status<>'LOST')::int AS opportunities`,
        [workspaceId, leaving.map((member) => member.user_id)],
      )
    ).rows[0]!;
    const counts = `missions ${open.missions}, cases ${open.cases}, opportunities ${open.opportunities}`;
    const blocked = toRemove.length > 0 && open.missions + open.cases + open.opportunities > 0;
    lines.push(`open work owned by the leaving members: ${counts}`);
    if (blocked) {
      if (value.apply)
        throw new Error(
          `Reassign these on the staff screens first: open ${counts} owned by the leaving members`,
        );
      lines.push('apply would refuse: Reassign these on the staff screens first');
    }
    for (const member of leaving)
      lines.push(
        member.revoked
          ? `member: ${member.name} (${short(member.user_id)}) is already removed from the real workspace`
          : `member: ${value.apply ? 'removed' : 'would remove'} ${member.name} (${short(member.user_id)}), role ${member.role}, from the real workspace only`,
      );
    if (!ownerChanges && !toRemove.length) {
      await db.query('ROLLBACK');
      return { state: 'unchanged', lines: [...lines, 'unchanged'] };
    }
    if (!value.apply) {
      await db.query('ROLLBACK');
      return { state: 'dry_run', lines: [...lines, 'nothing written (dry run)'] };
    }
    if (!installed) throw new Error('Install the real intake owner module first');
    // Offline work is attributed to the pinned service identity: the audit trigger accepts no person without a live session.
    await db.query(
      `SELECT set_config('corridra.bootstrap_actor',$1,true),
      set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)`,
      [configuration.executor_id, randomUUID(), randomUUID()],
    );
    // The owner first, so real intake never points at a member who has just been removed.
    if (ownerChanges)
      await db.query(
        'INSERT INTO customer_private.real_intake_owner_version(id,owner_id,set_by,reason) VALUES($1,$2,$3,$4)',
        [(latest?.id ?? 0) + 1, owner.user_id, configuration.executor_id, value.reason],
      );
    for (const member of toRemove) {
      const changed = await db.query(
        'UPDATE app.membership SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [workspaceId, member.user_id],
      );
      if (changed.rowCount !== 1) throw new Error('A membership changed; nothing was written');
    }
    await db.query('COMMIT');
    return { state: 'applied', lines: [...lines, 'applied'] };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
