import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  canSendOne,
  deliveryNoteWords,
  sendOneBody,
} from '../../apps/web/app/operator/outreach-send';

// B9b (ADR-090): what the staff introductions list shows and offers for one real email. The server stays the authority
// (communications.pending); these words and rules only decide what a staff member sees.
const flat = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ');

test('a test-mode receipt is shown in the two exact server notes and nothing else', () => {
  expect(deliveryNoteWords({ delivery_note: 'Test, not sent' })).toBe('Test, not sent');
  expect(deliveryNoteWords({ delivery_note: 'Test, sent to a test address only' })).toBe(
    'Test, sent to a test address only',
  );
  for (const delivery_note of [null, undefined, '', 'Sent', 'test, not sent', '<b>Test</b>'])
    expect(deliveryNoteWords({ delivery_note })).toBeNull();
});

test('only a waiting real email offers the one-message send', () => {
  for (const delivery_status of ['PENDING', 'RUNNING'])
    expect(canSendOne({ channel: 'EMAIL', delivery_status })).toBe(true);
  for (const delivery_status of ['DELIVERED', 'DEAD', 'SUPPRESSED', 'FAILED', '', null, undefined])
    expect(canSendOne({ channel: 'EMAIL', delivery_status })).toBe(false);
  // The sample lane and the manual handoff never get the one-message send: they keep the batch dispatch.
  for (const channel of ['SYNTHETIC', 'MANUAL', 'email', '', null, undefined])
    expect(canSendOne({ channel, delivery_status: 'PENDING' })).toBe(false);
});

test('one click names exactly one message and carries nothing else', () => {
  const id = '3f0c1a52-6f0e-4a3b-9a55-0d6d0f1f7a10';
  expect(sendOneBody({ id })).toEqual({ messageId: id });
  expect(Object.keys(sendOneBody({ id }))).toEqual(['messageId']);
});

test('the introductions list shows the note and sends one real email per click, batch stays as it was', () => {
  const access = flat('apps/web/app/operator/access.tsx');
  expect(access).toContain("from './outreach-send'");
  expect(access).toContain("void act('dispatch', sendOneBody(m))");
  expect(access).toContain('Send This Email');
  expect(access).toContain('deliveryNoteWords(m)');
  expect(access).toContain('canSendOne(m)');
  // The batch action keeps its name and its empty body, which the server limits to the sample lane.
  expect(access).toContain("onClick={() => void act('dispatch', {})}");
  expect(access).toContain('Dispatch Pending Introductions');
  expect(access.match(/act\('dispatch'/g)).toHaveLength(2);
  expect(access).not.toMatch(/—|–/);
});

test('the recovery queue says its batch start is for sample messages only and still posts an empty body', () => {
  const operations = flat('apps/web/app/operator/operations.tsx');
  expect(operations).toContain("await request('dispatch', {});");
  expect(operations.match(/request\('dispatch'/g)).toHaveLength(1);
  expect(operations).toContain('Start or Recover Eligible Dispatch');
  expect(operations).toContain(
    'This starts waiting sample messages only. A real email is sent one message at a time from Introductions and replies.',
  );
});
