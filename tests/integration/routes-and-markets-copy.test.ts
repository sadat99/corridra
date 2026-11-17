import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { translate } from '../../apps/web/lib/i18n/messages';

// Owner decision 17 Nov 2026, routes and markets: five open destinations beside China, shown as equals, and Spain is
// no longer a route name in the home and footer English words.
const home = readFileSync('apps/web/lib/i18n/home-words.ts', 'utf8');
const footer = readFileSync('apps/web/lib/i18n/messages.ts', 'utf8');

describe('routes and markets copy', () => {
  it('names every open destination in the English routes copy', () => {
    for (const key of [
      'home.country.cn',
      'home.country.eu',
      'home.country.uk',
      'home.country.us',
      'home.country.au',
      'home.country.asia',
    ] as const)
      expect(translate('en', key as never), key).not.toBe(key);
    const line = translate('en', 'footer.routes');
    for (const name of ['China', 'the EU', 'the UK', 'the US', 'Australia', 'key Asian markets'])
      expect(line, name).toContain(name);
  });

  it('does not call Spain a route in the home or footer English words', () => {
    expect(translate('en', 'footer.routes')).not.toMatch(/Spain/);
    expect(translate('en', 'footer.link.spain')).not.toMatch(/Spain/);
    expect(translate('en', 'home.start.sell.route' as never)).not.toMatch(/Spain/);
    expect(home).not.toMatch(/'home\.pass\.bdes'/);
    expect(home).not.toMatch(/'home\.routes\.title': 'Two routes/);
    expect(footer).not.toMatch(/First routes: Bangladesh to China, Spain/);
  });
});
