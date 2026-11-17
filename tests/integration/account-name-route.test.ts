import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../packages/domain/src/index';

// ADR-086. The name route, with the sign-in provider and the database answered by the test: every check in its fixed
// order, updateUser called only with { name }, a lost response replayed by command id without a second provider call,
// no-store on every answer and the name absent from every log line.
const issuer = 'https://auth.example';
const state = {
  capability: true,
  session: null as unknown,
  sessionThrows: false,
  update: { data: { status: true }, error: null } as unknown,
  updateThrows: false,
  limited: false,
  noted: false,
  preflightError: null as unknown,
  noteError: null as unknown,
  services: true,
};
const calls = {
  update: [] as unknown[],
  preflight: 0,
  note: [] as unknown[],
};
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/account-security-capabilities', () => ({
  get accountSecurityCapabilities() {
    return {
      updateName: state.capability,
      changePassword: false,
      listSessions: false,
      revokeSession: false,
      probe: null,
    };
  },
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: issuer }),
}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async (args: unknown) => {
      expect(args).toEqual({ query: { disableCookieCache: true } });
      if (state.sessionThrows) throw new Error('down');
      return state.session;
    },
    updateUser: async (args: unknown) => {
      calls.update.push(args);
      if (state.updateThrows) throw new Error('fetch failed');
      return state.update;
    },
  }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () =>
    state.services
      ? {
          ready: Promise.resolve(),
          config: { APP_ORIGIN: 'http://localhost' },
          customerPersonalProfiles: {
            nameChangePreflight: async () => {
              calls.preflight += 1;
              if (state.preflightError) throw state.preflightError;
              return { limited: state.limited, noted: state.noted };
            },
            noteSecurityChange: async (...args: unknown[]) => {
              calls.note.push(args);
              if (state.noteError) throw state.noteError;
              return { replayed: false };
            },
          },
        }
      : null,
}));
const { POST } = await import('../../apps/web/app/api/account/name/route');

const secretName = 'Zebra Quokkaname';
const user = (over: Record<string, unknown> = {}) => ({
  data: { user: { id: 'user-1', emailVerified: true, ...over } },
  error: null,
});
const request = (
  body: unknown = { commandId: randomUUID(), name: secretName },
  headers: Record<string, string> = {},
) =>
  new Request('http://localhost/api/account/name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'x-corridra-customer-subject': 'user-1',
      'x-corridra-customer-issuer': issuer,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const logs: string[] = [];
beforeEach(() => {
  Object.assign(state, {
    capability: true,
    session: user(),
    sessionThrows: false,
    update: { data: { status: true }, error: null },
    updateThrows: false,
    limited: false,
    noted: false,
    preflightError: null,
    noteError: null,
    services: true,
  });
  calls.update.length = 0;
  calls.note.length = 0;
  calls.preflight = 0;
  logs.length = 0;
  for (const level of ['log', 'warn', 'error', 'info'] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const line of logs) expect(line).not.toContain('Quokkaname');
});
async function send(req: Request) {
  const response = await POST(req);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('the name route', () => {
  test('changes the name with updateUser({ name }) only and records it', async () => {
    const commandId = randomUUID();
    const result = await send(request({ commandId, name: `  ${secretName}  ` }));
    expect(result).toEqual({ status: 200, body: { commandId, replayed: false } });
    expect(calls.update).toEqual([{ name: secretName }]);
    expect(calls.note).toHaveLength(1);
    expect(calls.note[0]).toEqual([commandId, 'name_changed', 'user-1', issuer]);
    expect(JSON.stringify(result.body)).not.toContain('Quokkaname');
  });

  test('checks in order: origin 403, JSON 415, size 413, name 400, capability 404', async () => {
    expect((await send(request(undefined, { Origin: 'https://evil.example' }))).status).toBe(403);
    expect((await send(request(undefined, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await send(request({ commandId: randomUUID(), name: 'x'.repeat(2000) }))).status).toBe(
      413,
    );
    for (const body of [
      { commandId: randomUUID(), name: '' },
      { commandId: randomUUID(), name: '   ' },
      { commandId: randomUUID(), name: 'x'.repeat(101) },
      { commandId: randomUUID(), name: 'tab\there' },
      { commandId: 'not-a-uuid', name: secretName },
      { commandId: randomUUID(), name: secretName, email: 'a@example.test' },
      '{not json',
    ])
      expect((await send(request(body))).status, JSON.stringify(body)).toBe(400);
    state.capability = false;
    expect(await send(request())).toEqual({
      status: 404,
      body: { error: 'Not found', code: 'not_found' },
    });
    expect(calls.update).toEqual([]);
    expect(calls.preflight).toBe(0);
  });

  test('refuses a missing, unverified or different session before the provider is asked', async () => {
    state.session = { data: null, error: null };
    expect((await send(request())).status).toBe(401);
    state.session = user({ emailVerified: false });
    expect((await send(request())).status).toBe(403);
    state.session = user();
    expect(
      (await send(request(undefined, { 'x-corridra-customer-subject': 'user-2' }))).status,
    ).toBe(409);
    expect(
      (await send(request(undefined, { 'x-corridra-customer-issuer': 'https://x.example' })))
        .status,
    ).toBe(409);
    state.sessionThrows = true;
    expect((await send(request())).body.code).toBe('provider_unavailable');
    expect(calls.update).toEqual([]);
    expect(calls.preflight).toBe(0);
  });

  test('a closed or erasure-pending account is refused 403 and the provider is not asked', async () => {
    state.preflightError = Object.assign(new Error('Your account is closed'), { code: '42501' });
    expect((await send(request())).status).toBe(403);
    state.preflightError = new DomainError('Your account is closed.', 403, 'account_closed');
    expect((await send(request())).status).toBe(403);
    expect(calls.update).toEqual([]);
  });

  test('past the hourly budget answers 429 and the provider is not asked', async () => {
    state.limited = true;
    expect((await send(request())).status).toBe(429);
    expect(calls.update).toEqual([]);
  });

  test('a lost response replays by command id with no second provider call', async () => {
    const commandId = randomUUID();
    expect((await send(request({ commandId, name: secretName }))).status).toBe(200);
    state.noted = true;
    expect(await send(request({ commandId, name: secretName }))).toEqual({
      status: 200,
      body: { commandId, replayed: true },
    });
    expect(calls.update).toHaveLength(1);
    expect(calls.note).toHaveLength(1);
  });

  test('a provider that is down answers 503 provider_unavailable and records nothing', async () => {
    for (const update of [
      { data: null, error: { status: 502 } },
      { data: null, error: { status: 500 } },
      { data: null, error: { status: 503 } },
    ]) {
      state.update = update;
      const result = await send(request());
      expect(result.status).toBe(503);
      expect(result.body.code).toBe('provider_unavailable');
    }
    state.updateThrows = true;
    expect((await send(request())).status).toBe(503);
    expect(calls.note).toEqual([]);
  });

  test('a record that fails after the provider changed the name still answers 200 and logs a code only', async () => {
    state.noteError = Object.assign(new Error('boom'), { code: '40001' });
    expect((await send(request())).status).toBe(200);
    expect(logs.some((line) => line.includes('account_name_missing_audit'))).toBe(true);
  });

  test('a module that is not installed answers 503 module_unavailable', async () => {
    state.preflightError = Object.assign(new Error('missing'), { code: '42883' });
    expect((await send(request())).body.code).toBe('module_unavailable');
    expect(calls.update).toEqual([]);
  });
});
