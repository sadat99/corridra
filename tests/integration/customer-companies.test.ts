import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { accessFixture, command, future } from './access-fixture';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import {
  CustomerCompanyService,
  customerCompaniesEnabled,
} from '../../packages/auth/src/customer-companies';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
const issuer = 'https://ep-company-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof accessFixture>>, delivery: DeliveryService;
const links: { id: string; token: string }[] = [],
  resources: string[] = [];
let targetIds: string[] = [],
  companyName: string,
  workspaceId: string,
  preserved = false;
const session = (person = 'alice') => ({
  subject: 'synthetic-companies-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const portfolio = (person = 'alice') =>
  new CustomerCompanyService(f.runtime, f.auth, options, async () => session(person));
const saved = (person = 'alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(person));
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid",
    )
  ).rows;
  const policies = (
    await f.owner.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const tables = (
    await f.owner.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid",
    )
  ).rows;
  const data = [];
  for (const t of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    data.push(
      (
        await f.owner.query(
          "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM " +
            q(t.nspname) +
            '.' +
            q(t.relname) +
            ' v',
        )
      ).rows[0].digest,
    );
  }
  return {
    functions,
    policies,
    tables,
    data,
    core: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    base: (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
    commercial: (
      await f.owner.query('SELECT * FROM customer_commercial_migrations.applied ORDER BY name')
    ).rows,
  };
}
beforeAll(async () => {
  f = await accessFixture();
  await migrateCustomerSavedMissions(f.owner);
  for (const person of ['alice', 'bob'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Fictional approved-company portfolio fixture,not real provider identity',
    });
  workspaceId = (
    await workspaces('bob').provision({
      commandId: randomUUID(),
      name: 'Synthetic private organisation workspace',
    })
  ).id;
  const invitation = await workspaces('bob').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic invited private customer',
  });
  await workspaces().access({ action: 'accept', commandId: randomUUID(), token: invitation.token });
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-company-fixture');
  const experience = new DeliveryExperienceService(f.runtime);
  const a = await f.target(),
    b = await f.target();
  const target = await f.research.command(
    f.ctx,
    command('target', {
      missionId: b.missionId,
      relationshipId: a.relationshipId,
      contactId: a.contactId,
      claimIds: [a.claimId],
      fit: 'POSSIBLE',
      rationale: 'Same canonical company in an independent approved engagement',
      uncertainty: 'No new verification inferred',
      gaps: 'Commercial scope remains different',
      nextAction: 'Review this separate engagement',
      dueAt: future(),
    }),
  );
  targetIds = [a.targetId, target.id];
  for (const [n, missionId] of [a.missionId, b.missionId].entries()) {
    const p = await delivery.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      missionId,
      title: n ? 'Approved sourcing context' : 'Approved buyer context',
      company: 'Synthetic requesting company',
      objective: n ? 'Review equipment supply' : 'Develop a commercial relationship',
      brief: 'Approved fictional requirements without private contacts or negotiation notes',
      nextAction: 'Review the approved counterparty',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    });
    await experience.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      publicationId: p.id,
      requirementId: null,
      targetIds: [targetIds[n]],
      quotationIds: [],
      agendaItemIds: [],
      approved: true,
      reason: 'Explicitly approve this original target and qualification only',
    });
    const link = await delivery.share(f.users.owner.ctx, {
      commandId: randomUUID(),
      programmeId: null,
      publicationIds: [p.id],
      audience: 'CLIENT_PROGRESS',
      purpose: 'Explicit synthetic commercial report scope',
      expiresAt: future(),
      allowExport: false,
      approved: true,
    });
    links.push(link);
    resources.push(
      (
        await saved().command({
          action: 'save',
          commandId: randomUUID(),
          token: link.token,
          acknowledged: true,
        })
      ).id,
    );
  }
  const before = await snapshot();
  await migrateCustomerCompanies(f.owner);
  const after = await snapshot();
  expect(after.functions.filter((p) => before.functions.some((q) => q.oid === p.oid))).toEqual(
    before.functions,
  );
  expect(after.policies).toEqual(before.policies);
  expect(after.tables).toEqual(before.tables);
  expect(after.data).toEqual(before.data);
  expect(after.core).toEqual(before.core);
  expect(after.base).toEqual(before.base);
  expect(after.commercial).toEqual(before.commercial);
  preserved = true;
  const report = await saved().command({
    action: 'view',
    audience: 'CLIENT_PROGRESS',
    resourceId: resources[0],
  });
  companyName = report.report.missions[0].experience.shortlist[0].company;
});
afterAll(async () => {
  await f?.close();
});
test('populated upgrade changes no original function,ACL,RLS,row or migration receipt and is explicit/repeatable', async () => {
  expect(preserved).toBe(true);
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerSavedMissions(f.owner);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_company_migrations.applied')).rows[0]
      .n,
  ).toBe(1);
});
test('one canonical company spans different approved missions without merging their contexts', async () => {
  const result = await portfolio().list();
  expect(result.companies).toHaveLength(1);
  const company = result.companies[0];
  expect(company.id).toMatch(/^[a-f0-9]{64}$/);
  expect(company.contexts).toHaveLength(2);
  expect(company.contexts.map((c: { company: string }) => c.company)).toEqual([
    companyName,
    companyName,
  ]);
  expect(new Set(company.contexts.map((c: { targetId: string }) => c.targetId))).toEqual(
    new Set(targetIds),
  );
  expect(new Set(company.contexts.map((c: { objective: string }) => c.objective))).toEqual(
    new Set(['Review equipment supply', 'Develop a commercial relationship']),
  );
  expect(result.nextAfter).toBeNull();
  expect(result.scopesRead).toBe(2);
  for (const context of company.contexts) {
    const report = await saved().command({
      action: 'view',
      audience: 'CLIENT_PROGRESS',
      resourceId: context.resourceId,
    });
    const original = report.report.missions[0].experience.shortlist.find(
      (t: { id: string }) => t.id === context.targetId,
    );
    expect(context).toMatchObject({
      company: original.company,
      country: original.country,
      fit: original.fit,
      rationale: original.rationale,
      uncertainty: original.uncertainty,
      gaps: original.gaps,
      verification: original.verification,
    });
  }
  const text = JSON.stringify(result);
  expect(text).not.toContain('Private negotiation details');
  expect(text).not.toContain('Synthetic Buyer Person');
  expect(text).not.toContain('@example.invalid');
  expect(text).not.toContain('organisationId');
});
test('workspace ownership,member access and guessed cursors grant no other customer portfolio', async () => {
  const result = await portfolio('bob').list();
  expect(result.companies).toEqual([]);
  expect(result.scopesRead).toBe(0);
  expect((await portfolio('bob').list({ after: resources[0] })).companies).toEqual([]);
  await expect(portfolio('unknown').list()).rejects.toMatchObject({ code: '42501' });
  await expect(portfolio().list({}, session('bob').subject, issuer)).rejects.toMatchObject({
    status: 409,
  });
});
test('same approved bearer in another admitted account has a separate opaque identity namespace', async () => {
  await saved('bob').command({
    action: 'save',
    commandId: randomUUID(),
    token: links[0].token,
    acknowledged: true,
  });
  const a = await portfolio().list(),
    b = await portfolio('bob').list();
  expect(b.companies).toHaveLength(1);
  expect(b.companies[0].id).not.toBe(a.companies[0].id);
  expect(b.companies[0].contexts).toHaveLength(1);
});
test('scope pagination uses owned bindings and stable canonical grouping across pages', async () => {
  const first = await portfolio().list({ pageSize: 1 });
  expect(first.companies).toHaveLength(1);
  expect(first.nextAfter).toBeTruthy();
  const second = await portfolio().list({ pageSize: 1, after: first.nextAfter });
  expect(second.nextAfter).toBeNull();
  expect(second.companies[0].id).toBe(first.companies[0].id);
  expect(second.companies[0].contexts[0].resourceId).not.toBe(
    first.companies[0].contexts[0].resourceId,
  );
  await expect(portfolio().list({ pageSize: 6 })).rejects.toThrow();
});
test('anonymous/unverified/provider failure and direct SQL cannot bypass the original proof or source authority', async () => {
  for (const identity of [null, { ...session(), emailVerified: false }])
    await expect(
      new CustomerCompanyService(f.runtime, f.auth, options, async () => identity).list(),
    ).rejects.toThrow();
  await expect(
    new CustomerCompanyService(f.runtime, f.auth, options, async () => {
      throw new Error('Synthetic provider outage');
    }).list(),
  ).rejects.toMatchObject({ status: 503 });
  await expect(f.runtime.query('SELECT customer.company_portfolio()')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    f.runtime.query('SELECT * FROM customer_private.saved_mission'),
  ).rejects.toMatchObject({ code: '42501' });
});
test('expired/revoked scopes disappear without stale names or unapproved company content', async () => {
  await rawContextRevoke(links[0].id);
  const result = await portfolio().list();
  expect(result.companies[0].contexts).toHaveLength(1);
  expect(result.unavailableScopes).toBe(1);
  await saved().command({ action: 'remove', commandId: randomUUID(), resourceId: resources[1] });
  const empty = await portfolio().list();
  expect(empty.companies).toEqual([]);
  expect(JSON.stringify(empty)).not.toContain(companyName);
});
async function rawContextRevoke(id: string) {
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: id,
    publicationId: null,
    reason: 'Revoke fictional portfolio scope for privacy acceptance',
  });
}
test('expired proof after a lock wait returns no portfolio and never writes a canonical record', async () => {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '0.4 seconds')",
    [hash, issuer, session().subject],
  );
  const lock = await f.owner.connect(),
    db = await f.runtime.connect();
  try {
    await lock.query('BEGIN');
    await lock.query(
      'SELECT * FROM customer_private.principal WHERE issuer=$1 AND subject=$2 FOR UPDATE',
      [issuer, session().subject],
    );
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const pending = db.query('SELECT customer.company_portfolio()');
    const denial = expect(pending).rejects.toMatchObject({ code: '42501' });
    await lock.query('SELECT pg_sleep(0.7)');
    await lock.query('COMMIT');
    await denial;
  } finally {
    await lock.query('ROLLBACK');
    await db.query('ROLLBACK');
    lock.release();
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
});
test('independent exposure flag preserves synthetic/nonproduction and existing delivery gates', () => {
  const env = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_COMPANIES_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'preview',
  };
  expect(customerCompaniesEnabled(env)).toBe(true);
  for (const change of [
    { VERCEL_ENV: 'production' },
    { DATA_ENVIRONMENT: 'real' },
    { CORRIDRA_DELIVERY_ENABLED: 'false' },
    { CORRIDRA_CUSTOMER_COMPANIES_ENABLED: 'false' },
  ])
    expect(customerCompaniesEnabled({ ...env, ...change })).toBe(false);
});

test('hard link expiry yields no cached company name and repeat reads write no business records', async () => {
  const original = (
    await f.owner.query('SELECT publication_ids FROM app.delivery_link WHERE id=$1', [links[0].id])
  ).rows[0];
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: original.publication_ids,
    audience: 'CLIENT_PROGRESS',
    purpose: 'Fictional short-lived portfolio expiry acceptance',
    expiresAt: new Date(Date.now() + 3000).toISOString(),
    allowExport: false,
    approved: true,
  });
  await saved().command({
    action: 'save',
    commandId: randomUUID(),
    token: link.token,
    acknowledged: true,
  });
  await f.owner.query('SELECT pg_sleep(3.1)');
  const before = await snapshot();
  const result = await portfolio().list();
  expect(result.companies).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(companyName);
  expect(result.unavailableScopes).toBeGreaterThan(0);
  expect(await snapshot()).toEqual(before);
});
test('changed optional history fails closed without altering original three-module/commercial receipts', async () => {
  const original = (await f.owner.query('SELECT * FROM customer_company_migrations.applied'))
    .rows[0];
  try {
    await f.owner.query(
      "UPDATE customer_company_migrations.applied SET sha256='invalid' WHERE name=$1",
      [original.name],
    );
    await expect(migrateCustomerCompanies(f.owner)).rejects.toThrow(
      'Customer company migration history mismatch',
    );
  } finally {
    await f.owner.query('UPDATE customer_company_migrations.applied SET sha256=$1 WHERE name=$2', [
      original.sha256,
      original.name,
    ]);
  }
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_migrations.applied')).rows[0].n,
  ).toBe(3);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_commercial_migrations.applied'))
      .rows[0].n,
  ).toBe(1);
});
