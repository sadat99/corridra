import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reportedPlaceWords } from '../../apps/web/app/operator/inbox/page-words';

// Team desk v4.1 fixes for the Inbox, Meetings and Companies (unit F5b). The parts that need no browser: the place
// words of a problem report, and the style rules that must stay tied to the v4.1 switch (switch-off finding R1).
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the place a problem report was filed from', () => {
  it('reads as the menu word, never as the stored address', () => {
    expect(reportedPlaceWords('/operator/missions')).toBe('Missions');
    expect(
      reportedPlaceWords('/operator/missions/00000000-0000-4000-8000-000000000001?tab=quotes'),
    ).toBe('Missions');
    // The bare workspace address can be any section whose query or hash was stripped: no guess, the caller shows it.
    expect(reportedPlaceWords('/operator')).toBeNull();
    expect(reportedPlaceWords('/operator/audit')).toBe('Audit');
    expect(reportedPlaceWords('/operator/health')).toBe('Health');
    expect(reportedPlaceWords('/operator/readiness')).toBe('Readiness');
    expect(reportedPlaceWords('/operator/controls')).toBe('People and access');
    expect(reportedPlaceWords('/operator/owner')).toBe('Owner page');
    expect(reportedPlaceWords('/operator/supply')).toBe('Supply');
    expect(reportedPlaceWords('/operator/inbox')).toBe('Inbox');
    expect(reportedPlaceWords('/operator/authenticator')).toBe('Authenticator');
    expect(reportedPlaceWords('/operator/research')).toBe('Companies');
    expect(reportedPlaceWords('/operator/meetings#workspace-meetings')).toBe('Meetings');
  });
  it('says so for a team page it does not know, and for anything that is not a team page', () => {
    expect(reportedPlaceWords('/operator/some-new-place')).toBe('Another team page');
    expect(reportedPlaceWords('/account/billing')).toBeNull();
    expect(reportedPlaceWords(null)).toBeNull();
    expect(reportedPlaceWords('')).toBeNull();
  });
});

describe('reply review styles reach the desk with the switch off as they were (R1)', () => {
  const css = read('apps/web/app/operator/reply-review.css');
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  };
  it('lets a column be narrower than 14rem on a phone with the switch on or off (320 px overflow)', () => {
    expect(rule('.reply-review-columns')).toContain('minmax(min(14rem, 100%), 1fr)');
    expect(css).not.toContain(".reply-review[data-desk='true'] .reply-review-columns");
  });
  it('gives the small reply heading its size and weight only on the desk', () => {
    expect(css).not.toMatch(/^\.reply-review-card h6 \{/m);
    expect(rule(".reply-review[data-desk='true'] .reply-review-card h6")).toContain(
      'font-weight: 600',
    );
  });
});

describe('the Inbox lists keep their Settings form with the switch off', () => {
  it('only the Inbox page asks for the tabbed form', () => {
    const lists = read('apps/web/app/operator/inbox/inbox-lists.tsx');
    expect(lists.match(/tabbed/g)).toHaveLength(4);
    for (const file of ['workspace.tsx', 'network.tsx'])
      expect(read(`apps/web/app/operator/${file}`)).not.toContain('tabbed');
  });
});
