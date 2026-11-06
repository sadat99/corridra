import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { MissionService } from '../../packages/missions/src/index';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';

// CRUD G4, archive enforcement. An archived workspace refuses new private requests, invitations and registrations
// and nothing else. Three existing functions get one gate each, only when their live text is the reviewed text. This
// proves the text is exactly the reviewed text plus the gate, that a never-archived workspace behaves exactly as it
// did, that every refusal says what to do next, and that an archive cannot be raced.
const prefix = 'g4par';
const archivedText =
  'This workspace is archived. Restore it to send new private requests, invitations and registrations.';
const archivedOthersText =
  'This workspace is archived and is not accepting new invitations or registrations right now.';
const signatures = {
  request: 'customer.submit_private_request(uuid,uuid,jsonb)',
  access: 'customer.workspace_access_command(uuid,text,jsonb)',
  programme: 'customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)',
} as const;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const gateLines = /workspace_open_guard\(|workspace_archived\(target\)/;
const people = ['alice', 'bob', 'pat'];
let f: Fixture;
let h: ReturnType<typeof harness>;
let missions: MissionService;
const principals: Record<string, string> = {};

const services = () => {
  const session = (person: string) => async () => h.session(person);
  return {
    requests: (person: string) =>
      new CustomerRequestService(f.runtime, f.auth, options, session(person)),
    programmes: (person: string) =>
      new CustomerProgrammeService(f.runtime, f.auth, options, session(person)),
    participants: (person: string) =>
      new CustomerParticipantService(f.runtime, f.auth, options, session(person)),
  };
};
const brief = (label: string) => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: `Synthetic hotel towels ${label}`,
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
});
const prepare = (context: Parameters<MissionService['prepareCustomerIntake']>[0], body: unknown) =>
  missions.prepareCustomerIntake(context, body);

// What a call answered, with ids, tokens and times made comparable between two runs.
async function outcome(label: string, call: () => Promise<unknown>) {
  let value: unknown;
  try {
    value = { ok: await call() };
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    value = { error: { code, message } };
  }
  return [label, normal(value)] as const;
}
const normal = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(Z|\+00:00)/g, '<time>')
      .replace(/[A-Za-z0-9_-]{32,}/g, '<long>')
      .replace(/Synthetic hotel towels (before|after)/g, 'Synthetic hotel towels RUN'),
  ) as unknown;

// The same scripted sequence on a fresh, never-archived workspace: private request, replay and conflict; invitation,
// acceptance, replay, revocation; programme invitation, preview, registration, replay, withdrawal.
async function script(label: string) {
  const s = services();
  const out: (readonly [string, unknown])[] = [];
  const workspaceId = await h.provision('alice', 'Synthetic parity workspace');
  const request = { commandId: randomUUID(), workspaceId, brief: brief(label) };
  out.push(await outcome('submit', () => s.requests('alice').submit(request, prepare)));
  out.push(await outcome('submit replay', () => s.requests('alice').submit(request, prepare)));
  out.push(
    await outcome('submit conflict', () =>
      s
        .requests('alice')
        .submit({ ...request, brief: { ...request.brief, notes: 'Conflicting' } }, prepare),
    ),
  );
  const inviteCommand = randomUUID();
  const invite = {
    action: 'invite' as const,
    commandId: inviteCommand,
    workspaceId,
    label: 'Synthetic invited bob',
  };
  const invited = await h.workspaces('alice').access(invite);
  out.push(['invite', normal(invited)]);
  out.push(await outcome('invite replay', () => h.workspaces('alice').access(invite)));
  const accept = { action: 'accept' as const, commandId: randomUUID(), token: invited.token! };
  const accepted = await h.workspaces('bob').access(accept);
  out.push(['accept', normal(accepted)]);
  out.push(await outcome('accept replay', () => h.workspaces('bob').access(accept)));
  out.push(
    await outcome('accept again', () =>
      h.workspaces('bob').access({ ...accept, commandId: randomUUID() }),
    ),
  );
  out.push(
    await outcome('revoke', () =>
      h.workspaces('alice').access({
        action: 'revoke',
        commandId: randomUUID(),
        workspaceId,
        kind: 'membership',
        targetId: accepted.memberId!,
      }),
    ),
  );
  const programme = await s.programmes('alice').create({
    commandId: randomUUID(),
    workspaceId,
    name: 'Synthetic parity programme',
    reportingPurpose: 'Synthetic planning of a buyer visit for the parity tests',
    acknowledged: true,
  });
  const issued = await s.participants('alice').command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId: programme.id,
    label: 'Synthetic participant invitation',
    acknowledged: true,
  });
  out.push(['programme invite', normal(issued)]);
  out.push(
    await outcome('programme preview', () =>
      s.participants('pat').preview({ token: issued.token }),
    ),
  );
  const registration = await s.participants('pat').command({
    action: 'accept',
    commandId: randomUUID(),
    token: issued.token,
    programmeId: programme.id,
    displayLabel: 'Synthetic participant Pat',
    consented: true,
  });
  out.push(['programme accept', normal(registration)]);
  out.push(
    await outcome('programme withdraw', () =>
      s.participants('pat').command({
        action: 'withdraw',
        commandId: randomUUID(),
        registrationId: registration.id,
        reason: 'Synthetic participant chooses to withdraw',
        acknowledged: true,
      }),
    ),
  );
  return out;
}

const definitions = async (pool: Fixture) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(signatures).map(async ([key, signature]) => [
        key,
        (await pool.owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature]))
          .rows[0].d as string,
      ]),
    ),
  ) as Record<keyof typeof signatures, string>;
const recordedHashes = () => {
  const sql = readFileSync(
    resolve('packages/db/customer-workspace-lifecycle-migrations/0003_archive_enforcement.sql'),
    'utf8',
  );
  return [...sql.matchAll(/<>'([0-9a-f]{64})'/g)].map((match) => match[1]);
};
const installedGuard = async (pool: Fixture) =>
  (
    await pool.owner.query(
      "SELECT to_regclass('customer_private.workspace_lifecycle_control') IS NOT NULL AS present",
    )
  ).rows[0].present as boolean;

// Every function with its text and ACL, every table with a digest of its rows, and the policies, for the schemas the
// customer modules use. Taken before and after an install to prove only the named objects differ.
async function snapshot(pool: Fixture) {
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const functions = (
    await pool.owner.query(
      `SELECT p.oid::regprocedure::text AS name,pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1`,
    )
  ).rows as { name: string; definition: string; acl: string }[];
  const tables = (
    await pool.owner.query(
      `SELECT n.nspname,c.relname,c.relacl::text AS acl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows as { nspname: string; relname: string; acl: string; relrowsecurity: boolean }[];
  const records: Record<string, string> = {};
  for (const row of tables)
    records[`${row.nspname}.${row.relname}`] = (
      await pool.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS d FROM ${quote(row.nspname)}.${quote(row.relname)} t`,
      )
    ).rows[0].d as string;
  const triggers = (
    await pool.owner.query(
      `SELECT t.tgrelid::regclass::text AS relation,t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows as { relation: string; name: string }[];
  const policies = (
    await pool.owner.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  return { functions, tables, records, policies, triggers };
}

beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'synthetic-only-parity-secret');
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerProgrammeLifecycle(f.owner);
  h = harness(f, prefix);
  Object.assign(principals, await h.admit(people));
  for (const person of people)
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person]!,
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
});
afterAll(async () => {
  await f?.close();
});

describe('installing the archive gate on a populated database', () => {
  let before: Awaited<ReturnType<typeof snapshot>>;
  let originals: Record<keyof typeof signatures, string>;
  let beforeRun: Awaited<ReturnType<typeof script>>;

  test('the reviewed hashes in the file are the hashes of a database built in production order', async () => {
    originals = await definitions(f);
    expect(recordedHashes()).toEqual([
      sha(originals.request),
      sha(originals.access),
      sha(originals.programme),
    ]);
  });

  test('install changes only the new objects, the three named function texts and the membership trigger, and the control stays closed', async () => {
    beforeRun = await script('before');
    before = await snapshot(f);
    await migrateCustomerWorkspaceLifecycle(f.owner);
    const after = await snapshot(f);
    expect(
      (await f.owner.query('SELECT customer_private.workspace_lifecycle_open() AS open')).rows[0]
        .open,
    ).toBe(false);
    const replaced = Object.values(signatures) as string[];
    const names = new Set(after.functions.map((row) => row.name));
    for (const row of before.functions) {
      expect(names.has(row.name)).toBe(true);
      const now = after.functions.find((candidate) => candidate.name === row.name)!;
      expect(now.acl).toBe(row.acl);
      if (replaced.includes(row.name)) expect(now.definition).not.toBe(row.definition);
      else expect(now.definition).toBe(row.definition);
    }
    for (const row of before.tables) {
      const now = after.tables.find(
        (candidate) => candidate.nspname === row.nspname && candidate.relname === row.relname,
      )!;
      expect(now).toEqual(row);
      expect(after.records[`${row.nspname}.${row.relname}`]).toBe(
        before.records[`${row.nspname}.${row.relname}`],
      );
    }
    // The only existing trigger that changes is the one on customer.membership (membership_immutable becomes membership_guard);
    // the two deferred owner checks are new, and every other trigger is on a new table.
    const triggerName = (row: { relation: string; name: string }) => `${row.relation}:${row.name}`;
    const existing = new Set(before.triggers.map(triggerName));
    const added = after.triggers.map(triggerName).filter((name) => !existing.has(name));
    expect(
      before.triggers
        .map(triggerName)
        .filter((name) => !after.triggers.map(triggerName).includes(name)),
    ).toEqual(['customer.membership:membership_immutable']);
    expect(added.filter((name) => !name.startsWith('customer_private.workspace_'))).toEqual([
      'customer.membership:membership_guard',
      'customer.membership:membership_one_owner',
      'customer.workspace:workspace_one_owner',
    ]);
    // Policies that existed are unchanged, and the new tables add none.
    expect(after.policies).toEqual(before.policies);
    // Nothing was granted to the application logins on the new tables or functions beyond the two customer functions.
    expect(
      (
        await f.owner.query(
          `SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='customer_private' AND p.proname LIKE 'workspace\\_%' AND has_function_privilege('corridra_runtime',p.oid,'EXECUTE')`,
        )
      ).rows,
    ).toEqual([]);
  });

  test('the new text is exactly the reviewed text plus the gate lines', async () => {
    const now = await definitions(f);
    for (const key of Object.keys(signatures) as (keyof typeof signatures)[]) {
      expect(now[key]).not.toBe(originals[key]);
      const stripped = now[key]
        .split('\n')
        .filter((line) => !gateLines.test(line))
        .join('\n');
      expect(sha(stripped)).toBe(sha(originals[key]));
    }
    // The gates sit where the decision says: requests, invitations, first acceptance, and the programme guard.
    expect(now.request.match(/workspace_open_guard\(target\)/g)).toHaveLength(1);
    expect(now.access.match(/workspace_open_guard\(target\)/g)).toHaveLength(1);
    expect(now.access.match(/workspace_open_guard\(target,false\)/g)).toHaveLength(1);
    expect(now.programme.match(/workspace_archived\(target\)/g)).toHaveLength(1);
  });

  test('a workspace that was never archived behaves exactly as it did before the install', async () => {
    const afterRun = await script('after');
    expect(afterRun).toEqual(beforeRun);
    expect(beforeRun.map(([name]) => name)).toContain('programme withdraw');
    // The script really did something: the first answers were successes, not refusals.
    expect(beforeRun.find(([name]) => name === 'submit')![1]).toHaveProperty('ok');
    expect(beforeRun.find(([name]) => name === 'accept')![1]).toHaveProperty('workspaceId');
  });
});

describe('an archived workspace', () => {
  let workspaceId: string;
  let version = 0;
  let name: string;
  const archive = async () => {
    const result = await h.lifecycle('alice', 'archive', {
      workspaceId,
      expectedVersion: version,
      confirmName: name,
    });
    version = result.version as number;
  };
  const restore = async () => {
    const result = await h.lifecycle('alice', 'restore', { workspaceId, expectedVersion: version });
    version = result.version as number;
  };
  const counts = async () =>
    (
      await f.owner.query(
        `SELECT (SELECT count(*)::int FROM customer_private.owned_request WHERE workspace_id=$1) requests,
        (SELECT count(*)::int FROM customer_private.workspace_invitation WHERE tenant_id=$1) invitations,
        (SELECT count(*)::int FROM customer_private.workspace_member WHERE tenant_id=$1) members,
        (SELECT count(*)::int FROM customer_private.programme_invitation WHERE workspace_id=$1) programme_invitations,
        (SELECT count(*)::int FROM customer_private.programme_registration WHERE workspace_id=$1) registrations`,
        [workspaceId],
      )
    ).rows[0] as Record<string, number>;

  beforeAll(async () => {
    await h.setControl(true);
    name = 'Synthetic archive enforcement workspace';
    workspaceId = await h.provision('alice', name);
  });

  test('refuses new private requests, invitations and registrations, with the archive wording, and writes nothing', async () => {
    const s = services();
    const earlier = {
      commandId: randomUUID(),
      workspaceId,
      brief: brief('earlier'),
    };
    const firstAnswer = await s.requests('alice').submit(earlier, prepare);
    const memberInvite = await h.workspaces('alice').access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic invited before archive',
    });
    const accepted = await h.workspaces('bob').access({
      action: 'accept',
      commandId: randomUUID(),
      token: (
        await h.workspaces('alice').access({
          action: 'invite',
          commandId: randomUUID(),
          workspaceId,
          label: 'Synthetic invited bob',
        })
      ).token!,
    });
    const programme = await s.programmes('alice').create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic archive enforcement programme',
      reportingPurpose: 'Synthetic planning of a buyer visit for the archive tests',
      acknowledged: true,
    });
    const programmeInvite = (label: string) => ({
      action: 'invite' as const,
      commandId: randomUUID(),
      workspaceId,
      programmeId: programme.id,
      label,
      acknowledged: true,
    });
    const issued = await s
      .participants('alice')
      .command(programmeInvite('Synthetic invitation before archive'));
    await archive();
    const before = await counts();

    await expect(
      s
        .requests('alice')
        .submit({ ...earlier, commandId: randomUUID(), brief: brief('new') }, prepare),
    ).rejects.toMatchObject({ code: '55000', message: archivedText });
    await expect(
      h.workspaces('alice').access({
        action: 'invite',
        commandId: randomUUID(),
        workspaceId,
        label: 'Synthetic invited while archived',
      }),
    ).rejects.toMatchObject({ code: '55000', message: archivedText });
    await expect(
      h.workspaces('pat').access({
        action: 'accept',
        commandId: randomUUID(),
        token: memberInvite.token!,
      }),
    ).rejects.toMatchObject({ code: '55000', message: archivedOthersText });
    await expect(
      s.participants('alice').command(programmeInvite('Synthetic invitation while archived')),
    ).rejects.toMatchObject({ code: '23514', message: archivedText });
    await expect(s.participants('pat').preview({ token: issued.token })).rejects.toMatchObject({
      code: '23514',
      message: archivedOthersText,
    });
    await expect(
      s.participants('pat').command({
        action: 'accept',
        commandId: randomUUID(),
        token: issued.token,
        programmeId: programme.id,
        displayLabel: 'Synthetic participant Pat',
        consented: true,
      }),
    ).rejects.toMatchObject({ code: '23514', message: archivedOthersText });
    expect(await counts()).toEqual(before);
    for (const text of [archivedText, archivedOthersText])
      expect(text).not.toMatch(/read-only|read only/i);

    // Everything that already exists is still there and can still be read, repeated or revoked.
    expect(await s.requests('alice').submit(earlier, prepare)).toEqual(firstAnswer);
    const listed = await s.requests('alice').list();
    expect(listed.requests.map((request: { id: string }) => request.id)).toContain(firstAnswer.id);
    expect(
      (await s.participants('alice').list({ workspaceId, programmeId: programme.id })).invitations,
    ).toHaveLength(1);
    await expect(
      h.workspaces('alice').access({
        action: 'revoke',
        commandId: randomUUID(),
        workspaceId,
        kind: 'membership',
        targetId: accepted.memberId!,
      }),
    ).resolves.toMatchObject({ status: 'revoked' });
    await expect(
      h.workspaces('alice').access({
        action: 'revoke',
        commandId: randomUUID(),
        workspaceId,
        kind: 'invitation',
        targetId: memberInvite.invitationId!,
      }),
    ).resolves.toMatchObject({ status: 'cancelled' });

    // Restore reopens all three, and an invitation issued before the archive works again.
    await restore();
    await expect(
      s
        .requests('alice')
        .submit({ ...earlier, commandId: randomUUID(), brief: brief('new') }, prepare),
    ).resolves.toMatchObject({ workspaceId });
    await expect(
      h.workspaces('alice').access({
        action: 'invite',
        commandId: randomUUID(),
        workspaceId,
        label: 'Synthetic invited after restore',
      }),
    ).resolves.toMatchObject({ issued: true });
    await expect(s.participants('pat').preview({ token: issued.token })).resolves.toMatchObject({
      programmeId: programme.id,
    });
    await expect(
      s.participants('pat').command({
        action: 'accept',
        commandId: randomUUID(),
        token: issued.token,
        programmeId: programme.id,
        displayLabel: 'Synthetic participant Pat',
        consented: true,
      }),
    ).resolves.toMatchObject({ programmeId: programme.id });
  });

  test('no migration text calls the archive read-only, and the install changes only the three named functions', () => {
    const directory = resolve('packages/db/customer-workspace-lifecycle-migrations');
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')))
      expect(readFileSync(resolve(directory, file), 'utf8')).not.toMatch(
        /read-only|read only|\u2014/i,
      );
    const sql = readFileSync(resolve(directory, '0003_archive_enforcement.sql'), 'utf8');
    expect([...sql.matchAll(/pg_get_functiondef\('([^']+)'/g)].map((match) => match[1])).toEqual(
      Object.values(signatures),
    );
  });

  test('a registration or request that starts while an archive is uncommitted waits for it and is then refused', async () => {
    const s = services();
    const local = await h.provision('alice', 'Synthetic archive race workspace');
    let racing: Promise<unknown> | undefined;
    let waited = false;
    await h.as('alice', async (db) => {
      await db.query('SELECT customer.workspace_lifecycle_command($1,$2,$3)', [
        randomUUID(),
        'archive',
        JSON.stringify({
          workspaceId: local,
          expectedVersion: 0,
          confirmName: 'Synthetic archive race workspace',
        }),
      ]);
      racing = s
        .requests('alice')
        .submit({ commandId: randomUUID(), workspaceId: local, brief: brief('race') }, prepare)
        .then(
          () => 'submitted',
          (error: unknown) => error,
        );
      for (let attempt = 0; attempt < 40 && !waited; attempt++) {
        const waiting = await f.owner.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock'",
        );
        waited = waiting.rows[0].n > 0;
        if (!waited) await new Promise((done) => setTimeout(done, 100));
      }
    });
    // The request really did block on the lock the uncommitted archive holds; otherwise this proves nothing.
    expect(waited).toBe(true);
    expect(await racing).toMatchObject({ code: '55000', message: archivedText });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.owned_request WHERE workspace_id=$1',
          [local],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('many requests racing an archive end either before it or refused, never after it', async () => {
    const s = services();
    const local = await h.provision('alice', 'Synthetic archive burst workspace');
    const attempts = await Promise.all([
      ...Array.from({ length: 6 }, (_, index) =>
        s
          .requests('alice')
          .submit(
            { commandId: randomUUID(), workspaceId: local, brief: brief('burst ' + index) },
            prepare,
          )
          .then(
            () => 'submitted',
            (error: { code?: string }) => error.code,
          ),
      ),
      h.lifecycle('alice', 'archive', {
        workspaceId: local,
        expectedVersion: 0,
        confirmName: 'Synthetic archive burst workspace',
      }),
    ]);
    const outcomes = attempts.slice(0, 6) as string[];
    for (const result of outcomes) expect(['submitted', '55000']).toContain(result);
    const late = await f.owner.query(
      `SELECT count(*)::int AS n FROM customer_private.owned_request r
      JOIN customer_private.workspace_revision v ON v.tenant_id=r.workspace_id AND v.kind='archive'
      WHERE r.workspace_id=$1 AND r.created_at>v.created_at`,
      [local],
    );
    expect(late.rows[0].n).toBe(0);
    const stored = await f.owner.query(
      'SELECT count(*)::int AS n FROM customer_private.owned_request WHERE workspace_id=$1',
      [local],
    );
    expect(stored.rows[0].n).toBe(outcomes.filter((result) => result === 'submitted').length);
  });
});

describe('refusing to change a function that is not the reviewed text', () => {
  let g: Fixture;
  beforeAll(async () => {
    g = await fixture('corridra_upgrade');
    await migrateCustomerRealUse(g.owner);
    await migrateCustomerProgrammeLifecycle(g.owner);
  });
  afterAll(async () => {
    await g?.close();
  });
  const changeFunction = async (signature: string) => {
    const original = (
      await g.owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature])
    ).rows[0].d as string;
    await g.owner.query(original.replace(/BEGIN\n/, 'BEGIN\n -- changed by someone else\n'));
    return original;
  };

  for (const [key, signature] of Object.entries(signatures))
    test(`a changed ${key} function stops the whole install and nothing is written`, async () => {
      const original = await changeFunction(signature);
      const changed = (await definitions(g))[key as keyof typeof signatures];
      expect(changed).not.toBe(original);
      await expect(migrateCustomerWorkspaceLifecycle(g.owner)).rejects.toThrow(
        `Workspace lifecycle prerequisite differs: ${signature.split('(')[0]}`,
      );
      expect(await installedGuard(g)).toBe(false);
      expect(
        (
          await g.owner.query(
            "SELECT to_regclass('customer_workspace_lifecycle_migrations.applied') IS NOT NULL AS present",
          )
        ).rows[0].present,
      ).toBe(false);
      expect((await definitions(g))[key as keyof typeof signatures]).toBe(changed);
      // Put the reviewed text back for the next case.
      await g.owner.query(original);
    });
});

describe('an optional module that is not installed', () => {
  test('is skipped cleanly: the programme guard is absent and stays absent, and the other two are changed', async () => {
    const g = await fixture('corridra_restore');
    try {
      await migrateCustomerRealUse(g.owner);
      const absent = async () =>
        (
          await g.owner.query(
            "SELECT to_regprocedure('customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)') IS NULL AS absent",
          )
        ).rows[0].absent as boolean;
      expect(await absent()).toBe(true);
      await migrateCustomerWorkspaceLifecycle(g.owner);
      expect(await installedGuard(g)).toBe(true);
      expect(await absent()).toBe(true);
      for (const signature of [signatures.request, signatures.access])
        expect(
          (await g.owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature]))
            .rows[0].d,
        ).toContain('workspace_open_guard(target');
    } finally {
      await g.close();
    }
  });
});
