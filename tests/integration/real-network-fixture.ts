import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { configureNetworkRealUse } from '../../packages/auth/src/network-real-use-configuration';
import { NetworkInvitations } from '../../packages/auth/src/network-invitations';
import { OperatorSetup } from '../../packages/auth/src/operator-setup';
import { NetworkService } from '../../packages/network/src/index';
export const realNetworkIssuer =
  'https://ep-network-real.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';

export async function realNetworkFixture(database = 'corridra_integration') {
  const f = await fixture(database);
  try {
    await migrateNetworkRealUse(f.owner);
    await pinCustomerAuthority(f.owner, {
      issuer: realNetworkIssuer,
      executorId: f.serviceId,
    });
    await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
    await configureCustomerRealUse(f.owner, {
      enabled: true,
      reason: 'Owner approved real work with reviewed invitations and deferred scanning',
    });
    const realTenant = (
      await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
    ).rows[0].intake_tenant_id as string;
    const ctx = (role = 'owner') => ({
      ...f.users[role].ctx,
      tenantId: realTenant,
      purpose: 'commercial_qualification',
    });
    await configureNetworkRealUse(f.owner, {
      enabled: true,
      reason: 'Owner approved reviewed real contributor work within retained scope',
    });
    return {
      ...f,
      realTenant,
      ctx,
      invitations: new NetworkInvitations(f.auth, true),
      setup: new OperatorSetup(f.auth),
      network: new NetworkService(f.runtime, true),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
export const newInvitation = () => ({
  action: 'invite' as const,
  commandId: randomUUID(),
  name: 'Invited local contributor',
  email: `contributor-${randomUUID()}@business.test`,
  operatingCountry: 'DE',
});
