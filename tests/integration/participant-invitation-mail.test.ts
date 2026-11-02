import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), foundations: vi.fn(), ready: true }));
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: state.foundations }));
vi.mock('../../packages/auth/src/customer-auth-mail', () => ({
  readAuthMailConfig: () =>
    state.ready ? { from: 'Corridra <mail@example.test>', apiKey: 'local-mail-fixture' } : null,
  sendWithResend: state.send,
}));
vi.mock('../../packages/auth/src/mission-mail', () => ({
  missionMailApplicationEnabled: () => true,
}));
import { notifyParticipantInvitation } from '../../apps/web/lib/notify';
const input = {
  id: '00000000-0000-4000-8000-000000000001',
  recipientEmail: 'participant@example.test',
  token: 'a'.repeat(43),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.ready = true;
  state.send.mockResolvedValue(undefined);
  vi.stubEnv('CORRIDRA_NOTIFICATIONS_V2', 'true');
  vi.stubEnv('APP_ORIGIN', 'https://app.example.test');
});
afterEach(() => vi.unstubAllEnvs());
test('invitation code is email-only, with a stable provider retry key and no invented inbox account', async () => {
  expect(await notifyParticipantInvitation(input)).toBe('sent');
  expect(await notifyParticipantInvitation(input)).toBe('sent');
  expect(state.foundations).not.toHaveBeenCalled();
  expect(state.send).toHaveBeenCalledTimes(2);
  const first = state.send.mock.calls[0][0],
    second = state.send.mock.calls[1][0];
  expect(first.to).toBe(input.recipientEmail);
  expect(first.message.text).toContain(input.token);
  expect(first.message.html).toContain(input.token);
  expect(first.message.text).toContain('https://app.example.test/account/delegations');
  expect(first.idempotencyKey).toBe(second.idempotencyKey);
  expect(first.idempotencyKey).not.toContain(input.token);
});
test('closed notifications or unavailable mail settings make no provider request', async () => {
  vi.stubEnv('CORRIDRA_NOTIFICATIONS_V2', 'false');
  expect(await notifyParticipantInvitation(input)).toBe('off');
  vi.stubEnv('CORRIDRA_NOTIFICATIONS_V2', 'true');
  state.ready = false;
  expect(await notifyParticipantInvitation(input)).toBe('not_sent');
  expect(state.send).not.toHaveBeenCalled();
  expect(state.foundations).not.toHaveBeenCalled();
});
test('provider errors return an honest failure and do not log the code or address', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    state.send.mockRejectedValue(Error('Fixture provider error'));
    expect(await notifyParticipantInvitation(input)).toBe('not_sent');
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(input.token);
    expect(output).not.toContain(input.recipientEmail);
  } finally {
    log.mockRestore();
  }
});
