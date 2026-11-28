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
  // Operator desk (owner approved 20 Nov 2026): the five-group team sidebar with pinned queues and the table Today. Presentation only.
  'CORRIDRA_UX_OPERATOR_DESK',
  // Before Send (owner approved 20 Nov 2026): one block of three facts above each Send on the evidence reply and the recipient reply check step. Presentation only.
  'CORRIDRA_UX_BEFORE_SEND',
  // Buyer reply in steps (owner approved 20 Nov 2026): the step line, choice rows and the consent step order inside the reply page. Needs CORRIDRA_REPLY_PAGE. Presentation only.
  'CORRIDRA_UX_BUYER_STEPS',
  // Team desk v4.1 (owner approved 24 Nov 2026): menu v3, one page pattern and the desk screens of docs/revamp/specs/team-desk-v4-1.md phases 2 to 5. Presentation only.
  'CORRIDRA_UX_TEAM_DESK_V41',
  // Home page v4.2 (owner approved 25 Nov 2026): the new home composition and the trimmed public footer. Off unless exactly "true"; read at build time, so a change needs a redeploy. Presentation only.
  'CORRIDRA_UX_HOME_V42',
  // Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"): the light hero with a photo, one page of contextual examples and the pack footer. On only when exactly "true" and wins over V42; read at build time, so a change needs a redeploy. Presentation only.
  'CORRIDRA_UX_HOME_V43',
  // Home page v4.4 (owner, 27 Nov 2026, decision 4 "keep mine"): the redesign hero, a route map that follows the chosen route and the same map in the request form. It refines the v4.3 home, so it takes effect only while CORRIDRA_UX_HOME_V43 is also on. On only when exactly "true", off by default; off, the v4.3 home is unchanged. Presentation only.
  'CORRIDRA_UX_HOME_V44',
  // One job per page for the home, /how-it-works and /trust (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three, build it"): the home shows a short summary of the process and of trust, each linking to its page, and the two pages carry the full process and the full proof. Takes effect only while CORRIDRA_UX_HOME_V43 is also on; read at build time, so a change needs a redeploy. Presentation only.
  'CORRIDRA_UX_HOW_TRUST_V43',
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
  // The helper interest register (ADR-0085). Off unless exactly "true", and it also needs CORRIDRA_NETWORK_ENABLED to be "true";
  // the database module is separate and the form stays hidden while it is not installed.
  'CORRIDRA_HELPER_INTEREST',
  // ADR-087 U4, the member notice on /account and in the inbox. Off unless exactly "true"; separate from any U5 switch, and it
  // shows nothing while the member notice database module is not installed or no notice was delivered. It opens no access.
  'CORRIDRA_MEMBER_NOTICE',
  // ADR-087 U5, owners and admins read members' saved reports and decision cards and download their books. Off unless exactly
  // "true"; separate from CORRIDRA_MEMBER_NOTICE. Off, its routes answer 404 and nothing shows. Each workspace still opens only
  // 24 hours after its member notice was delivered, and only once the member access database module is installed.
  'CORRIDRA_MEMBER_ACCESS',
  // ADR-089, the guided Connect AI form over the existing model policy command. Off unless exactly "true"; off, its two routes
  // answer 404. It never switches AI on: inference stays behind its own switches and the deployment settings.
  'CORRIDRA_AI_CONNECT_FORM',
  // Journey modes (owner approved 23 Nov 2026): the Journey switcher in the signed-in sidebar and one journey at a time on Home,
  // Requests and Meetings. Off unless exactly "true", and it also needs CORRIDRA_UX_SHELLS_V2 and CORRIDRA_UX_MOVE. Presentation only.
  'CORRIDRA_UX_JOURNEY_MODES',
  // Customer account v18 (owner approved the canvas Home_V18_Account, 28 Nov 2026): Home, My Work, Companies, Delegations and More, the Acting for switcher and the My businesses page. Presentation over existing pages; anything without a server yet is shown as Coming soon.
  'CORRIDRA_UX_ACCOUNT_V18',
] as const;
export type UxSwitchName = (typeof uxSwitchNames)[number];

export function uxSwitchOn(name: UxSwitchName, env: NodeJS.ProcessEnv = process.env): boolean {
  // Preview-only: the claude/home-v44 branch preview shows the v18 account. Remove before any merge to main.
  if (name === 'CORRIDRA_UX_ACCOUNT_V18' && env.VERCEL_GIT_COMMIT_REF === 'claude/home-v44') return true;
  return env[name] === 'true';
}

/**
 * Whether sign-in keeps the short list of email destinations (ADR-067): while Pulse is on, or while the
 * emailed status link is on, so a link in an email brings the person back to the page it named.
 */
export function emailReturnPagesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return uxSwitchOn('CORRIDRA_PULSE_ENABLED', env) || uxSwitchOn('CORRIDRA_STATUS_LINK', env);
}
