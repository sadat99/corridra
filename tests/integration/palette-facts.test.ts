import { describe, expect, test } from 'vitest';
import {
  factFor,
  foundHitLimit,
  parseFound,
  sourceChip,
  stageBadge,
} from '../../apps/web/lib/ux/palette-facts';

// What the palette shows beside a hit (docs/revamp/specs/navigation-v1/command-palette-search.md, section 4 and 5).
const id = '0b5a0000-0000-4000-8000-000000000001';

describe('P4 the stage badge follows the Road mapping', () => {
  test.each([
    ['DRAFT', 'Step 1, Define', 1],
    ['QUALIFICATION', 'Step 1, Define', 1],
    ['ACTIVE', 'Step 2, Find', 2],
    ['TARGETING', 'Step 2, Find', 2],
    ['OUTREACH', 'Step 2, Find', 2],
    ['MEETINGS', 'Step 4, Visit', 4],
    ['FOLLOW_UP', 'Step 6, Follow through', 6],
    ['COMMERCIAL_PIPELINE', 'Step 6, Follow through', 6],
    ['CLOSED', 'Step 6, Follow through', 6],
  ])('%s reads "%s"', (status, text, step) => {
    const badge = stageBadge(status);
    expect(badge).toMatchObject({ text, step, tone: 'neutral' });
  });
  test('the staff stage goes to the detail line', () => {
    expect(stageBadge('TARGETING').stage).toBe('Finding companies');
    expect(stageBadge('DRAFT').stage).toBe('Received, waiting for review');
  });
  test('paused and cancelled have a word and no step', () => {
    expect(stageBadge('ON_HOLD')).toEqual({ text: 'Paused', tone: 'caution' });
    expect(stageBadge('CANCELLED')).toEqual({ text: 'Cancelled', tone: 'critical' });
  });
  test('an unknown status shows its plain words and never a step number', () => {
    const badge = stageBadge('WAITING_ON_CUSTOMER');
    expect(badge).toEqual({ text: 'Waiting on customer', tone: 'neutral' });
    expect(badge.step).toBeUndefined();
    expect(badge.text).not.toMatch(/Step \d/);
  });
  test('steps 3 and 5 are never drawn', () => {
    const texts = [
      'DRAFT',
      'QUALIFICATION',
      'ACTIVE',
      'TARGETING',
      'OUTREACH',
      'MEETINGS',
      'FOLLOW_UP',
      'COMMERCIAL_PIPELINE',
      'CLOSED',
      'ON_HOLD',
      'CANCELLED',
    ].map((status) => stageBadge(status).text);
    expect(texts.some((text) => /Step [35]/.test(text))).toBe(false);
  });
});

describe('P5 the company chip exists only where the service reported the flag', () => {
  test('a source-reported identity is a neutral "Source on record", never verified', () => {
    expect(sourceChip('SOURCE_REPORTED')).toEqual({
      text: 'Source on record',
      tone: 'neutral',
      icon: 'document',
    });
  });
  test('an expired source says so with a word and a caution tone', () => {
    expect(sourceChip('EXPIRED')).toEqual({
      text: 'Source expired',
      tone: 'caution',
      icon: 'clock',
    });
  });
  test('no flag, no chip', () => {
    expect(sourceChip(undefined)).toBeNull();
  });
  test('no chip text says verified or evidence available', () => {
    for (const chip of [sourceChip('SOURCE_REPORTED'), sourceChip('EXPIRED')])
      expect(chip!.text).not.toMatch(/verified|evidence/i);
  });
});

describe('the search answer is checked on the client', () => {
  test('an old four-key answer has no facts and shows label and detail only', () => {
    const found = parseFound({
      missions: [{ id, label: 'Invented Towels Ltd', detail: 'Source suppliers · China' }],
      companies: [],
      denied: [],
      partial: [],
    });
    expect(found).toEqual({
      missions: [{ id, label: 'Invented Towels Ltd', detail: 'Source suppliers · China' }],
      companies: [],
      denied: [],
      partial: [],
      facts: {},
    });
    expect(factFor(found, 'mission:' + id)).toBeUndefined();
  });
  test('facts are read by prefixed key and only in the allowed shape', () => {
    const found = parseFound({
      missions: [{ id, label: 'A', detail: '' }],
      companies: [],
      denied: [],
      partial: [],
      facts: {
        ['mission:' + id]: { status: 'TARGETING', close: true, extra: 'x' },
        ['company:' + id]: { source: 'EXPIRED' },
        'mission:not-a-uuid': { status: 'DRAFT' },
        ['mission:0b5a0000-0000-4000-8000-000000000002']: { status: 'draft lower' },
        ['company:0b5a0000-0000-4000-8000-000000000003']: { source: 'VERIFIED' },
      },
    })!;
    expect(Object.keys(found.facts).sort()).toEqual(['company:' + id, 'mission:' + id]);
    expect(factFor(found, 'mission:' + id)).toEqual({ status: 'TARGETING', close: true });
    expect(factFor(found, 'company:' + id)).toEqual({ source: 'EXPIRED' });
  });
  test('hits per scope and the length of text are bounded; scope names are limited to the two scopes', () => {
    const many = Array.from({ length: 30 }, (_, n) => ({ id: `id-${n}`, label: 'x', detail: '' }));
    const found = parseFound({
      missions: [...many, { id: 'long', label: 'y'.repeat(201), detail: '' }],
      companies: many,
      denied: ['missions', 'people', 3],
      partial: ['companies', 'other'],
    })!;
    expect(found.missions).toHaveLength(foundHitLimit);
    expect(found.companies).toHaveLength(foundHitLimit);
    expect(found.denied).toEqual(['missions']);
    expect(found.partial).toEqual(['companies']);
  });
  test('something that is not an answer is not parsed', () => {
    expect(parseFound(null)).toBeNull();
    expect(parseFound('x')).toBeNull();
    expect(parseFound({ missions: 'no', companies: [] })).toBeNull();
    expect(parseFound({ error: 'Access denied' })).toBeNull();
  });
});
