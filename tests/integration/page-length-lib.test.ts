import { describe, expect, it } from 'vitest';
import { screensOf, verdictFor, viewports } from '../ux/page-length-lib';

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

  it('measures the document height over the viewport height', () => {
    expect(screensOf(900, desktop)).toBe(1);
    expect(screensOf(1350, desktop)).toBe(1.5);
    expect(screensOf(1688, phone)).toBe(2);
  });
});
