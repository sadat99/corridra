import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerProgrammeTemplateService } from '../../packages/auth/src/customer-programme-templates';
import { CustomerProgrammePricingService } from '../../packages/auth/src/customer-programme-pricing';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';

// A recurring programme: a captured plan, a series with fixed start dates, editions created from it, the revenue
// view across editions and the exports. Nothing a real organiser creates may read as sample data. The sample suite
// (customer-programme-pricing) proves the same rules for sample workspaces.
const issuer =
  'https://ep-real-series-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
const organiser = 'series-organiser';
const outsider = 'series-outsider';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let workspaceId: string;
let template: { id: string; version: number };
let series: { id: string; version: number };
let firstProgrammeId: string;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const workspaces = (who: string) => new CustomerWorkspaceService(...runtime(), sessionFor(who));
const programmes = (who = organiser) => new CustomerProgrammeService(...runtime(), sessionFor(who));
const templates = (who = organiser) =>
  new CustomerProgrammeTemplateService(...runtime(), sessionFor(who));
const pricing = (who = organiser) =>
  new CustomerProgrammePricingService(...runtime(), sessionFor(who));
const economics = (who = organiser) =>
  new CustomerProgrammeEconomicsService(...runtime(), sessionFor(who));
const stable = <T extends object>(value: T) => ({ ...value, expiresAt: undefined });

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-series-fixture-secret');
  workspaceId = (
    await workspaces(organiser).provision({
      commandId: randomUUID(),
      name: 'Dhaka Trade Association',
    })
  ).id;
  await workspaces(outsider).provision({ commandId: randomUUID(), name: 'Unrelated company' });
  firstProgrammeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Autumn supplier delegation',
      reportingPurpose: 'Prepare the autumn supplier delegation',
      acknowledged: true,
    })
  ).id;
  // The plan comes from a real programme: one cost line, no people and no fees.
  await economics().record({
    commandId: randomUUID(),
    workspaceId,
    programmeId: firstProgrammeId,
    entry: {
      kind: 'ORGANISER_EXPENSE',
      costBasis: 'PLANNED',
      registrationId: null,
      amountMinor: '5000000',
      currency: 'BDT',
      occurredOn: '2026-10-01',
      description: 'Venue hire for each edition',
    },
    acknowledged: true,
  });
  const captured = await templates().capture({ workspaceId, programmeId: firstProgrammeId });
  template = (
    await templates().save({
      commandId: randomUUID(),
      workspaceId,
      expectedVersion: 0,
      templateId: null,
      name: 'Quarterly supplier mission plan',
      description: 'Repeatable plan for each quarterly supplier mission',
      content: captured.content,
      retired: false,
    })
  ).template;
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('a series is saved with fixed start dates and revised by version; a stale save is refused', async () => {
  const save = (over: Record<string, unknown> = {}, commandId = randomUUID()) =>
    pricing().saveSeries({
      commandId,
      workspaceId,
      expectedVersion: 0,
      seriesId: null,
      name: 'Quarterly supplier missions',
      description: 'Three editions of the supplier mission across the year',
      templateId: template.id,
      startDates: ['2027-01-15', '2027-04-15', '2027-07-15'],
      retired: false,
      ...over,
    });
  const commandId = randomUUID();
  const created = await save({}, commandId);
  expect(created.series).toMatchObject({
    version: 1,
    templateId: template.id,
    startDates: ['2027-01-15', '2027-04-15', '2027-07-15'],
    nextEditionDate: '2027-01-15',
    provenance: 'ORGANISER_RECORDED',
  });
  expect(stable(await save({}, commandId))).toMatchObject({ replayed: true });
  series = created.series;
  const revised = await save({
    seriesId: series.id,
    expectedVersion: 1,
    description: 'Three editions of the supplier mission, revised',
  });
  expect(revised.series.version).toBe(2);
  series = revised.series;
  await expect(save({ seriesId: series.id, expectedVersion: 1 })).rejects.toThrow(/changed/i);
  const list = await pricing().seriesList({ workspaceId });
  expect(list.series).toHaveLength(1);
});

test('editions are created from the plan in order with their tasks and cost lines, and none reads as sample data', async () => {
  const create = (editionNo: number, expectedVersion: number) =>
    pricing().createEdition({
      commandId: randomUUID(),
      workspaceId,
      seriesId: series.id,
      expectedVersion,
      editionNo,
      templateVersion: template.version,
      name: 'Quarterly supplier mission edition ' + editionNo,
    });
  const first = await create(1, series.version);
  expect(first.edition).toMatchObject({ editionNo: 1, startDate: '2027-01-15' });
  expect(first.plannedCostsCreated).toBe(1);
  // Editions must be created in order and against the current series version.
  await expect(create(3, series.version)).rejects.toThrow();
  const second = await create(2, series.version);
  expect(second.edition).toMatchObject({ editionNo: 2, startDate: '2027-04-15' });
  const rows = (
    await s.f.owner.query(
      "SELECT description FROM customer_private.programme_ledger_entry WHERE programme_id=ANY($1::uuid[]) AND kind='ORGANISER_EXPENSE'",
      [[first.edition.programmeId, second.edition.programmeId]],
    )
  ).rows;
  expect(rows.length).toBe(2);
  for (const row of rows) expect(row.description).not.toMatch(/synthetic/i);
});

test('the revenue view adds the editions in exact whole units and states that nothing is verified', async () => {
  const revenue = await pricing().revenue({ workspaceId, seriesId: series.id });
  expect(revenue.verified).toBe(false);
  expect(revenue.projection).toBe(false);
  expect(revenue.editions).toHaveLength(2);
  expect(revenue.totals[0]).toMatchObject({
    currency: 'BDT',
    editions: 2,
    plannedCosts: '10000000',
  });
  expect(JSON.stringify(revenue)).not.toMatch(/synthetic/i);
});

test('the owner exports programmes and the ledger; the file carries the real figures; others cannot', async () => {
  const programmesExport = await pricing().exportRows({
    commandId: randomUUID(),
    workspaceId,
    dataset: 'programmes',
  });
  expect(programmesExport.rowCount).toBe(3);
  const ledger = await pricing().exportRows({
    commandId: randomUUID(),
    workspaceId,
    dataset: 'ledger',
    programmeId: firstProgrammeId,
  });
  expect(ledger.rowCount).toBe(1);
  expect(JSON.stringify(ledger.rows)).toContain('5000000');
  expect(JSON.stringify([programmesExport.rows, ledger.rows])).not.toMatch(/synthetic/i);
  await expect(
    pricing(outsider).exportRows({ commandId: randomUUID(), workspaceId, dataset: 'ledger' }),
  ).rejects.toMatchObject({ code: '42501' });
});
