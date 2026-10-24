import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  maxMoveObject,
  maxOpenMoves,
  moveCommand,
  moveHolders,
  moveInput,
  moveObjectProblem,
  moveVerbs,
} from '../../packages/domain/src/moves';
import { buildMoveModel, type MoveInput } from '../../apps/web/lib/move-cards';

// Move records, the parts that need no database (the database has its own suite): the shape of a Move,
// how Moves reach Your Move, and every switch-off path.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the shape of a Move', () => {
  it('uses a fixed list of verbs and three holders, at most five open', () => {
    expect(moveVerbs).toEqual(['Read', 'Answer', 'Add', 'Confirm', 'Choose', 'Send']);
    expect(moveHolders).toEqual(['customer', 'team', 'third']);
    expect(maxOpenMoves).toBe(5);
    expect(maxMoveObject).toBe(80);
  });

  it.each([
    'your import licence number',
    'your visit on week 3',
    'passport number for 2 people',
    'the delivery date',
    'কারখানা পরিদর্শনের তারিখ',
  ])('accepts plain words: %s', (object) => {
    expect(moveObjectProblem(object)).toBeNull();
    expect(moveInput.safeParse({ verb: 'Add', object, holder: 'customer' }).success).toBe(true);
  });

  it.each([
    ['https://example.com/pay', 'links'],
    ['www.example.com', 'links'],
    ['write to buyer@example.com', 'addresses'],
    ['read example.com now', 'links'],
    ['a <b>tag</b>', 'markup'],
    ['pay USD 500', 'amounts'],
    ['send 12.50 each', 'amounts'],
    ['confirm the 1,200 total', 'amounts'],
    ['send $300', 'amounts'],
    ['accept 5k deposit', 'amounts'],
    ['line one\nline two', 'markup'],
  ])('refuses %s (%s)', (object) => {
    expect(moveObjectProblem(object)).not.toBeNull();
    expect(moveInput.safeParse({ verb: 'Add', object, holder: 'customer' }).success).toBe(false);
  });

  it('refuses words that are too short or too long, an unknown verb, an unknown holder and extra keys', () => {
    expect(moveInput.safeParse({ verb: 'Add', object: 'ab', holder: 'team' }).success).toBe(false);
    expect(
      moveInput.safeParse({ verb: 'Add', object: 'x'.repeat(81), holder: 'team' }).success,
    ).toBe(false);
    expect(
      moveInput.safeParse({ verb: 'Pay', object: 'the deposit', holder: 'team' }).success,
    ).toBe(false);
    expect(moveInput.safeParse({ verb: 'Add', object: 'a thing', holder: 'staff' }).success).toBe(
      false,
    );
    expect(
      moveInput.safeParse({ verb: 'Add', object: 'a thing', holder: 'team', note: 'x' }).success,
    ).toBe(false);
  });

  it('takes a real date as year-month-day or none', () => {
    expect(moveInput.parse({ verb: 'Add', object: 'a thing', holder: 'team' }).dueOn).toBeNull();
    expect(
      moveInput.safeParse({ verb: 'Add', object: 'a thing', holder: 'team', dueOn: 'next week' })
        .success,
    ).toBe(false);
  });

  it('a set needs one to five Moves, and every command needs ids', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const move = { verb: 'Add', object: 'a thing', holder: 'customer' };
    expect(
      moveCommand.safeParse({ action: 'set', commandId: id, missionId: id, moves: [] }).success,
    ).toBe(false);
    expect(
      moveCommand.safeParse({
        action: 'set',
        commandId: id,
        missionId: id,
        moves: Array(6).fill(move),
      }).success,
    ).toBe(false);
    expect(
      moveCommand.safeParse({
        action: 'set',
        commandId: id,
        missionId: id,
        moves: Array(5).fill(move),
      }).success,
    ).toBe(true);
    expect(
      moveCommand.safeParse({ action: 'clear', commandId: 'nope', missionId: id }).success,
    ).toBe(false);
  });
});

describe('Moves on Your Move', () => {
  const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'A', role: 'owner' as const };
  const base: MoveInput = {
    workspaces: [owner],
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [
      {
        id: 'r1',
        workspaceId: owner.id,
        createdAt: '2026-10-02T00:00:00Z',
        progress: { status: 'MEETINGS', receivedAt: '2026-10-02T09:00:00Z', replies: [] },
      },
    ],
  };

  it('shows a Move the person holds as a card with the words as written and a real date', () => {
    const model = buildMoveModel({
      ...base,
      moves: [
        {
          requestId: 'r1',
          moves: [
            {
              id: 'm1',
              verb: 'Add',
              object: 'your import licence number',
              holder: 'customer',
              dueOn: '2026-11-05',
            },
          ],
        },
      ],
    });
    expect(model.cards).toHaveLength(1);
    expect(model.cards[0]).toMatchObject({
      kind: 'move',
      verb: 'Add',
      holder: 'you',
      object: 'your import licence number',
      dueOn: '2026-11-05',
      href: '/account/requests/r1',
    });
  });

  it('folds a Move held by the team or a supplier or buyer under waiting, with no action', () => {
    const model = buildMoveModel({
      ...base,
      moves: [
        {
          requestId: 'r1',
          moves: [
            { id: 'm1', verb: 'Confirm', object: 'the visit dates', holder: 'team', dueOn: null },
            { id: 'm2', verb: 'Send', object: 'the quotation', holder: 'third', dueOn: null },
          ],
        },
      ],
    });
    expect(model.cards).toEqual([]);
    const rows = model.waiting.filter((w) => w.kind === 'move');
    expect(rows.map((r) => [r.holder, r.title])).toEqual([
      ['team', 'Confirm the visit dates'],
      ['third', 'Send the quotation'],
    ]);
  });

  it('puts the team-set Moves first, and opens the Room when the Road is on', () => {
    const model = buildMoveModel(
      {
        ...base,
        drafts: [
          { id: 'd1', workspaceId: owner.id, title: 'x', updatedAt: '2026-10-01T00:00:00Z' },
        ],
        moves: [
          {
            requestId: 'r1',
            moves: [
              { id: 'm1', verb: 'Read', object: 'the report', holder: 'customer', dueOn: null },
            ],
          },
        ],
      },
      { rooms: true },
    );
    expect(model.cards.map((c) => c.kind)).toEqual(['move', 'draft']);
    expect(model.cards[0].href).toBe('/account/rooms/r1');
  });

  it('with no Move records, Your Move is exactly what it was', () => {
    expect(buildMoveModel(base)).toEqual(buildMoveModel({ ...base, moves: [] }));
    expect(buildMoveModel(base).cards).toEqual([]);
  });
});

describe('the switches and the paths', () => {
  it('both routes answer 503 unless the Move records switch and the request module are on', () => {
    for (const path of [
      'apps/web/app/api/move/mine/route.ts',
      'apps/web/app/api/move/staff/route.ts',
    ]) {
      const source = read(path);
      expect(source, path).toContain('customerMovesEnabled()');
      expect(source, path).toContain('503');
    }
  });
  it('the team route checks the origin, the session and the tenant like the rest of the team API', () => {
    const source = read('apps/web/app/api/move/staff/route.ts');
    expect(source).toContain('Request origin is not allowed');
    expect(source).toContain('getSession(request.headers)');
    expect(source).toContain("z.uuid().parse(url.searchParams.get('tenant'))");
  });
  it('the customer route has no write method', () => {
    const source = read('apps/web/app/api/move/mine/route.ts');
    expect(source).toContain('export async function GET');
    expect(source).not.toMatch(/export (async function|const) (POST|PUT|PATCH|DELETE)/);
  });
  it('the panel is mounted only where the flag is on, and only for a person who can manage', () => {
    const missions = read('apps/web/app/operator/missions.tsx');
    expect(missions).toContain('{manage && moveRecords && <MissionMoves');
    expect(read('apps/web/app/operator/page.tsx')).toContain(
      'moveRecords={customerMovesEnabled()}',
    );
  });
  it('the install job and the workflow carry the new action with a reason for enable and pause', () => {
    const script = read('scripts/install-customer-modules.ts');
    expect(script).toContain('MOVE_RECORDS_ACTION');
    expect(script).toContain('Move record changes require INSTALL_APPLY=yes');
    expect(script).toContain('customer_move_migrations');
    const workflow = read('.github/workflows/install-customer-modules.yml');
    expect(workflow).toContain('move_records_action');
    expect(workflow).toContain('move_records_reason');
  });
  it('the migration is additive: it creates objects and never replaces or drops one', () => {
    const sql = read('packages/db/customer-move-migrations/0001_move_records.sql');
    expect(sql).not.toMatch(/CREATE OR REPLACE/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bALTER TABLE (?!app\.%I|customer_private\.move_control)/);
    expect(sql).toContain('customer_private.move_open()');
  });
});
