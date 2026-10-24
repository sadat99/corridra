import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { DeliveryService } from '../../packages/delivery/src/index';
import { importColumns } from '../../packages/delivery/src/import';
import { MissionService } from '../../packages/missions/src/index';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';

export const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();

// Real-use set-up shared by the real-mode scenario tests: real data mode, the optional modules, the real intake tenant,
// and staff (the fixture owner) who work in it under the real processing purpose.
export async function realStaffFixture(issuer: string, secret: string) {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  const f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'local-bootstrap-fixture',
    executorId: f.serviceId,
    reason: 'Local fixture authority only; never a production customer',
  });
  await f.owner.query(
    "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
    [f.tenantA, f.serviceId, f.users.owner.id],
  );
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Local functional fixture with owner-approved real use and deferred scanning',
  });
  const intakeTenantId: string = (
    await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
  ).rows[0].intake_tenant_id;
  const ctx = {
    ...f.users.owner.ctx,
    tenantId: intakeTenantId,
    purpose: 'commercial_qualification',
  };
  const missions = new MissionService(f.runtime, secret, 'real');
  const delivery = new DeliveryService(f.runtime, missions, secret);
  const unexpected = async () => {
    throw new Error('This test performs no file or scan operation');
  };
  const evidence = new EvidenceService(
    f.runtime,
    { put: unexpected, get: unexpected },
    { scan: unexpected },
  );
  const research = new CounterpartyService(f.runtime);
  // A real mission arrives through a staff programme import, as in production, then moves to targeting.
  async function mission(label = 'Machinery participant') {
    const programme = await delivery.programme(ctx, {
      commandId: randomUUID(),
      name: 'Supplier visits ' + randomUUID().slice(0, 8),
      reportingPurpose: 'Prepare the participating company for supplier discussions',
    });
    const values: Record<string, string> = {
      participant_reference: 'company-' + randomUUID().slice(0, 8),
      company: label,
      name: 'Participant contact',
      email: 'participant@business.test',
      objective: 'Source suppliers',
      market: 'China',
      offer: 'Find machinery suppliers for the planned factory expansion',
      attendance: 'No',
      startDate: '',
      endDate: '',
      timezone: 'Asia/Dhaka',
      website: 'https://business.test/catalogue',
      outcomes: 'Relevant meetings',
      notes: '',
      companyCountry: 'BD',
      marketCode: 'CN',
      missionJob: 'sourcing',
    };
    const csv = Buffer.from(
      importColumns.join(',') + '\n' + importColumns.map((key) => values[key]).join(',') + '\n',
    );
    const preview = await delivery.preview(ctx, programme.id, randomUUID(), csv, 'CSV');
    const confirmed = await delivery.confirm(ctx, {
      commandId: randomUUID(),
      importId: preview.id,
      ownerId: f.users.owner.id,
      counts: preview.counts,
      acknowledged: true,
    });
    const missionId = confirmed.rows[0].missionId as string;
    for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
      await missions.command(ctx, {
        id: missionId,
        version: i + 1,
        commandId: randomUUID(),
        action,
        ownerId: f.users.owner.id,
        reason: 'Qualified from the supplied company details',
        nextAction: 'Review relevant supplier introductions',
        dueAt: future(),
        marketCode: 'CN',
        targetProfile: 'Machinery manufacturers with export experience',
      });
    return missionId;
  }
  // A researched supplier company with a private contact and one sourced claim, attached to the mission as a target.
  async function target(missionId: string, name = 'Machinery Supplier Company') {
    const source = await evidence.createSource(ctx, {
      kind: 'public_record',
      classification: 'PUBLIC',
      locator: 'https://business.test/registry/' + randomUUID(),
      observedAt: new Date().toISOString(),
      purpose: 'commercial_qualification',
      retentionUntil: future(7),
      aiPolicy: 'DENY',
    });
    const org = await research.command(ctx, {
      action: 'ingest',
      commandId: randomUUID(),
      sourceId: source.id,
      name,
      country: 'CN',
      domain: 'supplier.business.test',
      address: 'Company business address',
      identifierType: 'registry',
      identifier: randomUUID(),
    });
    const relationship = await research.command(ctx, {
      action: 'relationship',
      commandId: randomUUID(),
      organisationId: org.id,
      ownerId: f.users.owner.id,
      visibility: 'OWNER',
      note: 'Private negotiation details never shown to the customer',
    });
    const contact = await research.command(ctx, {
      action: 'contact',
      commandId: randomUUID(),
      relationshipId: relationship.id,
      sourceId: source.id,
      name: 'Supplier contact',
      jobTitle: 'Sales manager',
      email: 'sales@supplier.business.test',
      validUntil: future(6),
    });
    const claim = await evidence.createClaim(ctx, {
      sourceId: source.id,
      statement: 'The company states it exports machinery',
    });
    await research.command(ctx, {
      action: 'attribute',
      commandId: randomUUID(),
      organisationId: org.id,
      kind: 'requirement',
      claimId: claim.id,
      validUntil: future(6),
    });
    const created = await research.command(ctx, {
      action: 'target',
      commandId: randomUUID(),
      missionId,
      relationshipId: relationship.id,
      contactId: contact.id,
      claimIds: [claim.id],
      fit: 'POSSIBLE',
      rationale: 'Declared exports fit the requested machinery',
      uncertainty: 'No buyer interest verified',
      gaps: 'Need an actual supplier response',
      nextAction: 'Review an introduction',
      dueAt: future(),
    });
    return {
      targetId: created.id as string,
      sourceId: source.id as string,
      claimId: claim.id as string,
    };
  }
  return { f, ctx, intakeTenantId, missions, delivery, evidence, research, mission, target };
}
