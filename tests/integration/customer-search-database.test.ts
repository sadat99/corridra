import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, options, type World } from './removed-member-support';
import { CustomerRequestDetailService } from '../../packages/auth/src/customer-request-details';
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
    throw new Error('the Companies service must not be read in this file');
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
  };
  return searchCustomer(
    services,
    { requests: true, details: true, companies: false, provenance: customerProvenanceAllowed },
    { correlationId: randomUUID(), subject: options2.subject, issuer: options2.issuer },
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
