import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homeJobOrder, homeJobs, orderedJobs } from '../../apps/web/lib/home-jobs';
import { homeEn, homeWords } from '../../apps/web/lib/i18n/home-words';
import { translate } from '../../apps/web/lib/i18n/messages';

// Owner decision, 12 November 2026: the three home jobs are unequal by default and one constant sets the order.
describe('home jobs order', () => {
  it('leads with Buy, then the group trip, then Sell, with the same links as before', () => {
    expect(homeJobOrder).toEqual(['buy', 'trip', 'sell']);
    expect(orderedJobs().map(({ job, weight }) => [job.href, weight])).toEqual([
      ['/plan?job=sourcing', 'lead'],
      ['/plan?job=delegations', 'normal'],
      ['/plan?job=buyers', 'compact'],
    ]);
  });

  it('can flip the lead by reordering the constant only', () => {
    expect(
      orderedJobs(['sell', 'buy', 'trip']).map(({ job, weight }) => [job.key, weight]),
    ).toEqual([
      ['sell', 'lead'],
      ['buy', 'normal'],
      ['trip', 'compact'],
    ]);
  });

  it('names only the routes the repository already states', () => {
    expect(Object.values(homeJobs).map((job) => translate('en', job.route))).toEqual([
      'Bangladesh to China',
      'Delegations and trade missions',
      'Bangladesh to Spain and the EU',
    ]);
    // The footer's first-routes line is where the repository states its routes.
    const messages = readFileSync('apps/web/lib/i18n/messages.ts', 'utf8');
    expect(messages).toContain(
      "'footer.routes': 'First routes: Bangladesh to China, Spain and the EU'",
    );
  });

  it('every catalogue carries the new words in English until a native review is recorded', () => {
    const added = Object.keys(homeEn).filter(
      (key) =>
        key.startsWith('home.player.trip.') ||
        key.startsWith('home.ex.trip.') ||
        key.endsWith('.route'),
    ) as (keyof typeof homeEn)[];
    expect(added.length).toBeGreaterThan(30);
    for (const words of Object.values(homeWords))
      for (const key of added) expect(words[key]).toBe(homeEn[key]);
    for (const key of added) expect(homeEn[key]).not.toMatch(/—/);
  });
});
