// When a mission email may be sent. A pure decision with a reason, so the caller can log the reason
// (never the address) and tests can pin every refusal. Nothing here sends.
import { realUseEnabled } from './customer-production';

export type MissionMailGateInput = {
  env?: NodeJS.ProcessEnv;
  /** The workspace the request belongs to is a sample workspace. */
  workspaceSynthetic: boolean;
  /** The address of the signed-in account holder, as the identity provider returned it. */
  accountEmail: string | null | undefined;
  accountEmailVerified: boolean;
};

export type MissionMailGateReason =
  'switch-off' | 'not-real-use' | 'sample-workspace' | 'email-not-verified' | 'address-not-usable';

const plainAddress = /^[^\s@<>"',;:()[\]\\]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function missionMailGate(input: MissionMailGateInput): {
  send: boolean;
  reason?: MissionMailGateReason;
} {
  const env = input.env ?? process.env;
  if (env.CORRIDRA_MISSION_EMAIL_ENABLED !== 'true') return { send: false, reason: 'switch-off' };
  if (!realUseEnabled(env)) return { send: false, reason: 'not-real-use' };
  if (input.workspaceSynthetic) return { send: false, reason: 'sample-workspace' };
  if (!input.accountEmailVerified) return { send: false, reason: 'email-not-verified' };
  const address = input.accountEmail ?? '';
  if (
    address.length > 254 ||
    !plainAddress.test(address) ||
    /\.(invalid|example|test|localhost)$/i.test(address) ||
    /@example\.(com|net|org)$/i.test(address)
  )
    return { send: false, reason: 'address-not-usable' };
  return { send: true };
}

/** The founder sentence the owner writes. Empty means nothing is rendered. */
export function readFounderLine(env: NodeJS.ProcessEnv = process.env) {
  return env.MISSION_EMAIL_FOUNDER_LINE ?? '';
}
