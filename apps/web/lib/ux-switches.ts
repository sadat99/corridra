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
] as const;
export type UxSwitchName = (typeof uxSwitchNames)[number];

export function uxSwitchOn(name: UxSwitchName, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[name] === 'true';
}
