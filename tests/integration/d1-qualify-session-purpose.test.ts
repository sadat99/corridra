// Team desk v4.1, unit D1. The website always sends the sample purpose (apps/web/app/api/workspace/[action]/route.ts)
// and withTenant swaps it for the workspace's own purpose in the session. Every row a command writes must carry that
// session purpose, never the purpose the caller sent, or a real workspace refuses the row (42501).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { future, realStaffFixture } from './real-staff-fixture';
import { MissionService } from '../../packages/missions/src/index';
import { inviteOperator } from '../../packages/auth/src/operator-invitation';

const websitePurpose = 'synthetic_validation';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
beforeAll(async () => {
  s = await realStaffFixture(
    'https://ep-d1-qualify-purpose.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    'd1-qualify-session-purpose-secret',
  );
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await s?.f.close();
});
const command = (id: string, version: number, action: string, ownerId = s.f.users.owner.id) => ({
  id,
  version,
  commandId: randomUUID(),
  action,
  ownerId,
  reason: 'Reviewed the supplied company details',
  nextAction: 'Review relevant supplier introductions',
  dueAt: future(),
  marketCode: 'CN',
  targetProfile: 'Machinery manufacturers with export experience',
});
// What the qualify step stored for one mission, read as the schema owner.
async function stored(missionId: string) {
  return (
    await s.f.owner.query(
      `SELECT m.status,m.version,c.purpose AS claim_purpose,r.purpose AS source_purpose,
              (SELECT count(*)::int FROM app.source_record x WHERE x.tenant_id=m.tenant_id AND x.locator LIKE 'Mission intake '||m.id||';%') AS sources
         FROM app.mission m
         LEFT JOIN app.commercial_intent i ON i.tenant_id=m.tenant_id AND i.mission_id=m.id
         LEFT JOIN app.claim c ON c.id=i.claim_id
         LEFT JOIN app.source_record r ON r.id=c.source_id
        WHERE m.id=$1`,
      [missionId],
    )
  ).rows[0];
}

test('a real workspace saves Begin Qualification when the caller sends the purpose the website sends', async () => {
  const workspacePurpose: string = (
    await s.f.owner.query('SELECT app.tenant_processing_purpose($1) AS purpose', [s.intakeTenantId])
  ).rows[0].purpose;
  expect(workspacePurpose).not.toBe(websitePurpose);
  const ctx = { ...s.ctx, purpose: websitePurpose };
  const id = await s.draft('Qualification participant');
  await expect(s.missions.command(ctx, command(id, 1, 'assign'))).resolves.toEqual({ version: 2 });
  await expect(s.missions.command(ctx, command(id, 2, 'qualify'))).resolves.toEqual({ version: 3 });
  expect(await stored(id)).toMatchObject({
    status: 'QUALIFICATION',
    source_purpose: workspacePurpose,
    claim_purpose: workspacePurpose,
    sources: 1,
  });
  await expect(s.missions.command(ctx, command(id, 3, 'activate'))).resolves.toEqual({
    version: 4,
  });
  await expect(s.missions.command(ctx, command(id, 4, 'targeting'))).resolves.toEqual({
    version: 5,
  });
  expect(await stored(id)).toMatchObject({ status: 'TARGETING', version: 5 });
});

test('a member of another workspace is refused, and the same qualify command then saves once for the owner', async () => {
  const ctx = { ...s.ctx, purpose: websitePurpose };
  const id = await s.draft('Refused then retried participant');
  const qualify = command(id, 1, 'qualify');
  // The other workspace's owner names the real workspace with the website's purpose and with the real one.
  for (const purpose of [websitePurpose, s.ctx.purpose])
    await expect(
      s.missions.command({ ...s.f.users.other.ctx, tenantId: s.intakeTenantId, purpose }, qualify),
    ).rejects.toThrow('Access denied');
  expect(await stored(id)).toMatchObject({ status: 'DRAFT', version: 1, sources: 0 });
  expect(
    (await s.f.owner.query('SELECT 1 FROM app.mission_command WHERE id=$1', [qualify.commandId]))
      .rowCount,
  ).toBe(0);
  // The refusal left nothing behind, so the same command key saves, and a repeat returns the same result.
  await expect(s.missions.command(ctx, qualify)).resolves.toEqual({ version: 2 });
  await expect(s.missions.command(ctx, qualify)).resolves.toEqual({ version: 2 });
  expect(await stored(id)).toMatchObject({
    status: 'QUALIFICATION',
    version: 2,
    source_purpose: s.ctx.purpose,
    claim_purpose: s.ctx.purpose,
    sources: 1,
  });
});

test('a sample workspace still saves qualification under its own sample purpose', async () => {
  const sample = new MissionService(s.f.runtime, 'd1-qualify-session-purpose-secret');
  const { id } = await sample.submit(randomUUID(), {
    objective: 'Sell in a new market',
    market: 'Spain',
    attendance: 'Yes',
    startDate: '2027-11-01',
    endDate: '2027-11-07',
    timezone: 'Europe/Madrid',
    offer: `Synthetic hotel towels ${randomUUID()}`,
    website: 'https://example.invalid/catalogue',
    outcomes: ['Relevant meetings'],
    notes: 'Synthetic test only',
    name: 'Test Person',
    company: 'Example Test Company',
    email: 'mission@example.invalid',
    acknowledged: true,
  });
  const owner = s.f.users.owner;
  expect(owner.ctx).toMatchObject({ tenantId: s.f.tenantA, purpose: websitePurpose });
  await expect(
    sample.command(owner.ctx, { ...command(id!, 1, 'qualify'), marketCode: 'ES' }),
  ).resolves.toEqual({ version: 2 });
  expect(await stored(id!)).toMatchObject({
    status: 'QUALIFICATION',
    source_purpose: websitePurpose,
    claim_purpose: websitePurpose,
    sources: 1,
  });
});

// Defence in depth: this does not fail on d7d55c0. Both callers of the invitation insert accept sample workspaces
// only, so a real workspace never reaches it; the insert now states the workspace purpose all the same.
test('a staff invitation is refused in a real workspace and stores the workspace purpose in a sample one', async () => {
  const invitation = (email: string) => ({
    commandId: randomUUID(),
    email,
    name: 'Invited sample operator',
    role: 'operator',
    operatingCountry: 'BD',
  });
  // One pass is enough: inviteOperator sets the sample purpose itself and never reads the caller's.
  await expect(
    inviteOperator(s.f.owner, s.ctx, invitation('real-refused@example.invalid')),
  ).rejects.toThrow('An active owner with fresh MFA must approve the invitation');
  expect(
    (
      await s.f.owner.query(
        'SELECT 1 FROM identity."user" WHERE email=\'real-refused@example.invalid\'',
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    inviteOperator(s.f.owner, s.f.users.owner.ctx, invitation('sample-invited@example.invalid')),
  ).resolves.toMatchObject({ prepared: true });
  const { rows } = await s.f.owner.query(
    `SELECT m.tenant_id,m.allowed_purposes,app.tenant_processing_purpose(m.tenant_id) AS workspace_purpose
       FROM app.membership m JOIN identity.principal p ON p.id=m.user_id JOIN identity."user" u ON u.id=p.identity_id
      WHERE u.email='sample-invited@example.invalid'`,
  );
  expect(rows).toEqual([
    {
      tenant_id: s.f.tenantA,
      allowed_purposes: [websitePurpose],
      workspace_purpose: websitePurpose,
    },
  ]);
});

// The lookup above is guarded by this exact expression. A role without EXECUTE on the function (the real-use
// module grants it to the runtime role only) gets false and keeps the sample purpose instead of a refusal. That
// role cannot reach the invitation at all today (no access to schema app), so the guard is shown on its own.
test('the invitation purpose lookup is skipped for a database role that may not run it', async () => {
  const guard =
    "SELECT coalesce(has_function_privilege(to_regprocedure('app.tenant_processing_purpose(uuid)')::oid,'EXECUTE'),false) AS present,coalesce(has_function_privilege(to_regprocedure('app.no_such_function(uuid)')::oid,'EXECUTE'),false) AS absent";
  expect((await s.f.auth.query(guard)).rows[0]).toEqual({ present: false, absent: false });
  expect((await s.f.runtime.query(guard)).rows[0]).toEqual({ present: true, absent: false });
  expect((await s.f.owner.query(guard)).rows[0]).toEqual({ present: true, absent: false });
  await expect(
    s.f.auth.query('SELECT app.tenant_processing_purpose($1)', [s.f.tenantA]),
  ).rejects.toMatchObject({ code: '42501' });
});
