import { describe, expect, it } from 'vitest';
import { missionCatalogue } from '../../packages/domain/src/commercial-missions';
import { briefGoals, briefHref, goalJob, goalLinks } from '../../apps/web/lib/home-routes-data';

// LP3, board 3c brief: the home page's three answers open the real request form. Every job is one the form accepts
// (P-05), the visitor's words travel as ?note within the notes field's 1000 characters, and nothing else is added.
describe('home brief to /plan', () => {
  it('maps every goal to a job the request form accepts, or to none for Something else', () => {
    const keys = new Set<string>(missionCatalogue.map((t) => t.key));
    for (const goal of briefGoals) {
      const job = goalJob[goal];
      if (goal === 'other') expect(job).toBeNull();
      else expect(keys.has(job as string)).toBe(true);
    }
  });

  it('builds /plan with the job and the note, and plain /plan when nothing is answered', () => {
    expect(briefHref(null, '')).toBe('/plan');
    expect(briefHref('other', '   ')).toBe('/plan');
    expect(briefHref('sell', '')).toBe('/plan?job=buyers');
    const href = briefHref('fair', 'Route: Bangladesh to the UK\nTiming: Within a month');
    const url = new URL(href, 'https://corridra.test');
    expect(url.pathname).toBe('/plan');
    expect(url.searchParams.get('job')).toBe('trade_fairs');
    expect(url.searchParams.get('note')).toBe(
      'Route: Bangladesh to the UK\nTiming: Within a month',
    );
  });

  it('never carries more than the notes field holds', () => {
    const url = new URL(briefHref('china', 'x'.repeat(1500)), 'https://corridra.test');
    expect(url.searchParams.get('note')).toHaveLength(1000);
  });

  it('lists the six goals on the home page with one address each, the same one the brief opens', () => {
    expect(goalLinks.map((link) => link.key)).toEqual([...briefGoals]);
    expect(goalLinks.map((link) => link.href)).toEqual(
      briefGoals.map((goal) => briefHref(goal, '')),
    );
    // No two links in the page share a destination (team desk v4.1: one link per destination).
    expect(new Set(goalLinks.map((link) => link.href)).size).toBe(goalLinks.length);
  });
});
