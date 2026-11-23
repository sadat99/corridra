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
test('the email names the programme and the organiser and gives the expiry in Dhaka time (D-037, D-038)', async () => {
  expect(
    await notifyParticipantInvitation({
      ...input,
      programme: 'Guangzhou Sourcing Week',
      organiser: 'Meghna Textiles',
      expiresAt: '2026-11-30T06:21:40.16943+00:00',
    }),
  ).toBe('sent');
  const { message } = state.send.mock.calls[0][0];
  for (const body of [message.text, message.html]) {
    expect(body).toContain('Meghna Textiles invited you to join Guangzhou Sourcing Week.');
    expect(body).toContain('This invitation expires on 30 Nov 2026, 12:21 (Dhaka, UTC+6).');
    expect(body).toContain(
      'If you did not expect this invitation, you can ignore this email. Nothing happens unless you use the code.',
    );
    expect(body).toContain(input.token);
  }
  expect(message.subject).toBe('You are invited to Guangzhou Sourcing Week');
});
test('a changed message gets its own provider retry key, so a resend after a rename is not refused as a replay', async () => {
  const facts = { programme: 'Guangzhou Sourcing Week', organiser: 'Meghna Textiles' };
  await notifyParticipantInvitation({ ...input, ...facts });
  await notifyParticipantInvitation({ ...input, ...facts });
  await notifyParticipantInvitation({ ...input, ...facts, programme: 'Foshan Sourcing Week' });
  const keys = state.send.mock.calls.map((call) => call[0].idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
  for (const key of keys) {
    expect(key).not.toContain(input.token);
    expect(key).not.toContain('Sourcing');
  }
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
