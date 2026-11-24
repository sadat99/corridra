/** Who may open the Invoice issuer screen. Pure, so every denial is tested without a server. */
export type IssuerTenant = { id: string; name: string; role: string };

/** Owners only: an admin, operator, reviewer or viewer is never offered the screen. */
export function chooseIssuerTenant(tenants: IssuerTenant[], requested?: string) {
  const owned = tenants.filter((tenant) => tenant.role === 'owner');
  return owned.find((tenant) => tenant.id === requested) ?? owned[0];
}
