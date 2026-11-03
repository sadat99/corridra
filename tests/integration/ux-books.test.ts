import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
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
      'await bookPdf(book)',
    ].map((text) => route.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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
