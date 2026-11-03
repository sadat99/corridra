import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { future } from './access-fixture';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerBookService } from '../../packages/auth/src/customer-books';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';

// The route that makes a book (ADR-076), called for real against the real database function with the
// restricted runtime role. Only the identity provider is replaced: the session is a fixed synthetic one.
const account = vi.hoisted(() => ({ services: null as unknown, who: 'alice' }));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => account.services }));
import * as route from '../../apps/web/app/api/customer-books/route';

const issuer = 'https://ep-book-route.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const origin = 'https://corridra.example.invalid';
const options = { enabled: true, synthetic: true, production: false, issuer };
const session = (who: string) => ({
  subject: 'synthetic-book-route-' + who,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let f: Awaited<ReturnType<typeof commercialFixture>>;
let resourceId: string;
const post = (
  body: unknown,
  headers: Record<string, string> = {},
  raw = typeof body === 'string' ? body : JSON.stringify(body),
) =>
  route.POST(
    new Request(origin + '/api/customer-books', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-corridra-customer-subject': session(account.who).subject,
        'x-corridra-customer-issuer': issuer,
        ...headers,
      },
      body: raw,
    }),
  );
const input = (kind: string, over: Record<string, unknown> = {}) => ({
  resourceId,
  commandId: randomUUID(),
  kind,
  acknowledged: true,
  ...over,
});
const ledger = async () =>
  (
    await f.owner.query(
      "SELECT count(*)::int n FROM customer_private.saved_mission_command WHERE input->>'action'='book'",
    )
  ).rows[0].n as number;

beforeAll(async () => {
  f = await commercialFixture();
  const delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-book-route');
  await migrateCustomerBooks(f.owner);
  for (const who of ['alice', 'bob'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(who).subject,
      executorId: f.serviceId,
      reason: 'Fictional customer book route fixture, never real provider data',
    });
  // One reviewed meeting and no shortlist: the Trip Book has content and the Supplier Book is empty.
  const target = await f.target('ES');
  const held = await f.held(undefined, target);
  const publication = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: target.missionId,
    title: 'Approved synthetic mission for the book route',
    company: 'Fictional requesting company',
    objective: 'Check the route that makes a book',
    brief: 'Approved summary without private supplier contacts',
    nextAction: 'Wait for the review',
    dueAt: future(),
    meetings: [{ id: held.meetingId, version: 4, label: 'Reviewed conversation' }],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic book route check',
    expiresAt: future(2),
    allowExport: false,
    approved: true,
  });
  resourceId = (
    await new CustomerSavedMissionService(f.runtime, f.auth, options, async () =>
      session('alice'),
    ).command({ action: 'save', commandId: randomUUID(), token: link.token, acknowledged: true })
  ).id;
  account.services = {
    delivery,
    customerBooks: new CustomerBookService(f.runtime, f.auth, options, async () =>
      session(account.who),
    ),
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
  };
});
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});
const switchOn = () => {
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_UX_BOOKS', 'true');
};

describe('the book route', () => {
  test('with the switch off it answers 503 and writes nothing', async () => {
    vi.unstubAllEnvs();
    for (const value of [undefined, 'TRUE', '1', 'false']) {
      switchOn();
      if (value === undefined) vi.stubEnv('CORRIDRA_UX_BOOKS', '');
      else vi.stubEnv('CORRIDRA_UX_BOOKS', value);
      const before = await ledger();
      const response = await post(input('TRIP'));
      expect(response.status).toBe(503);
      expect(await ledger()).toBe(before);
    }
    vi.unstubAllEnvs();
    switchOn();
    vi.stubEnv('CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED', 'false');
    expect((await post(input('TRIP'))).status).toBe(503);
    vi.unstubAllEnvs();
  });

  test('has no GET, so no link, prefetch or crawler can start a generation', () => {
    expect(Object.keys(route).filter((key) => /^[A-Z]+$/.test(key))).toEqual(['POST']);
  });

  test('makes a Trip Book PDF with private headers, a fixed file name and the recorded time and code', async () => {
    switchOn();
    const response = await post(input('TRIP'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const generatedAt = response.headers.get('x-corridra-book-generated-at')!;
    expect(generatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="corridra-trip-book-${generatedAt.slice(0, 10).replaceAll('-', '')}.pdf"`,
    );
    expect(response.headers.get('x-corridra-book-digest')).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get('x-corridra-book-replayed')).toBe('false');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(Number(response.headers.get('content-length'))).toBe(bytes.length);
    const stamp = generatedAt.replaceAll(/[-:]/g, '').replace('T', '').replace('Z', '');
    expect(bytes.toString('latin1')).toContain(`(D:${stamp}Z)`);
  });

  test('a retry with the same command id returns the same file once, and says it is a replay', async () => {
    switchOn();
    const body = input('TRIP');
    const before = await ledger();
    const first = await post(body);
    const second = await post(body);
    expect(first.headers.get('x-corridra-book-replayed')).toBe('false');
    expect(second.headers.get('x-corridra-book-replayed')).toBe('true');
    for (const name of ['x-corridra-book-digest', 'x-corridra-book-generated-at'])
      expect(second.headers.get(name)).toBe(first.headers.get(name));
    expect(
      Buffer.from(await second.arrayBuffer()).equals(Buffer.from(await first.arrayBuffer())),
    ).toBe(true);
    expect(await ledger()).toBe(before + 1);
  });

  test('a book with nothing reviewed is 422 in plain words and writes nothing', async () => {
    switchOn();
    const before = await ledger();
    const response = await post(input('SUPPLIER'));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'Nothing has been reviewed for this book yet.',
    });
    expect(await ledger()).toBe(before);
  });

  test('every loss of access is the same 403, whatever the cause', async () => {
    switchOn();
    const before = await ledger();
    account.who = 'bob';
    const otherCustomer = await post(input('TRIP'));
    account.who = 'alice';
    const unknown = await post(input('TRIP', { resourceId: randomUUID() }));
    for (const response of [otherCustomer, unknown]) expect(response.status).toBe(403);
    expect(await otherCustomer.json()).toEqual(await unknown.json());
    // A browser that still shows another account is refused the same way, not as a content conflict.
    const changed = await post(input('TRIP'), { 'x-corridra-customer-subject': 'someone-else' });
    expect(changed.status).toBe(403);
    expect(await ledger()).toBe(before);
  });

  test('refuses a foreign origin, a non-JSON body, an oversized body and bad input', async () => {
    switchOn();
    const before = await ledger();
    expect((await post(input('TRIP'), { Origin: 'https://elsewhere.invalid' })).status).toBe(403);
    expect((await post(input('TRIP'), { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post(input('TRIP', { padding: 'x'.repeat(4000) }))).status).toBe(413);
    for (const bad of [
      input('TRIP', { acknowledged: false }),
      input('CSV'),
      input('TRIP', { tenantId: randomUUID() }),
      { resourceId },
    ])
      expect((await post(bad)).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect(await ledger()).toBe(before);
  });

  test('a signed-out caller gets 401 in plain words and writes nothing', async () => {
    switchOn();
    const before = await ledger();
    const signedOut = account.services as { customerBooks: unknown };
    const original = signedOut.customerBooks;
    signedOut.customerBooks = new CustomerBookService(f.runtime, f.auth, options, async () => null);
    try {
      const response = await post(input('TRIP'));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Sign in to continue' });
    } finally {
      signedOut.customerBooks = original;
    }
    expect(await ledger()).toBe(before);
  });

  test('the module not installed is 503, not a server error', async () => {
    switchOn();
    await f.owner.query(
      'ALTER FUNCTION customer.saved_mission_book(uuid,text,uuid,boolean) RENAME TO saved_mission_book_hidden',
    );
    try {
      const response = await post(input('TRIP'));
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('Trip and Supplier books are unavailable');
    } finally {
      await f.owner.query(
        'ALTER FUNCTION customer.saved_mission_book_hidden(uuid,text,uuid,boolean) RENAME TO saved_mission_book',
      );
    }
  });
});
