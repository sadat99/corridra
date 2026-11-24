import { inEveryLanguage } from '../lang';

// WS-E message block (commercial readiness program, D16 and 3.3). Only WS-E edits this file.
// Keys start with "wse.". English is the source; each other language's words for these keys
// are in lang/<code>.ts, and a key a language has no words for is shown in English.
// Privacy and consent lines stay in English. The three team group words Delivery, Outcomes and All
// tools and settings, and the menu words Close menu, Collapse menu, Expand menu, Helper sections
// and How assigned work works, are English placeholders in every language until reviewed (D16): the sidebar
// marks a word lang="en" when the chosen language's text equals the English text (open language gap).
export const wsEEn = {
  'wse.team.nav': 'Team sections',
  'wse.team.today': 'Today',
  'wse.team.missions': 'Missions',
  'wse.team.companies': 'Companies',
  'wse.team.meetings': 'Meetings',
  'wse.team.quotes': 'Money',
  'wse.team.reports': 'Reports',
  'wse.team.network': 'Network',
  'wse.team.evidence': 'Evidence',
  'wse.team.settings': 'Settings',
  'wse.team.owner': 'Owner: what is on and off',
  'wse.shell.team': 'Team workspace',
  'wse.shell.customer': 'Your account',
  'wse.shell.contributor': 'Your tasks',
  'wse.shell.live': 'Live',
  'wse.shell.preview': 'Preview',
  'wse.shell.statusLabel': 'Service status',
  'wse.shell.inbox': 'Inbox',
  'wse.shell.menu': 'Sections',
  'wse.shell.closeMenu': 'Close menu',
  'wse.shell.collapseMenu': 'Collapse menu',
  'wse.shell.expandMenu': 'Expand menu',
  'wse.contributor.nav': 'Helper sections',
  'wse.contributor.how': 'How assigned work works',
  'wse.shell.website': 'Corridra website',
  'wse.shell.help': 'Help',
  'wse.trust.note': 'Kept in English so evidence labels stay exact',
  'wse.nav.customer': 'Customer navigation',
  'wse.nav.home': 'Home',
  'wse.nav.move': 'Your Move',
  'wse.nav.missions': 'Missions',
  'wse.nav.work': 'Requests',
  'wse.nav.companies': 'Companies',
  'wse.nav.library': 'Library',
  'wse.nav.results': 'Reports',
  'wse.nav.more': 'Account',
} as const;

/** These words in every other language (lang/<code>.ts), English where a language has none yet. */
export const wsE = inEveryLanguage(wsEEn);
