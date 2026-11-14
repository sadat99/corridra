import { beforeAll, afterAll, afterEach, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import {
  CustomerProgrammePublicationService,
  ProgrammePageReader,
  customerProgrammePagesEnabled,
  customerProgrammeShareKitEnabled,
} from '../../packages/auth/src/customer-programme-publication';

// ADR-084 slice S1: the switch, the organiser route, and the public routes of the share kit (preview image, flyer, calendar
// file) and the public page itself, against the real database functions. Only the identity provider is replaced.
const account = vi.hoisted(() => ({ services: null as unknown }));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => account.services }));
import * as pagesRoute from '../../apps/web/app/api/customer-programme-pages/route';
import * as calendarRoute from '../../apps/web/app/delegations/[address]/calendar.ics/route';

const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { renderToStaticMarkup } = webRequire('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string;
};
// The .tsx modules are loaded with a dynamic import because the root typecheck has no jsx setting (as the other component
// tests do), so their shapes are restated here, narrowly.
type Params = { params: Promise<{ address: string }> };
type Meta = { openGraph?: object; twitter?: object; robots?: unknown; referrer?: string };
const loadTsx = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const imageRoute = (await loadTsx('app/delegations/[address]/preview-image/route.tsx')) as {
  GET: (request: Request, context: Params) => Promise<Response>;
};
const publicPage = (await loadTsx('app/delegations/[address]/page.tsx')) as {
  default: (props: Params) => Promise<unknown>;
  generateMetadata: (props: Params) => Promise<Meta>;
};
const flyerPage = (await loadTsx('app/delegations/[address]/flyer/page.tsx')) as {
  default: (props: Params) => Promise<unknown>;
  generateMetadata: (props: Params) => Promise<Meta>;
};
const issuer = 'https://ep-share-kit-routes.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const origin = 'https://corridra.example.invalid';
let f: Awaited<ReturnType<typeof fixture>>, workspaceId: string, programmeId: string;
const session = (person = 'alice') => ({
  subject: 'synthetic-kit-routes-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const pages = (person = 'alice') =>
  new CustomerProgrammePublicationService(f.runtime, f.auth, options, async () => session(person));
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const copy = (extra: Record<string, unknown> = {}) => ({
  title: 'Synthetic China agricultural machinery delegation',
  organiser: 'Synthetic Dhaka Agro Traders Association',
  summary: 'A ten company buying delegation to compare rice transplanters before the next season.',
  destination: 'Guangzhou and Foshan, China',
  dates: '12 to 18 April 2027, to be confirmed',
  focus: 'Agricultural machinery for small and medium farms',
  audience: 'Owners and buyers of importers and dealers who plan to place an order within a year.',
  eligibility: 'A registered business that imports or sells farm machinery.',
  activities: [{ label: 'Factory visits in Foshan', status: 'PLANNED' }],
  included: ['Programme coordination'],
  excluded: ['Flights'],
  ...extra,
});
const publish = (expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  action: 'publish',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  expectedVersion,
  copy: copy(extra),
  closesAt: new Date(Date.now() + 240 * 3600000).toISOString(),
  acknowledged: true,
});
const schedule = (version: number) => ({
  action: 'schedule',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  version,
  startsOn: '2027-04-12',
  endsOn: '2027-04-18',
});
const pagesOn = () => {
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_PROGRAMME_PAGES', 'true');
};
const kitOn = () => {
  pagesOn();
  vi.stubEnv('CORRIDRA_PROGRAMME_SHARE_KIT', 'true');
};
const serve = () => {
  account.services = {
    missions: { budget: async () => {} },
    customerProgrammePages: pages('alice'),
    programmePageReader: new ProgrammePageReader(f.runtime),
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
  };
};
afterEach(() => {
  vi.unstubAllEnvs();
});
const post = (body: unknown) =>
  pagesRoute.POST(
    new Request(origin + '/api/customer-programme-pages', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const view = async () =>
  (
    await pagesRoute.GET(
      new Request(
        origin +
          `/api/customer-programme-pages?view=page&workspaceId=${workspaceId}&programmeId=${programmeId}`,
      ),
    )
  ).json();
const params = (address: string) => ({ params: Promise.resolve({ address }) });
/** Everything a caller can observe of a response, for comparing two answers. */
const observed = async (r: Response) => ({
  status: r.status,
  type: r.headers.get('content-type'),
  cache: r.headers.get('cache-control'),
  disposition: r.headers.get('content-disposition'),
  body: Buffer.from(await r.arrayBuffer()).toString('hex'),
});
const notFound = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return String((error as { digest?: string }).digest ?? error);
  }
  return 'rendered';
};
const html = async (element: Promise<unknown>) => renderToStaticMarkup(await element);

let address = '';
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerParticipants(f.owner);
  await migrateCustomerProgrammePublication(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: session().subject,
    executorId: f.serviceId,
    reason: 'Explicit fictional share kit route fixture,no real customer account',
  });
  workspaceId = (
    await workspace().provision({ commandId: randomUUID(), name: 'Synthetic organiser workspace' })
  ).id;
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic share kit route acceptance',
      acknowledged: true,
    })
  ).id;
  address = (await pages().publication(publish(0))).address;
  serve();
}, 240000);
afterAll(async () => {
  await f?.close();
});

test('the share kit switch is off unless exactly true, and only where the public pages are on', () => {
  const on = {
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    CORRIDRA_PROGRAMME_PAGES: 'true',
  } as unknown as NodeJS.ProcessEnv;
  expect(customerProgrammePagesEnabled(on)).toBe(true);
  expect(customerProgrammeShareKitEnabled(on)).toBe(false);
  for (const value of ['TRUE', '1', 'yes', ' true', 'on', ''])
    expect(
      customerProgrammeShareKitEnabled({ ...on, CORRIDRA_PROGRAMME_SHARE_KIT: value }),
      value,
    ).toBe(false);
  expect(customerProgrammeShareKitEnabled({ ...on, CORRIDRA_PROGRAMME_SHARE_KIT: 'true' })).toBe(
    true,
  );
  // The kit alone is not enough.
  expect(
    customerProgrammeShareKitEnabled({
      CORRIDRA_PROGRAMME_SHARE_KIT: 'true',
    } as unknown as NodeJS.ProcessEnv),
  ).toBe(false);
});

test('the organiser route offers and takes the days only while the share kit is on', async () => {
  pagesOn();
  // Off: the view is exactly what it was, and stating days answers unavailable.
  const off = await view();
  expect(off).not.toHaveProperty('shareKit');
  expect(off).not.toHaveProperty('schedule');
  expect((await post({ kind: 'page', ...schedule(1) })).status).toBe(503);
  expect(await pages().view({ workspaceId, programmeId })).not.toHaveProperty('schedule');
  vi.stubEnv('CORRIDRA_PROGRAMME_SHARE_KIT', 'true');
  expect(await view()).toMatchObject({ shareKit: true, schedule: null });
  const made = await post({ kind: 'page', ...schedule(1) });
  expect(made.status).toBe(200);
  expect(await made.json()).toEqual({
    programmeId,
    version: 1,
    startsOn: '2027-04-12',
    endsOn: '2027-04-18',
  });
  expect(await view()).toMatchObject({
    shareKit: true,
    version: 1,
    schedule: { version: 1, startsOn: '2027-04-12', endsOn: '2027-04-18' },
  });
  // Other days for the same version: a named refusal the screen turns into words, never a fault.
  const again = await post({
    kind: 'page',
    ...schedule(1),
    startsOn: '2027-05-01',
    endsOn: '2027-05-02',
  });
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ code: 'PROGRAMME_SCHEDULE_ALREADY_SET' });
  // Unknown fields and bad days are refused before the database.
  expect((await post({ kind: 'page', ...schedule(1), extra: 1 })).status).toBe(400);
  expect((await post({ kind: 'page', ...schedule(1), startsOn: '2027-02-31' })).status).toBe(400);
});

test('with the share kit off, every share kit route answers the one 404, even for a page with days', async () => {
  pagesOn();
  const calendar = await observed(await calendarRoute.GET(new Request(origin), params(address)));
  const image = await observed(await imageRoute.GET(new Request(origin), params(address)));
  expect(calendar.status).toBe(404);
  expect(calendar.body).toBe('');
  expect(image).toEqual(calendar);
  expect(await notFound(flyerPage.default(params(address)))).toMatch(/404/);
  // The public page itself is as it was: no kit, no flyer or calendar link, no attribution, no image of its own.
  const markup = await html(publicPage.default(params(address)));
  expect(markup).toContain('Copy Link');
  expect(markup).not.toMatch(/programme-kit|\/flyer|calendar\.ics|Corridra Programmes|<img/);
  const meta = await publicPage.generateMetadata(params(address));
  expect(meta.openGraph).not.toHaveProperty('images');
  expect(meta.twitter).toMatchObject({ card: 'summary' });
  expect(meta.twitter).not.toHaveProperty('images');
});

test('with the share kit on, the calendar file is the stated days, and every other case is the same 404', async () => {
  kitOn();
  const found = await calendarRoute.GET(new Request(origin), params(address));
  expect(found.status).toBe(200);
  expect(found.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(found.headers.get('content-disposition')).toBe(`attachment; filename="${address}.ics"`);
  expect(found.headers.get('cache-control')).toBe('no-store');
  // Long lines are folded at 75 octets; unfolded, they are what the organiser's page says.
  const body = (await found.text()).replace(/\r\n /g, '');
  expect(body).toContain('DTSTART;VALUE=DATE:20270412');
  expect(body).toContain('DTEND;VALUE=DATE:20270419');
  expect(body).toContain('SUMMARY:Sample: Synthetic China agricultural machinery delegation');
  expect(body).toContain(`URL:${origin}/delegations/${address}`);
  expect(body).not.toMatch(/ATTENDEE|ORGANIZER|mailto:/);
  // A new version has no days: that page, an unknown address and a malformed one are the same single answer.
  expect((await pages().publication(publish(1))).version).toBe(2);
  const nodays = await observed(await calendarRoute.GET(new Request(origin), params(address)));
  const unknown = await observed(
    await calendarRoute.GET(new Request(origin), params('not-a-page-0123456789')),
  );
  const malformed = await observed(await calendarRoute.GET(new Request(origin), params('x')));
  expect(nodays.status).toBe(404);
  expect(unknown).toEqual(nodays);
  expect(malformed).toEqual(nodays);
});

test('the preview image is a 1200 by 630 picture of a readable page, and the same 404 for anything else', async () => {
  kitOn();
  const r = await imageRoute.GET(new Request(origin), params(address));
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('image/png');
  const png = Buffer.from(await r.arrayBuffer());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  const unknown = await observed(
    await imageRoute.GET(new Request(origin), params('not-a-page-0123456789')),
  );
  expect(unknown.status).toBe(404);
  expect(unknown.body).toBe('');
  // After the page is taken down the image is gone too.
  await pages().publication({
    action: 'withdraw',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    acknowledged: true,
  });
  expect(await observed(await imageRoute.GET(new Request(origin), params(address)))).toEqual(
    unknown,
  );
  expect(await observed(await calendarRoute.GET(new Request(origin), params(address)))).toEqual(
    unknown,
  );
  expect(await notFound(flyerPage.default(params(address)))).toMatch(/404/);
  expect(await notFound(flyerPage.default(params('not-a-page-0123456789')))).toMatch(/404/);
  // Both are the digest of the same not found state as the page itself.
  expect(await notFound(publicPage.default(params(address)))).toBe(
    await notFound(flyerPage.default(params(address))),
  );
});

test('the public page with the kit on: flyer and QR, a calendar link only with days, one quiet line, nothing sent or tracked', async () => {
  kitOn();
  // Version 3 with a fee line and days.
  expect((await pages().publication(publish(2, { fee: 'BDT 45,000 per company' }))).version).toBe(
    3,
  );
  expect(await html(publicPage.default(params(address)))).not.toContain('calendar.ics');
  await pages().publication(schedule(3));
  const markup = await html(publicPage.default(params(address)));
  expect(markup).toContain(`href="/delegations/${address}/flyer"`);
  expect(markup).toContain('Open Flyer');
  expect(markup).toContain(`href="/delegations/${address}/calendar.ics"`);
  expect(markup).toContain('Add to Calendar');
  expect(markup).toContain('Show QR Code');
  expect(markup).toContain('aria-controls="programme-kit-qr"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('id="programme-kit-qr" hidden=""');
  expect(markup).toContain('<img class="programme-qr" src="data:image/svg+xml');
  expect(markup).toContain('href="/trade-missions#organise-entry-title"');
  expect(markup).toContain('Page made with Corridra Programmes');
  // The three existing actions are unchanged.
  expect(markup).toContain('Copy Link');
  expect(markup).toContain('https://wa.me/?text=');
  expect(markup).toContain('https://www.facebook.com/sharer/sharer.php?u=');
  // Nothing new leaves the page: the only absolute web addresses are the two share links that were already there.
  const external = [...markup.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  expect(external.every((url) => /^https:\/\/(wa\.me|www\.facebook\.com)\//.test(url!))).toBe(true);
  // The one image is the QR code, which holds its own picture; there is no other image, script, frame or form.
  expect(
    [...markup.matchAll(/<img[^>]* src="([^"]+)"/g)].every((m) =>
      m[1]!.startsWith('data:image/svg+xml'),
    ),
  ).toBe(true);
  expect(markup).not.toMatch(/<script|<iframe|<form|ping=|\bref=|utm_|referral/i);
  const meta = await publicPage.generateMetadata(params(address));
  expect(meta.openGraph).toMatchObject({
    images: [{ url: `${origin}/delegations/${address}/preview-image`, width: 1200, height: 630 }],
  });
  expect(meta.twitter).toMatchObject({
    card: 'summary_large_image',
    images: [`${origin}/delegations/${address}/preview-image`],
  });
  expect(meta.robots).toEqual({ index: false, follow: false });
  // An address that opens nothing names no programme and offers no image.
  const none = await publicPage.generateMetadata(params('not-a-page-0123456789'));
  expect(JSON.stringify(none)).not.toMatch(/Synthetic|preview-image/);
});

test('the flyer holds the published words only: the fee as written, no totals, no counts, the stated by the organiser sentence', async () => {
  kitOn();
  const markup = await html(flyerPage.default(params(address)));
  for (const word of [
    'Synthetic China agricultural machinery delegation',
    'Guangzhou and Foshan, China',
    '12 to 18 April 2027, to be confirmed',
    'Owners and buyers of importers and dealers',
    'Synthetic Dhaka Agro Traders Association',
    'BDT 45,000 per company',
    'Fee as the organiser states it',
    'Everything on this flyer is stated by the organiser. Corridra has not checked these details and is not the travel operator.',
    'Sample. The programme and the organiser on this flyer are examples, not real offers.',
  ])
    expect(markup, word).toContain(word);
  expect(markup).toContain(`${origin}/delegations/${address}`);
  expect(markup).toContain('<img class="programme-qr" src="data:image/svg+xml');
  expect(markup).toContain('Print Flyer');
  // Not on it: applications, places, closing date, summary, activities, conversions or totals.
  expect(markup).not.toMatch(/application|Places|close|Factory visits|USD|EUR|total|Total/);
  expect(markup).not.toMatch(/<script|<iframe|<form|utm_|referral/i);
  expect([...markup.matchAll(/<img[^>]* src="([^"]+)"/g)].length).toBe(1);
  const meta = await flyerPage.generateMetadata(params(address));
  expect(meta).toMatchObject({ robots: { index: false, follow: false }, referrer: 'no-referrer' });
  // Without a fee line, none is shown or invented.
  expect((await pages().publication(publish(3))).version).toBe(4);
  const plain = await html(flyerPage.default(params(address)));
  expect(plain).not.toMatch(/Fee as the organiser states it|BDT/);
});
