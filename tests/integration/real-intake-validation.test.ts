import { expect, test } from 'vitest';
import { briefSchema, realBriefSchema, realIntakeSteps } from '../../packages/domain/src/missions';

const request = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Hotel towels for hospitality distributors',
  website: 'https://business.test/catalogue',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Request owner',
  company: 'Hospitality supplier',
  email: 'Owner@business.test',
  acknowledged: true,
});

test('real brief validation accepts normal contact details without opening legacy synthetic admission', () => {
  const value = request();
  expect(realBriefSchema.parse(value).email).toBe('owner@business.test');
  expect(briefSchema.safeParse(value).success).toBe(false);
  expect(briefSchema.safeParse({ ...value, email: 'owner@example.invalid' }).success).toBe(true);
  expect(realIntakeSteps[4].safeParse(value).success).toBe(true);
});

test('real brief validation preserves dates, outcomes, contact and acknowledgement requirements', () => {
  for (const changes of [
    { email: 'not an address' },
    { acknowledged: false },
    { endDate: '2026-10-31' },
    { startDate: '2026-02-30' },
    { outcomes: [] },
    { outcomes: ['Relevant meetings', 'Relevant meetings'] },
    { website: 'javascript:alert(1)' },
  ])
    expect(realBriefSchema.safeParse({ ...request(), ...changes }).success).toBe(false);
});

test('real mission payloads refuse passwords and unrelated account fields', () => {
  for (const field of ['password', 'newPassword', 'sessionToken', 'accountSubject'])
    expect(realBriefSchema.safeParse({ ...request(), [field]: 'not-mission-data' }).success).toBe(
      false,
    );
});
