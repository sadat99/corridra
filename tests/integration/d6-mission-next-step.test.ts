import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missionCommand, missionStatus } from '../../packages/domain/src/missions';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';

// Team desk v4.1, units D6 and D7 (behind CORRIDRA_UX_TEAM_DESK_V41). The rules behind the Next step card and
// the action dialogs are pure, so they are held here: one step per stage, each a command the server accepts
// from that stage; the fields each action asks for; and the one line saying what changes and what the customer
// will read. The browser behaviour is in tests/operator/d6-mission-page.spec.ts.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const labels = async () =>
  await import('../../apps/web/app/operator/[section]/[missionId]/mission-labels');
const customer = (stage: string) => ({ step: `Step of ${stage}`, words: `Words of ${stage}.` });

describe('D6 and D7 switch', () => {
  it('registers CORRIDRA_UX_TEAM_DESK_V41, described, off unless exactly true', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_TEAM_DESK_V41');
    const entry = switchRegistry.find((s) => s.name === 'CORRIDRA_UX_TEAM_DESK_V41');
    expect(entry).toMatchObject({ label: 'Team desk v4.1', kind: 'flag' });
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', { CORRIDRA_UX_TEAM_DESK_V41: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', { CORRIDRA_UX_TEAM_DESK_V41: 'true' })).toBe(
      true,
    );
  });
  it('the mission page reads the switch on the server and the screen defaults to off', () => {
    // The desk needs the team shell as well (work-log follow-up: the page flag ignored CORRIDRA_UX_SHELLS_V2).
    const page = read('apps/web/app/operator/[section]/[missionId]/page.tsx');
    expect(page).toContain(
      "const deskV41 = uxSwitchOn('CORRIDRA_UX_SHELLS_V2') && uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41');",
    );
    expect(page).toContain('teamDeskV41={deskV41}');
    expect(page).not.toContain("teamDeskV41={uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')}");
    expect(read('apps/web/app/operator/operator-flags.tsx')).toContain('teamDeskV41 = false,');
    expect(read('apps/web/app/operator/[section]/[missionId]/mission-page.tsx')).toContain(
      'const { teamDeskV41: desk } = useOperatorFlags();',
    );
  });
});

describe('D6 the one next step of a stage', () => {
  // The stage each command starts from on the server (packages/missions/src/index.ts).
  const from: Record<string, string> = {
    DRAFT: 'qualify',
    QUALIFICATION: 'activate',
    ACTIVE: 'targeting',
    TARGETING: 'outreach',
    OUTREACH: 'meetings',
    MEETINGS: 'followup',
    FOLLOW_UP: 'pipeline',
    COMMERCIAL_PIPELINE: 'close',
    ON_HOLD: 'resume',
  };
  it('offers exactly one step per open stage, a command the server accepts from that stage', async () => {
    const { nextStep } = await labels();
    const actions = missionCommand.shape.action.options as readonly string[];
    for (const status of missionStatus.options) {
      const step = nextStep(status);
      if (status === 'CLOSED' || status === 'CANCELLED') {
        expect(step).toBeNull();
        continue;
      }
      expect(step?.action).toBe(from[status]);
      expect(actions).toContain(step!.action);
      // Title Case written in the text, no em dash.
      expect(step!.label).toMatch(/^[A-Z][A-Za-z-]*( [A-Z][A-Za-z-]*)*$/);
      expect(step!.lead).not.toContain('—');
    }
    expect(nextStep('SOMETHING_NEW')).toBeNull();
  });
  it('says so when no step is waiting, and pauses only where the server allows a pause', async () => {
    const { restingLine, canPause, actionTitle } = await labels();
    expect(restingLine('CLOSED')).toBe('This mission is closed. No step is waiting.');
    expect(restingLine('CANCELLED')).toBe('This mission was cancelled. No step is waiting.');
    expect(missionStatus.options.filter(canPause)).toEqual([
      'QUALIFICATION',
      'ACTIVE',
      'TARGETING',
      'OUTREACH',
      'MEETINGS',
      'FOLLOW_UP',
      'COMMERCIAL_PIPELINE',
    ]);
    expect(actionTitle('qualify')).toBe('Begin Qualification');
    expect(actionTitle('assign')).toBe('Update Mission Details');
    expect(actionTitle('pause')).toBe('Pause Mission');
    expect(actionTitle('cancel')).toBe('Cancel Mission');
  });
});

describe('D7 each action asks only for its fields', () => {
  const full = { next_action: 'Call the invented buyer', target_profile: 'Invented mills' };
  it('asks for the fields of the action and nothing else', async () => {
    const { stepFields } = await labels();
    expect(stepFields('assign', full)).toEqual([
      'owner',
      'nextAction',
      'dueAt',
      'marketCode',
      'targetProfile',
    ]);
    // One to three fields per step: market, target profile and the reason.
    expect(stepFields('qualify', full)).toEqual(['marketCode', 'targetProfile']);
    expect(stepFields('qualify', { next_action: '', target_profile: null })).toEqual([
      'nextAction',
      'marketCode',
      'targetProfile',
    ]);
    for (const action of ['activate', 'targeting', 'outreach', 'meetings', 'followup', 'resume'])
      expect(stepFields(action, full)).toEqual(['nextAction', 'dueAt']);
    for (const action of ['pause', 'cancel', 'close']) expect(stepFields(action, full)).toEqual([]);
  });
  it('always asks for a value the server would refuse as missing', async () => {
    const { stepFields } = await labels();
    expect(stepFields('cancel', { next_action: '', target_profile: null })).toEqual([
      'nextAction',
      'targetProfile',
    ]);
    expect(stepFields('activate', { next_action: 'ok', target_profile: 'Invented mills' })).toEqual(
      ['nextAction', 'dueAt'],
    );
    expect(stepFields('pause', { next_action: 'Call them', target_profile: ' a ' })).toEqual([
      'targetProfile',
    ]);
  });
});

describe('D7 one line on what changes and what the customer will see', () => {
  it('names the stage change and quotes the customer words for the new stage', async () => {
    const { stepStatement } = await labels();
    expect(stepStatement('qualify', 'DRAFT', customer)).toEqual({
      changes: 'Stage now: Received, waiting for review. After this: Qualifying.',
      customer: 'The customer will see: Step of QUALIFICATION. Words of QUALIFICATION.',
    });
    expect(stepStatement('pause', 'ACTIVE', () => ({ step: null, words: 'On hold.' }))).toEqual({
      changes: 'Stage now: Active. After this: Paused.',
      customer: 'The customer will see: On hold.',
    });
    expect(stepStatement('cancel', 'MEETINGS', customer).changes).toBe(
      'Stage now: Meetings. After this: Cancelled.',
    );
  });
  it('promises no stage change where the command makes none', async () => {
    const { stepStatement } = await labels();
    expect(stepStatement('assign', 'ACTIVE', customer).customer).toBe(
      'The stage the customer sees stays the same.',
    );
    expect(stepStatement('resume', 'ON_HOLD', customer).changes).toBe(
      'The mission returns to the stage it was paused from.',
    );
  });
  it('shows the route state, and qualification never needs a route (decision 3)', async () => {
    const { routeLine } = await labels();
    expect(routeLine(null, 'qualify')).toBe(
      'Route: not assigned yet. You can begin qualification without a route.',
    );
    expect(routeLine('BD to CN', 'qualify')).toBe('Route: BD to CN.');
    expect(routeLine(undefined, 'activate')).toBe('Route: not assigned yet.');
    expect(routeLine(null, '')).toBe('Route: not assigned yet.');
  });
});
