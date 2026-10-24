import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';

// The workspace owner of a real workspace changes team roles, a member leaves, and every role reader agrees. The
// sample suite (customer-member-roles) proves the same rules for sample workspaces.
const issuer =
  'https://ep-real-roles-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const sessionFor = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const owner = 'roles-owner';
const people = ['roles-bob', 'roles-carol', 'roles-dave'];
const stranger = 'roles-erin';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let workspaceId: string;
const members: Record<string, string> = {};
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const workspaces = (who = owner) => new CustomerWorkspaceService(...runtime(), sessionFor(who));
const profiles = (who = owner) =>
  new CustomerOrganisationProfileService(...runtime(), sessionFor(who));
const roles = (who = owner) => new CustomerMemberRoleService(...runtime(), sessionFor(who));
const setRole = (
  who: string,
  member: string,
  role: 'admin' | 'member',
  expectedRole: 'admin' | 'member',
) =>
  roles(who).command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: member,
    role,
    expectedRole,
  });
const leave = (who: string) =>
  roles(who).command({ action: 'leave', commandId: randomUUID(), workspaceId });
const canEditProfile = async (who: string) => (await profiles(who).view({ workspaceId })).canEdit;

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-roles-fixture-secret');
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Dhaka Imports team' })
  ).id;
  await workspaces(stranger).provision({
    commandId: randomUUID(),
    name: 'Separate private workspace',
  });
  for (const who of people) {
    const invitation = await workspaces().access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Invited ' + who,
    });
    members[who] = (
      await workspaces(who).access({
        action: 'accept',
        commandId: randomUUID(),
        token: invitation.token!,
      })
    ).memberId!;
  }
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('invited members start as plain members who can only read the company profile; the owner can edit', async () => {
  for (const who of people) {
    expect((await workspaces(who).list()).find((w) => w.id === workspaceId)?.role).toBe('member');
    expect(await canEditProfile(who)).toBe(false);
  }
  expect(await canEditProfile(owner)).toBe(true);
});

test('only the owner changes a role, and the change reaches the workspace list and the profile editor', async () => {
  const before = (
    await s.f.owner.query(
      "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type='customer_workspace_access'",
    )
  ).rows[0].n;
  expect(await setRole(owner, members['roles-bob'], 'admin', 'member')).toEqual({
    workspaceId,
    memberId: members['roles-bob'],
    role: 'admin',
    roleVersion: 1,
  });
  expect((await workspaces('roles-bob').list()).find((w) => w.id === workspaceId)?.role).toBe(
    'admin',
  );
  expect(await canEditProfile('roles-bob')).toBe(true);
  expect(await canEditProfile('roles-carol')).toBe(false);
  const events = (
    await s.f.owner.query(
      "SELECT payload FROM app.domain_event WHERE type='customer.workspace.member.role_changed'",
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].payload).toMatchObject({
    memberId: members['roles-bob'],
    role: 'admin',
    synthetic: false,
    initiator_kind: 'customer',
  });
  const after = (
    await s.f.owner.query(
      "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type='customer_workspace_access'",
    )
  ).rows[0].n;
  expect(after).toBe(before + 1);
});

test('an admin, a plain member and a stranger cannot change roles; a stale request writes nothing', async () => {
  await expect(setRole('roles-bob', members['roles-carol'], 'admin', 'member')).rejects.toThrow(
    /owner required/i,
  );
  await expect(setRole('roles-carol', members['roles-carol'], 'admin', 'member')).rejects.toThrow(
    /owner required/i,
  );
  await expect(setRole(stranger, members['roles-carol'], 'admin', 'member')).rejects.toThrow();
  const before = (
    await s.f.owner.query('SELECT count(*)::int n FROM customer_private.workspace_member_role')
  ).rows[0].n;
  await expect(setRole(owner, members['roles-bob'], 'admin', 'member')).rejects.toThrow();
  expect(
    (await s.f.owner.query('SELECT count(*)::int n FROM customer_private.workspace_member_role'))
      .rows[0].n,
  ).toBe(before);
});

test('a repeated command returns the first answer once, and demoting returns the member to read-only access', async () => {
  const commandId = randomUUID();
  const demote = () =>
    roles().command({
      action: 'set_role',
      commandId,
      workspaceId,
      memberId: members['roles-bob'],
      role: 'member',
      expectedRole: 'admin',
    });
  const first = await demote();
  expect(await demote()).toEqual(first);
  expect(await canEditProfile('roles-bob')).toBe(false);
});

test('a member leaves only their own membership and loses all access; nobody else can make them leave', async () => {
  await expect(leave(stranger)).rejects.toThrow(/unavailable/i);
  const left = await leave('roles-dave');
  expect(left).toEqual({ workspaceId, memberId: members['roles-dave'], status: 'left' });
  expect((await workspaces('roles-dave').list()).map((w) => w.id)).not.toContain(workspaceId);
  await expect(leave('roles-dave')).rejects.toThrow(/unavailable/i);
  await expect(setRole(owner, members['roles-dave'], 'admin', 'member')).rejects.toThrow(
    /unavailable/i,
  );
  await expect(profiles('roles-dave').view({ workspaceId })).rejects.toThrow();
  expect((await workspaces('roles-bob').list()).map((w) => w.id)).toContain(workspaceId);
});

test('the original owner has no member row, so cannot be demoted, removed or made to leave', async () => {
  await expect(leave(owner)).rejects.toThrow();
  await expect(
    setRole(owner, '00000000-0000-4000-8000-000000000000', 'member', 'admin'),
  ).rejects.toThrow();
  expect((await workspaces().list()).find((w) => w.id === workspaceId)?.role).toBe('owner');
});
