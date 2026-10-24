import { founderActivation, type ActivationState } from '@corridra/auth/founder-activation';
import {
  customerOpenAdmission,
  customerProductionUnlocked,
  realUseEnabled,
} from '@corridra/auth/customer-production';

/**
 * Plain-language registry of every CORRIDRA_* setting the application reads.
 * Read-only: it describes state and never changes it. A test fails when the code reads a setting
 * that is not described here, so a new switch cannot ship without a label.
 */
export const switchGroups = [
  'Accounts and requests',
  'Programmes and delegations',
  'Money and pricing',
  'Delivery',
  'Network',
  'Safety and checks',
  'Team access',
] as const;
export type SwitchGroup = (typeof switchGroups)[number];

/**
 * module: a customer module whose real state comes from founderActivation (it also checks the
 *   switches it depends on).
 * flag: the setting is exactly "true" or not.
 * mode: state comes from the shared helper that combines several settings.
 * setting: a value, not a switch. Only "Set" or "Not set" is ever shown, never the value.
 * planned: the switch is reserved for work that is not built yet, so it is not shown as on or off.
 */
export type SwitchKind = 'module' | 'flag' | 'mode' | 'setting' | 'planned';

export type SwitchEntry = {
  name: string;
  label: string;
  line: string;
  group: SwitchGroup;
  kind: SwitchKind;
};

export const switchRegistry: SwitchEntry[] = [
  // Accounts and requests
  {
    name: 'CORRIDRA_NEON_AUTH_ENABLED',
    label: 'Customer sign-up and sign-in',
    line: 'Turns on customer accounts.',
    group: 'Accounts and requests',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_NEON_AUTH_PRODUCTION_READY',
    label: 'Customer sign-in on the live site',
    line: 'Lets customer sign-in run on the live site.',
    group: 'Accounts and requests',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_CUSTOMER_ISSUER',
    label: 'Sign-in issuer address',
    line: 'The identity address the customer modules trust. Its value is never shown.',
    group: 'Accounts and requests',
    kind: 'setting',
  },
  {
    name: 'CORRIDRA_CUSTOMER_OPEN_ADMISSION',
    label: 'Open sign-up',
    line: 'Admits any account with a verified email, without an offline list.',
    group: 'Accounts and requests',
    kind: 'mode',
  },
  {
    name: 'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    label: 'Customer workspaces',
    line: 'Lets a signed-in customer open a private workspace.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
    label: 'Private requests',
    line: 'Lets a customer send a request and follow it.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED',
    label: 'Request detail workspace',
    line: 'Lets a customer reopen the details they sent.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_MISSION_DRAFTS_ENABLED',
    label: 'Guided request drafts',
    line: 'Saves answers while a customer fills in a request.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
    label: 'Saved commercial reports',
    line: 'Lets a customer keep approved reports in the account.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_DECISIONS_ENABLED',
    label: 'Report decisions',
    line: 'Lets a customer record a decision on a report.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_COMPANIES_ENABLED',
    label: 'Company continuity',
    line: 'Keeps approved companies across saved reports.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_ORGANISATION_PROFILES_ENABLED',
    label: 'Organisation profiles',
    line: 'Lets a customer keep a company profile.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED',
    label: 'Company links',
    line: 'Links a customer company to one shared company record.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED',
    label: 'Team roles and leaving',
    line: 'Lets a customer owner set team roles and let members leave.',
    group: 'Accounts and requests',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_CODE_SIGNIN',
    label: 'Sign in with a code',
    line: 'Adds a second way to sign in: a six-digit code sent by email. Password sign-in stays.',
    group: 'Accounts and requests',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED',
    label: 'Branded sign-in and reset emails',
    line: 'Sends the code and reset emails from Corridra. Needs its sender settings and the Neon webhook.',
    group: 'Accounts and requests',
    kind: 'flag',
  },
  // Programmes and delegations
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
    label: 'Delegation programmes',
    line: 'Lets an organiser create and list delegation programmes.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED',
    label: 'Participant invitations and registrations',
    line: 'Lets an organiser invite participants and take registrations.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMME_CONTEXT_ENABLED',
    label: 'Programme context',
    line: 'Shares consented participant objectives with the organiser.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_MISSION_SHARES_ENABLED',
    label: 'Mission sharing with participants',
    line: 'Lets an organiser share a mission with a participant.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED',
    label: 'Programme coordination and reporting',
    line: 'Lets an organiser plan programme days and see reports.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED',
    label: 'Repeatable programme templates',
    line: 'Lets an organiser reuse a programme setup.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMME_TERMS_ENABLED',
    label: 'Programme terms, eligibility and places',
    line: 'Lets an organiser set terms, who can join and how many places.',
    group: 'Programmes and delegations',
    kind: 'module',
  },
  // Money and pricing
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED',
    label: 'Organiser programme economics',
    line: 'Lets an organiser track fees, costs and margin. No payment is taken.',
    group: 'Money and pricing',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED',
    label: 'Pricing, series and exports',
    line: 'Lets an organiser set prices, run a series and export results.',
    group: 'Money and pricing',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED',
    label: 'Paid-service requests',
    line: 'Lets a customer ask for a paid service. No payment is taken.',
    group: 'Money and pricing',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_BILLING_ENABLED',
    label: 'Sample plans and subscriptions',
    line: 'Lets a sample workspace ask for a plan. Nothing is charged and no invoice is made.',
    group: 'Money and pricing',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_CUSTOMER_INVOICING_ENABLED',
    label: 'Sample invoices and payment records',
    line: 'Lets the team issue sample invoices and record payments for sample workspaces. Needs sample plans. Nothing is collected.',
    group: 'Money and pricing',
    kind: 'module',
  },
  // Delivery
  {
    name: 'CORRIDRA_FOUNDATIONS_ENABLED',
    label: 'Team workspace',
    line: 'Turns on the protected workspace for the Corridra team.',
    group: 'Delivery',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_LIVE_ROLLOUT_ENABLED',
    label: 'Team workspace on the live site',
    line: 'Lets the team workspace run on the live site.',
    group: 'Delivery',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_DELIVERY_ENABLED',
    label: 'Delivery and reports',
    line: 'Lets the team build and send scoped reports and delivery links.',
    group: 'Delivery',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_CUSTOMER_DELIVERY_ENABLED',
    label: 'Assigned missions',
    line: 'Lets a customer see missions the team assigned to them.',
    group: 'Delivery',
    kind: 'module',
  },
  {
    name: 'CORRIDRA_MISSION_EMAIL_ENABLED',
    label: 'Mission emails',
    line: 'Sends "We have your request" to the verified account holder. Needs the mission mail database module installed and opened, and the sender settings. "One thing needs you" waits for the Mission Road work.',
    group: 'Delivery',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_LANGUAGES_REVIEWED',
    label: 'Languages with reviewed text',
    line: 'Codes of the languages a native speaker has reviewed, for example bn,zh,es. Only these appear in the language chip. English is always there. Needs a new deploy.',
    group: 'Accounts and requests',
    kind: 'setting',
  },
  {
    name: 'CORRIDRA_LANGUAGES_PREVIEW',
    label: 'Show draft languages',
    line: 'Shows every draft language in the language chip, marked as a draft, so you can read them before a reviewer has. Keep it off for the public. Needs a new deploy.',
    group: 'Accounts and requests',
    kind: 'flag',
  },
  {
    name: 'MISSION_EMAIL_FOUNDER_LINE',
    label: 'Founder sentence in the first email',
    line: 'One sentence in your words, shown in the first email. Empty shows nothing. Its text is never shown here.',
    group: 'Delivery',
    kind: 'setting',
  },

  // Network
  {
    name: 'CORRIDRA_NETWORK_ENABLED',
    label: 'Corridra Network',
    line: 'Lets invited helpers see and do assigned tasks.',
    group: 'Network',
    kind: 'flag',
  },
  // Safety and checks
  {
    name: 'CORRIDRA_REAL_USE_ENABLED',
    label: 'Real customer use',
    line: 'On only when real data mode, this switch and the owner approval value all agree.',
    group: 'Safety and checks',
    kind: 'mode',
  },
  {
    name: 'CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK',
    label: 'Live site unlock',
    line: 'The owner approval that lets customer modules run on the live site.',
    group: 'Safety and checks',
    kind: 'mode',
  },
  {
    name: 'CORRIDRA_AI_ENABLED',
    label: 'AI drafts',
    line: 'Allows AI draft tools. AI never decides access, money or facts.',
    group: 'Safety and checks',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_AI_FIXTURE_URL',
    label: 'AI sample service address',
    line: 'Address of the sample AI service used for tests. Its value is never shown.',
    group: 'Safety and checks',
    kind: 'setting',
  },
  {
    name: 'CORRIDRA_OPENAI_PROCESSING_LOCATIONS',
    label: 'AI processing locations',
    line: 'Where an AI provider may process data. Its value is never shown.',
    group: 'Safety and checks',
    kind: 'setting',
  },
  // Team access
  {
    name: 'CORRIDRA_OPERATOR_RECOVERY_ENABLED',
    label: 'Team password recovery email',
    line: 'Lets team members reset a password by email.',
    group: 'Team access',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_VIEW_AS_ENABLED',
    label: 'Preview as a customer',
    line: 'Lets owners and admins open a read-only preview of a customer screen with sample data. Every open is logged. It never signs in as a real person.',
    group: 'Team access',
    kind: 'flag',
  },
  {
    name: 'CORRIDRA_OWNER_PAGE_ENABLED',
    label: 'This Owner page',
    line: 'Shows this page to workspace owners and admins.',
    group: 'Team access',
    kind: 'flag',
  },
];

/** Names that hold a secret. They are never listed and their values are never read. */
export function isSecretName(name: string) {
  return /(KEY|SECRET|TOKEN|PASSWORD)$/.test(name);
}

export type SwitchTone = 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown';
export type SwitchState = { text: string; tone: SwitchTone };
export type SwitchRow = SwitchEntry & { state: SwitchState };
export type SwitchGroupView = { group: string; rows: SwitchRow[] };

const moduleStates: Record<ActivationState, SwitchState> = {
  ON: { text: 'On', tone: 'positive' },
  OFF: { text: 'Off', tone: 'neutral' },
  WAITING_PREREQUISITE: { text: 'Waiting for another switch', tone: 'caution' },
  LOCKED_PRODUCTION: { text: 'Locked until the live site is unlocked', tone: 'caution' },
  LOCKED_NOT_SYNTHETIC: { text: 'Locked by data mode', tone: 'caution' },
};
const on: SwitchState = { text: 'On', tone: 'positive' };
const off: SwitchState = { text: 'Off', tone: 'neutral' };

function resolve(
  entry: SwitchEntry,
  env: NodeJS.ProcessEnv,
  modules: Map<string, ActivationState>,
) {
  if (entry.kind === 'planned') return { text: 'Planned, not built yet', tone: 'unknown' as const };
  if (entry.kind === 'setting')
    return env[entry.name]
      ? { text: 'Set', tone: 'info' as const }
      : { text: 'Not set', tone: 'neutral' as const };
  if (entry.kind === 'module') return moduleStates[modules.get(entry.name) ?? 'OFF'];
  if (entry.kind === 'mode') {
    if (entry.name === 'CORRIDRA_CUSTOMER_OPEN_ADMISSION')
      return customerOpenAdmission(env) ? on : off;
    if (entry.name === 'CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK')
      return customerProductionUnlocked(env) ? on : off;
    if (entry.name === 'CORRIDRA_REAL_USE_ENABLED') return realUseEnabled(env) ? on : off;
    return off;
  }
  return env[entry.name] === 'true' ? on : off;
}

/**
 * Switch rows grouped for display. Settings that are present but not described above are shown in
 * their own group, so nothing is hidden. Secret names are skipped before their value is read.
 */
export function describeSwitches(env: NodeJS.ProcessEnv = process.env): SwitchGroupView[] {
  const modules = new Map(founderActivation(env).modules.map((m) => [m.flag, m.state]));
  const groups: SwitchGroupView[] = switchGroups.map((group) => ({
    group,
    rows: switchRegistry
      .filter((entry) => entry.group === group)
      .map((entry) => ({ ...entry, state: resolve(entry, env, modules) })),
  }));
  const known = new Set(switchRegistry.map((entry) => entry.name));
  const extra = Object.keys(env)
    .filter((name) => name.startsWith('CORRIDRA_') && !known.has(name) && !isSecretName(name))
    .sort()
    .map((name): SwitchRow => ({
      name,
      label: name,
      line: 'Found in the settings but not described yet. Only its state is shown.',
      group: 'Team access',
      kind: 'flag',
      state:
        env[name] === 'true'
          ? on
          : env[name]
            ? { text: 'Set', tone: 'info' }
            : { text: 'Not set', tone: 'neutral' },
    }));
  if (extra.length) groups.push({ group: 'Not described yet', rows: extra });
  return groups;
}
