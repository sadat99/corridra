import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ADR-089. The two Connect AI actions on the workspace route answer 404, before the service is called, unless
// CORRIDRA_AI_CONNECT_FORM is exactly "true". The service and the database behind them are in ai-connect.test.ts.
const session = vi.fn();
const connectOptions = vi.fn();
const connect = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/communication-orchestrator', () => ({ communicationOrchestrator: {} }));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: session },
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    // A write reads the workspace switches first; none is needed here.
    access: { config: async () => [] },
    intelligence: { connectOptions, connect },
  }),
}));
const route = async () => await import('../../apps/web/app/api/workspace/[action]/route');
const tenant = randomUUID();
const url = `https://app.corridra.test/api/workspace/ai-connect?tenant=${tenant}`;
const params = () => ({ params: Promise.resolve({ action: 'ai-connect' }) });
const get = async (query = '') => (await route()).GET(new Request(url + query), params());
const post = async () =>
  (await route()).POST(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.corridra.test' },
      body: JSON.stringify({ adapter: 'openai' }),
    }),
    params(),
  );
const saved = process.env.CORRIDRA_AI_CONNECT_FORM;

beforeEach(() => {
  session.mockReset().mockResolvedValue({ token: 'staff-token' });
  connectOptions.mockReset().mockResolvedValue({ canConnect: true });
  connect.mockReset().mockResolvedValue({ id: randomUUID(), version: 1 });
});
afterEach(() => {
  if (saved === undefined) delete process.env.CORRIDRA_AI_CONNECT_FORM;
  else process.env.CORRIDRA_AI_CONNECT_FORM = saved;
});

describe('the Connect AI actions on the workspace route', () => {
  test('answer 404 and call nothing while the switch is not exactly "true"', async () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', ' true']) {
      if (value === undefined) delete process.env.CORRIDRA_AI_CONNECT_FORM;
      else process.env.CORRIDRA_AI_CONNECT_FORM = value;
      for (const send of [get, post]) {
        const response = await send();
        expect(response.status, String(value)).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect((await response.json()).error).toBe('Not found');
      }
    }
    expect(connectOptions).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  test('reach the service with the staff session and tenant when the switch is "true"', async () => {
    process.env.CORRIDRA_AI_CONNECT_FORM = 'true';
    const read = await get();
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ canConnect: true });
    expect(connectOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: 'staff-token', tenantId: tenant }),
      undefined,
    );
    // The chosen provider reaches the service, which leaves that provider's own connection out of the fallbacks.
    expect((await get('&adapter=openai')).status).toBe(200);
    expect(connectOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: 'staff-token', tenantId: tenant }),
      'openai',
    );
    const write = await post();
    expect(write.status).toBe(201);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'staff-token', tenantId: tenant }),
      { adapter: 'openai' },
    );
  });

  test('still need a signed-in staff session with the switch on', async () => {
    process.env.CORRIDRA_AI_CONNECT_FORM = 'true';
    session.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect(connectOptions).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
