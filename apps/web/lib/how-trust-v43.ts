import { uxSwitchOn } from './ux-switches';

// One job per page (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three, build it"). The home keeps a
// summary of the process and of trust; /how-it-works carries the full process and /trust the full proof. The switch
// CORRIDRA_UX_HOW_TRUST_V43 is off by default and does nothing unless the home page v4.3 is on as well: the deep
// pages take the v4.3 header and footer, and the home they send a reader back to is the v4.3 home.
export function howTrustV43On(env: NodeJS.ProcessEnv = process.env): boolean {
  return uxSwitchOn('CORRIDRA_UX_HOME_V43', env) && uxSwitchOn('CORRIDRA_UX_HOW_TRUST_V43', env);
}

/** A sentence per item, so a summary reads as short lines. Splits after . ? ! and their Arabic, Bangla and CJK forms. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!؟।。！？])\s+|(?<=[。！？])/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
