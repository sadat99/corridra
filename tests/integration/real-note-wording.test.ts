import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerProgrammePricingService } from '../../packages/auth/src/customer-programme-pricing';
import { CustomerProgrammeTemplateService } from '../../packages/auth/src/customer-programme-templates';

// Real-use 0008: the two system-written notes (an organiser fee line and a template's first capacity reason) must not
// call a real workspace's records "Synthetic". Sample workspaces keep the exact old text.
let f: Awaited<ReturnType<typeof fixture>>;
let workspaceId: string;
const issuer =
  'https://ep-note-wording-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
  expiresAt: new Date(Date.now() + 60000),
});
const owner = 'note-owner';
const programmes = () =>
  new CustomerProgrammeService(f.runtime, f.auth, options, sessionFor(owner));
const participants = (who = owner) =>
  new CustomerParticipantService(f.runtime, f.auth, options, sessionFor(who));
const pricing = () =>
  new CustomerProgrammePricingService(f.runtime, f.auth, options, sessionFor(owner));
const templates = () =>
  new CustomerProgrammeTemplateService(f.runtime, f.auth, options, sessionFor(owner));
const newProgramme = async (name: string) =>
  (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name,
      reportingPurpose: 'Prepare the autumn supplier delegation',
      acknowledged: true,
    })
  ).id as string;

beforeAll(async () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'local-bootstrap-fixture',
    executorId: f.serviceId,
    reason: 'Local fixture authority only; never a production customer',
  });
  await f.owner.query(
    "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
    [f.tenantA, f.serviceId, f.users.owner.id],
  );
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Local functional fixture with owner-approved real use and deferred scanning',
  });
  workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, sessionFor(owner)).provision({
      commandId: randomUUID(),
      name: 'Dhaka Imports',
    })
  ).id as string;
}, 180000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

test('the migration is recorded and the sample wording is still in both functions for sample workspaces', async () => {
  const applied = (
    await f.owner.query('SELECT name FROM customer_real_use_migrations.applied ORDER BY name')
  ).rows.map((r: { name: string }) => r.name);
  expect(applied).toContain('0008_real_note_wording.sql');
  for (const [fn, sample] of [
    [
      'customer.programme_bulk_fees_record',
      "'Synthetic participant fee from fee schedule version '",
    ],
    ['customer.programme_template_apply', "'Synthetic capacity from a programme template'"],
  ] as const) {
    const def = (
      await f.owner.query(
        "SELECT pg_get_functiondef(p.oid) d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=$1",
        [fn],
      )
    ).rows[0].d as string;
    expect(def).toContain(sample);
    expect(def).toContain('app.tenant_is_synthetic(target)');
  }
});

test('applying a programme template to a real programme records a capacity reason without the word Synthetic', async () => {
  const programme = await newProgramme('Autumn supplier delegation');
  const saved = await templates().save({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 0,
    templateId: null,
    name: 'Autumn delegation plan',
    description: 'A repeatable plan for the autumn supplier delegation',
    content: {
      reportingPurpose: 'Prepare the autumn supplier delegation',
      capacity: 12,
      tasks: [],
      plannedCosts: [],
    },
    retired: false,
  });
  const templateId =
    (saved as { template?: { id: string }; id?: string }).template?.id ??
    (saved as { id: string }).id;
  await templates().apply({
    commandId: randomUUID(),
    workspaceId,
    programmeId: programme,
    templateId,
    expectedVersion: 1,
    startDate: null,
  });
  const rows = (
    await f.owner.query(
      'SELECT reason,capacity FROM customer_private.programme_capacity_revision WHERE programme_id=$1',
      [programme],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ capacity: 12, reason: 'Capacity from a programme template' });
  expect(rows[0].reason).not.toMatch(/synthetic/i);
});

test('recording participant fees for a real programme writes ledger lines without the word Synthetic', async () => {
  const programme = await newProgramme('Autumn fees programme');
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId: programme,
    label: 'Delegate invitation',
    acknowledged: true,
  });
  const registration = (
    await participants('note-bob').command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId: programme,
      token: invitation.token,
      displayLabel: 'Delegate Bob',
      consented: true,
    })
  ).id as string;
  const template = await pricing().saveTemplate({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 0,
    templateId: null,
    name: 'Standard delegate fees',
    description: 'Standard fee for the autumn delegation',
    content: {
      currency: 'BDT',
      tiers: [{ label: 'Standard delegate fee', amountMinor: '1000000' }],
      earlyBird: [],
      groupDiscounts: [],
    },
    retired: false,
  });
  const templateId =
    (template as { template?: { id: string }; id?: string }).template?.id ??
    (template as { id: string }).id;
  await pricing().applySchedule({
    commandId: randomUUID(),
    workspaceId,
    programmeId: programme,
    expectedScheduleVersion: 0,
    templateId,
    templateVersion: 1,
  });
  await pricing().recordFees({
    commandId: randomUUID(),
    workspaceId,
    programmeId: programme,
    scheduleVersion: 1,
    feeDate: '2026-11-15',
    rows: [{ registrationId: registration, tier: 'Standard delegate fee' }],
  });
  const rows = (
    await f.owner.query(
      "SELECT description,amount_minor::text amount FROM customer_private.programme_ledger_entry WHERE programme_id=$1 AND kind='PARTICIPANT_FEE'",
      [programme],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: '1000000',
    description: 'Participant fee from fee schedule version 1',
  });
  expect(rows[0].description).not.toMatch(/synthetic/i);
});
