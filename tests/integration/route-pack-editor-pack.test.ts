import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { routePackWords, standardFieldsV1 } from '../../packages/domain/src/route-pack-standard';
import { routePackChangeRequest } from '../../packages/missions/src/route-pack-form';
import {
  guidedListKeys,
  keyIssue,
  keyListKeys,
  listOptions,
  manualOf,
  nextPackCommand,
  notPublishedWords,
  packFingerprint,
  packKeyPattern,
  packOutcome,
  packRowAction,
  previewBody,
  previewReason,
  publishBody,
  readPreview,
  readPublished,
  sameAsPack,
  type PackEdit,
  type PackOutcome,
} from '../../apps/web/lib/route-pack-editor-pack';
import { keyIssueWords, packWords } from '../../apps/web/lib/route-pack-editor-pack-words';

// ADR-093 Phase 3, PR 3b: the page's side of route-pack-publish. Pure: no network, no page. Every body the page builds is
// parsed by the server's own schema, so the two cannot drift apart.
const routeId = '11111111-1111-4111-8111-111111111111';
let n = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const edits: PackEdit[] = [
  ...guidedListKeys.map((key) => ({
    kind: 'list' as const,
    key,
    value:
      key === 'missionTypes'
        ? ['supplier_discovery']
        : key === 'languages'
          ? ['en', 'bn']
          : key === 'currencies'
            ? ['USD']
            : ['Asia/Dhaka'],
  })),
  ...keyListKeys.map((key) => ({
    kind: 'list' as const,
    key,
    value: ['dhaka', 'chittagong.port'],
  })),
  ...keyListKeys.map((key) => ({ kind: 'list' as const, key, value: [] })),
  { kind: 'channel', manual: true },
  { kind: 'channel', manual: false },
  { kind: 'removeSourcing' },
  ...(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED'] as const).map((status) => ({
    kind: 'status' as const,
    status,
  })),
];

describe('the bodies parse with the server schema', () => {
  test.each(edits.map((edit) => [JSON.stringify(edit), edit] as const))('%s', (_, edit) => {
    for (const body of [
      previewBody(edit, routeId, 2, makeId),
      publishBody(edit, routeId, 2, '  Added Chinese  ', { id: makeId(), fingerprint: 'x' }),
    ])
      expect(() => routePackChangeRequest.parse(body)).not.toThrow();
  });
  test('a list sets only its own key, [] is kept, and nothing else is sent', () => {
    const body = previewBody({ kind: 'list', key: 'localities', value: [] }, routeId, 3, makeId);
    expect(body.change).toEqual({
      kind: 'settings',
      commandId: expect.any(String),
      routeId,
      version: 4,
      reason: previewReason,
      localities: [],
    });
  });
  test('the channel is the boolean manualChannel, never a channel value', () => {
    const body = JSON.stringify(previewBody({ kind: 'channel', manual: true }, routeId, 1, makeId));
    expect(body).toContain('"manualChannel":true');
    expect(body).not.toMatch(/channels|SYNTHETIC|MANUAL"/);
  });
  test('remove sourcing sends removeSourcingProfile and no sourcing block', () => {
    const { change } = previewBody({ kind: 'removeSourcing' }, routeId, 1, makeId);
    expect(change).toMatchObject({ kind: 'settings', removeSourcingProfile: true });
    expect('sourcing' in change).toBe(false);
  });
  test('a route with no pack writes version 1; a pack read at 5 writes 6', () => {
    const edit: PackEdit = { kind: 'list', key: 'missionTypes', value: ['supplier_discovery'] };
    expect(previewBody(edit, routeId, null, makeId).change.version).toBe(1);
    expect(previewBody(edit, routeId, 5, makeId).change.version).toBe(6);
  });
  test('the server refuses no mission types, so the page never builds an empty mission list', () => {
    const body = previewBody({ kind: 'list', key: 'missionTypes', value: [] }, routeId, 1, makeId);
    expect(() => routePackChangeRequest.parse(body)).toThrow();
    expect(
      sameAsPack({ kind: 'list', key: 'missionTypes', value: [] }, { missionTypes: [] }, 'TESTING'),
    ).toBe(true);
  });
});

describe('command ids', () => {
  const edit: PackEdit = { kind: 'status', status: 'ACTIVE' };
  test('every preview has a fresh id and carries only the internal preview reason', () => {
    const a = previewBody(edit, routeId, 2, makeId);
    const b = previewBody(edit, routeId, 2, makeId);
    expect(a.change.commandId).not.toBe(b.change.commandId);
    expect(a.change.reason).toBe(previewReason);
    expect(a.mode).toBe('preview');
  });
  test('the preview reason is never the reason of a publish or a retry', () => {
    const first = nextPackCommand(null, packFingerprint(edit, routeId, 2, 'Go live now'), makeId);
    const body = publishBody(edit, routeId, 2, 'Go live now', first);
    const again = publishBody(edit, routeId, 2, 'Go live now', first);
    for (const sent of [body, again]) {
      expect(sent.mode).toBe('publish');
      expect(sent.change.reason).toBe('Go live now');
      expect(JSON.stringify(sent)).not.toContain(previewReason);
    }
  });
  test('the same change and reason keep the publish id (Try Publishing Again)', () => {
    const first = nextPackCommand(null, packFingerprint(edit, routeId, 2, 'Go live'), makeId);
    const retry = nextPackCommand(first, packFingerprint(edit, routeId, 2, ' Go live '), makeId);
    expect(retry.id).toBe(first.id);
  });
  test.each([
    ['the reason', packFingerprint(edit, routeId, 2, 'Go live today')],
    ['the status', packFingerprint({ kind: 'status', status: 'PAUSED' }, routeId, 2, 'Go live')],
    ['the version', packFingerprint(edit, routeId, 3, 'Go live')],
    [
      'the value',
      packFingerprint({ kind: 'list', key: 'clusters', value: ['a'] }, routeId, 2, 'Go live'),
    ],
  ])('a change of %s makes a new id', (_, fingerprint) => {
    const first = nextPackCommand(null, packFingerprint(edit, routeId, 2, 'Go live'), makeId);
    expect(nextPackCommand(first, fingerprint, makeId).id).not.toBe(first.id);
  });
  test('the preview id is never the publish id', () => {
    const preview = previewBody(edit, routeId, 2, makeId);
    const command = nextPackCommand(null, packFingerprint(edit, routeId, 2, 'Go live'), makeId);
    expect(publishBody(edit, routeId, 2, 'Go live', command).change.commandId).not.toBe(
      preview.change.commandId,
    );
  });
});

describe('packOutcome: every status and code', () => {
  const cases: Array<[string, number, string | null, string | null, boolean, PackOutcome]> = [
    ['preview', 200, null, null, true, 'previewed'],
    ['publish', 201, null, null, true, 'published'],
    ['publish', 200, null, null, true, 'published'],
    ['preview', 409, 'ROUTE_PACK_PACK_CHANGED', null, true, 'stale'],
    ['publish', 409, 'ROUTE_PACK_PACK_CHANGED', null, true, 'stale'],
    ['preview', 409, 'ROUTE_PACK_NO_CHANGE', 'x', true, 'noChange'],
    ['publish', 409, 'ROUTE_PACK_COMMAND_REUSED', null, true, 'commandReused'],
    ['publish', 409, 'ROUTE_PACK_LOCKED_CORE_EMPTIED', 'x', true, 'blocked'],
    ['publish', 409, 'SOMETHING_ELSE', 'x', true, 'invalid'],
    ['preview', 400, 'ROUTE_PACK_INVALID', 'x', true, 'invalid'],
    ['publish', 413, null, null, true, 'tooLarge'],
    ['preview', 401, 'STEP_UP_REQUIRED', null, true, 'stepUp'],
    ['publish', 401, 'STEP_UP_REQUIRED', null, true, 'stepUp'],
    ['preview', 401, null, null, true, 'signedOut'],
    ['publish', 403, null, null, true, 'denied'],
    ['preview', 404, null, null, true, 'notFound'],
    ['publish', 500, null, null, true, 'offline'],
    ['publish', 0, null, null, true, 'offline'],
    [
      'publish',
      409,
      'ROUTE_PACK_POLICY_EXPIRED',
      `Expired. ${notPublishedWords}`,
      true,
      'savedNotPublished',
    ],
    ['publish', 403, null, `Refused. ${notPublishedWords}`, false, 'proposed'],
    // A preview never says a proposal was saved.
    ['preview', 409, null, `Refused. ${notPublishedWords}`, true, 'invalid'],
  ];
  test.each(cases)('%s %i %s', (mode, status, code, error, onePerson, outcome) => {
    expect(packOutcome(mode as 'preview' | 'publish', status, code, error, onePerson)).toBe(
      outcome,
    );
  });
  test('the saved-not-published words are the domain words', () => {
    expect(notPublishedWords).toBe(routePackWords.notPublished);
  });
});

describe('reading answers', () => {
  test('a preview with ids or reasons still draws only what the page needs', () => {
    const preview = readPreview({
      kind: 'settings',
      statusFrom: 'TESTING',
      statusTo: 'TESTING',
      changedKeys: ['languages'],
      baseVersion: 2,
      newVersion: 3,
      duplicate: false,
      historicalAssignmentsPreserved: 4,
      warnings: [{ code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE', keys: ['pack.languages'] }, 'junk'],
      blocked: null,
      onePersonPublication: true,
      removedPolicies: [],
    });
    expect(preview).toMatchObject({ newVersion: 3, historicalAssignmentsPreserved: 4 });
    expect(preview?.warnings).toHaveLength(1);
  });
  test('an answer without a version is never claimed', () => {
    expect(readPreview({ kind: 'settings' })).toBeNull();
    expect(readPublished({ duplicate: false })).toBeNull();
    expect(readPublished({ version: 3, duplicate: true })).toMatchObject({
      version: 3,
      duplicate: true,
    });
  });
});

describe('key lists', () => {
  test('the key shape is the server keyList shape', () => {
    const source = readFileSync('packages/missions/src/route-pack-form.ts', 'utf8');
    expect(source).toContain(`z.string().regex(${packKeyPattern.toString()})).max(50)`);
  });
  test.each([
    ['', [], 'empty'],
    ['Dhaka', [], 'characters'],
    ['dhaka port', [], 'characters'],
    ['1dhaka', [], 'start'],
    ['_dhaka', [], 'start'],
    ['a'.repeat(81), [], 'tooLong'],
    ['dhaka', ['dhaka'], 'repeated'],
    ['dhaka', Array.from({ length: 50 }, (_, i) => `k${i}`), 'full'],
  ])('%s is refused (%s)', (typed, list, kind) => {
    expect(keyIssue(typed, list as string[])?.kind).toBe(kind);
  });
  test.each(['dhaka', 'chittagong.port', 'a-b_c.d', 'a'.repeat(80)])('%s is taken', (typed) => {
    expect(keyIssue(typed, [])).toBeNull();
  });
  test('every issue has words', () => {
    for (const kind of ['empty', 'characters', 'start', 'full'] as const)
      expect(keyIssueWords({ kind })).toMatch(/\.$/);
    expect(keyIssueWords({ kind: 'tooLong', length: 83 })).toContain('83');
  });
});

describe('the row actions and the lists', () => {
  const byKey = new Map(standardFieldsV1.map((field) => [field.key, field]));
  test('the owner can change every one of the twelve pack settings', () => {
    const locked = standardFieldsV1.filter((field) => field.configurationKey);
    expect(locked).toHaveLength(12);
    for (const field of locked)
      expect(
        packRowAction(
          { key: field.key, part: 'Locked', state: 'FILLED' },
          'owner',
          field.configurationKey,
        ),
      ).toEqual({ kind: 'change', key: field.configurationKey });
  });
  test('remove sourcing is offered only on a filled sourcing profile, to the owner', () => {
    const row = {
      key: 'sourcing.profile',
      part: byKey.get('sourcing.profile')!.part,
      state: 'FILLED',
    };
    expect(packRowAction(row, 'owner', undefined)).toEqual({ kind: 'removeSourcing' });
    expect(packRowAction({ ...row, state: 'PENDING' }, 'owner', undefined)).toBeNull();
    expect(packRowAction(row, 'admin', undefined)).toBeNull();
  });
  test('an admin and a viewer get no pack action', () => {
    for (const role of ['admin', 'viewer'])
      expect(
        packRowAction(
          { key: 'pack.languages', part: 'Locked', state: 'FILLED' },
          role,
          'languages',
        ),
      ).toBeNull();
  });
  test('a value the pack holds that the choices lack is still offered', () => {
    expect(listOptions([['en', 'English']], ['en', 'ja'])).toEqual([
      ['en', 'English'],
      ['ja', 'ja'],
    ]);
  });
  test('sameAsPack ignores order and sees the channel', () => {
    const configuration = { languages: ['en', 'bn'], channels: ['MANUAL'] };
    expect(
      sameAsPack({ kind: 'list', key: 'languages', value: ['bn', 'en'] }, configuration, 'ACTIVE'),
    ).toBe(true);
    expect(
      sameAsPack({ kind: 'list', key: 'languages', value: ['en'] }, configuration, 'ACTIVE'),
    ).toBe(false);
    expect(sameAsPack({ kind: 'channel', manual: true }, configuration, 'ACTIVE')).toBe(true);
    expect(sameAsPack({ kind: 'status', status: 'ACTIVE' }, configuration, 'ACTIVE')).toBe(true);
    expect(manualOf(['SYNTHETIC'])).toBe(false);
  });
});

describe('words', () => {
  test('no em dash and no reason placeholder shown as a reason', () => {
    const all = JSON.stringify(packWords);
    expect(all).not.toContain(String.fromCharCode(0x2014));
    expect(all).not.toContain(previewReason);
  });
});
