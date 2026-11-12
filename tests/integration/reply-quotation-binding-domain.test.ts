import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { commercialMissionCommand } from '../../packages/domain/src/commercial-missions';
import {
  replyPrefillReasons,
  replyQuotationPrefill,
  replyTermNames,
} from '../../packages/domain/src/reply-review';

// ADR-081 unit checks: the optional command field and the shape of the prefill. No database.
const base = {
  commandId: randomUUID(),
  missionId: randomUUID(),
  reason: 'Record the published supplier reply',
  sourceId: randomUUID(),
  claimId: randomUUID(),
};
const quotation = {
  ...base,
  action: 'quotation',
  rfqId: randomUUID(),
  targetId: randomUUID(),
  revision: 2,
  currency: 'CNY',
  terms: { unitPriceMinor: '1250' },
  uncertainties: 'Lead time not yet known',
  observedAt: '2026-11-01T10:00:00.123456Z',
};
const binding = { responseId: randomUUID(), seen: 1, digest: 'a'.repeat(64) };

describe('the reply binding field on the offer command', () => {
  it('is optional, and its absence leaves the parsed command exactly as before', () => {
    const parsed = commercialMissionCommand.parse(quotation);
    expect(parsed).not.toHaveProperty('replyBinding');
    expect(JSON.stringify(parsed)).not.toContain('replyBinding');
  });
  it('is accepted on a quotation and kept exactly', () => {
    expect(commercialMissionCommand.parse({ ...quotation, replyBinding: binding })).toMatchObject({
      replyBinding: binding,
      observedAt: '2026-11-01T10:00:00.123456Z',
    });
  });
  it('is strict: an unknown key, a bad version, a short or upper case digest and a non-uuid are refused', () => {
    for (const replyBinding of [
      { ...binding, note: 'extra' },
      { ...binding, seen: 21 },
      { ...binding, seen: -1 },
      { ...binding, seen: 1.5 },
      { ...binding, digest: 'a'.repeat(63) },
      { ...binding, digest: 'A'.repeat(64) },
      { ...binding, responseId: 'not-a-uuid' },
      { seen: 0, digest: 'a'.repeat(64) },
    ])
      expect(commercialMissionCommand.safeParse({ ...quotation, replyBinding }).success).toBe(
        false,
      );
  });
  it('exists only on the quotation action', () => {
    const others = [
      {
        ...base,
        action: 'rfq',
        requirementId: randomUUID(),
        targetIds: [randomUUID()],
        buyerContext: 'Shareable context',
        requestedTerms: 'Unit price and delivery',
        dueAt: '2026-12-01T10:00:00Z',
      },
      {
        ...base,
        action: 'decision',
        requirementId: randomUUID(),
        targetId: randomUUID(),
        assessmentId: randomUUID(),
        decision: 'SELECT',
        rationale: 'Best fit',
        nextAction: 'Prepare the order',
        ownerId: randomUUID(),
        dueAt: '2026-12-01T10:00:00Z',
      },
      {
        commandId: base.commandId,
        missionId: base.missionId,
        reason: base.reason,
        action: 'schedule',
        version: 1,
        entries: [],
      },
    ];
    for (const other of others) {
      expect(commercialMissionCommand.safeParse(other).success).toBe(true);
      expect(commercialMissionCommand.safeParse({ ...other, replyBinding: binding }).success).toBe(
        false,
      );
    }
  });
});

const eligible = {
  eligible: true,
  reason: null,
  responseId: randomUUID(),
  seen: 1,
  digest: 'b'.repeat(64),
  missionId: randomUUID(),
  rfqId: randomUUID(),
  requirementId: randomUUID(),
  targetId: randomUUID(),
  currency: 'BHD',
  terms: {
    unitPriceMinor: '900719925474099312',
    toolingMinor: '0',
    leadTime: '  kept as the supplier wrote it ',
    validUntil: '2027-03-31T00:00:00+08:00',
  },
  uncertainties: 'Lead time depends on raw material delivery',
  observedAt: '2026-11-01T10:00:00.123456Z',
  sourceKind: 'SELF_DECLARATION',
  revision: 2,
  previousId: randomUUID(),
};

describe('the prefill the offer form receives', () => {
  it('keeps exact minor-unit strings, the original currency and the supplier words untouched', () => {
    const parsed = replyQuotationPrefill.parse(eligible);
    expect(parsed).toEqual(eligible);
    expect(typeof (parsed.eligible && parsed.terms.unitPriceMinor)).toBe('string');
    expect(parsed.eligible && parsed.currency).toBe('BHD');
  });
  it('rejects a number where an amount string belongs, an unknown term name and an unknown currency', () => {
    expect(
      replyQuotationPrefill.safeParse({ ...eligible, terms: { unitPriceMinor: 1250 } }).success,
    ).toBe(false);
    expect(
      replyQuotationPrefill.safeParse({ ...eligible, terms: { markupMinor: '100' } }).success,
    ).toBe(false);
    expect(
      replyQuotationPrefill.safeParse({ ...eligible, terms: { staffCostMinor: '100' } }).success,
    ).toBe(false);
    expect(replyQuotationPrefill.safeParse({ ...eligible, currency: 'XXX' }).success).toBe(false);
    for (const name of replyTermNames)
      expect(replyQuotationPrefill.safeParse({ ...eligible, terms: { [name]: 'x' } }).success).toBe(
        true,
      );
  });
  it('accepts a first revision with no previous offer and refuses a statement time that is not microseconds in UTC', () => {
    expect(
      replyQuotationPrefill.safeParse({ ...eligible, revision: 1, previousId: null }).success,
    ).toBe(true);
    for (const observedAt of [
      '2026-11-01T10:00:00Z',
      '2026-11-01T10:00:00.123Z',
      '2026-11-01T10:00:00.123456+01:00',
    ])
      expect(replyQuotationPrefill.safeParse({ ...eligible, observedAt }).success).toBe(false);
  });
  it('carries only a reason code when the reply cannot be carried, and nothing else', () => {
    for (const reason of replyPrefillReasons)
      expect(replyQuotationPrefill.parse({ eligible: false, reason })).toEqual({
        eligible: false,
        reason,
      });
    expect(
      replyQuotationPrefill.safeParse({ eligible: false, reason: 'SOMETHING_ELSE' }).success,
    ).toBe(false);
    expect(
      replyQuotationPrefill.safeParse({ eligible: false, reason: 'NOT_FOUND', terms: {} }).success,
    ).toBe(false);
    expect(
      replyQuotationPrefill.safeParse({
        eligible: false,
        reason: 'NOT_FOUND',
        responseId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(replyQuotationPrefill.safeParse({ ...eligible, token: 'secret' }).success).toBe(false);
  });
});
