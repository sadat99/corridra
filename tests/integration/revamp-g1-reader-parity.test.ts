import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CRUD G1: every database function that reads offline revocation (customer_private.request_revocation) is listed
// here with what a withdrawal does to it. A function added later that reads revocation fails this test until
// someone decides, in writing, whether a withdrawn request must be blocked there too.
//   'revoked only'        a withdrawal does not change it: the owner still reads the request, its delivered
//                          reports and its records; a withdrawal deletes nothing and hides nothing the owner owns
//   'revoked or withdrawn' outbound mail and reminders: a withdrawn request sends nothing (mail 0003, Pulse 0005)
//   'flags withdrawn'      returns the withdrawn flag so a list can show it under Withdrawn
//   'own'                  the mute and withdrawal commands themselves
const classification: Record<string, string> = {
  'app.customer_delivery_scope': 'revoked only',
  'app.record_reply_posted': 'revoked only',
  'customer.enqueue_move_notifications': 'revoked or withdrawn',
  'customer.mission_draft_close': 'revoked only',
  'customer.my_mission_mail_mutes': 'own',
  'customer.my_notification_mutes': 'own',
  'customer.my_request_withdrawals': 'own',
  'customer.private_request_moves': 'revoked only',
  'customer.private_requests': 'flags withdrawn',
  'customer.programme_mission_choices': 'revoked only',
  'customer.restore_request': 'own',
  'customer.set_mission_mail_mute': 'own',
  'customer.set_notification_mute': 'own',
  'customer.withdraw_request': 'own',
  'customer_private.notification_valid': 'revoked or withdrawn',
  'customer_private.programme_mission_source': 'revoked only',
  'customer_private.request_result': 'flags withdrawn',
  'customer_private.service_request_context': 'revoked only',
};
const root = resolve('packages/db');
const sqlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sqlFiles(path);
    return name.endsWith('.sql') ? [path] : [];
  });
const readers = () => {
  const found = new Map<string, Set<string>>();
  for (const file of sqlFiles(root))
    for (const chunk of readFileSync(file, 'utf8')
      .split(/CREATE (?:OR REPLACE )?FUNCTION /)
      .slice(1)) {
      if (!chunk.includes('request_revocation')) continue;
      const name = /^([a-z_.]+)\s*\(/.exec(chunk)?.[1];
      if (name) found.set(name, (found.get(name) ?? new Set()).add(relative(root, file)));
    }
  return found;
};

describe('every reader of offline revocation says what a withdrawal does to it', () => {
  it('has no reader missing from the list, and no stale entry', () => {
    expect([...readers().keys()].sort()).toEqual(Object.keys(classification).sort());
  });

  it('the outbound readers are exactly the ones the mail and Pulse withdrawal files replace', () => {
    const files = sqlFiles(root);
    const text = (suffix: string) =>
      readFileSync(
        files.find((file) => file.endsWith(suffix))!,
        'utf8',
      );
    const mail = text('customer-mission-mail-migrations/0003_withdrawn_requests.sql');
    const pulse = text('customer-notification-migrations/0005_withdrawn_requests.sql');
    for (const name of ['customer.enqueue_mission_mail', 'customer.claim_mission_mail'])
      expect(mail).toContain("signature:='" + name);
    for (const name of [
      'customer_private.notification_valid',
      'customer.enqueue_move_notifications',
    ])
      expect(pulse).toContain("signature:='" + name);
    const outbound = Object.entries(classification)
      .filter(([, kind]) => kind === 'revoked or withdrawn')
      .map(([name]) => name)
      .sort();
    expect(outbound).toEqual(
      ['customer.enqueue_move_notifications', 'customer_private.notification_valid'].sort(),
    );
  });

  it('the two readers that describe a request to its owner carry the withdrawn flag', () => {
    const withdrawal = readFileSync(
      join(root, 'customer-request-withdrawal-migrations/0001_request_withdrawal.sql'),
      'utf8',
    );
    expect(withdrawal).toContain("'withdrawn'',customer_private.request_withdrawn(owned.id)");
    for (const [name, kind] of Object.entries(classification))
      if (kind === 'flags withdrawn') expect(readers().has(name)).toBe(true);
  });
});
