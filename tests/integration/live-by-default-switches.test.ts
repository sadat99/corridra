import { describe, expect, it } from 'vitest';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
import { liveByDefaultSwitches, uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';

// Owner, 28 Nov 2026: "dont hesitate about "live user will see" etc, we will always update this way, like live, no by
// switching on/off, although we will keep switch, in case we ever need." The new designs of claude/home-v44 ship live
// and keep an off switch: on unless the setting is exactly "false". Every earlier switch keeps "on only when true".
const live = [
  'CORRIDRA_UX_HOME_V44',
  'CORRIDRA_UX_ACCOUNT_V18',
  'CORRIDRA_UX_ACCESS_WINDOW_V11',
  'CORRIDRA_UX_WORK_SIGNIN_V12',
  'CORRIDRA_UX_PLAN_V10',
  'CORRIDRA_UX_START_V13',
] as const;

describe('live-by-default switches', () => {
  it('are exactly the new designs of this branch', () => {
    expect([...liveByDefaultSwitches].sort()).toEqual([...live].sort());
    for (const name of live) expect(uxSwitchNames).toContain(name);
  });
  it('are on when the setting is unset', () => {
    for (const name of live) expect(uxSwitchOn(name, {}), name).toBe(true);
  });
  it('are off only when the setting is exactly "false"', () => {
    for (const name of live) {
      expect(uxSwitchOn(name, { [name]: 'false' }), name).toBe(false);
      for (const value of ['true', 'FALSE', 'False', ' false', '0', 'no', 'off', ''])
        expect(uxSwitchOn(name, { [name]: value }), `${name}=${JSON.stringify(value)}`).toBe(true);
    }
  });
  it('leave every earlier switch on only when exactly "true"', () => {
    for (const name of uxSwitchNames.filter((n) => !liveByDefaultSwitches.has(n))) {
      expect(uxSwitchOn(name, {}), name).toBe(false);
      expect(uxSwitchOn(name, { [name]: 'false' }), name).toBe(false);
      expect(uxSwitchOn(name, { [name]: 'TRUE' }), name).toBe(false);
      expect(uxSwitchOn(name, { [name]: 'true' }), name).toBe(true);
    }
  });
  it('are described for the owner as on unless set to false', () => {
    const kinds = new Map(switchRegistry.map((entry) => [entry.name, entry.kind]));
    for (const name of live) expect(kinds.get(name), name).toBe('flagDefaultOn');
    const view = new Map(
      describeSwitches({}).flatMap((g) => g.rows.map((r) => [r.name, r.state.text])),
    );
    for (const name of live) expect(view.get(name), name).toBe('On');
    const off = Object.fromEntries(live.map((name) => [name, 'false']));
    const offView = new Map(
      describeSwitches(off).flatMap((g) => g.rows.map((r) => [r.name, r.state.text])),
    );
    for (const name of live) expect(offView.get(name), name).toBe('Off');
  });
});
