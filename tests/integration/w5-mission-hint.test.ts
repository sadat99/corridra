import { describe, expect, it } from 'vitest';
import {
  missionFromAddress,
  missionHintNote,
  missionHintSection,
  takeMissionHint,
} from '../../apps/web/app/operator/mission-hint';

// W5: the mission hint a section applies. Pure rules: which section an address names, and that a hint is used
// once per section and mission in a page load.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const at = (path: string, search = '', hash = '') => ({ pathname: path, search, hash });

describe('the note', () => {
  it('says what to do next, in plain words', () => {
    expect(missionHintNote).toBe(
      'This mission is not in the list shown here. Choose a mission from the list, or open the mission page again.',
    );
  });
});

describe('the mission in the address', () => {
  it('accepts a well-formed id, lower-cased, and ignores anything else', () => {
    expect(missionFromAddress('?workspace=x&mission=' + A.toUpperCase())).toBe(A);
    for (const bad of ['', '?mission=', '?mission=not-a-uuid', '?mission=' + A + 'x'])
      expect(missionFromAddress(bad), bad).toBeNull();
  });
});

describe('the section an address names', () => {
  it('is the # part when there is one', () => {
    expect(missionHintSection(at('/operator', '', '#workspace-research'))).toBe(
      'workspace-research',
    );
    expect(missionHintSection(at('/', '', '#workspace-commercial'))).toBe('workspace-commercial');
  });
  it('is the section word of a section address, and the # part wins over it', () => {
    expect(missionHintSection(at('/operator/research'))).toBe('workspace-research');
    expect(missionHintSection(at('/operator/commercial'))).toBe('workspace-commercial');
    expect(missionHintSection(at('/operator/research', '', '#workspace-commercial'))).toBe(
      'workspace-commercial',
    );
  });
  it('is none for an address that names no section', () => {
    expect(missionHintSection(at('/operator'))).toBeNull();
    expect(missionHintSection(at('/operator', '', '#'))).toBeNull();
    expect(missionHintSection(at('/operator/owner'))).toBeNull();
  });
});

describe('taking the hint', () => {
  const search = (mission: string) => `?workspace=w&mission=${mission}`;
  it('answers only the section the address names', () => {
    const address = at('/operator', search(A), '#workspace-research');
    expect(takeMissionHint('workspace-commercial', address)).toBeNull();
    expect(takeMissionHint('workspace-research', address)).toBe(A);
  });
  it('answers nothing when the address names no section or no valid mission', () => {
    expect(takeMissionHint('workspace-research', at('/operator', search(B)))).toBeNull();
    expect(
      takeMissionHint(
        'workspace-research',
        at('/operator', '?mission=nope', '#workspace-research'),
      ),
    ).toBeNull();
    // Nothing was used up by those, so the named section still gets the hint.
    expect(
      takeMissionHint('workspace-research', at('/operator', search(B), '#workspace-research')),
    ).toBe(B);
  });
  it('gives a hint once per section and mission in a page load', () => {
    const research = at('/operator', search(C), '#workspace-research');
    const commercial = at('/operator', search(C), '#workspace-commercial');
    expect(takeMissionHint('workspace-research', research)).toBe(C);
    // Opened again (the section was left and returned to): not applied over a later choice.
    expect(takeMissionHint('workspace-research', research)).toBeNull();
    // Another section for the same mission has its own turn.
    expect(takeMissionHint('workspace-commercial', commercial)).toBe(C);
    expect(takeMissionHint('workspace-commercial', commercial)).toBeNull();
  });
  it('gives a different mission its own turn', () => {
    const first = at('/operator', search(D), '#workspace-research');
    const second = at('/operator', search(A.replace('1', '5')), '#workspace-research');
    expect(takeMissionHint('workspace-research', first)).toBe(D);
    expect(takeMissionHint('workspace-research', second)).toBe(A.replace('1', '5'));
  });
});
