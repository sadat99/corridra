import { randomUUID } from 'node:crypto';
import type { AccessService } from '../../packages/auth/src/access';
import type { RequestContext } from '../../packages/db/src/index';

// A member change names the membership version the person saw and carries a command id (CRUD G9). Tests that only need
// the change made read the version as it stands now, the way the screen does after loading the member list.
export async function changeMemberNow(
  access: AccessService,
  ctx: RequestContext,
  change: { userId: string; role: string; revoked: boolean },
  readCtx: RequestContext = ctx,
) {
  const members = await access.members(readCtx).catch(() => []);
  const seen = members.find((m: { user_id: string }) => m.user_id === change.userId);
  return access.changeMember(ctx, {
    commandId: randomUUID(),
    expectedVersion: seen?.version ?? 1,
    ...change,
  });
}
