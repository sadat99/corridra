import { DomainError, stepUpRequired } from '@corridra/domain';

// Some team reads are decided by one database function that refuses with the same 403 whether the role is wrong or the
// authenticator check has aged (network invitations). For a role that may read them the only remaining cause is the
// check, so the answer becomes 401 STEP_UP_REQUIRED and the screen can ask for the code in place. A role that may
// never read them keeps the plain 403. The role is read from the session's own memberships, never from the request.
type Tenants = { access: { tenants(token: string): Promise<{ id: string; role: string }[]> } };

export async function stepUpWhenRoleAllows<T>(
  s: Tenants,
  ctx: { token: string; tenantId: string },
  roles: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof DomainError) || error.status !== 403 || error.code) throw error;
    let role: string | undefined;
    try {
      role = (await s.access.tenants(ctx.token)).find((t) => t.id === ctx.tenantId)?.role;
    } catch {
      throw error;
    }
    if (role && roles.includes(role)) throw stepUpRequired();
    throw error;
  }
}
