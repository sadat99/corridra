import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearObjectiveReturn,
  delegateDirections,
  delegateNextStep,
  draftFromObjective,
  objectiveReturnKey,
  readObjectiveReturn,
  saveObjectiveReturn,
} from '../../apps/web/lib/delegate-objective';
import { privateRequestStoragePrefix } from '../../apps/web/lib/private-request-storage';
import { missionDraftDetails } from '../../packages/auth/src/customer-mission-drafts';
import {
  draftProblems,
  draftReadiness,
  missionDraftObjectives,
} from '../../packages/domain/src/mission-drafts';

// The delegate's objective is carried, not asked again: the words written in a programme application become a
// guided private request draft the existing rules accept, and the path names one next step. No database is used:
// the draft is saved through the existing draft service, which customer-mission-drafts.test.ts proves.
const real = () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
};
afterEach(() => vi.unstubAllEnvs());
const store = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (n: number) => [...map.keys()][n] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};
const registrationId = '00000000-0000-4000-8000-000000000003',
  draftId = '00000000-0000-4000-8000-000000000004';

describe('a private request draft from the application words', () => {
  const statement = 'We plan to buy two combine harvesters this year and want factory visits.';
  it('real mode: the statement, company and origin are carried and the draft saves as it is', () => {
    real();
    for (const direction of delegateDirections) {
      const details = draftFromObjective({
        programmeName: 'Spring machinery delegation',
        statement,
        displayLabel: 'Rahman Agro Imports',
        direction,
      });
      expect(details.offer).toBe(statement);
      expect(details.companyName).toBe('Rahman Agro Imports');
      expect(details.title).toBe('Spring machinery delegation: my objective');
      expect(details.notes).toBe(
        'Started from the programme "Spring machinery delegation", where I am a registered participant.',
      );
      // The button the person pressed names the objective in the request's own vocabulary for that family.
      expect(missionDraftObjectives[direction]).toContain(details.objective);
      // The existing server rule and the existing client rule both accept it unchanged.
      expect(missionDraftDetails.safeParse(details).success).toBe(true);
      expect(draftProblems(details)).toEqual([]);
      // What is still the person's to give is exactly what nothing here could know.
      const gaps = draftReadiness(details).gaps.join(' | ');
      expect(gaps).not.toMatch(/offer|requirement|objective|company/i);
    }
  });
  it('carries nothing it was not given: no market, dates, outcomes, contact or website are invented', () => {
    real();
    const details = draftFromObjective({
      programmeName: 'Spring machinery delegation',
      statement,
      displayLabel: 'Rahman Agro Imports',
      direction: 'SUPPLIERS_PRODUCTS',
    });
    expect(details).toMatchObject({
      market: '',
      startDate: '',
      endDate: '',
      attendance: 'Not decided',
      outcomes: [],
      website: '',
      contactName: '',
      contactEmail: '',
      requirements: [],
      profileVersion: null,
      sourcingContext: null,
    });
  });
  it('a person who joined by code has no words to carry: the description starts empty and still saves', () => {
    real();
    const details = draftFromObjective({
      programmeName: 'Spring machinery delegation',
      statement: '',
      displayLabel: 'Rahman Agro Imports',
      direction: 'BUYERS_PARTNERS',
    });
    expect(details.offer).toBe('');
    expect(missionDraftDetails.safeParse(details).success).toBe(true);
  });
  it('sample mode keeps the sample rule: sample words are carried, anything else is left for the person', () => {
    const sample = draftFromObjective({
      programmeName: 'Synthetic China machinery delegation',
      statement: 'Synthetic plan to compare two rice transplanters',
      displayLabel: 'Synthetic Rahman Agro',
      direction: 'SUPPLIERS_PRODUCTS',
    });
    expect(sample.offer).toBe('Synthetic plan to compare two rice transplanters');
    expect(sample.title).toBe('Synthetic China machinery delegation: my objective');
    // The origin note does not start with Synthetic, so the sample rule leaves it out instead of bending it.
    expect(sample.notes).toBe('');
    expect(missionDraftDetails.safeParse(sample).success).toBe(true);
    expect(draftProblems(sample)).toEqual([]);
    const refused = draftFromObjective({
      programmeName: 'Synthetic China machinery delegation',
      statement: 'Real looking words',
      displayLabel: 'Rahman Agro',
      direction: 'SUPPLIERS_PRODUCTS',
    });
    expect(refused).toMatchObject({ offer: '', companyName: '' });
    expect(missionDraftDetails.safeParse(refused).success).toBe(true);
  });
  it('control characters and overlong text never reach the draft', () => {
    real();
    const details = draftFromObjective({
      programmeName: 'Spring\u0000 delegation ' + 'x'.repeat(300),
      statement: 'Line one\nline two\u0007 ' + 'y'.repeat(3000),
      displayLabel: 'Rahman\tAgro ' + 'z'.repeat(300),
      direction: 'OTHER',
    });
    expect(JSON.stringify(details)).not.toMatch(/\\u0000|\\n|\\t|\\u0007/);
    expect(details.title.length).toBeLessThanOrEqual(120);
    expect(details.offer.length).toBeLessThanOrEqual(2000);
    expect(details.companyName.length).toBeLessThanOrEqual(160);
    expect(missionDraftDetails.safeParse(details).success).toBe(true);
  });
});

describe('the one next step', () => {
  it('goes request, then share, then results, and claims nothing it could not read', () => {
    expect(delegateNextStep({ privateRequests: 0, sharedObjectives: 0 })).toBe('request');
    expect(delegateNextStep({ privateRequests: 2, sharedObjectives: 0 })).toBe('share');
    expect(delegateNextStep({ privateRequests: 2, sharedObjectives: 1 })).toBe('results');
    // A failed read is "not known": the path falls back to the first step it cannot prove done.
    expect(delegateNextStep({ privateRequests: null, sharedObjectives: null })).toBe('request');
    expect(delegateNextStep({ privateRequests: 1, sharedObjectives: null })).toBe('share');
    // A shared objective stands on a request, so it is trusted even when the request count could not be read.
    expect(delegateNextStep({ privateRequests: null, sharedObjectives: 1 })).toBe('results');
  });
});

describe('the way back after sending', () => {
  it('is kept under the private request prefix, so sign-out clears it, and holds ids and a name only', () => {
    expect(objectiveReturnKey.startsWith(privateRequestStoragePrefix)).toBe(true);
    const s = store();
    saveObjectiveReturn(s, { registrationId, draftId, programmeName: 'Spring delegation' });
    const kept = JSON.parse(s.getItem(objectiveReturnKey)!) as Record<string, unknown>;
    expect(Object.keys(kept).sort()).toEqual(
      ['draftId', 'programmeName', 'registrationId', 'savedAt'].sort(),
    );
    expect(readObjectiveReturn(s)).toEqual({
      registrationId,
      draftId,
      programmeName: 'Spring delegation',
    });
    clearObjectiveReturn(s);
    expect(readObjectiveReturn(s)).toBeNull();
  });
  it('expires after a day and drops anything malformed', () => {
    const s = store();
    saveObjectiveReturn(s, { registrationId, draftId, programmeName: 'Spring delegation' });
    expect(readObjectiveReturn(s, Date.now() + 25 * 3600 * 1000)).toBeNull();
    expect(s.getItem(objectiveReturnKey)).toBeNull();
    for (const bad of [
      '{',
      JSON.stringify({ registrationId: 'x', draftId, programmeName: 'a', savedAt: Date.now() }),
      JSON.stringify({ registrationId, draftId: 'x', programmeName: 'a', savedAt: Date.now() }),
      JSON.stringify({ registrationId, draftId, programmeName: 7, savedAt: Date.now() }),
      JSON.stringify({ registrationId, draftId, programmeName: 'a', savedAt: Date.now() + 1e9 }),
    ]) {
      s.setItem(objectiveReturnKey, bad);
      expect(readObjectiveReturn(s)).toBeNull();
    }
  });
});

describe('the path adds no authority', () => {
  const source = (file: string) => readFileSync(resolve(file), 'utf8');
  const path = source('apps/web/app/account/delegations/delegate-path.tsx');
  it('reads and writes only through routes that already exist, with the signed-in identity headers', () => {
    const routes = [...path.matchAll(/'(\/api\/[a-z-]+)/g)].map((m) => m[1]);
    expect([...new Set(routes)].sort()).toEqual([
      '/api/customer-mission-drafts',
      '/api/customer-programme-objectives',
      '/api/customer-programme-pages',
      '/api/customer-workspaces',
    ]);
    expect(path).toContain('customerHeaders(subject, issuer)');
    // It shares nothing itself: sharing goes through the existing objective tools and their consent.
    expect(path).not.toMatch(/action: 'share'|consented/);
  });
  it('the objective tools never pre-tick consent when opened from the path', () => {
    const editor = source('apps/web/app/account/delegations/programme-objective-editor.tsx');
    const start = editor.slice(
      editor.indexOf('const started = useRef'),
      editor.indexOf('const current = items.find'),
    );
    expect(start).toContain('setSummary(text)');
    expect(start).not.toContain('setConsent');
  });
  it('is shown only while programme pages and shared objectives are both on', () => {
    expect(source('apps/web/app/account/delegations/page.tsx')).toContain(
      'objectivePathEnabled={pagesOn && customerMissionSharesEnabled()}',
    );
    expect(source('apps/web/app/account/delegations/participant-account.tsx')).toContain(
      '{props.objectivePathEnabled && props.missionSharesEnabled && (',
    );
  });
});
