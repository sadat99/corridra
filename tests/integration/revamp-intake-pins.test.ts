import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MissionService } from '../../packages/missions/src/index';
import { noticeVersion, realNoticeVersion } from '../../packages/domain/src/missions';

// Spec pack 1 (docs/revamp/specs/public-home.md) pins, named by P-id. P-01, P-02, P-04 (device draft), P-05,
// P-06 and P-07 are in tests/e2e/verification/ws-a/intake-parity.spec.ts and old-addresses.spec.ts, and the
// request rules in tests/integration/intake-parity.test.ts. This file adds P-03 and keeps the account-draft half
// of P-04 from being lost.

describe('P-03 the notice version follows the data mode', () => {
  const secret = 'x'.repeat(32);
  const brief = {
    objective: 'Source suppliers',
    market: 'China',
    attendance: 'Not decided',
    startDate: '',
    endDate: '',
    timezone: 'UTC',
    offer: 'Combed cotton yarn for a knitting unit',
    website: '',
    outcomes: ['Supplier visits'],
    notes: '',
    name: 'QA buyer',
    company: 'QA test company',
    acknowledged: true,
  };
  const key = '11111111-2222-4333-8444-555555555555';
  it('sample requests carry the sample notice version', () => {
    const plan = new MissionService(null as never, secret, 'synthetic').prepareIntake(key, {
      ...brief,
      email: 'qa@example.invalid',
    });
    expect(plan.noticeVersion).toBe('synthetic-intake-2026-10-05-v1');
    expect(plan.noticeVersion).toBe(noticeVersion);
  });
  it('real requests carry the real notice version', () => {
    const plan = new MissionService(null as never, secret, 'real').prepareIntake(key, {
      ...brief,
      email: 'qa@firm.com',
    });
    expect(plan.noticeVersion).toBe('real-intake-2026-10-21-v1');
    expect(plan.noticeVersion).toBe(realNoticeVersion);
  });
  it('a request without the acknowledgement is refused in both modes', () => {
    expect(() =>
      new MissionService(null as never, secret, 'synthetic').prepareIntake(key, {
        ...brief,
        email: 'qa@example.invalid',
        acknowledged: false,
      }),
    ).toThrow();
    expect(() =>
      new MissionService(null as never, secret, 'real').prepareIntake(key, {
        ...brief,
        email: 'qa@firm.com',
        acknowledged: false,
      }),
    ).toThrow();
  });
});

// The account draft path is covered by the tests below. They live in files owned by other tracks, so this
// only fails if one of them is renamed or removed; a change to that path must keep an equivalent test.
describe('P-04 the account-draft half stays covered', () => {
  const read = (path: string) => readFileSync(resolve(path), 'utf8');
  const ui = read('tests/operator/v3-guided-request-ui.spec.ts');
  const service = read('tests/integration/customer-mission-drafts.test.ts');
  it.each([
    [ui, 'a draft saves as a new version with the exact command, headers and typed details'],
    [
      ui,
      'current position is optional, saved with the original description and recovered after reload',
    ],
    [ui, 'an unconfirmed save keeps the text and retries with the same command id'],
    [
      ui,
      'review names what is missing in plain language, offers save-and-finish-later and blocks sending',
    ],
    [ui, 'sending uses the existing request with a stable command id, then closes the draft'],
    [ui, 'a sent draft opens read-only at the review and offers no way to edit or send again'],
    [
      ui,
      'leaving with unsaved changes asks first, and changing the signed-in account discards the old screen',
    ],
    [
      service,
      'a draft continues as a new version, a stale tab is refused and an exact retry returns the original',
    ],
    [service, 'each person sees only their own drafts, including the workspace owner'],
    [service, "a draft becomes a submitted request only against the creator's own current request"],
    [
      service,
      'derived command ids are stable per draft version, differ by purpose and version, and are valid UUIDs',
    ],
  ])('keeps %#', (file, title) => {
    expect(file).toContain(title);
  });
});
