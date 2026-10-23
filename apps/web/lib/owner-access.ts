/** Who may open the Owner page. Pure, so every denial is tested without a server. */
export type OwnerTenant = { id: string; name: string; role: string };
export type OwnerAccess = 'hidden' | 'unavailable' | 'sign-in' | 'denied' | 'allowed';

export function ownerPageEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_OWNER_PAGE_ENABLED === 'true';
}

/** Only owners and admins. Operators, reviewers and viewers are denied. */
export function ownerCapable(tenants: OwnerTenant[]) {
  return tenants.filter((tenant) => tenant.role === 'owner' || tenant.role === 'admin');
}

/**
 * The order matters. With the switch off the page does not exist, so nothing else is checked.
 * Customers never reach a staff membership, so they land in the denied or sign-in states.
 */
export function ownerPageAccess(input: {
  enabled: boolean;
  configured: boolean;
  signedIn: boolean;
  tenants: OwnerTenant[];
}): OwnerAccess {
  if (!input.enabled) return 'hidden';
  if (!input.configured) return 'unavailable';
  if (!input.signedIn) return 'sign-in';
  return ownerCapable(input.tenants).length > 0 ? 'allowed' : 'denied';
}

export function chooseOwnerTenant(tenants: OwnerTenant[], requested?: string) {
  const capable = ownerCapable(tenants);
  return capable.find((tenant) => tenant.id === requested) ?? capable[0];
}
