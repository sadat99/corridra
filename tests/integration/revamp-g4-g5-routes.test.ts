import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

// CRUD G4 and G5, the two customer routes. Every refusal leaves the database alone, the stale answer carries both
// versions, and a rate-limited command can be sent again with the same command id.
const state = vi.hoisted(() => ({
  wsState: vi.fn(),
  wsCommand: vi.fn(),
  acState: vi.fn(),
  acCommand: vi.fn(),
  budget: vi.fn(),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.example.invalid' },
    missions: { budget: state.budget },
    customerWorkspaceLifecycle: { state: state.wsState, command: state.wsCommand },
    customerAccountLifecycle: { state: state.acState, command: state.acCommand },
  }),
}));
import * as workspace from '../../apps/web/app/api/customer-workspace-lifecycle/route';
import * as account from '../../apps/web/app/api/customer-account-lifecycle/route';

const origin = 'https://app.example.invalid';
const id = '00000000-0000-4000-8000-000000000001';
const cmd = '00000000-0000-4000-8000-000000000002';
const wsUrl = origin + '/api/customer-workspace-lifecycle';
const acUrl = origin + '/api/customer-account-lifecycle';
const rename = {
  action: 'rename',
  commandId: cmd,
  workspaceId: id,
  name: 'New name',
  reason: 'The old name was wrong',
  expectedVersion: 3,
};
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED', 'true');
  state.budget.mockResolvedValue(undefined);
  state.wsState.mockResolvedValue([]);
  state.wsCommand.mockResolvedValue({ workspaceId: id, operation: 'rename', version: 4 });
  state.acState.mockResolvedValue({ open: true, status: 'active' });
  state.acCommand.mockResolvedValue({ operation: 'undo', changed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('workspace lifecycle route', () => {
  test('GET with no query lists, with a workspace id reads one, and passes the session identity', async () => {
    const list = await workspace.GET(
      new Request(wsUrl, {
        headers: { 'x-corridra-customer-subject': 'alice', 'x-corridra-customer-issuer': 'iss' },
      }),
    );
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(state.wsState).toHaveBeenCalledWith({}, 'alice', 'iss');
    await workspace.GET(new Request(`${wsUrl}?workspaceId=${id}`));
    expect(state.wsState).toHaveBeenLastCalledWith({ workspaceId: id }, undefined, undefined);
  });
  test('GET refuses an unknown or malformed query and an unavailable module', async () => {
    expect((await workspace.GET(new Request(`${wsUrl}?workspaceId=nope`))).status).toBe(400);
    expect((await workspace.GET(new Request(`${wsUrl}?other=1`))).status).toBe(400);
    expect(state.wsState).not.toHaveBeenCalled();
    vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED', 'false');
    expect((await workspace.GET(new Request(wsUrl))).status).toBe(503);
  });
  test('POST sends one valid command to the service', async () => {
    const response = await workspace.POST(post(wsUrl, rename));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaceId: id, operation: 'rename', version: 4 });
    expect(state.wsCommand).toHaveBeenCalledTimes(1);
  });
  test('refuses another origin 403, a non-JSON body 415, an oversized body 413 and an unknown key 400', async () => {
    expect(
      (await workspace.POST(post(wsUrl, rename, { Origin: 'https://evil.test' }))).status,
    ).toBe(403);
    expect(
      (await workspace.POST(post(wsUrl, rename, { 'Content-Type': 'text/plain' }))).status,
    ).toBe(415);
    expect((await workspace.POST(post(wsUrl, '{' + ' '.repeat(5000) + '}'))).status).toBe(413);
    expect((await workspace.POST(post(wsUrl, { ...rename, extra: 1 }))).status).toBe(400);
    expect((await workspace.POST(post(wsUrl, { ...rename, action: 'delete' }))).status).toBe(400);
    expect((await workspace.POST(post(wsUrl, 'not json'))).status).toBe(400);
    expect(state.wsCommand).not.toHaveBeenCalled();
    expect(state.budget).not.toHaveBeenCalled();
  });
  test('maps signed out 401, role 403, conflict 409 and archived 409 with its code', async () => {
    state.wsCommand.mockRejectedValueOnce(new DomainError('Sign in', 401));
    expect((await workspace.POST(post(wsUrl, rename))).status).toBe(401);
    state.wsCommand.mockRejectedValueOnce(new DomainError('Only the owner can do this', 403));
    expect((await workspace.POST(post(wsUrl, rename))).status).toBe(403);
    state.wsCommand.mockRejectedValueOnce(new DomainError('Wrong state', 409));
    expect((await workspace.POST(post(wsUrl, rename))).status).toBe(409);
    state.wsCommand.mockRejectedValueOnce(new DomainError('Archived', 409, 'archived'));
    const archived = await workspace.POST(post(wsUrl, rename));
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({ error: 'Archived', code: 'archived' });
    state.wsCommand.mockRejectedValueOnce(new DomainError('Closed', 503, 'unavailable'));
    expect((await workspace.POST(post(wsUrl, rename))).status).toBe(503);
  });
  test('a stale version is a 409 that carries both the current name and version, and nothing else', async () => {
    state.wsCommand.mockResolvedValueOnce({
      stale: true,
      workspaceId: id,
      currentVersion: 7,
      currentName: 'Their name',
      archived: false,
    });
    const response = await workspace.POST(post(wsUrl, rename));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'stale', currentName: 'Their name', currentVersion: 7 });
    expect(typeof body.error).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['code', 'currentName', 'currentVersion', 'error']);
  });
  test('a rate limit answers 429 before the service, and the same command id then succeeds', async () => {
    state.budget.mockRejectedValueOnce(new DomainError('Too many requests', 429));
    expect((await workspace.POST(post(wsUrl, rename))).status).toBe(429);
    expect(state.wsCommand).not.toHaveBeenCalled();
    expect((await workspace.POST(post(wsUrl, rename))).status).toBe(200);
    expect(state.wsCommand).toHaveBeenCalledTimes(1);
    expect(state.wsCommand.mock.calls[0]![0].commandId).toBe(cmd);
  });
  test('a forged subject or issuer reaches the service, which refuses with 409', async () => {
    state.wsCommand.mockRejectedValueOnce(new DomainError('Your session changed', 409));
    const response = await workspace.POST(
      post(wsUrl, rename, {
        'x-corridra-customer-subject': 'mallory',
        'x-corridra-customer-issuer': 'https://forged.test',
      }),
    );
    expect(response.status).toBe(409);
    expect(state.wsCommand.mock.calls[0]!.slice(1)).toEqual(['mallory', 'https://forged.test']);
  });
});

describe('account lifecycle route', () => {
  test('GET answers for the signed-in person only and refuses any query', async () => {
    const response = await account.GET(
      new Request(acUrl, {
        headers: { 'x-corridra-customer-subject': 'alice', 'x-corridra-customer-issuer': 'iss' },
      }),
    );
    expect(response.status).toBe(200);
    expect(state.acState).toHaveBeenCalledWith('alice', 'iss');
    expect((await account.GET(new Request(`${acUrl}?principalId=${id}`))).status).toBe(400);
    expect(state.acState).toHaveBeenCalledTimes(1);
  });
  test('a closed account still reaches the state and undo, and the route answers its code', async () => {
    state.acState.mockResolvedValueOnce({ open: true, status: 'closed', canUndo: true });
    const closed = await account.GET(new Request(acUrl));
    expect((await closed.json()).status).toBe('closed');
    state.acCommand.mockRejectedValueOnce(
      new DomainError('Your account is closed.', 403, 'account_closed'),
    );
    const refused = await account.POST(post(acUrl, { action: 'file_erasure', commandId: cmd }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: 'Your account is closed.',
      code: 'account_closed',
    });
    expect((await account.POST(post(acUrl, { action: 'undo', commandId: cmd }))).status).toBe(200);
  });
  test('POST sends close, undo and file_erasure, and refuses anything else', async () => {
    const closeBody = { action: 'close', commandId: cmd, confirmation: 'Close my account' };
    expect((await account.POST(post(acUrl, closeBody))).status).toBe(200);
    expect(
      (await account.POST(post(acUrl, { action: 'file_erasure', commandId: cmd }))).status,
    ).toBe(200);
    expect(state.acCommand).toHaveBeenCalledTimes(2);
    for (const bad of [
      { ...closeBody, confirmation: 'close my account' },
      { action: 'close', commandId: cmd },
      { action: 'undo', commandId: cmd, principalId: id },
      { action: 'undo', commandId: cmd, subject: 'bob' },
      { action: 'undo', commandId: cmd, id },
      { action: 'erase', commandId: cmd },
    ])
      expect((await account.POST(post(acUrl, bad))).status).toBe(400);
    expect(state.acCommand).toHaveBeenCalledTimes(2);
  });
  test('refuses another origin 403, a non-JSON body 415, an oversized body 413', async () => {
    const body = { action: 'undo', commandId: cmd };
    expect((await account.POST(post(acUrl, body, { Origin: 'https://evil.test' }))).status).toBe(
      403,
    );
    expect((await account.POST(post(acUrl, body, { 'Content-Type': 'text/plain' }))).status).toBe(
      415,
    );
    expect((await account.POST(post(acUrl, '{' + ' '.repeat(3000) + '}'))).status).toBe(413);
    expect(state.acCommand).not.toHaveBeenCalled();
  });
  test('maps 401, 409 and 503, and a rate limit keeps the command id for the resend', async () => {
    const body = { action: 'undo', commandId: cmd };
    state.acCommand.mockRejectedValueOnce(new DomainError('Sign in', 401));
    expect((await account.POST(post(acUrl, body))).status).toBe(401);
    state.acCommand.mockRejectedValueOnce(new DomainError('Hand over first', 409));
    expect((await account.POST(post(acUrl, body))).status).toBe(409);
    state.acCommand.mockRejectedValueOnce(new DomainError('x', 503, 'unavailable'));
    expect((await account.POST(post(acUrl, body))).status).toBe(503);
    state.acCommand.mockClear();
    state.budget.mockRejectedValueOnce(new DomainError('Too many requests', 429));
    expect((await account.POST(post(acUrl, body))).status).toBe(429);
    expect(state.acCommand).not.toHaveBeenCalled();
    expect((await account.POST(post(acUrl, body))).status).toBe(200);
    expect(state.acCommand.mock.calls[0]![0]).toEqual(body);
  });
  test('a forged subject or issuer reaches the service, which refuses with 409', async () => {
    state.acCommand.mockRejectedValueOnce(new DomainError('Your session changed', 409));
    const response = await account.POST(
      post(
        acUrl,
        { action: 'undo', commandId: cmd },
        { 'x-corridra-customer-subject': 'mallory', 'x-corridra-customer-issuer': 'forged' },
      ),
    );
    expect(response.status).toBe(409);
    expect(state.acCommand.mock.calls[0]!.slice(1)).toEqual(['mallory', 'forged']);
  });
  test('an unavailable module answers 503 without reaching the service', async () => {
    vi.stubEnv('CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED', 'false');
    expect((await account.GET(new Request(acUrl))).status).toBe(503);
    expect((await account.POST(post(acUrl, { action: 'undo', commandId: cmd }))).status).toBe(503);
    expect(state.acState).not.toHaveBeenCalled();
  });
});
