import { beforeAll, afterAll, afterEach, test, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { realStaffFixture, future } from './real-staff-fixture';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerCompanyService } from '../../packages/auth/src/customer-companies';
import { CustomerDecisionService } from '../../packages/auth/src/customer-decisions';
import { CustomerAssignedMissionService } from '../../packages/auth/src/customer-assigned-missions';
import {
  realReportPublicLinkEnabled,
  realReportSignedInEnabled,
  realReportsOffMessage,
} from '../../packages/auth/src/real-report-access';

// The owner's two switches for shared reports that belong to real workspaces: the public link (off unless
// CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED is "true") and signed-in access (on unless
// CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED is "false"). With neither set, behaviour is exactly what 0009 gave.
const issuer =
  'https://ep-real-switches-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
const who = 'switch-alice';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let publicDelivery: DeliveryService;
let link: { id: string; token: string };
let publicationId: string;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const saved = () => new CustomerSavedMissionService(...runtime(), sessionFor(who));
const companies = () => new CustomerCompanyService(...runtime(), sessionFor(who));
const decisions = () => new CustomerDecisionService(...runtime(), sessionFor(who));
const assigned = () => new CustomerAssignedMissionService(...runtime(), sessionFor(who));
const view = (token = link.token) =>
  publicDelivery.external({ action: 'view', token, audience: 'CLIENT_PROGRESS' });
const save = (token = link.token) =>
  saved().command({ action: 'save', commandId: randomUUID(), token, acknowledged: true });

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-switches-fixture-secret');
  // Same wiring as the application: the delivery service asks the switch each time.
  publicDelivery = new DeliveryService(
    s.f.runtime,
    s.missions,
    'real-switches-fixture-secret',
    () => realReportPublicLinkEnabled(),
  );
  await new CustomerWorkspaceService(...runtime(), sessionFor(who)).provision({
    commandId: randomUUID(),
    name: 'Switch test company',
  });
  const missionId = await s.mission();
  publicationId = (
    await s.delivery.publication(s.ctx, {
      commandId: randomUUID(),
      missionId,
      title: 'Approved sourcing report',
      company: 'Machinery participant',
      objective: 'Source suppliers',
      brief: 'Approved requirement without private contacts.',
      nextAction: 'Review the approved supplier',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  link = await s.delivery.share(s.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Private report for the participating company',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
}, 240000);
afterEach(() => {
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', undefined as unknown as string);
  vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', undefined as unknown as string);
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
});
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('the helpers read exactly the documented values', () => {
  const real = { DATA_ENVIRONMENT: 'real', CORRIDRA_REAL_USE_ENABLED: 'true' };
  expect(realReportPublicLinkEnabled(real)).toBe(false);
  for (const value of ['TRUE', 'yes', '1', ' true', ''])
    expect(
      realReportPublicLinkEnabled({ ...real, CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED: value }),
    ).toBe(false);
  expect(
    realReportPublicLinkEnabled({ ...real, CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED: 'true' }),
  ).toBe(true);
  expect(
    realReportPublicLinkEnabled({
      DATA_ENVIRONMENT: 'synthetic',
      CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED: 'true',
    }),
  ).toBe(false);
  expect(realReportSignedInEnabled({})).toBe(true);
  expect(realReportSignedInEnabled({ CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED: 'true' })).toBe(true);
  expect(realReportSignedInEnabled({ CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED: 'false' })).toBe(
    false,
  );
});

test('with neither switch set: signed-in access works and the public link is refused (the state before the switches)', async () => {
  await expect(view()).rejects.toThrow(/Link unavailable or expired/);
  const item = await save();
  expect(item.available).toBe(true);
  expect((await saved().list()).missions.some((m: { id: string }) => m.id === item.id)).toBe(true);
});

test('public link on: anyone with the link reads the report, a bad or revoked link does not, and the report holds nothing private', async () => {
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
  const report = (await view()) as { missions: { title: string }[] };
  expect(report.missions[0].title).toBe('Approved sourcing report');
  expect(JSON.stringify(report)).not.toMatch(/Private negotiation details|sales@supplier/i);
  await expect(view('f'.repeat(64))).rejects.toThrow(/Link unavailable or expired/);
  const second = await s.delivery.share(s.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'A second private report link',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  await expect(view(second.token)).resolves.toBeTruthy();
  await s.delivery.revoke(s.ctx, {
    commandId: randomUUID(),
    linkId: second.id,
    publicationId: null,
    reason: 'Revoked to prove a revoked link stops working',
  });
  await expect(view(second.token)).rejects.toThrow(/Link unavailable or expired/);
});

test('public link on: a visitor can answer a staff request through the link', async () => {
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
  const request = await s.delivery.request(s.ctx, {
    commandId: randomUUID(),
    publicationId,
    ownerId: s.f.users.owner.id,
    title: 'Supporting evidence request',
    instructions: 'Send a short written confirmation of the delivery schedule',
    dueAt: future(),
  });
  await publicDelivery.external({
    action: 'respond',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: request.id,
    body: 'The delivery schedule is confirmed for the second week of November',
    acknowledged: true,
  });
  expect(JSON.stringify(await view())).toContain('second week of November');
});

test('public link back off: the same link is refused again, and real use off also closes it', async () => {
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
  await expect(view()).resolves.toBeTruthy();
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'false');
  await expect(view()).rejects.toThrow(/Link unavailable or expired/);
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'false');
  await expect(view()).rejects.toThrow(/Link unavailable or expired/);
});

test('signed-in off: saved reports, companies, decisions and assigned missions all answer that they are switched off', async () => {
  const item = await save();
  vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', 'false');
  const off = { status: 503, message: realReportsOffMessage };
  await expect(save()).rejects.toMatchObject(off);
  await expect(saved().list()).rejects.toMatchObject(off);
  await expect(
    saved().command({ action: 'view', resourceId: item.id, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject(off);
  await expect(companies().list()).rejects.toMatchObject(off);
  await expect(decisions().read(item.id)).rejects.toMatchObject(off);
  await expect(assigned().list()).rejects.toMatchObject(off);
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId: randomUUID(), acknowledged: true }),
  ).rejects.toMatchObject(off);
});

test('the two switches are independent: signed-in off leaves the public link on, and signed-in back on restores access', async () => {
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', 'false');
  await expect(view()).resolves.toBeTruthy();
  await expect(saved().list()).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', 'true');
  await expect(saved().list()).resolves.toBeTruthy();
  vi.stubEnv('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED', 'false');
  await expect(view()).rejects.toThrow(/Link unavailable or expired/);
  await expect(saved().list()).resolves.toBeTruthy();
});

// Calls the database directly through the ordinary customer session, skipping the application guard, to show the
// database itself refuses a real session's share while the switch is off.
class DatabaseProbe extends CustomerSessionBoundary {
  saveInvitation(token: string) {
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.save_mission_invitation($1,$2) AS result', [
            randomUUID(),
            createHash('sha256').update(token).digest('hex'),
          ])
        ).rows[0].result,
    );
  }
}
test('the database refuses a real session share while signed-in is off, even without the application guard', async () => {
  const probe = new DatabaseProbe(...runtime(), sessionFor(who));
  vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', 'false');
  await expect(probe.saveInvitation(link.token)).rejects.toMatchObject({ code: '42501' });
  vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', 'true');
  await expect(probe.saveInvitation(link.token)).resolves.toMatchObject({ available: true });
});

test('the database helper gives the real purpose only to a non-sample tenant and only through a switch', async () => {
  const purpose = async (tenant: string, settings: Record<string, string>) => {
    const db = await s.f.owner.connect();
    try {
      await db.query('BEGIN');
      for (const [key, value] of Object.entries(settings))
        await db.query('SELECT set_config($1,$2,true)', [key, value]);
      const row = (await db.query('SELECT app.delivery_purpose($1) p', [tenant])).rows[0];
      await db.query('ROLLBACK');
      return row.p as string;
    } finally {
      db.release();
    }
  };
  const publicOn = { 'corridra.real_report_public': 'on' };
  expect(await purpose(s.intakeTenantId, publicOn)).toBe('commercial_qualification');
  expect(await purpose(s.intakeTenantId, {})).toBe('synthetic_validation');
  expect(await purpose(s.intakeTenantId, { 'corridra.real_report_public': 'off' })).toBe(
    'synthetic_validation',
  );
  // A sample tenant never gets the real purpose, whatever the setting.
  expect(await purpose(s.f.tenantA, publicOn)).toBe('synthetic_validation');
  // A staff session already names its tenant, so the helper leaves it to the ordinary rule.
  expect(
    await purpose(s.intakeTenantId, { ...publicOn, 'corridra.tenant_id': s.intakeTenantId }),
  ).toBe('commercial_qualification');
  expect(await purpose(s.f.tenantA, { 'corridra.tenant_id': s.f.tenantA })).toBe(
    'synthetic_validation',
  );
});

test('the real-use registry records the switch migration', async () => {
  const applied = (
    await s.f.owner.query('SELECT name FROM customer_real_use_migrations.applied ORDER BY name')
  ).rows.map((r: { name: string }) => r.name);
  expect(applied).toContain('0010_real_report_switches.sql');
});
