import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '../../../../packages/db/src/index';
import { MissionService } from '../../../../packages/missions/src/index';

// WS-C seed hook for the verification server (scripts/qa/verification-server.ts). Only WS-C edits
// this file. Write only "QA test (madeup)" records or @example.invalid addresses, and return what the
// WS-C tests need (ids, never secrets other than local test passwords).
//
// One QA mission submitted through the ordinary public intake (the lead's seed already opened sample
// intake for the QA workspace), so the mission page and its API have a real record to refuse or show.
export async function seed(
  db: DatabasePool,
  base: { tenantId: string; principalId: string },
): Promise<Record<string, unknown>> {
  const missions = new MissionService(db, 'qa-verification-only-secret');
  const submitted = await missions.submit(randomUUID(), {
    objective: 'Sell in a new market',
    market: 'Spain',
    attendance: 'Yes',
    startDate: '2026-11-10',
    endDate: '2026-11-14',
    timezone: 'Europe/Madrid',
    offer: 'QA test (madeup) knitted sweaters for Spanish retailers',
    website: 'https://example.invalid/qa-catalogue',
    outcomes: ['Relevant meetings'],
    notes: 'QA test (madeup) only',
    name: 'QA test (madeup) Person',
    company: 'QA Test Co (madeup)',
    email: 'qa-ws-c-mission@example.invalid',
    acknowledged: true,
  });
  return { tenantId: base.tenantId, missionId: submitted.id };
}
