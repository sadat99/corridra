import { describe, expect, test } from 'vitest';
import {
  standardFieldByKey,
  type ContentDocument,
} from '../../packages/domain/src/route-pack-standard';
import {
  commandFingerprint,
  factsOutcome,
  nextCommand,
  outcomeWords,
  replaceKeysWithLabels,
  type FactsOutcome,
} from '../../apps/web/lib/route-pack-editor-write';

// ADR-093 Phase 3, PR 2b: what the answer of route-pack-facts means for the editor, in the words of the spec, and the one command
// id of a save. Pure: no network, no page.
describe('factsOutcome: every status and code', () => {
  const cases: Array<[number, string | undefined, FactsOutcome]> = [
    [201, undefined, 'saved'],
    [200, undefined, 'saved'],
    [409, 'ROUTE_PACK_CONTENT_CHANGED', 'conflict'],
    [409, 'ROUTE_PACK_COMMAND_REUSED', 'commandReused'],
    [409, 'ROUTE_PACK_CUSTOM_KEY_CONFLICT', 'customKeyConflict'],
    [409, 'SOMETHING_ELSE', 'offline'],
    [400, 'ROUTE_PACK_INVALID', 'invalid'],
    [400, undefined, 'invalid'],
    [413, undefined, 'tooLarge'],
    [401, 'STEP_UP_REQUIRED', 'stepUp'],
    [401, undefined, 'signedOut'],
    [403, undefined, 'denied'],
    [404, undefined, 'notFound'],
    [500, undefined, 'offline'],
    [502, undefined, 'offline'],
    [429, undefined, 'offline'],
  ];
  for (const [status, code, outcome] of cases)
    test(`${status} ${code ?? ''} is ${outcome}`, () => {
      expect(factsOutcome(status, code)).toBe(outcome);
    });
});

describe('outcomeWords', () => {
  const label = (key: string) => standardFieldByKey.get(key)?.label ?? null;
  const key = [...standardFieldByKey.keys()].find((k) => k.startsWith('events.'))!;
  test('the words of each refusal', () => {
    expect(outcomeWords('offline', null)).toBe(
      'Not saved. Your changes are still here. Try again.',
    );
    expect(outcomeWords('notFound', null)).toBe(
      'Not saved. Your changes are still here. Try again.',
    );
    expect(outcomeWords('tooLarge', null)).toBe(
      'This route content is too large to save. Shorten notes or long lists.',
    );
    expect(outcomeWords('signedOut', null)).toBe(
      'Your session has ended. Sign in again, then open this route and save again.',
    );
    expect(outcomeWords('denied', null)).toBe(
      'You can no longer save route facts. Only the owner can.',
    );
    expect(outcomeWords('commandReused', 'Command key reused with different values')).toBe(
      'This save could not be repeated because its details changed. Check the summary, then save again.',
    );
    expect(outcomeWords('stepUp', null)).toBe(
      'Confirm your authenticator code to finish this. Your changes are kept.',
    );
  });

  test('a 400 names the field by its label, not its key, and says nothing was saved', () => {
    const words = outcomeWords(
      'invalid',
      `${key} needs the date it was observed, written YYYY-MM-DD and not in the future.`,
      label,
    );
    expect(words).toBe(
      `The save was refused: ${label(key)} needs the date it was observed, written YYYY-MM-DD and not in the future. Nothing was saved. Your changes are still here.`,
    );
    expect(words).not.toContain(key);
    // The server's own full stop is not doubled.
    expect(outcomeWords('invalid', 'Remove the email address.', label)).toBe(
      'The save was refused: Remove the email address. Nothing was saved. Your changes are still here.',
    );
    expect(outcomeWords('invalid', null)).toBe(
      'The save was refused. Nothing was saved. Your changes are still here.',
    );
  });

  test('a custom key conflict keeps the server words and says what to do', () => {
    expect(
      outcomeWords(
        'customKeyConflict',
        'custom.x already means something else on another route: use the same section, type and allowed values, or a new key.',
        (k) => (k === 'custom.x' ? 'Dock rules' : null),
      ),
    ).toBe(
      'Dock rules already means something else on another route: use the same section, type and allowed values, or a new key. Undo Change on that field, then add it again with another name.',
    );
  });

  test('replaceKeysWithLabels leaves an unknown key and ordinary words alone', () => {
    expect(
      replaceKeysWithLabels('Check e.g. this. custom.mine and nothing.else', (k) =>
        k === 'custom.mine' ? 'Mine' : null,
      ),
    ).toBe('Check e.g. this. Mine and nothing.else');
  });

  test('no em dash and no internal word on any line', () => {
    const all: Array<Exclude<FactsOutcome, 'saved' | 'conflict'>> = [
      'invalid',
      'customKeyConflict',
      'commandReused',
      'tooLarge',
      'signedOut',
      'stepUp',
      'denied',
      'notFound',
      'offline',
    ];
    for (const outcome of all) {
      const text = outcomeWords(outcome, 'Sample words', label);
      expect(text).not.toContain(String.fromCharCode(0x2014));
      expect(text).not.toMatch(/ROUTE_PACK|stage|version conflict|rebase/i);
    }
  });
});

describe('nextCommand: one id for one save', () => {
  const document = { standardVersion: 1, sectionMarks: [], facts: [] } as ContentDocument;
  const body = { routeId: 'r1', version: 6, document, reason: 'Added the holidays' };
  let n = 0;
  const makeId = () => `id-${++n}`;
  test('the same route, version, document and reason keep the id (a retry is the same command)', () => {
    const first = nextCommand(null, body, makeId);
    expect(first.id).toBe('id-1');
    expect(nextCommand(first, { ...body }, makeId)).toBe(first);
    expect(nextCommand(first, { ...body, document: { ...document } }, makeId).id).toBe('id-1');
  });
  test('a change of the reason, the version, the document or the route makes a new id', () => {
    const first = nextCommand(null, body, makeId);
    const reason = nextCommand(first, { ...body, reason: 'Another reason' }, makeId);
    expect(reason.id).not.toBe(first.id);
    expect(nextCommand(first, { ...body, version: 7 }, makeId).id).not.toBe(first.id);
    expect(nextCommand(first, { ...body, routeId: 'r2' }, makeId).id).not.toBe(first.id);
    const changed = {
      ...document,
      facts: [{ key: 'a.b', state: 'NOT_APPLICABLE', note: 'x' }],
    } as ContentDocument;
    expect(nextCommand(first, { ...body, document: changed }, makeId).id).not.toBe(first.id);
    // Going back to the first body after a change is a new command again: the earlier id belongs to the earlier body only.
    expect(nextCommand(reason, body, makeId).id).not.toBe(first.id);
  });
  test('the fingerprint is the four things the server compares, never the id', () => {
    expect(JSON.parse(commandFingerprint(body))).toEqual(['r1', 6, document, 'Added the holidays']);
  });
});
