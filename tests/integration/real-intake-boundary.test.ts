import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { noticeVersion, realNoticeVersion } from '../../packages/domain/src/missions';

let f: Awaited<ReturnType<typeof fixture>>;
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: 'Hotel towels for hospitality distributors',
  website: '',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Request owner',
  company: 'Hospitality supplier',
  email: 'owner@business.test',
  acknowledged: true,
});
beforeAll(async () => {
  f = await fixture();
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
});
afterAll(async () => {
  await f?.close();
});

test('real canonical preparation selects its notice and remains separate from legacy receipts and commands', () => {
  const legacy = new MissionService(f.runtime, 'real-intake-test-only-secret');
  const real = new MissionService(f.runtime, 'real-intake-test-only-secret', 'real');
  const key = randomUUID();
  const body = { ...brief(), email: 'owner@example.invalid' };
  const oldPlan = legacy.prepareIntake(key, body);
  const plan = real.prepareIntake(key, body);
  expect(oldPlan.noticeVersion).toBe(noticeVersion);
  expect(plan.noticeVersion).toBe(realNoticeVersion);
  expect(plan.receipt).not.toBe(oldPlan.receipt);
  expect(plan.payloadHash).not.toBe(oldPlan.payloadHash);
  expect(real.prepareIntake(key, body)).toEqual(plan);
  const context = {
    issuer: 'https://identity.business.test',
    subject: 'request-owner',
    workspaceId: randomUUID(),
    commandId: key,
  };
  const privatePlan = real.prepareCustomerIntake(context, brief());
  expect(privatePlan.noticeVersion).toBe(realNoticeVersion);
  expect(privatePlan.key).not.toBe(legacy.prepareCustomerIntake(context, body).key);
  expect(privatePlan).not.toHaveProperty('receipt');
});

test('choosing real server validation cannot bypass a synthetic-only database or persist a partial request', async () => {
  const legacy = new MissionService(f.runtime, 'real-intake-test-only-secret');
  const real = new MissionService(f.runtime, 'real-intake-test-only-secret', 'real');
  await expect(legacy.submit(randomUUID(), brief())).rejects.toThrow();
  await expect(real.submit(randomUUID(), brief())).rejects.toMatchObject({ code: '23514' });
  expect(
    (await f.owner.query('SELECT count(*)::int AS count FROM app.mission')).rows[0].count,
  ).toBe(0);
  expect(
    (await f.owner.query('SELECT count(*)::int AS count FROM app.mission_intake')).rows[0].count,
  ).toBe(0);
});
