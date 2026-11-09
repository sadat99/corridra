import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CRUD G5, staff side: the route behind the erasure queue. The staff session, the tenant and the fresh authenticator
// check are the existing ones. There is no scope input: the database decides sample or real from the staff workspace.
// A person's internal id never leaves the route, and every refusal leaves the database alone.
const enabled = { account: true };
const queue = vi.fn();
const transition = vi.fn();
const getSession = vi.fn();
const web = createRequire(resolve('apps/web/package.json'));
const lifecycleFile = web.resolve('@corridra/auth/customer-account-lifecycle');
vi.doMock(lifecycleFile, async () => ({
  ...(await vi.importActual<Record<string, unknown>>(lifecycleFile)),
  customerAccountLifecycleEnabled: () => enabled.account,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    provider: { getSession },
    customerErasureQueue: { queue, transition },
  }),
}));

const route = async () =>
  await import('../../apps/web/app/api/workspace/customer-erasure-queue/route');
const tenant = '00000000-0000-4000-8000-0000000000a1';
const request = '00000000-0000-4000-8000-0000000000b1';
const command = '00000000-0000-4000-8000-0000000000c1';
const url = (extra = '') =>
  `https://app.corridra.test/api/workspace/customer-erasure-queue?tenant=${tenant}${extra}`;
const row = (number: number, over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-00000000d' + String(number).padStart(3, '0'),
  number,
  reference: 'ER-' + number,
  filedAt: '2026-11-01T00:00:00Z',
  dueAt: '2026-12-01T00:00:00Z',
  daysLeft: 22,
  status: 'received',
  note: null,
  principalId: '00000000-0000-4000-8000-00000000e' + String(number).padStart(3, '0'),
  accountStatus: 'closed',
  closedAt: '2026-11-02T00:00:00Z',
  undoUntil: '2026-12-02T00:00:00Z',
  ...over,
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.corridra.test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
const move = (over: Record<string, unknown> = {}) => ({
  commandId: command,
  requestId: request,
  expectedState: 'received',
  toState: 'in_progress',
  ...over,
});

beforeEach(() => {
  enabled.account = true;
  getSession.mockReset().mockResolvedValue({ token: 'staff-token' });
  queue.mockReset().mockResolvedValue([row(5), row(4)]);
  transition.mockReset().mockResolvedValue({
    id: request,
    reference: 'ER-5',
    status: 'in_progress',
    note: null,
    changed: true,
  });
});

describe('GET lists the queue for the signed-in staff workspace', () => {
  it('passes the paging and status through, never a scope, and answers with no-store', async () => {
    const { GET } = await route();
    const response = await GET(new Request(url('&after=9&pageSize=2&status=received&scope=real')));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(queue).toHaveBeenCalledTimes(1);
    const [ctx, input] = queue.mock.calls[0]!;
    expect(ctx).toMatchObject({ token: 'staff-token', tenantId: tenant });
    expect(input).toEqual({ afterNumber: 9, pageSize: 2, status: 'received' });
  });

  it('answers only the fields staff may see: no internal person id, and a cursor while a full page came back', async () => {
    const { GET } = await route();
    const body = await (await GET(new Request(url('&pageSize=2')))).json();
    expect(body.nextAfter).toBe(4);
    expect(body.items).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('principalId');
    expect(JSON.stringify(body)).not.toContain('00000000-0000-4000-8000-00000000e');
    expect(Object.keys(body.items[0]).sort()).toEqual([
      'accountStatus',
      'closedAt',
      'daysLeft',
      'dueAt',
      'filedAt',
      'id',
      'note',
      'number',
      'reference',
      'status',
      'undoUntil',
    ]);
  });

  it('has no cursor on a short page', async () => {
    queue.mockResolvedValue([row(1)]);
    const { GET } = await route();
    const body = await (await GET(new Request(url('&pageSize=2')))).json();
    expect(body.nextAfter).toBeNull();
  });

  it('refuses without a staff session, with a bad tenant and with a bad status', async () => {
    const { GET } = await route();
    getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request(url()))).status).toBe(401);
    expect((await GET(new Request(url().replace(tenant, 'nope')))).status).toBe(400);
    expect((await GET(new Request(url('&status=bogus')))).status).toBe(400);
    expect(queue).not.toHaveBeenCalled();
  });

  it('is unavailable while the account lifecycle is off', async () => {
    enabled.account = false;
    const { GET } = await route();
    expect((await GET(new Request(url()))).status).toBe(503);
    expect(queue).not.toHaveBeenCalled();
  });
});

describe('POST moves a request along the allowed arrows', () => {
  it('passes the command through and answers with the result', async () => {
    const { POST } = await route();
    const response = await POST(post(move()));
    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition.mock.calls[0]![1]).toEqual(move());
    expect((await response.json()).status).toBe('in_progress');
  });

  it('needs a note of 10 to 1000 characters to complete or decline', async () => {
    const { POST } = await route();
    for (const note of [undefined, 'too short', 'x'.repeat(1001)])
      expect((await POST(post(move({ toState: 'completed', note })))).status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
    const ok = await POST(
      post(move({ toState: 'declined', note: 'Kept the invoices the law requires' })),
    );
    expect(ok.status).toBe(200);
  });

  it('refuses a foreign origin, a missing session, a wrong content type and extra fields', async () => {
    const { POST } = await route();
    expect((await POST(post(move(), { origin: 'https://evil.test' }))).status).toBe(403);
    getSession.mockResolvedValueOnce(null);
    expect((await POST(post(move()))).status).toBe(401);
    expect((await POST(post(move(), { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(post(move({ scope: 'real' })))).status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it('maps a request outside the staff side to a conflict, not a server error', async () => {
    transition.mockRejectedValueOnce(
      Object.assign(new Error('Erasure request not found'), { code: '23514' }),
    );
    const { POST } = await route();
    expect((await POST(post(move()))).status).toBe(409);
  });
});

describe('the route is registered as a private API', () => {
  it('has a no-referrer, no-store header override in next.config.ts', () => {
    const config = readFileSync(resolve('apps/web/next.config.ts'), 'utf8');
    const rule =
      /source:\s*'\/api\/workspace\/customer-erasure-queue',\s*headers:\s*\[([^\]]*)\]/.exec(
        config,
      );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
    expect(rule![1]).toContain("key: 'Cache-Control', value: 'no-store'");
  });
});

describe('a note the database would refuse is refused first, in plain words', () => {
  const words = 'Notes must be on one line, with no line breaks, tabs or control characters';
  it.each([
    ['a line break', 'Kept the invoices\nthe law requires'],
    ['a tab', 'Kept the invoices\tthe law requires'],
    ['an escape code', 'Kept the invoices \u001b the law requires'],
    ['a line separator', 'Kept the invoices the law requires'],
  ])('answers 400 with the words for %s, and the database is not called', async (_name, note) => {
    const { POST } = await route();
    const response = await POST(post(move({ toState: 'completed', note })));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(words);
    expect(transition).not.toHaveBeenCalled();
  });

  it('still accepts a note with ordinary punctuation and a trailing newline from a paste', async () => {
    const { POST } = await route();
    const response = await POST(
      post(
        move({
          toState: 'completed',
          note: 'Kept the invoices the law requires; erased the rest.\n',
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(transition.mock.calls[0]![1]).toMatchObject({
      note: 'Kept the invoices the law requires; erased the rest.',
    });
  });
});

describe('a refusal from the database stays a refusal', () => {
  it('answers 403 when the staff role may not manage requests, and 503 when the queue is not available', async () => {
    const { GET, POST } = await route();
    queue.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: '42501' }));
    expect((await GET(new Request(url()))).status).toBe(403);
    transition.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: '42501' }));
    expect((await POST(post(move()))).status).toBe(403);
    queue.mockRejectedValueOnce(Object.assign(new Error('relation missing'), { code: '42P01' }));
    expect((await GET(new Request(url()))).status).toBe(503);
  });
});
