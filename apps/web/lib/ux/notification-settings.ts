// Whether the customer's email choices page (/account/notifications) exists. One answer for the page and for the
// avatar menu's Notification Settings item, so the menu never offers a link that answers 404: the page is dark
// unless Pulse is on, except for a signed-in person who may still switch email off (withdrawal), which needs
// only the customer area.
import {
  customerNotificationsEnabled,
  customerNotificationWithdrawalEnabled,
} from '@corridra/auth/customer-notifications';

export const notificationSettingsAvailable = () =>
  customerNotificationsEnabled() || customerNotificationWithdrawalEnabled();
