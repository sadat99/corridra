import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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
    // Two checks, named for what reads them: the intake check is the membership test in app.submit_mission; the network
    // check is that test plus the operating country, as the offline network step applies it.
    const failures = (member: Member | undefined, network: boolean) => {
      if (!member || member.revoked || !['owner', 'admin'].includes(member.role))
        return ['not an active owner or admin'];
      return [
        ...(member.disabled ? ['account disabled'] : []),
        ...(member.real_purpose ? [] : ['no real processing purpose']),
        ...(network && !member.country_ok ? ['operating country not allowed'] : []),
      ];
    };
    const verdict = (member: Member | undefined, network: boolean) => {
      const found = failures(member, network);
      return found.length ? `does not pass: ${found.join(', ')}` : 'passes';
    };
    if (failures(owner, true).length)
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
      `intake check: configuration owner (${short(configuration.owner_id)}) ${verdict(configurationOwner, false)}`,
      `intake check: new owner ${plan.owner} (${short(owner.user_id)}) ${verdict(owner, false)}`,
      `network check: configuration owner (${short(configuration.owner_id)}) ${verdict(configurationOwner, true)}`,
      `network check: new owner ${plan.owner} (${short(owner.user_id)}) ${verdict(owner, true)}`,
    );
    // Open work the leaving members still own. A staff update needs an owner who is an active member, and the staff screens
    // then preselect another owner, so the work would move silently. Nothing here reassigns it: the mission guard accepts an
    // owner change only from a signed-in member. The apply refuses until staff have reassigned it on their own screens.
    // The lock app.submit_mission takes for every request: held from here to the commit, so no real request can land on
    // a member who is being removed while this transaction counts and writes.
    if (value.apply) await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:intake'))");
    // Only the members still to be removed are counted. Blocking kinds are those a staff form would silently move to
    // another owner; the others cannot change owner on an update, so they are shown for information only.
    const open = (
      await db.query<Record<string, number>>(
        `SELECT
          (SELECT count(*) FROM app.mission m WHERE m.tenant_id=$1 AND m.owner_id=ANY($2::uuid[])
            AND m.status NOT IN ('CLOSED','CANCELLED'))::int AS missions,
          (SELECT count(*) FROM app.meeting g WHERE g.tenant_id=$1 AND g.owner_id=ANY($2::uuid[])
            AND g.status IN ('PROPOSED','ACCEPTED','SCHEDULED','RESCHEDULE_REQUIRED'))::int AS meetings,
          (SELECT count(*) FROM app.operations_case c WHERE c.tenant_id=$1 AND c.owner_id=ANY($2::uuid[])
            AND c.state IN ('OPEN','BLOCKED') AND c.version=(SELECT max(v.version) FROM app.operations_case v
            WHERE v.tenant_id=c.tenant_id AND v.key=c.key))::int AS cases,
          (SELECT count(*) FROM app.opportunity o WHERE o.tenant_id=$1 AND o.owner_id=ANY($2::uuid[])
            AND o.status NOT IN ('LOST','CASH_COLLECTED','RECURRING_REVENUE'))::int AS opportunities,
          (SELECT count(*) FROM app.route_readiness r WHERE r.tenant_id=$1 AND r.owner_id=ANY($2::uuid[])
            AND r.version=(SELECT max(v.version) FROM app.route_readiness v WHERE v.tenant_id=r.tenant_id
            AND v.route_id=r.route_id AND v.mission_type=r.mission_type AND v.dimension=r.dimension))::int AS readiness,
          (SELECT count(*) FROM app.follow_up f WHERE f.tenant_id=$1 AND f.owner_id=ANY($2::uuid[])
            AND f.status='OPEN')::int AS follow_ups,
          (SELECT count(*) FROM app.delivery_request d WHERE d.tenant_id=$1
            AND d.owner_id=ANY($2::uuid[]))::int AS delivery_requests,
          (SELECT count(*) FROM app.route_release l WHERE l.tenant_id=$1 AND l.owner_id=ANY($2::uuid[])
            AND l.version=(SELECT max(v.version) FROM app.route_release v WHERE v.tenant_id=l.tenant_id
            AND v.route_id=l.route_id AND v.mission_type=l.mission_type))::int AS releases`,
        [workspaceId, toRemove.map((member) => member.user_id)],
      )
    ).rows[0]!;
    const counts = `missions ${open.missions}, meetings ${open.meetings}, cases ${open.cases}, opportunities ${open.opportunities}, route readiness ${open.readiness}`;
    const blocked =
      open.missions! + open.meetings! + open.cases! + open.opportunities! + open.readiness! > 0;
    lines.push(
      `open work owned by the members to remove: ${counts}`,
      `for information, not blocking: open follow-ups ${open.follow_ups}, delivery requests ${open.delivery_requests}, route releases ${open.releases}`,
    );
    if (blocked) {
      if (value.apply)
        throw new Error(
          `Reassign these on the staff screens first: open ${counts} owned by the members to remove`,
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

export type RealIntakeOwnerInstallPreview = {
  state: 'installed' | 'would be installed' | 'refused';
  refusal?: string;
};

// Read only, for the installer's dry run: whether an install would go through, checked the way the install itself checks
// (the real-use schema is current, and every function this module replaces is still the text its file pins by hash). It
// runs in a read-only transaction that is always rolled back.
export async function previewCustomerRealIntakeOwnerInstall(
  pool: DatabasePool,
): Promise<RealIntakeOwnerInstallPreview> {
  // The same files and hashes the migrator reads (packages/db/src/customer-real-intake-owner-migrate.ts).
  const read = async (family: string) => {
    const directory = new URL(`../../db/${family}/`, import.meta.url);
    const files = new Map<string, { sql: string; hash: string }>();
    for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      files.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
    }
    return files;
  };
  const sources = await read('customer-real-intake-owner-migrations');
  const realUse = await read('customer-real-use-migrations');
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const present = async (name: string) =>
      (
        await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [
          name,
        ])
      ).rows[0]!.present;
    const applied = (await present('customer_real_intake_owner_migrations.applied'))
      ? (
          await db.query<{ name: string; sha256: string }>(
            'SELECT name,sha256 FROM customer_real_intake_owner_migrations.applied',
          )
        ).rows
      : [];
    for (const row of applied)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        return { state: 'refused', refusal: 'Real intake owner migration history mismatch' };
    const waiting = [...sources].filter(([name]) => !applied.some((row) => row.name === name));
    if (!waiting.length) return { state: 'installed' };
    const done = (await present('customer_real_use_migrations.applied'))
      ? (
          await db.query<{ name: string; sha256: string }>(
            'SELECT name,sha256 FROM customer_real_use_migrations.applied',
          )
        ).rows
      : [];
    for (const [name, file] of realUse)
      if (!done.some((row) => row.name === name && row.sha256 === file.hash))
        return { state: 'refused', refusal: 'the customer real-use schema is not current' };
    for (const [, source] of waiting)
      for (const pinned of source.sql.matchAll(
        /pg_get_functiondef\('([^']+)'::regprocedure\),'UTF8'\)\),'hex'\)<>'([a-f0-9]{64})'/g,
      )) {
        const now = await db.query<{ hash: string | null }>(
          "SELECT encode(sha256(convert_to(pg_get_functiondef(to_regprocedure($1)),'UTF8')),'hex') AS hash",
          [pinned[1]],
        );
        if (now.rows[0]?.hash !== pinned[2])
          return {
            state: 'refused',
            refusal: `${pinned[1]!.split('(')[0]} is not the text this module was written against`,
          };
      }
    return { state: 'would be installed' };
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
