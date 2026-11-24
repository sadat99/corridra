// Whether journey modes are on. Kept beside the model, not in the switch list, so it is worked out from the one
// switch reader every page already uses and nothing else has to know about it.
import { uxSwitchOn } from '../ux-switches';

/** Journey modes act only with the signed-in frame and Your Move (the journey pages) also on. */
export function journeyModesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    uxSwitchOn('CORRIDRA_UX_JOURNEY_MODES', env) &&
    uxSwitchOn('CORRIDRA_UX_SHELLS_V2', env) &&
    uxSwitchOn('CORRIDRA_UX_MOVE', env)
  );
}
