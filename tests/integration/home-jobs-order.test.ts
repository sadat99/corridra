import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homeJobLead, homeJobOrder, homeJobs, orderedJobs } from '../../apps/web/lib/home-jobs';
import { homeEn, homeWords } from '../../apps/web/lib/i18n/home-words';
import { translate } from '../../apps/web/lib/i18n/messages';

// Owner decision, 12 November 2026: the three home jobs carry equal weight and one constant sets the order.
describe('home jobs order', () => {
  it('draws Buy, the group trip and Sell in that order at equal weight, with the same links as before', () => {
    // Owner decision, 12 November 2026: "Equal weight".
    expect(homeJobOrder).toEqual(['buy', 'trip', 'sell']);
    expect(homeJobLead).toBeNull();
    expect(orderedJobs().map(({ job, weight }) => [job.href, weight])).toEqual([
      ['/plan?job=sourcing', 'equal'],
      ['/plan?job=delegations', 'equal'],
      ['/plan?job=buyers', 'equal'],
    ]);
  });

  it('can name a lead later by setting one constant, with no other change', () => {
    expect(
      orderedJobs(['sell', 'buy', 'trip'], 'sell').map(({ job, weight }) => [job.key, weight]),
    ).toEqual([
      ['sell', 'lead'],
      ['buy', 'compact'],
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
