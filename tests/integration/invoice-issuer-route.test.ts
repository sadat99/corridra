import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError, stepUpRequired } from '../../packages/domain/src/index';

// ADR-091 (unit B8). The Invoice issuer route answers 404, before any session or service is touched, unless
// CORRIDRA_INVOICE_ISSUER is exactly "true". The service and the database behind it are proved in
// customer-invoicing-real-issuer.test.ts.
const session = vi.fn();
const view = vi.fn();
const save = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: session },
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    invoiceIssuer: { view, save },
  }),
}));
const route = async () => await import('../../apps/web/app/operator/invoice-issuer/details/route');
const tenant = randomUUID();
const url = `https://app.corridra.test/operator/invoice-issuer/details?tenant=${tenant}`;
const body = { commandId: randomUUID(), expectedVersion: 1, legalName: 'Corridra Pte Ltd' };
const get = async (address = url) => (await route()).GET(new Request(address));
const post = async (headers: Record<string, string> = {}, text = JSON.stringify(body)) =>
  (await route()).POST(
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://app.corridra.test',
        ...headers,
      },
      body: text,
    }),
  );
const saved = process.env.CORRIDRA_INVOICE_ISSUER;

beforeEach(() => {
  session.mockReset().mockResolvedValue({ token: 'staff-token' });
  view.mockReset().mockResolvedValue({ version: 1, complete: false });
  save.mockReset().mockResolvedValue({ state: 'saved', version: 2 });
  process.env.CORRIDRA_INVOICE_ISSUER = 'true';
});
afterEach(() => {
  if (saved === undefined) delete process.env.CORRIDRA_INVOICE_ISSUER;
  else process.env.CORRIDRA_INVOICE_ISSUER = saved;
});

describe('the Invoice issuer route', () => {
  test('answers 404 and touches nothing while the switch is not exactly "true"', async () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', ' true']) {
      if (value === undefined) delete process.env.CORRIDRA_INVOICE_ISSUER;
      else process.env.CORRIDRA_INVOICE_ISSUER = value;
      for (const send of [() => get(), () => post()]) {
        const response = await send();
        expect(response.status, String(value)).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({ error: 'Not found' });
      }
    }
    expect(session).not.toHaveBeenCalled();
    expect(view).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test('reads and saves with the staff session and the named workspace', async () => {
    const read = await get();
    expect(read.status).toBe(200);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(await read.json()).toEqual({ version: 1, complete: false });
    const ctx = { token: 'staff-token', tenantId: tenant, purpose: 'synthetic_validation' };
    expect(view).toHaveBeenCalledWith(ctx);
    const written = await post();
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ state: 'saved', version: 2 });
    expect(save).toHaveBeenCalledWith(ctx, body);
  });

  test('refuses a missing sign-in, a missing workspace, another origin, a non-JSON body and an oversized body', async () => {
    session.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(401);
    expect((await get(url.replace(tenant, 'not-a-workspace'))).status).toBe(400);
    expect((await post({ origin: 'https://elsewhere.test' })).status).toBe(403);
    expect((await post({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({}, '{not json')).status).toBe(400);
    expect((await post({}, JSON.stringify({ pad: 'x'.repeat(9000) }))).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  test('passes a refusal on with its status and code and never the words of an unexpected error', async () => {
    save.mockRejectedValueOnce(stepUpRequired());
    const stepUp = await post();
    expect(stepUp.status).toBe(401);
    expect(await stepUp.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    save.mockRejectedValueOnce(
      new DomainError('The issuer details changed', 409, 'ISSUER_DETAILS_CHANGED'),
    );
    const conflict = await post();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'ISSUER_DETAILS_CHANGED' });
    view.mockRejectedValueOnce(
      Object.assign(new Error('row (072-123456-7) failed'), { code: 'XX000' }),
    );
    const failed = await get();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('072-123456-7');
  });
});
