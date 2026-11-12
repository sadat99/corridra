import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { future } from './access-fixture';
import { buildWorld, options, type World } from './removed-member-support';
import { CustomerRequestDetailService } from '../../packages/auth/src/customer-request-details';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { CustomerCompanyService } from '../../packages/auth/src/customer-companies';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { customerProvenanceAllowed } from '../../packages/domain/src/customer-input-mode';
import {
  searchCustomer,
  type CustomerSearchScope,
  type CustomerSearchServices,
} from '../../apps/web/lib/customer-search';

// The customer search against a real database (Sensitive: yes; docs/revamp/specs/navigation-v1/customer-search.md, D2 and
// D3): the core runs over the real Request and detail services under each person's own session, so what a person finds is
// what row security lets that person read. Every Request of the removed member world has the same title, "Sell in Spain", so
// a hit is told apart only by its id, and the strongest check is that the hits are exactly the Requests the person's own
// list returns. Companies are not covered here: the approved portfolio needs a published shortlist, which this world does not
// build, so that scope has its core tests with counting services and is not exercised against a database in this file.
//
// The world is the one the removed member suites build (the same mock of the file system, which keeps the later migration files
// away, and the same helpers), so this file proves its rules on the schema those suites prove.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
const reason = 'A reason that is long enough to be accepted';
const sorted = (ids: string[]) => [...ids].sort();
const never = {
  async list(): Promise<never> {
    throw new Error('this service must not be read by this part of the test');
  },
};
const tally = { details: 0 };
// The core over the real services for one person. A null session is a visitor with no customer session.
function searchAs(
  person: string | null,
  options2: { q?: string; scope?: CustomerSearchScope; subject?: string; issuer?: string } = {},
) {
  const readSession = async () => (person ? w.session(person) : null);
  const details = new CustomerRequestDetailService(w.f.runtime, w.f.auth, options, readSession);
  const services: CustomerSearchServices = {
    requests: new CustomerRequestService(w.f.runtime, w.f.auth, options, readSession),
    details: {
      detail: async (...args) => {
        tally.details += 1;
        return details.detail(...args);
      },
    },
    companies: never,
    companyBudget: async () => undefined,
  };
  return searchCustomer(
    services,
    { requests: true, details: true, companies: false, provenance: customerProvenanceAllowed },
    {
      correlationId: randomUUID(),
      client: 'local',
      subject: options2.subject,
      issuer: options2.issuer,
    },
    options2.q ?? 'spain',
    options2.scope ?? 'requests',
  );
}
const found = async (person: string) => (await searchAs(person)).hits.map((hit) => hit.id);
const listed = async (person: string) => (await w.listRequests(person)).ids;

beforeAll(async () => {
  w = await buildWorld();
}, 900000);
afterAll(async () => {
  await w?.f.close();
});

describe('P1 while everyone is a member, a person finds exactly the Requests their own list shows', () => {
  test('every person, and a stranger who finds nothing and is told the search was complete', async () => {
    for (const person of w.people) {
      const answer = await searchAs(person);
      expect(answer.scopes, person).toEqual({ requests: 'ok' });
      expect(sorted(answer.hits.map((hit) => hit.id)), person).toEqual(
        sorted(await listed(person)),
      );
      for (const hit of answer.hits) {
        expect(hit.label).toBe('Sell in Spain');
        expect(hit.href).toBe(`/account/requests/${hit.id}`);
        expect(answer.facts?.[`request:${hit.id}`]?.sent).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
    expect(await found('stranger')).toEqual([]);
    expect(sorted(await found('sam'))).toEqual(sorted(w.requests.sam!));
  });
  test('a typo finds the same Requests and marks them close', async () => {
    const answer = await searchAs('sam', { q: 'spian' });
    expect(sorted(answer.hits.map((hit) => hit.id))).toEqual(sorted(w.requests.sam!));
    for (const hit of answer.hits) expect(answer.facts?.[`request:${hit.id}`]?.close).toBe(true);
  });
  test('words that match no title find nothing and the search is still complete', async () => {
    expect(await searchAs('sam', { q: 'zebra' })).toEqual({ hits: [], scopes: { requests: 'ok' } });
  });
});

describe("D2 one customer never finds another customer's Requests", () => {
  test('a workspace owner does not find the Requests of the members of the same workspace', async () => {
    const olive = await found('olive');
    for (const person of ['lena', 'rex', 'sam', 'rita'] as const)
      for (const id of w.requests[person]!) expect(olive).not.toContain(id);
    expect(sorted(olive)).toEqual(sorted(await listed('olive')));
  });
  test('two members of one workspace and the members of two workspaces each find only their own', async () => {
    const hana = await found('hana');
    expect(hana).toContain(w.w2Requests.hana);
    expect(hana).not.toContain(w.w2Requests.olive);
    expect(await found('olive')).toContain(w.w2Requests.olive);
    expect(await found('olive')).not.toContain(w.w2Requests.hana);
    for (const id of await found('sam')) expect(await found('stranger')).not.toContain(id);
  });
  test('a claimed subject or issuer that is not the signed-in person is refused before any Request is read', async () => {
    const before = tally.details;
    const otherIssuer =
      'https://ep-other-person.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
    await expect(searchAs('sam', { subject: w.session('lena').subject })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      searchAs('sam', { subject: w.session('sam').subject, issuer: otherIssuer }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(searchAs('sam', { subject: 'bad\u0001subject' })).rejects.toMatchObject({
      status: 400,
    });
    expect(tally.details).toBe(before);
  });
});

describe('D1 a visitor with no customer session', () => {
  test('is refused with a 401 and no title is looked up', async () => {
    const before = tally.details;
    await expect(searchAs(null)).rejects.toMatchObject({ status: 401 });
    expect(tally.details).toBe(before);
  });
});

describe('D3 the withdrawn, the revoked and the removed', () => {
  test('a withdrawn Request is found and says so, as the Requests list shows it', async () => {
    const id = w.requests.olive![1]!;
    await w.row('olive', 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
      id,
      randomUUID(),
      reason,
    ]);
    const answer = await searchAs('olive');
    expect(answer.hits.map((hit) => hit.id)).toContain(id);
    expect(answer.facts?.[`request:${id}`]?.withdrawn).toBe(true);
    const other = w.requests.olive![0]!;
    expect(answer.facts?.[`request:${other}`]?.withdrawn).toBeUndefined();
  });
  test('a revoked Request is not found', async () => {
    const [kept, revoked] = w.requests.sam!;
    await w.f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the customer search test')",
      [revoked],
    );
    const ids = await found('sam');
    expect(ids).toContain(kept);
    expect(ids).not.toContain(revoked);
    expect(sorted(ids)).toEqual(sorted(await listed('sam')));
  });
  test.each([
    ['leaves', 'lena'],
    ['is removed by the owner', 'rex'],
  ])(
    'a member who %s finds nothing written in the workspace, and keeps their own',
    async (how, person) => {
      if (how === 'leaves') await w.leave(person, w.W);
      else await w.revoke('olive', w.W, w.members[person]!);
      const answer = await searchAs(person);
      // Nothing tells them the Requests exist: the search is complete, and it is empty of them.
      expect(answer.scopes).toEqual({ requests: 'ok' });
      const ids = answer.hits.map((hit) => hit.id);
      for (const id of w.requests[person]!) expect(ids).not.toContain(id);
      expect(ids).toEqual([w.ownWorkspaceRequest[person]]);
      expect(sorted(ids)).toEqual(sorted(await listed(person)));
    },
  );
  test('everyone else still finds their own Requests', async () => {
    expect(sorted(await found('rita'))).toEqual(sorted(await listed('rita')));
    expect((await found('rita')).length).toBeGreaterThan(0);
    for (const id of w.requests.rita!) expect(await found('rita')).toContain(id);
  });
  test('a new invitation gives the Requests back, and a person who stays out stays out', async () => {
    await w.join('olive', 'rex', w.W);
    const rex = await found('rex');
    for (const id of w.requests.rex!) expect(rex).toContain(id);
    expect(sorted(rex)).toEqual(sorted(await listed('rex')));
    const lena = await found('lena');
    for (const id of w.requests.lena!) expect(lena).not.toContain(id);
  });
});

// The Companies scope through the search, against the real approved portfolio. The fixture is the one the Companies suite
// builds, applied to a Request of this world: staff qualify its mission, ingest a company with a claim and a contact, target
// it, publish a report that approves that target, share it and assign it to the Request's author, who accepts it. Sam then
// holds a saved report with an approved shortlist, so `customer.company_portfolio` returns the company for Sam alone.
describe('Companies through the search', () => {
  let companyName = '';
  let reportId = '';
  const portfolio = (person: string) => {
    const readSession = async () => w.session(person);
    return new CustomerCompanyService(w.f.runtime, w.f.auth, options, readSession);
  };
  const searchCompanies = (person: string, q = 'buyer') =>
    searchCustomerWith(person, q, 'companies');
  async function searchCustomerWith(person: string, q: string, scope: CustomerSearchScope) {
    return searchCustomer(
      {
        requests: never,
        details: { detail: never.list },
        companies: portfolio(person),
        companyBudget: async () => undefined,
      },
      { requests: false, details: false, companies: true, provenance: customerProvenanceAllowed },
      { correlationId: randomUUID(), client: 'local' },
      q,
      scope,
    );
  }

  beforeAll(async () => {
    await migrateCustomerCompanies(w.f.owner);
    const ctx = w.operatorCtx;
    const research = new CounterpartyService(w.f.runtime);
    const evidence = new EvidenceService(
      w.f.runtime,
      {
        async put() {},
        async get() {
          return new Uint8Array();
        },
      },
      {
        async scan() {
          return { verdict: 'ERROR', engine: 'not-used' };
        },
      },
    );
    const request = await w.submit('sam', w.W);
    const missionId = await w.missionOf(request);
    const source = await evidence.createSource(ctx, {
      kind: 'public_record',
      locator: 'https://example.invalid/customer-search',
      observedAt: new Date().toISOString(),
      classification: 'PUBLIC',
      purpose: 'synthetic_validation',
      retentionUntil: future(7),
      aiPolicy: 'DENY',
    });
    const command = (action: string, data: Record<string, unknown>) => ({
      action,
      commandId: randomUUID(),
      ...data,
    });
    const company = await research.command(
      ctx,
      command('ingest', {
        sourceId: source.id,
        name: `Synthetic Buyer ${randomUUID()}`,
        country: 'ES',
        domain: `${randomUUID()}.example.invalid`,
        address: 'Synthetic business address',
        identifierType: 'registry',
        identifier: randomUUID(),
      }),
    );
    const relationship = await research.command(
      ctx,
      command('relationship', {
        organisationId: company.id,
        ownerId: w.f.users.operator.id,
        visibility: 'OWNER',
        note: 'Private negotiation details never shown to the buyer',
      }),
    );
    const contact = await research.command(
      ctx,
      command('contact', {
        relationshipId: relationship.id,
        sourceId: source.id,
        name: 'Synthetic Buyer Person',
        jobTitle: 'Procurement',
        email: `${randomUUID()}@example.invalid`,
        validUntil: future(6),
      }),
    );
    const claim = await evidence.createClaim(ctx, {
      sourceId: source.id,
      statement: 'Synthetic buyer declares interest in towels',
    });
    await research.command(
      ctx,
      command('attribute', {
        organisationId: company.id,
        kind: 'requirement',
        claimId: claim.id,
        validUntil: future(6),
      }),
    );
    const version = (
      await w.f.owner.query('SELECT version FROM app.mission WHERE id=$1', [missionId])
    ).rows[0].version as number;
    for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
      await w.missions.command(ctx, {
        id: missionId,
        version: version + i,
        commandId: randomUUID(),
        action,
        ownerId: w.f.users.operator.id,
        reason: 'Synthetic customer search qualification',
        nextAction: 'Review relevant introduction',
        dueAt: future(),
        marketCode: 'ES',
        targetProfile: 'Synthetic hotel distributor profile',
      });
    const target = await research.command(
      ctx,
      command('target', {
        missionId,
        relationshipId: relationship.id,
        contactId: contact.id,
        claimIds: [claim.id],
        fit: 'POSSIBLE',
        rationale: 'Declared needs fit the synthetic offer',
        uncertainty: 'No buyer interest verified',
        gaps: 'Need actual buyer response',
        nextAction: 'Review an introduction',
        dueAt: future(),
      }),
    );
    const publication = await w.delivery.publication(w.staffCtx, {
      commandId: randomUUID(),
      missionId,
      title: 'Approved buyer context',
      company: 'Synthetic requesting company',
      objective: 'Develop a commercial relationship',
      brief: 'Approved fictional requirements without private contacts or negotiation notes',
      nextAction: 'Review the approved counterparty',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    });
    await new DeliveryExperienceService(w.f.runtime).publication(w.staffCtx, {
      commandId: randomUUID(),
      publicationId: publication.id,
      requirementId: null,
      targetIds: [target.id],
      quotationIds: [],
      agendaItemIds: [],
      approved: true,
      reason: 'Explicitly approve this original target and qualification only',
    });
    const link = await w.delivery.share(w.staffCtx, {
      commandId: randomUUID(),
      programmeId: null,
      publicationIds: [publication.id],
      audience: 'CLIENT_PROGRESS',
      purpose: 'Explicit synthetic commercial report scope',
      expiresAt: future(),
      allowExport: false,
      approved: true,
    });
    const assignment = await w.assign(request, link.id);
    reportId = await w.accept('sam', assignment);
    companyName = (
      await w.f.owner.query('SELECT name FROM app.organisation WHERE id=$1', [company.id])
    ).rows[0].name as string;
  }, 300000);

  test('Sam finds the approved company through the search, opening the report it came from', async () => {
    const answer = await searchCompanies('sam');
    expect(answer.scopes).toEqual({ companies: 'ok' });
    // The real portfolio carries the approved scope's expiry, which the dialog clears the company at.
    expect(Date.parse(answer.expiresAt!)).toBeGreaterThan(Date.now());
    expect(answer.hits).toHaveLength(1);
    expect(answer.hits[0]!.label).toBe(companyName);
    expect(answer.hits[0]!.href).toBe(`/account/missions/${reportId}`);
    expect(answer.facts?.[`company:${answer.hits[0]!.id}`]?.reports).toBe(1);
  });
  test('another customer, a stranger and a member of another workspace never find it', async () => {
    for (const person of ['stranger', 'hana', 'olive', 'rita'])
      // Their own saved reports may carry an expiry; none of them has a company to find.
      expect(await searchCompanies(person), person).toMatchObject({
        hits: [],
        scopes: { companies: 'ok' },
      });
  });
  test('after Sam is removed from the workspace the company is not found, and a new invitation brings it back', async () => {
    await w.revoke('olive', w.W, w.members.sam!);
    expect(await searchCompanies('sam')).toMatchObject({ hits: [], scopes: { companies: 'ok' } });
    await w.join('olive', 'sam', w.W);
    const back = await searchCompanies('sam');
    expect(back.hits.map((hit) => hit.label)).toEqual([companyName]);
  });
});
