import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  CustomerDecisionCardService,
  DecisionCardReader,
} from '../../packages/auth/src/customer-decision-cards';

// Owner, 23 Nov 2026: "decision cards for real". A card is a public link to one decision of a report, so for a real
// workspace it follows the owner's public report link switch and opens no access of its own. These cases prove the
// application side with a recording connection; the database rule is proved in customer-decision-cards.test.ts.
const digest = 'a'.repeat(64);
const card = {
  company: 'Example Works',
  decision: 'Shortlist',
  rationale: 'Meets the brief',
  nextAction: 'Send samples',
  dueAt: '2026-12-01T00:00:00.000Z',
  provenance: { sourceKind: 'supplier', claimStatus: 'reviewed' },
};
function recorder(answer: unknown, failOn?: string) {
  const calls: string[] = [];
  const query = async (text: string) => {
    calls.push(text);
    if (failOn && text.includes(failOn)) throw Object.assign(new Error('boom'), { code: 'XX000' });
    return { rows: [{ result: answer }] };
  };
  const source = {
    query,
    connect: async () => {
      calls.push('connect');
      return { query, release: () => calls.push('release') };
    },
  };
  return { calls, source: source as never };
}
const open = (synthetic: boolean) => ({
  state: 'OPEN',
  card,
  expiresAt: '2026-12-01T00:00:00.000Z',
  synthetic,
});

describe('the anonymous card read and the public report link switch', () => {
  test('switch off: one plain statement, exactly as before, and no setting is sent', async () => {
    const r = recorder(open(true));
    expect(await new DecisionCardReader(r.source, () => false).read(digest)).toEqual(open(true));
    expect(r.calls).toEqual(['SELECT app.read_decision_card($1) AS result']);
  });

  test('switch on: the read runs in one transaction that carries the setting, then commits and releases', async () => {
    const r = recorder(open(false));
    expect(await new DecisionCardReader(r.source, () => true).read(digest)).toEqual(open(false));
    expect(r.calls).toEqual([
      'connect',
      'BEGIN',
      "SELECT set_config('corridra.real_report_public','on',true)",
      'SELECT app.read_decision_card($1) AS result',
      'COMMIT',
      'release',
    ]);
  });

  test('switch on and the read fails: the transaction is rolled back and the connection released', async () => {
    const r = recorder(open(false), 'read_decision_card');
    await expect(new DecisionCardReader(r.source, () => true).read(digest)).rejects.toThrow('boom');
    expect(r.calls.slice(-2)).toEqual(['ROLLBACK', 'release']);
    expect(r.calls).not.toContain('COMMIT');
  });

  test('the switch is off unless the owner turns it on, and a malformed request never reaches the database', async () => {
    const r = recorder({ state: 'unknown' });
    expect(await new DecisionCardReader(r.source).read(digest)).toEqual({ state: 'unknown' });
    expect(await new DecisionCardReader(r.source).read(null)).toEqual({ state: 'unknown' });
    expect(r.calls).toEqual(['SELECT app.read_decision_card($1) AS result']);
  });

  test('an answer without the workspace kind is not an open card', async () => {
    const r = recorder({ state: 'OPEN', card, expiresAt: '2026-12-01T00:00:00.000Z' });
    expect(await new DecisionCardReader(r.source, () => false).read(digest)).toEqual({
      state: 'unknown',
    });
  });
});

describe('a real workspace while the public report link switch is off', () => {
  const options = {
    enabled: true,
    synthetic: false,
    production: false,
    issuer: 'https://ep-b7-cards.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    dataMode: 'real' as const,
  };
  const service = (publicLinks: boolean) => {
    const r = recorder(null);
    return {
      calls: r.calls,
      cards: new CustomerDecisionCardService(
        r.source,
        r.source,
        options,
        async () => null,
        'b7-card-switch-secret-0123456789abcdef',
        () => publicLinks,
      ),
    };
  };

  test('preview and creation are refused before any database call, so no link is made that cannot open', async () => {
    const s = service(false);
    await expect(s.cards.preview(randomUUID(), randomUUID())).rejects.toMatchObject({
      status: 403,
      message: 'Access denied or link unavailable',
    });
    await expect(
      s.cards.create({
        action: 'create',
        commandId: randomUUID(),
        resourceId: randomUUID(),
        decisionId: randomUUID(),
        digest,
        expiresAt: '2026-12-01T00:00:00.000Z',
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Access denied or link unavailable' });
    expect(s.calls).toEqual([]);
  });
});
