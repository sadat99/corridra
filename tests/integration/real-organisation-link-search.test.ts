import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { baseCheck, randomLabel, World } from './organisation-link-support';
import { CustomerOrganisationLinkService } from '../../packages/auth/src/customer-organisation-links';
import { realOptions } from './organisation-link-support';

// ADR-079 slice A, customer search: provenance, the two lanes, the answer shape, the identical empty answer and the per-person
// rate limit. The ladder file under test is applied after the base world is built (see organisation-link-support.ts).
vi.hoisted(() => {
  (globalThis as { __linkHide?: boolean }).__linkHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    return (globalThis as { __linkHide?: boolean }).__linkHide &&
      String(path).includes('customer-real-use-migrations')
      ? names.filter((n) => !String(n).startsWith('0013_organisation_link_provenance_and_search'))
      : names;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

// Sends the text straight to the SQL function, past the service checks, inside a real customer session.
class RawSearch extends CustomerOrganisationLinkService {
  raw(workspaceId: string, term: string) {
    return this.transaction((db) =>
      db.query('SELECT customer.organisation_link_search($1,$2)', [workspaceId, term]),
    );
  }
}
let w: World;
const search = (who: string, workspaceId: string, q: string, mode: 'real' | 'synthetic' = 'real') =>
  w.link(who, mode).search({ workspaceId, q });
const found = async (...args: Parameters<typeof search>) =>
  (await search(...args)).organisations.map((o) => o.id);
// The comparable part of an answer: the clock value and the workspace id differ by design.
const shape = (body: { workspaceId: string; expiresAt: string; organisations: unknown[] }) => ({
  ...body,
  workspaceId: '',
  expiresAt: '',
});
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error,
  );
beforeAll(async () => {
  w = await World.build('corridra_integration');
  await w.install();
  await w.suppress('OR3');
  for (const key of [
    'Alpha',
    'Bravo',
    'Charlie',
    'Delta',
    'Echo',
    'Foxtrot',
    'Golf',
    'Hotel',
    'India',
    'Juliet',
    'Kilo',
    'Lima',
    'Zulu',
  ])
    await w.addOrganisation({
      key: 'CAP-' + key,
      name: `Capwerk ${key} GmbH`,
      synthetic: false,
      host: `capwerk-${key.toLowerCase()}.de`,
    });
  await w.addOrganisation({
    key: 'ORW',
    name: 'Wwwhost Handel GmbH',
    synthetic: false,
    host: 'www.wwwhost-handel.de',
  });
  await w.addOrganisation({ key: 'ORAB', name: 'Ab GmbH', synthetic: false, host: 'ab-gmbh.de' });
}, 300000);
afterAll(async () => {
  await w?.close();
});

test('each side finds only its own organisations, by name and by the saved company (rows 1, 2, 2b, 10)', async () => {
  expect(await found('alice-r', w.ws.WR1!, 'acme')).toEqual([w.org.OR1]);
  // Typed junk: the saved company name and website host still take the exact lane.
  expect(await found('alice-r', w.ws.WR1!, 'zzz')).toEqual([w.org.OR1]);
  // A typed web address adds no host lane: only the saved profile is matched, and another company's host finds nothing.
  expect(await found('alice-r', w.ws.WR1!, 'acme-gmbh.de')).toEqual([w.org.OR1]);
  const stranger = await w.freshWriter('addr-' + randomLabel(), 'Unrelated Firma GmbH');
  expect(await found(stranger.who, stranger.workspaceId, 'acme-gmbh.de')).toEqual([]);
  expect(await found(stranger.who, stranger.workspaceId, 'delta-bau.de')).toEqual([]);
  expect(await found('alice-s', w.ws.WS1!, 'acme', 'synthetic')).toEqual([w.org.OS1]);
  expect(await found('alice-s', w.ws.WS1!, 'zzz', 'synthetic')).toEqual([w.org.OS1]);
  const real = JSON.stringify(await search('alice-r', w.ws.WR1!, 'realwerk'));
  for (const needle of ['Acme Realwerk AG', w.org.OS1, w.ws.WS1])
    expect(real).not.toContain(needle);
  const synthetic = JSON.stringify(await search('alice-s', w.ws.WS1!, 'realwerk', 'synthetic'));
  for (const needle of ['Acme Realwerk GmbH', w.org.OR1, w.ws.WR1])
    expect(synthetic).not.toContain(needle);
});

test('exact lane: the profile host with and without www, short keys, the typed name and percent signs', async () => {
  const a = await w.freshWriter(
    'www-' + randomLabel(),
    'Unrelated Firma GmbH',
    'https://wwwhost-handel.de',
  );
  expect(await found(a.who, a.workspaceId, 'zzz')).toEqual([w.org.ORW]);
  const b = await w.freshWriter(
    'host-' + randomLabel(),
    'Unrelated Firma GmbH',
    'https://www.pilot-realwerk.de',
  );
  expect(await found(b.who, b.workspaceId, 'qqq')).toEqual([w.org.OR5]);
  // A name key shorter than three letters never takes the exact lane, from the profile or from the typed text.
  const c = await w.freshWriter('short-' + randomLabel(), 'Ab GmbH');
  expect(await found(c.who, c.workspaceId, 'zzz')).toEqual([]);
  expect(await found(c.who, c.workspaceId, 'AB!')).toEqual([]);
  expect(await found(c.who, c.workspaceId, '%%%')).toEqual([]);
  // The typed name drives the exact lane through its normalised key, whatever the punctuation.
  const d = await w.freshWriter('typed-' + randomLabel(), 'Unrelated Firma GmbH');
  expect(await found(d.who, d.workspaceId, 'CAPWERK-ZULU, gmbh')).toEqual([w.org['CAP-Zulu']]);
});

test('exact rows fill the cap first, duplicates are removed, at most ten rows, ordered by name then id', async () => {
  const plain = await w.freshWriter('plain-' + randomLabel(), 'Unrelated Firma GmbH');
  const names = (await search(plain.who, plain.workspaceId, 'capwerk')).organisations.map(
    (o) => o.name,
  );
  expect(names).toHaveLength(10);
  expect(names).toEqual([...names].sort());
  expect(names).not.toContain('Capwerk Zulu GmbH');
  // The saved company is the last name alphabetically but takes the exact lane, so it is kept and the tail is dropped.
  const exact = await w.freshWriter('exact-' + randomLabel(), 'Capwerk Zulu GmbH');
  const result = (await search(exact.who, exact.workspaceId, 'capwerk')).organisations;
  expect(result).toHaveLength(10);
  expect(result.filter((o) => o.id === w.org['CAP-Zulu'])).toHaveLength(1);
  expect(result.map((o) => o.name)).toEqual([
    ...['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'].map(
      (n) => `Capwerk ${n} GmbH`,
    ),
    'Capwerk Zulu GmbH',
  ]);
  // Nothing in the answer says which lane a row came from.
  expect(Object.keys(result[9]!).sort()).toEqual(['country', 'id', 'name']);
});

test('the answer has exactly the agreed keys, no total and no flag', async () => {
  const body = await search('alice-r', w.ws.WR1!, 'acme');
  expect(Object.keys(body).sort()).toEqual(['expiresAt', 'organisations', 'workspaceId']);
  expect(body.workspaceId).toBe(w.ws.WR1);
  for (const o of body.organisations)
    expect(Object.keys(o).sort()).toEqual(['country', 'id', 'name']);
  expect(body.organisations.length).toBeLessThanOrEqual(10);
  expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60000);
  expect(body.organisations.map((o) => o.id)).toEqual([w.org.OR1]);
});

test('every cause of an empty answer gives the same body as a miss, and a company without a rights record is returned', async () => {
  const miss = await search('erin-r', w.ws.WR5!, 'zzzq');
  expect(miss.organisations).toEqual([]);
  const reference = shape(miss);
  // Other provenance, expired identifier, hidden organisation.
  for (const term of ['orchid', 'beta', 'gamma'])
    expect(shape(await search('erin-r', w.ws.WR5!, term))).toEqual(reference);
  // Another country.
  const spain = await w.freshWriter('es-' + randomLabel(), 'Nonesuch Handel GmbH', null, 'ES');
  expect(shape(await search(spain.who, spain.workspaceId, 'acme'))).toEqual(reference);
  // Ten searches within ten minutes.
  const ten = await w.freshWriter('ten-' + randomLabel());
  await w.addAttempts(ten.who, Array(10).fill('1 minute'));
  const limited = await search(ten.who, ten.workspaceId, 'acme');
  expect(shape(limited)).toEqual(reference);
  // Sixty searches within a day, none within ten minutes.
  const day = await w.freshWriter('day-' + randomLabel());
  await w.addAttempts(day.who, Array(60).fill('20 hours'));
  expect(shape(await search(day.who, day.workspaceId, 'acme'))).toEqual(reference);
  // The clock value is built the same way in every branch.
  for (const body of [miss, limited]) {
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60000);
  }
  // A company that has no rights record is found like any other.
  expect(await found('erin-r', w.ws.WR5!, 'delta bau')).toEqual([w.org.OR4]);
});

test('an empty answer on a workspace whose own company is listed can only mean limited (documented limit)', async () => {
  const mine = await w.freshWriter(
    'own-' + randomLabel(),
    'Acme Realwerk GmbH',
    'https://www.acme-gmbh.de',
  );
  expect(await found(mine.who, mine.workspaceId, 'zzz')).toEqual([w.org.OR1]);
  await w.addAttempts(mine.who, Array(10).fill('1 minute'));
  expect(await found(mine.who, mine.workspaceId, 'zzz')).toEqual([]);
});

test('a hidden organisation is found again once it is shown, and both rows stay in history (O3, O9)', async () => {
  const writer = await w.freshWriter('shown-' + randomLabel());
  expect(await found(writer.who, writer.workspaceId, 'gamma')).toEqual([]);
  await w.suppress('OR3', 'shown');
  expect(await found(writer.who, writer.workspaceId, 'gamma')).toEqual([w.org.OR3]);
  if (!baseCheck) {
    const history = await w.f.owner.query(
      'SELECT version,state FROM customer_private.organisation_suppression WHERE organisation_id=$1 ORDER BY version',
      [w.org.OR3],
    );
    expect(history.rows).toEqual([
      { version: 1, state: 'hidden' },
      { version: 2, state: 'shown' },
    ]);
  }
});

test('rate limit: ten in ten minutes, sixty in a day, back-dated rows stop counting, invalid searches write nothing', async () => {
  const a = await w.freshWriter('rate-' + randomLabel());
  for (let n = 1; n <= 10; n += 1)
    expect(await found(a.who, a.workspaceId, 'acme')).toEqual([w.org.OR1]);
  expect(await found(a.who, a.workspaceId, 'acme')).toEqual([]);
  expect(await w.attempts(a.who)).toBe(10);
  // Sixty in a day.
  const b = await w.freshWriter('daily-' + randomLabel());
  await w.addAttempts(b.who, Array(59).fill('20 hours'));
  expect(await found(b.who, b.workspaceId, 'acme')).toEqual([w.org.OR1]);
  expect(await found(b.who, b.workspaceId, 'acme')).toEqual([]);
  expect(await w.attempts(b.who)).toBe(60);
  // Rows older than ten minutes no longer count towards the short cap.
  const c = await w.freshWriter('aged-' + randomLabel());
  await w.addAttempts(c.who, Array(10).fill('11 minutes'));
  expect(await found(c.who, c.workspaceId, 'acme')).toEqual([w.org.OR1]);
  expect(await w.attempts(c.who)).toBe(11);
  // Invalid text and a missing profile write no row.
  const d = await w.freshWriter('invalid-' + randomLabel());
  const direct = new RawSearch(w.f.runtime, w.f.auth, realOptions, async () => ({
    subject: 'link-a-' + d.who,
    email: `${d.who}@business.test`,
    emailVerified: true,
    expiresAt: new Date(Date.now() + 3600000),
  }));
  expect((await failure(direct.raw(d.workspaceId, 'ab')))?.message).toMatch(/Invalid search/);
  const bare = await w
    .workspaces(d.who, 'real')
    .provision({ commandId: randomUUID(), name: 'Workspace without a profile' });
  expect((await failure(search(d.who, bare.id, 'acme')))?.message).toMatch(
    /Save the company profile/,
  );
  expect(await w.attempts(d.who)).toBe(0);
});

test('rows older than a day are removed only by that person’s next search, young rows cannot be changed even by the owner', async () => {
  const x = await w.freshWriter('old-x-' + randomLabel());
  const y = await w.freshWriter('old-y-' + randomLabel());
  await w.addAttempts(x.who, ['25 hours', '26 hours', '30 hours']);
  await w.addAttempts(y.who, ['25 hours', '26 hours', '30 hours']);
  expect(await found(x.who, x.workspaceId, 'zzzq')).toEqual([]);
  expect(await w.attempts(x.who)).toBe(1);
  expect(await w.attempts(y.who)).toBe(3);
  const actor = await w.principalId(x.who);
  await expect(
    w.f.owner.query(
      'DELETE FROM customer_private.organisation_link_search_attempt WHERE actor_id=$1',
      [actor],
    ),
  ).rejects.toThrow(/recent search attempt/);
  await expect(
    w.f.owner.query(
      "UPDATE customer_private.organisation_link_search_attempt SET created_at=created_at-interval '2 days' WHERE actor_id=$1",
      [actor],
    ),
  ).rejects.toThrow(/Immutable record/);
  expect(await w.attempts(x.who)).toBe(1);
});

test('the count spans every workspace of the person, and no search text is stored', async () => {
  const a = await w.freshWriter('span-' + randomLabel());
  await w.workspace('F-second-' + a.who, a.who, 'real', 'Another Firma GmbH', null);
  const second = w.ws['F-second-' + a.who]!;
  for (let n = 0; n < 5; n += 1) await search(a.who, a.workspaceId, 'zzzq');
  for (let n = 0; n < 5; n += 1) await search(a.who, second, 'zzzq');
  expect(await w.attempts(a.who)).toBe(10);
  expect(await found(a.who, second, 'acme')).toEqual([]);
  expect(await w.attempts(a.who)).toBe(10);
  const probe = await w.freshWriter('term-' + randomLabel());
  await search(probe.who, probe.workspaceId, 'zzqxunique');
  if (baseCheck) return;
  const columns = await w.f.owner.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='customer_private' AND table_name='organisation_link_search_attempt' ORDER BY column_name",
  );
  expect(columns.rows.map((r) => r.column_name)).toEqual(['actor_id', 'created_at', 'id']);
  const dump = await w.f.owner.query(
    'SELECT to_jsonb(a)::text t FROM customer_private.organisation_link_search_attempt a',
  );
  expect(dump.rows.map((r) => r.t).join(' ')).not.toMatch(/zzqxunique|acme|zzzq/);
});

test('two searches at nine counted rows run the lookup once (race)', async () => {
  const a = await w.freshWriter('race-' + randomLabel());
  await w.addAttempts(a.who, Array(9).fill('1 minute'));
  const results = await Promise.all([
    found(a.who, a.workspaceId, 'acme'),
    found(a.who, a.workspaceId, 'acme'),
  ]);
  expect(results.map((r) => r.length).sort()).toEqual([0, 1]);
  expect(await w.attempts(a.who)).toBe(10);
});

test('only an owner or admin with a current session may search; others read as denied', async () => {
  const owner = await w.freshWriter('roles-' + randomLabel(), 'Acme Realwerk GmbH');
  const invited = await w.workspaces(owner.who, 'real').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: owner.workspaceId,
    label: 'Invited colleague',
  });
  const memberId = (
    await w.workspaces('member-' + owner.who, 'real').access({
      action: 'accept',
      commandId: randomUUID(),
      token: invited.token!,
    })
  ).memberId!;
  const member = 'member-' + owner.who;
  expect((await failure(search(member, owner.workspaceId, 'acme')))?.message).toMatch(
    /owner or admin required/i,
  );
  expect((await failure(search('erin-r', owner.workspaceId, 'acme')))?.message).toMatch(
    /owner or admin required/i,
  );
  expect((await failure(search(owner.who, randomUUID(), 'acme')))?.message).toMatch(
    /owner or admin required/i,
  );
  await w.workspaces(owner.who, 'real').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId: owner.workspaceId,
    kind: 'membership',
    targetId: memberId,
  });
  expect(await failure(search(member, owner.workspaceId, 'acme'))).not.toBeNull();
  expect(
    (
      await failure(
        w.link(owner.who, 'real', -1000).search({ workspaceId: owner.workspaceId, q: 'acme' }),
      )
    )?.message,
  ).toMatch(/sign in/i);
  const signedOut = new CustomerOrganisationLinkService(
    w.f.runtime,
    w.f.auth,
    realOptions,
    async () => null as never,
  );
  expect(
    await failure(signedOut.search({ workspaceId: owner.workspaceId, q: 'acme' })),
  ).not.toBeNull();
  // The owner searches, then the account is disabled and is refused.
  expect(await found(owner.who, owner.workspaceId, 'acme')).toEqual([w.org.OR1]);
  await w.f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    ['link-a-' + owner.who],
  );
  expect(await failure(search(owner.who, owner.workspaceId, 'acme'))).not.toBeNull();
  expect(await w.attempts(member)).toBe(0);
});
