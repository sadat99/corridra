import { describe, expect, test } from 'vitest';
import * as mail from '../../apps/web/lib/ux/notify-mail';

const origin = 'https://app.example.test';
const code = 'a'.repeat(43);
const ignoreLine =
  'If you did not expect this invitation, you can ignore this email. Nothing happens unless you use the code.';

function invite(invitation?: Record<string, unknown>) {
  return mail.buildNotificationEmail({
    type: 'PARTICIPANT_INVITE',
    origin,
    link: '/account/delegations',
    lines: ['Your private invitation code: ' + code],
    ...(invitation ? { invitation } : {}),
  } as Parameters<typeof mail.buildNotificationEmail>[0]);
}

describe('participant invitation email (D-037, D-038)', () => {
  test('names the programme and the organiser and gives the expiry in the Dhaka format', () => {
    const message = invite({
      programme: 'Guangzhou Sourcing Week',
      organiser: 'Meghna Textiles',
      expiresAt: '2026-11-30T06:21:40.16943+00:00',
    });
    for (const body of [message.text, message.html]) {
      expect(body).toContain('Guangzhou Sourcing Week');
      expect(body).toContain('Meghna Textiles');
      expect(body).toContain('30 Nov 2026, 12:21 (Dhaka, UTC+6)');
      expect(body).not.toContain('2026-11-30T06:21');
      expect(body).toContain(code);
      expect(body).toContain(ignoreLine);
    }
    expect(message.subject).toBe('You are invited to Guangzhou Sourcing Week');
    expect(message.text).toContain('https://app.example.test/account/delegations');
    expect(message.text).not.toMatch(/—/);
  });

  test('says how to ignore it even when the programme details are not supplied', () => {
    const message = invite();
    expect(message.subject).toBe('You are invited to a Corridra programme');
    expect(message.text).toContain(ignoreLine);
    expect(message.html).toContain(ignoreLine);
    expect(message.text).not.toMatch(/undefined|null|Invalid Date/);
  });

  test('escapes the programme and organiser names and keeps them on one line', () => {
    const message = invite({
      programme: 'Trade <b>Week</b>\nBcc: x@example.test',
      organiser: 'A & B "Traders"',
      expiresAt: 'not a date',
    });
    expect(message.html).toContain('Trade &lt;b&gt;Week&lt;/b&gt;');
    expect(message.html).not.toContain('<b>Week</b>');
    expect(message.html).toContain('A &amp; B &quot;Traders&quot;');
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.text).not.toMatch(/expires/);
  });

  test('other mails are unchanged: no invitation lines outside the participant invitation', () => {
    const quote = mail.buildNotificationEmail({
      type: 'QUOTE_SENT',
      origin,
      link: '/account/requests/1',
    });
    expect(quote.text).toBe(
      [
        'You have a new quote',
        '',
        'Open the link below to read the quote and decide.',
        '',
        'https://app.example.test/account/requests/1',
        '',
        'Corridra',
      ].join('\n'),
    );
    expect(quote.text).not.toContain(ignoreLine);
  });

  test('the sender display name is Corridra, never a person', () => {
    const sender = (mail as unknown as { notificationSender?: (from: string) => string })
      .notificationSender;
    expect(typeof sender).toBe('function');
    expect(sender!('"Sadat, Corridra" <mail@example.test>')).toBe('Corridra <mail@example.test>');
    expect(sender!('mail@example.test')).toBe('Corridra <mail@example.test>');
    expect(sender!('Corridra <mail@example.test>')).toBe('Corridra <mail@example.test>');
  });
});
