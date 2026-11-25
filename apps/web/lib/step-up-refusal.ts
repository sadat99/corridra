import { DomainError, stepUpRequired } from '@corridra/domain';

// Some team reads are decided by one database function that refuses with the same 403 whether the role is wrong, the
// workspace is outside the network's scope, the network is off, or the authenticator check has aged (network
// invitations). The answer becomes 401 STEP_UP_REQUIRED only when the person's role may read it AND the database says
// the check is not fresh right now: nothing else can be fixed by confirming a code, and asking would loop. Every other
// refusal keeps its honest 403. The role and freshness come from the session's own authority, never from the request.
type Authority = {
  access: {
    authority(ctx: { token: string; tenantId: string }): Promise<{ role: string; fresh: boolean }>;
  };
};

export async function stepUpWhenRoleAllows<T>(
  s: Authority,
  ctx: { token: string; tenantId: string },
  roles: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof DomainError) || error.status !== 403 || error.code) throw error;
    let lapsed = false;
    try {
      const { role, fresh } = await s.access.authority(ctx);
      lapsed = roles.includes(role) && !fresh;
    } catch {
      throw error;
    }
    if (lapsed) throw stepUpRequired();
    throw error;
  }
}
