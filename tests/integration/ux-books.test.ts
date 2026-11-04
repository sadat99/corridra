import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
import { catalogs, en, translate, type MessageKey } from '../../apps/web/lib/i18n/messages';
import { localeCodes } from '../../apps/web/lib/i18n/locales';
import { uxSwitchNames } from '../../apps/web/lib/ux-switches';

// The Trip Book and Supplier Book switch (ADR-076, E2a): a real owner switch, off unless exactly 'true', with a
// route that can only be started by a deliberate same-origin POST. The route's behaviour is proved against the
// real database in customer-book-route.test.ts; the database function in customer-books.test.ts.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));
const { booksAvailable } = await import('../../apps/web/lib/book-availability');

describe('the books switch', () => {
  const entry = () => switchRegistry.find((s) => s.name === 'CORRIDRA_UX_BOOKS')!;
  const state = (env: NodeJS.ProcessEnv) =>
    new Map(describeSwitches(env).flatMap((g) => g.rows.map((r) => [r.name, r.state.text]))).get(
      'CORRIDRA_UX_BOOKS',
    );
  it('is a real owner switch, read through the shared switch names', () => {
    expect(entry().kind).toBe('flag');
    expect(entry().label).toBe('Trip and Supplier books');
    expect(uxSwitchNames).toContain('CORRIDRA_UX_BOOKS');
  });
  it('is described in plain words: what it does, what it needs and that a file cannot be recalled', () => {
    const line = entry().line;
    expect(line).not.toMatch(/[–—]/);
    expect(line).toMatch(/database module/i);
    expect(line).toContain('cannot be recalled');
    // Honest about the state of the build: the route and the download panel on the saved mission page.
    expect(line).toContain('download route');
    expect(line).toContain('download panel');
    expect(line).toContain('saved mission page');
    expect(line).not.toContain('following step');
    expect(line).not.toMatch(/^Lets a signed-in customer download/);
    expect(line).toMatch(/PDF/);
  });
  it('is Off unless the setting is exactly "true"', () => {
    expect(state({})).toBe('Off');
    expect(state({ CORRIDRA_UX_BOOKS: 'true' })).toBe('On');
    for (const value of ['TRUE', '1', 'yes', 'false', ''])
      expect(state({ CORRIDRA_UX_BOOKS: value })).toBe('Off');
  });
  it('leaves the decision card switch planned', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_SHARE_CARD')?.kind).toBe('planned');
  });
});

describe('availability for a page', () => {
  afterEach(() => vi.restoreAllMocks());
  const enabled = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_UX_BOOKS: 'true',
  };
  it('reads nothing from the database while the switch is off', async () => {
    const readInstalled = vi.fn(async () => true);
    expect(await booksAvailable(readInstalled, { ...enabled, CORRIDRA_UX_BOOKS: 'TRUE' })).toBe(
      false,
    );
    expect(await booksAvailable(readInstalled, {})).toBe(false);
    expect(readInstalled).not.toHaveBeenCalled();
  });
  it('is true only when the switch is on and the module is installed', async () => {
    expect(await booksAvailable(async () => true, enabled)).toBe(true);
    expect(await booksAvailable(async () => false, enabled)).toBe(false);
  });
  it('fails closed and logs only the error code, never the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('relation "secret_table" does not exist'), {
      code: '42P01',
    });
    expect(
      await booksAvailable(async () => {
        throw failure;
      }, enabled),
    ).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('42P01');
    expect(String(log.mock.calls[0]![0])).not.toContain('secret_table');
  });
});

describe('the route source contract', () => {
  const route = read('apps/web/app/api/customer-books/route.ts');
  it('answers POST only, never cached, on the Node runtime', () => {
    expect(route).toContain("export const runtime = 'nodejs';");
    expect(route).toContain("export const dynamic = 'force-dynamic';");
    expect(route).toContain('export async function POST(');
    expect(route).not.toMatch(/export (async )?function (GET|HEAD|PUT|PATCH|DELETE)\b/);
  });
  it('checks the switch, the origin, the content type and the body size before it does any work', () => {
    const order = [
      'customerBooksEnabled()',
      "request.headers.get('origin') !== s.config.APP_ORIGIN",
      "startsWith('application/json')",
      'boundedBody(request, 2048)',
      's.delivery.budget(client, input.resourceId)',
      's.customerBooks.generate(',
    ].map((text) => route.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('makes the file inside the generation, by passing the renderer in, so a book that cannot be made leaves no record', () => {
    expect(route).toMatch(/generate\(\s*input,\s*bookPdf,/);
    expect(route).not.toMatch(/await bookPdf\(/);
  });
  it('sends a PDF with the private headers and a fixed ASCII file name, and reads the digest and time from the record', () => {
    expect(route).toContain('...deliveryHeaders');
    expect(route).toContain("'Content-Type': 'application/pdf'");
    expect(route).toContain('attachment; filename="corridra-${name}-book-');
    expect(route).toContain("'X-Corridra-Book-Digest': book.digest");
    expect(route).toContain("'X-Corridra-Book-Replayed': String(book.replayed)");
    expect(route).toContain("'X-Corridra-Book-Generated-At': book.generatedAt");
    // The file name never comes from mission text.
    expect(route).not.toMatch(/projection\.(title|company)/);
  });
  it('maps a missing database module to 503 and leaves every other error to the shared delivery error', () => {
    expect(route).toContain("['42P01', '3F000', '42883']");
    expect(route).toContain('deliveryError(');
  });
});

// The download panel (E2b). The browser behaviour is in tests/operator/ux-books.spec.ts; these checks prove the
// words, that the panel is wired to the saved mission page only and only when told to, and what it renders at rest.
describe('the words', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('books.')) as MessageKey[];
  it('are 27 keys, each present in English and in every other catalog', () => {
    expect(keys).toHaveLength(27);
    for (const code of localeCodes)
      for (const key of keys) expect(catalogs[code][key]?.trim(), `${code}.${key}`).toBeTruthy();
  });
  it('use no dash as punctuation, never the word digest, and name the file a code the person can quote', () => {
    for (const key of keys) {
      expect(en[key], key).not.toMatch(/[—–]| - /);
      expect(en[key], key).not.toMatch(/digest|checkbox|tick/i);
    }
    expect(en['books.success.detail']).toBe(
      'Created {time}. Content code {code}. Give this code to the Corridra team if you ask about the file.',
    );
    expect(en['books.tooMany']).toBe(
      'Too many downloads for this mission just now. Try again later.',
    );
    // In Corridra a quote is a price quote, so the code is never something to "quote".
    expect(en['books.success.detail']).not.toMatch(/quote/i);
    expect(en['books.notice']).toBe(
      'A downloaded file cannot be recalled. If access is withdrawn later, the file stays on your device and with anyone you send it to.',
    );
  });
  it('stay English placeholders in the six other languages until a native reviewer signs them off (D16)', () => {
    for (const code of localeCodes.filter((c) => c !== 'en'))
      for (const key of keys) expect(translate(code, key), `${code}.${key}`).toBe(en[key]);
  });
  it('are recorded as needing review, never as reviewed', () => {
    expect(read('docs/product/language-review-record.md')).toMatch(
      /books\.\*[^\n]*review not yet recorded/i,
    );
  });
});

describe('the wiring', () => {
  const page = read('apps/web/app/account/missions/[resourceId]/page.tsx');
  const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
  it('reads the panel switch on the server and passes it to the saved mission page', () => {
    expect(page).toContain("import { booksForPage } from '../../../../lib/book-availability'");
    expect(page).toContain('books={await booksForPage()}');
  });
  it('shows the panel only when told to, only on the whole page, after everything else, and nowhere else', () => {
    expect(report).toContain('books?: boolean;');
    expect(report).toContain('books = false');
    expect(report).toMatch(/\{showRest && books && \(\s*<BookDownloads/);
    expect(report.lastIndexOf('<BookDownloads')).toBeGreaterThan(
      report.indexOf('Evidence requests and declarations'),
    );
    for (const file of [
      'apps/web/app/account/rooms/[requestId]/room-view.tsx',
      'apps/web/app/account/rooms/[requestId]/trip-list.tsx',
      'apps/web/app/account/rooms/[requestId]/page.tsx',
    ])
      expect(read(file), file).not.toMatch(/BookDownloads|booksForPage|book-downloads/);
  });
  it('keeps the panel inside the page frame: no language or direction of its own, no field, no tooltip', () => {
    const panel = read('apps/web/app/account/missions/book-downloads.tsx');
    expect(panel).not.toMatch(/\blang=|\bdir=|type="checkbox"|<input|title=/);
    expect(panel).toContain('acknowledged: true');
    expect(panel).toContain("cache: 'no-store'");
    expect(panel).toContain('savedMissionHeaders');
    expect(panel).toContain('revokeObjectURL');
    expect(panel).toContain('/api/customer-books');
  });
});

const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
const panelPath = '../../apps/web/app/account/missions/book-downloads';
const loadPanel = async () => await import(/* @vite-ignore */ panelPath);
const id = '33333333-3333-4333-8333-333333333333';
async function unconfirmed() {
  const { createPendingBooks } = await loadPanel();
  const pending = createPendingBooks();
  pending.ensure('TRIP');
  return pending;
}
async function markup(over: Record<string, unknown> = {}) {
  const { BookDownloads, createPendingBooks } = await loadPanel();
  return renderToStaticMarkup(
    createElement(BookDownloads, {
      subject: 's',
      issuer: 'https://example.invalid/auth',
      resourceId: id,
      tripCount: 3,
      supplierCount: 1,
      pending: createPendingBooks(),
      onDenied: () => {},
      onChanged: () => {},
      ...over,
    }),
  );
}

describe('the panel at rest', () => {
  it('is one closed disclosure with a heading, the notice, two enabled buttons and an empty status slot', async () => {
    const html = await markup();
    expect(html).toMatch(/<details class="ux-mission-detail book-downloads">/);
    expect(html).not.toContain(' open');
    expect(html).toContain('<h2>Download a Trip Book or Supplier Book</h2>');
    expect(html).toContain('Trip Book: 3 meetings or visits. Supplier Book: 1 company.');
    expect(html).toContain('<strong>A downloaded file cannot be recalled.</strong>');
    expect(html).toContain('Download Trip Book (PDF)');
    expect(html).toContain('Download Supplier Book (PDF)');
    expect(html).not.toMatch(/disabled/);
    expect(html).toContain('<p role="status"></p>');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/<input/);
  });
  it('points both buttons at the notice, so it is read at the button', async () => {
    const html = await markup();
    const notice = /<p id="([^"]+)"><strong>A downloaded file/.exec(html)?.[1];
    expect(notice).toBeTruthy();
    expect(html.split(`aria-describedby="${notice}"`)).toHaveLength(3);
  });
  it('disables a book with nothing reviewed and says why in visible text, not a tooltip', async () => {
    const html = await markup({ tripCount: 0, supplierCount: 0 });
    expect(html).toContain('Trip Book: none yet. Supplier Book: none yet.');
    // A book with nothing to download is marked, not removed from the tab order, so the focus can stay on it.
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html).not.toMatch(/ disabled=/);
    expect(html).toContain(
      'No meetings or visits have been reviewed yet, so there is no Trip Book.',
    );
    expect(html).toContain('No companies have been reviewed yet, so there is no Supplier Book.');
    expect(html).not.toContain('title=');
    const one = await markup({ tripCount: 2, supplierCount: 0 });
    expect(one.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(one).not.toMatch(/ disabled=/);
    expect(one).not.toContain('there is no Trip Book');
    expect(one).toContain('there is no Supplier Book');
  });
  it('shows the cannot-confirm alert again when it is mounted with a download not yet confirmed', async () => {
    const html = await markup({
      pending: await unconfirmed(),
    });
    expect(html).toContain(
      '<p role="alert">We could not confirm the download. Try again. It will not create a second record.</p>',
    );
    expect(html).toContain('<p role="status"></p>');
  });
});
