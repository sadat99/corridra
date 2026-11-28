import { describe, expect, it } from 'vitest';
import { customerTabs } from '../../apps/web/lib/ux/customer-navigation';

// Customer account v18 (canvas Home_V18_Account): five destinations, Meetings and Results inside My Work.
describe('customer account v18 navigation', () => {
  it('lists Home, My Work, Companies, Delegations and More in that order', () => {
    const tabs = customerTabs({ companies: true, move: false });
    expect(tabs.map((t) => t.label)).toEqual(['Home', 'My Work', 'Companies', 'Delegations', 'More']);
    expect(tabs.map((t) => t.href)).toEqual([
      '/account',
      '/account?view=work',
      '/account/companies',
      '/account/delegation-hub',
      '/account?view=more',
    ]);
  });
  it('leaves Companies out where its module is off and never lists more than five', () => {
    const tabs = customerTabs({ companies: false, move: false });
    expect(tabs.map((t) => t.key)).not.toContain('companies');
    expect(tabs.length).toBeLessThanOrEqual(5);
  });
});
