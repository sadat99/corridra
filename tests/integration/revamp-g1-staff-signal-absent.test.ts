import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture } from './support';
import { RequestWithdrawalSignalService } from '../../packages/missions/src/request-withdrawal-signal';

// CRUD G1 follow-up: on a database where the withdrawal module is not installed (production until the owner installs
// it), the team's service answers "not withdrawn" for a signed-in member and never a SQL error, so the page shows
// nothing. A person outside the workspace is still refused before anything is looked up.
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.close();
});

describe('the team signal without the withdrawal module', () => {
  test('the function does not exist, and the service answers not withdrawn', async () => {
    expect(
      (
        await f.owner.query(
          "SELECT to_regprocedure('app.mission_request_withdrawal(uuid)') IS NULL AS absent",
        )
      ).rows[0].absent,
    ).toBe(true);
    const service = new RequestWithdrawalSignalService(f.runtime);
    expect(await service.read(f.users.operator.ctx, randomUUID())).toEqual({
      withdrawn: false,
      at: null,
    });
  });

  test('a person outside the workspace is refused, not answered', async () => {
    const service = new RequestWithdrawalSignalService(f.runtime);
    await expect(service.read(f.users.outsider.ctx, randomUUID())).rejects.toThrow();
  });
});
