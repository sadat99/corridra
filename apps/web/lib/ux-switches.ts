/**
 * The switches that gate the UX update. Each is "on" only when the setting is exactly "true", and
 * each is off by default, so with every one unset a page is byte for byte what it was before.
 * Reading goes through here so the names stay in one place; the plain-language description of each
 * lives in `owner-switches.ts` (a test fails when a name is read but not described).
 */
export const uxSwitchNames = [
  'CORRIDRA_UX_NAV',
  'CORRIDRA_UX_MOVE',
  'CORRIDRA_UX_ROAD',
  'CORRIDRA_UX_LENSES',
  'CORRIDRA_UX_FIRSTQ',
  'CORRIDRA_UX_TRIP',
  'CORRIDRA_UX_MOVE_RECORDS',
  'CORRIDRA_REPLY_PAGE',
  'CORRIDRA_PULSE_ENABLED',
  'CORRIDRA_STATUS_LINK',
  'CORRIDRA_SHARE_CARD',
  'CORRIDRA_UX_OPERATOR_URLS',
  'CORRIDRA_UX_PROGRAMME',
  'CORRIDRA_UX_FAIRS',
  'CORRIDRA_UX_BOOKS',
  'CORRIDRA_UX_FRONT_DOORS',
  // The three access pages under /access: in Unit A it only decides whether search engines may index them.
  'CORRIDRA_UX_ACCESS_DOORS',
  // Pocket (phone): the Next Move button and the short phone header on signed-in customer pages. Presentation only.
  'CORRIDRA_UX_POCKET',
  // Commercial readiness program (31 Oct 2026, section 5.4). Off in production until the owner sets them.
  'CORRIDRA_UX_SHELLS_V2',
  'CORRIDRA_UX_MISSIONS_V2',
  'CORRIDRA_NOTIFICATIONS_V2',
  'CORRIDRA_TEAM_INVITES',
  'CORRIDRA_ROUTE_PACK_FORM',
  // ADR-083 (sourcing workflow). Off unless the setting is exactly "true"; the database module and its control are separate.
  'CORRIDRA_SOURCING_WORKFLOW',
  'CORRIDRA_SUPPLY_SOURCES',
  // ADR-084 delegation, off unless exactly "true": S0 first run acts where public programme pages are on, S4 participant home wherever participant terms are on; no command, permission or data.
  'CORRIDRA_DELEGATION_FIRST_RUN',
  // ADR-084 S3 people board and money view, off unless exactly "true"; presentation over the existing reads, no command, permission or data.
  'CORRIDRA_DELEGATION_BOARD',
  // ADR-084 S7: the Buying Trip starter template, off unless exactly "true"; it also needs the programme templates module on
  'CORRIDRA_DELEGATION_BUYING_TRIP',
  // ADR-084 S1 (programme page share kit). Off unless exactly "true"; it only acts where public programme pages are on
  // and adds no tracking, no send and no data beyond the optional structured dates of a page version.
  'CORRIDRA_PROGRAMME_SHARE_KIT',
] as const;
export type UxSwitchName = (typeof uxSwitchNames)[number];

export function uxSwitchOn(name: UxSwitchName, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[name] === 'true';
}

/**
 * Whether sign-in keeps the short list of email destinations (ADR-067): while Pulse is on, or while the
 * emailed status link is on, so a link in an email brings the person back to the page it named.
 */
export function emailReturnPagesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return uxSwitchOn('CORRIDRA_PULSE_ENABLED', env) || uxSwitchOn('CORRIDRA_STATUS_LINK', env);
}
