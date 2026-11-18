import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { realStaffFixture, future } from './real-staff-fixture';
import { Probe } from './removed-member-support';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { migrateMemberNotice } from '../../packages/db/src/member-notice-migrate';
import { migrateMemberAccess } from '../../packages/db/src/member-access-migrate';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';

// ADR-087 U5, test 9: the reused writer, customer_private.workspace_access_event in its real-use version, records both an
// app.domain_event and an app.audit_event when a workspace owner reads a member's saved report in a workspace that is not a
// sample, with a real session, real staff delivery and the restricted logins. If it could not, U5 would stop and report to the
// owner instead of adding a mechanism. Fails on main: the module and its functions do not exist there.
const issuer = 'https://ep-real-member-access.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const session = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const hex = (value: string) => createHash('sha256').update(value).digest('hex');
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let W = '';
let resourceId = '';
const as = <T>(who: string, work: (db: DatabaseClient) => Promise<T>) =>
  new Probe(s.f.runtime, s.f.auth, options, session(who)).run(work);
const workspaces = (who: string) => new CustomerWorkspaceService(s.f.runtime, s.f.auth, options, session(who));

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-member-access-secret');
  await migrateCommercialReadiness(s.f.owner);
  await migrateCustomerBooks(s.f.owner);
  await migrateMemberNotice(s.f.owner);
  await migrateMemberAccess(s.f.owner);
  W = (await workspaces('access-owner').provision({ commandId: randomUUID(), name: 'Dhaka sourcing team' })).id;
  const invitation = await workspaces('access-owner').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: W,
    label: 'Invited buyer',
  });
  await workspaces('access-bob').access({ action: 'accept', commandId: randomUUID(), token: invitation.token! });
  const bob = (
    await s.f.owner.query('SELECT principal_id FROM customer_private.workspace_member WHERE tenant_id=$1', [W])
  ).rows[0].principal_id as string;
  // Staff deliver an approved report for bob's request in the real workspace, as in production.
  const missionId = await s.mission('Bob sourcing company');
  const publication = await s.delivery.publication(s.ctx, {
    commandId: randomUUID(),
    missionId,
    title: 'Approved machinery sourcing scope',
    company: 'Bob sourcing company',
    objective: 'Source suppliers',
    brief: 'Approved requirements without private contacts.',
    nextAction: 'Review the approved supplier',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await s.delivery.share(s.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Private report for the requesting customer',
    expiresAt: future(3),
    allowExport: false,
    approved: true,
  });
  const requestId = randomUUID();
  await s.f.owner.query(
    `INSERT INTO customer_private.owned_request(id,principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [requestId, bob, randomUUID(), W, s.intakeTenantId, missionId, randomUUID(), hex(randomUUID()), hex(randomUUID())],
  );
  await new CustomerDeliveryService(s.f.runtime).assign(s.ctx, {
    commandId: randomUUID(),
    requestId,
    linkId: link.id,
    reason: 'Reviewed delivery to the requesting customer',
    approved: true,
  });
  resourceId = (
    await new CustomerSavedMissionService(s.f.runtime, s.f.auth, options, session('access-bob')).command({
      action: 'save',
      commandId: randomUUID(),
      token: link.token,
      acknowledged: true,
    })
  ).id as string;
  await s.f.owner.query(
    `INSERT INTO customer_private.member_notice_delivery(workspace_id,delivered_at,opens_at,delivered_by)
     SELECT $1,t,t+interval '24 hours','member access real test' FROM (SELECT clock_timestamp()-interval '25 hours' AS t) m`,
    [W],
  );
}, 600000);
afterAll(async () => {
  await s?.f.close();
});

test('9. the real-use writer records a domain event and an audit event for an owner read in a real workspace', async () => {
  expect((await s.f.owner.query('SELECT synthetic FROM app.tenant WHERE id=$1', [W])).rows[0].synthetic).toBe(false);
  const owner = (
    await s.f.owner.query("SELECT principal_id FROM customer.membership WHERE tenant_id=$1 AND role='owner'", [W])
  ).rows[0].principal_id as string;
  const listed = await as('access-owner', async (db) =>
    (await db.query('SELECT customer.workspace_saved_missions($1) AS r', [W])).rows[0].r,
  );
  expect(listed.missions.map((m: { id: string }) => m.id)).toEqual([resourceId]);
  const read = await as('access-owner', async (db) =>
    (await db.query('SELECT customer.workspace_saved_mission($1,$2) AS r', [W, resourceId])).rows[0].r,
  );
  expect(read.report.missions[0].title).toBe('Approved machinery sourcing scope');
  const rows = (
    await s.f.owner.query(
      `SELECT e.type,e.payload,e.actor_id,a.actor_id AS audit_actor,a.action,a.tenant_id AS audit_tenant
       FROM app.domain_event e JOIN app.audit_event a ON a.domain_event_id=e.id
       WHERE e.tenant_id=$1 AND e.type='customer.member_item.read' ORDER BY e.occurred_at`,
      [W],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.payload.view)).toEqual(['saved_list', 'saved_report']);
  for (const row of rows) {
    expect(row.payload).toMatchObject({ synthetic: false, initiator_kind: 'customer', initiator_id: owner });
    expect(row.action).toBe('customer.member_item.read');
    expect(row.audit_tenant).toBe(W);
    expect(row.audit_actor).toBe(row.actor_id);
  }
  expect(rows[1].payload.resourceId).toBe(resourceId);
});
