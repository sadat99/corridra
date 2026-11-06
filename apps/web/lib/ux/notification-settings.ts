// Whether the customer's email choices page (/account/notifications) exists. The avatar menu's Notification
// Settings item follows it, so the menu never offers a link that answers 404. It repeats the page's own test, which
// stays in the page (apps/web/app/account/notifications/page.tsx, pinned by tests/integration/ux-pulse.test.ts):
// the page is dark unless Pulse is on, except for a signed-in person who may still switch email off (withdrawal),
// which needs only the customer area. tests/integration/revamp-nav-notification-settings.test.ts keeps the two in step.
import {
  customerNotificationsEnabled,
  customerNotificationWithdrawalEnabled,
} from '@corridra/auth/customer-notifications';

export const notificationSettingsAvailable = () =>
  customerNotificationsEnabled() || customerNotificationWithdrawalEnabled();
