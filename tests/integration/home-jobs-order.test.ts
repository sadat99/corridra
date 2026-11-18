import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homeJobOrder, homeJobs, orderedJobs } from '../../apps/web/lib/home-jobs';
import { homeBoardDrafts, homeEn, homeWords } from '../../apps/web/lib/i18n/home-words';
import { translate } from '../../apps/web/lib/i18n/messages';

// Owner decision, 12 November 2026: the three home jobs carry equal weight and one constant sets the order.
describe('home jobs order', () => {
  it('draws Buy, the group trip and Sell in that order, with the same links as before', () => {
    // Owner decision, 12 November 2026: "Equal weight".
    expect(homeJobOrder).toEqual(['buy', 'trip', 'sell']);
    expect(orderedJobs().map((job) => job.href)).toEqual([
      '/plan?job=sourcing',
      '/plan?job=delegations',
      '/plan?job=buyers',
    ]);
  });

  it('names only the routes the repository already states', () => {
    expect(Object.values(homeJobs).map((job) => translate('en', job.route))).toEqual([
      'Bangladesh to China',
      'Delegations and trade missions',
      // owner decision 17 Nov 2026, routes and markets
      'Bangladesh to the EU, the UK, the US, Australia and key Asian markets',
    ]);
    // The footer's open-routes line is where the repository states its routes.
    const messages = readFileSync('apps/web/lib/i18n/messages.ts', 'utf8');
    expect(messages).toContain(
      // owner decision 17 Nov 2026, routes and markets
      'Open now from Bangladesh: China, the EU, the UK, the US, Australia, key Asian markets',
    );
  });

  it('every catalogue carries the new words in English until a native review is recorded', () => {
    const added = Object.keys(homeEn).filter(
      (key) => key.startsWith('home.tr.') || key.endsWith('.route'),
    ) as (keyof typeof homeEn)[];
    expect(added.length).toBeGreaterThan(30);
    // The owner's board 3c hero drafts (LP3, owner 18 November 2026) are the one exception: Bangla, Chinese and Spanish
    // carry the board's draft lines for those keys, marked for native review; every other key stays English.
    for (const [code, words] of Object.entries(homeWords)) {
      const drafted: Record<string, string> =
        homeBoardDrafts[code as keyof typeof homeBoardDrafts] ?? {};
      for (const key of added) expect(words[key]).toBe(key in drafted ? drafted[key] : homeEn[key]);
    }
    for (const key of added) expect(homeEn[key]).not.toMatch(/—/);
  });
});
