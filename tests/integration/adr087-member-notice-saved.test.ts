import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildWorld, options, type World } from './removed-member-support';
import { migrateMemberNotice } from '../../packages/db/src/member-notice-migrate';
import { deliverMemberNotice } from '../../packages/db/src/member-notice-deliver';
import { CustomerMemberNoticeService } from '../../apps/web/lib/member-notice';

// ADR-087 U4 (review F5): on a saved report's page, the decision card panel shows only the notice of the workspace that
// report belongs to: the workspace of the request it was delivered for, when the reader holds the report and wrote that
// request. Real saved reports, delivered by staff and accepted by members, on a real PostgreSQL database with the restricted
// logins (the removed member world). Fails on main: the module and customer.member_notice_for_saved do not exist there.
let w: World;
const on = { CORRIDRA_MEMBER_NOTICE: 'true' } as NodeJS.ProcessEnv;
const forSaved = (person: string, saved: string) =>
  w.as(
    person,
    async (db) =>
      (await db.query('SELECT * FROM customer.member_notice_for_saved($1::uuid)', [saved])).rows,
  );
const service = (person: string) =>
  new CustomerMemberNoticeService(w.f.runtime, w.f.auth, options, async () => w.session(person));

beforeAll(async () => {
  w = await buildWorld({ requestsPerPerson: 2 });
  await migrateMemberNotice(w.f.owner);
  await deliverMemberNotice(w.f.owner, {
    targets: [w.W, w.personal.lena!],
    deliveredBy: 'member notice saved report test',
  });
});
afterAll(async () => {
  await w?.f.close();
});

describe('the notice of a saved report', () => {
  test('is the notice of the workspace the report was delivered for', async () => {
    for (const person of ['olive', 'lena', 'rex'] as const) {
      const rows = await forSaved(person, w.reports[person]!.savedId);
      expect(rows, person).toHaveLength(1);
      expect(rows[0].workspace_id).toBe(w.W);
      expect(rows[0].dismissed).toBe(false);
    }
  });
  test('is nothing for a report held by someone else, a report of another person request, or an unknown id', async () => {
    expect(await forSaved('lena', w.reports.rex!.savedId)).toEqual([]);
    expect(await forSaved('lena', w.bearer.lena!.assignedToSam)).toEqual([]);
    expect(await forSaved('lena', w.bearer.lena!.unassigned)).toEqual([]);
    expect(await forSaved('stranger', w.reports.lena!.savedId)).toEqual([]);
    expect(await forSaved('lena', randomUUID())).toEqual([]);
  });
  test('the app service shows only that workspace on the report page, and every delivered workspace elsewhere', async () => {
    const all = (await service('lena').list(undefined, undefined, on)).notices;
    expect(all.map((row) => row.workspaceId).sort()).toEqual([w.W, w.personal.lena!].sort());
    const page = (await service('lena').list(undefined, undefined, on, w.reports.lena!.savedId))
      .notices;
    expect(page.map((row) => row.workspaceId)).toEqual([w.W]);
    expect(page[0]!.workspaceName).toBe('Synthetic removed member workspace');
    expect(
      (await service('lena').list(undefined, undefined, on, w.bearer.lena!.assignedToSam)).notices,
    ).toEqual([]);
  });
  test('a member who left sees no notice on their report page', async () => {
    await w.leave('rex', w.W);
    expect(await forSaved('rex', w.reports.rex!.savedId)).toEqual([]);
  });
});
