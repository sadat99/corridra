import { describe, expect, it } from 'vitest';
import {
  homeLimits,
  limitsFor,
  publicPageLimits,
  screensOf,
  verdictFor,
  viewports,
} from '../ux/page-length-lib';

// The page-length limits of the layout budget (docs/revamp/specs/layout-budget.md section 2, owner
// decision of 5 November 2026): phone target 1.5 and hard limit 2.0; desktop one screen both ways.
describe('page length limits', () => {
  const phone = viewports.find((v) => v.name === 'phone')!;
  const desktop = viewports.find((v) => v.name === 'desktop')!;

  it('uses the owner limits', () => {
    expect([phone.width, phone.height, phone.target, phone.hard]).toEqual([390, 844, 1.5, 2.0]);
    expect([desktop.width, desktop.height, desktop.target, desktop.hard]).toEqual([
      1440, 900, 1.0, 1.0,
    ]);
  });

  it('judges a desktop page over one screen as over the hard limit', () => {
    expect(verdictFor(1.0, desktop)).toBe('within target');
    expect(verdictFor(1.01, desktop)).toBe('over hard limit');
    expect(verdictFor(1.5, desktop)).toBe('over hard limit');
  });

  it('judges a phone page by its own limits', () => {
    expect(verdictFor(1.5, phone)).toBe('within target');
    expect(verdictFor(1.51, phone)).toBe('over target');
    expect(verdictFor(2.0, phone)).toBe('over target');
    expect(verdictFor(2.01, phone)).toBe('over hard limit');
  });

  it('judges a public page by the public page limits and the home by its own rule (owner, 6 November 2026)', () => {
    expect(publicPageLimits).toEqual({
      phone: { target: 3.0, hard: 3.0 },
      desktop: { target: 2.0, hard: 2.0 },
    });
    expect(homeLimits).toEqual({
      phone: { target: 4.25, hard: 4.25 },
      desktop: { target: 3.0, hard: 3.0 },
    });
    // Sign-in and recovery pages carry the public footer; /plan keeps the signed-in limits.
    expect(
      limitsFor({ route: '/signin', audience: 'public intake and customer identity' }, desktop),
    ).toEqual(publicPageLimits.desktop);
    expect(
      limitsFor({ route: '/plan', audience: 'public intake and customer identity' }, desktop),
    ).toEqual({
      target: desktop.target,
      hard: desktop.hard,
    });
    const about = { route: '/about', audience: 'public' };
    expect(limitsFor(about, desktop)).toEqual(publicPageLimits.desktop);
    expect(limitsFor(about, phone)).toEqual(publicPageLimits.phone);
    expect(verdictFor(2.0, limitsFor(about, desktop))).toBe('within target');
    expect(verdictFor(2.01, limitsFor(about, desktop))).toBe('over hard limit');
    expect(verdictFor(3.01, limitsFor(about, phone))).toBe('over hard limit');
    expect(limitsFor({ route: '/', audience: 'public' }, desktop)).toEqual(homeLimits.desktop);
    // Owner, 6 November 2026: with the Ledger footer the home may be up to 3.0 desktop and 4.25 phone screens.
    expect(verdictFor(3.0, limitsFor({ route: '/', audience: 'public' }, desktop))).toBe(
      'within target',
    );
    expect(verdictFor(3.01, limitsFor({ route: '/', audience: 'public' }, desktop))).toBe(
      'over hard limit',
    );
    expect(verdictFor(4.26, limitsFor({ route: '/', audience: 'public' }, phone))).toBe(
      'over hard limit',
    );
  });

  it('keeps the viewport limits for /plan and every signed-in page', () => {
    for (const entry of [
      { route: '/plan', audience: 'public intake and customer identity' },
      { route: '/account', audience: 'customer' },
      { route: '/operator', audience: 'staff' },
    ]) {
      expect(limitsFor(entry, desktop), entry.route).toEqual({ target: 1.0, hard: 1.0 });
      expect(limitsFor(entry, phone), entry.route).toEqual({ target: 1.5, hard: 2.0 });
    }
  });

  it('measures the document height over the viewport height', () => {
    expect(screensOf(900, desktop)).toBe(1);
    expect(screensOf(1350, desktop)).toBe(1.5);
    expect(screensOf(1688, phone)).toBe(2);
  });
});
