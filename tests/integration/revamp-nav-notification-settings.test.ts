import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationSettingsAvailable } from '../../apps/web/lib/ux/notification-settings';
import { customerAvatarItems } from '../../apps/web/lib/ux/customer-navigation';

// Navigation v1, Guardian finding on PR 347: the avatar menu's Notification Settings must be a link only where its
// page exists. The page is dark (404) unless Pulse is on, or the customer area is on (a person may still switch
// email off). One helper answers for both the page and the menu; here it is exercised under each setting with the
// real switches, and the menu item follows it.
afterEach(() => vi.unstubAllEnvs());

const item = () =>
  customerAvatarItems({
    billing: false,
    notificationSettings: notificationSettingsAvailable(),
    organisationProfiles: true,
    workspaces: [],
  }).find((entry) => entry.label === 'Notification Settings')!;

describe('Notification Settings follows whether its page exists', () => {
  it('is Coming soon, not a link, with the customer area and Pulse both off', () => {
    vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', '');
    vi.stubEnv('CORRIDRA_PULSE_ENABLED', '');
    expect(notificationSettingsAvailable()).toBe(false);
    expect(item().kind).toBe('soon');
  });

  it('is a link to the page with the customer area on, even with Pulse off (email can still be switched off)', () => {
    vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_PULSE_ENABLED', '');
    vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
    expect(notificationSettingsAvailable()).toBe(true);
    expect(item()).toEqual({
      kind: 'link',
      label: 'Notification Settings',
      href: '/account/notifications',
    });
  });

  it('is a link with Pulse and the customer area on', () => {
    vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_PULSE_ENABLED', 'true');
    vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
    expect(notificationSettingsAvailable()).toBe(true);
  });

  it("repeats the page's own test, which stays in the page", () => {
    const page = readFileSync(
      new URL('../../apps/web/app/account/notifications/page.tsx', import.meta.url),
      'utf8',
    );
    const helper = readFileSync(
      new URL('../../apps/web/lib/ux/notification-settings.ts', import.meta.url),
      'utf8',
    );
    // The page is dark when Pulse is off, and then needs the withdrawal path (the customer area) to exist at all.
    expect(page).toContain('const dark = !customerNotificationsEnabled();');
    expect(page).toContain('if (dark && !customerNotificationWithdrawalEnabled()) notFound();');
    expect(helper).toContain(
      'customerNotificationsEnabled() || customerNotificationWithdrawalEnabled()',
    );
  });
});
