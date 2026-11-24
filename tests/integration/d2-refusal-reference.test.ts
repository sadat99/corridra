import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError, stepUpRequired } from '../../packages/domain/src/index';

// Team desk v4.1, unit D2 (docs/revamp/specs/team-desk-v4-1.md, Phase 1). When /api/workspace/[action]
// refuses, the answer says what to do and carries a short reference, the server logs the code with the
// correlation id for every refusal (403, 409, 503 and 500), and no text written by the database reaches
// the page. The services are counting stand-ins; the route under test is the real one.
const state = vi.hoisted(() => ({
  session: { token: 'staff-token' } as null | { token: string },
  fails: null as null | (() => unknown),
  unavailable: false,
  commands: 0,
}));
const service = () => {
  state.commands += 1;
  if (state.fails) throw state.fails();
  return { ok: true };
};
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () =>
    state.unavailable
      ? null
      : {
          ready: Promise.resolve(),
          config: { APP_ORIGIN: 'https://corridra.example.invalid' },
          provider: { getSession: async () => state.session },
          access: { config: async () => [] },
          missions: { command: async () => service(), queue: async () => service() },
          commercialMissions: { replyPrefill: async () => service() },
        },
}));
vi.mock('../../apps/web/lib/communication-orchestrator', () => ({
  communicationOrchestrator: () => null,
}));
vi.mock('../../apps/web/lib/notify', () => ({ notify: async () => undefined }));
import { staffRefusal, workspaceRefusal } from '../../apps/web/lib/staff-db-error';
import * as route from '../../apps/web/app/api/workspace/[action]/route';

const tenant = '11111111-1111-4111-8111-111111111111';
const origin = 'https://corridra.example.invalid';
const call = (action: string, method: 'GET' | 'POST', query = '') =>
  (method === 'GET' ? route.GET : route.POST)(
    new Request(`${origin}/api/workspace/${action}?tenant=${tenant}${query}`, {
      method,
      headers: method === 'POST' ? { origin, 'Content-Type': 'application/json' } : {},
      body: method === 'POST' ? JSON.stringify({ id: tenant }) : undefined,
    }),
    { params: Promise.resolve({ action }) },
  );
const command = () => call('mission', 'POST');
/** A failure shaped like the ones node-postgres throws: SQLSTATE in `code`, the server's words in `message`. */
const pg = (code: string, message: string) => () => Object.assign(new Error(message), { code });
const rls = pg(
  '42501',
  'new row violates row-level security policy for table "source_record" in schema customer_private',
);
type Body = { error: string; reference?: string; correlationId?: string; code?: string };
const logged = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((line) => JSON.parse(String(line[0])) as Record<string, unknown>);

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  state.session = { token: 'staff-token' };
  state.fails = null;
  state.unavailable = false;
  state.commands = 0;
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('D2 a refused change says what to do and carries a reference', () => {
  const denied = (reference?: string) =>
    `This change was not allowed in this workspace. Check you are in the right workspace, or ask a workspace owner. Quote reference ${reference}.`;
  test('42501 answers 403 with the new words and the reference, and logs the code with the correlation id', async () => {
    state.fails = rls;
    const response = await command();
    expect(response.status).toBe(403);
    const body = (await response.json()) as Body;
    const correlationId = response.headers.get('X-Corridra-Request-ID')!;
    expect(body.correlationId).toBe(correlationId);
    expect(body.reference).toBe(correlationId.slice(0, 8).toUpperCase());
    expect(body.reference).toMatch(/^[0-9A-F]{8}$/);
    expect(body.error).toBe(denied(body.reference));
    // The log line holds the whole correlation id, so the eight characters a person quotes find it.
    expect(logged(errors)).toEqual([
      {
        event: 'foundation_request_refused',
        code: '42501',
        status: 403,
        correlationId,
        reference: body.reference,
      },
    ]);
  });

  test('a refused read gets the same words, which do not assume a role', async () => {
    state.fails = rls;
    const response = await call('missions', 'GET');
    expect(response.status).toBe(403);
    const body = (await response.json()) as Body;
    expect(body.error).toBe(denied(body.reference));
  });

  const changed =
    'The record or policy changed. Check its status and refresh before retrying. If it is refused again, quote reference ';
  const failed =
    'The request could not be completed. Try again. If it fails again, quote reference ';
  test.each([
    ['23514', 409, 'foundation_request_refused', 'That change is not allowed. Quote reference '],
    ['23505', 409, 'foundation_request_refused', 'That already exists. Quote reference '],
    ['23503', 409, 'foundation_request_refused', changed],
    ['P0001', 409, 'foundation_request_refused', changed],
    ['54000', 409, 'foundation_request_refused', changed],
    ['XX000', 500, 'foundation_request_failed', failed],
    [undefined, 500, 'foundation_request_failed', failed],
  ] as const)(
    'database code %s answers %i with a reference and one log line',
    async (code, status, event, words) => {
      state.fails = code
        ? pg(code, `relation "customer_private.mission" violates check constraint "mission_ck"`)
        : () => new TypeError('Cannot read properties of undefined (reading "rows")');
      const response = await command();
      expect(response.status).toBe(status);
      const body = (await response.json()) as Body;
      const correlationId = response.headers.get('X-Corridra-Request-ID')!;
      expect(body.reference).toBe(correlationId.slice(0, 8).toUpperCase());
      expect(body.error).toBe(`${words}${body.reference}.`);
      expect(logged(errors)).toEqual([
        { event, code: code ?? 'UNKNOWN', status, correlationId, reference: body.reference },
      ]);
    },
  );

  test.each(['22007', '22008', '22P02'])(
    'a value the database cannot read (%s) is a 400 as on the other team routes, not logged',
    async (code) => {
      state.fails = pg(code, 'invalid input syntax for type uuid: "x"');
      const response = await command();
      expect(response.status).toBe(400);
      expect(((await response.json()) as Body).error).toBe('Check the values and try again');
      expect(errors).not.toHaveBeenCalled();
    },
  );

  test('a workspace that is not configured answers 503 with what to do and the reference', async () => {
    state.unavailable = true;
    const response = await command();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Body;
    expect(body.error).toBe(
      `Operator workspace is unavailable. Try again later. If it continues, quote reference ${body.reference}.`,
    );
    expect(logged(errors)).toEqual([
      {
        event: 'foundation_request_failed',
        code: 'UNAVAILABLE',
        status: 503,
        correlationId: response.headers.get('X-Corridra-Request-ID'),
        reference: body.reference,
      },
    ]);
  });

  test('a missing reply function answers 503 with a reference and is logged', async () => {
    state.fails = pg('42883', 'function customer_private.reply_prefill(uuid) does not exist');
    const response = await call('reply-quotation-prefill', 'GET', `&reply=${tenant}`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as Body;
    expect(body.error).toBe(
      `This is not available right now. Try again later. If it continues, quote reference ${body.reference}.`,
    );
    expect(logged(errors)).toEqual([
      {
        event: 'foundation_request_failed',
        code: '42883',
        status: 503,
        correlationId: response.headers.get('X-Corridra-Request-ID'),
        reference: body.reference,
      },
    ]);
  });

  test('a refusal written by the product keeps its words and is logged with its status', async () => {
    state.fails = () => new DomainError('Access denied', 403);
    const denied = await command();
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as Body;
    expect(body.error).toBe('Access denied');
    expect(body.reference).toMatch(/^[0-9A-F]{8}$/);
    expect(logged(errors)).toEqual([
      {
        event: 'foundation_request_refused',
        code: 'DOMAIN',
        status: 403,
        correlationId: body.correlationId,
        reference: body.reference,
      },
    ]);
    errors.mockClear();
    state.fails = () => new DomainError('Mission changed; refresh and retry', 409);
    const stale = await command();
    expect(((await stale.json()) as Body).error).toBe('Mission changed; refresh and retry');
    expect(logged(errors).map((line) => [line.event, line.code, line.status])).toEqual([
      ['foundation_request_refused', 'DOMAIN', 409],
    ]);
  });
});

describe('D2 unchanged answers', () => {
  test('a fresh authenticator refusal stays 401 with its code, so the page can ask in place', async () => {
    state.fails = () => stepUpRequired();
    const response = await command();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: 'Verify your authenticator again to continue',
      code: 'STEP_UP_REQUIRED',
    });
    expect(errors).not.toHaveBeenCalled();
  });
  test('an expired session stays 401 "Sign in to continue" and reads nothing', async () => {
    state.session = null;
    const response = await command();
    expect(response.status).toBe(401);
    expect(((await response.json()) as Body).error).toBe('Sign in to continue');
    expect(state.commands).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
  test('bad values stay 400 and an unknown action stays 404, neither logged', async () => {
    const bad = await route.GET(new Request(`${origin}/api/workspace/missions?tenant=not-a-uuid`), {
      params: Promise.resolve({ action: 'missions' }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Body).error).toBe('Check the submitted values');
    const unknown = await call('no-such-action', 'POST');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as Body).error).toBe('Not found');
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('D2 no database text reaches the page', () => {
  const leaks = [
    'new row violates row-level security policy for table "source_record"',
    'permission denied for schema customer_private',
    'duplicate key value violates unique constraint "mission_command_pkey"',
    'insert or update on table "mission_route" violates foreign key constraint "mission_route_fk"',
    'relation "customer_private.real_intake_owner_version" does not exist',
    'function app.fresh_mfa() does not exist',
    'syntax error at or near "SELEC"',
  ];
  const codes = ['42501', '23514', '23503', '23505', 'P0001', '54000', '42883', '42P01', '3F000'];
  const forbidden =
    /row-level security|violates|permission denied|constraint|\brelation\b|schema|customer_private|source_record|mission_route|mission_command|fresh_mfa|syntax|SELEC|\bfunction\b|\btable\b/i;
  test('for every status, on a write and on a reply read', async () => {
    const statuses = new Set<number>();
    for (const code of [...codes, 'XX000'])
      for (const text of leaks)
        for (const send of [
          () => command(),
          () => call('reply-quotation-prefill', 'GET', `&reply=${tenant}`),
        ]) {
          state.fails = pg(code, text);
          const response = await send();
          statuses.add(response.status);
          const raw = await response.text();
          expect(raw).not.toMatch(forbidden);
          expect(raw).not.toContain(text);
        }
    expect([...statuses].sort()).toEqual([403, 409, 500, 503]);
    // The log names the code and the request, never the database's words.
    for (const line of errors.mock.calls) expect(String(line[0])).not.toMatch(forbidden);
  });
});

describe('D2 one table for both team refusal helpers', () => {
  const error = (code: string, message = 'new row violates row-level security policy') =>
    Object.assign(new Error(message), { code });
  test('the same code gives the same status in both', () => {
    for (const code of ['42501', '23514', '23505', '22007', '22008', '22P02'])
      expect(workspaceRefusal(error(code), 'ABCDEF12', { replyPath: false }).status).toBe(
        staffRefusal(error(code))!.status,
      );
  });
  test('staffRefusal answers exactly as before this unit', () => {
    expect(staffRefusal(error('42501'))).toEqual({ status: 403, message: 'Access denied' });
    expect(staffRefusal(error('42501', 'Verify your authenticator again to continue'))).toEqual({
      status: 403,
      message: 'Verify your authenticator again to continue',
    });
    expect(staffRefusal(error('23514', 'At most five open Moves per request'))).toEqual({
      status: 409,
      message: 'At most five open Moves per request',
    });
    expect(staffRefusal(error('23514'))).toEqual({
      status: 409,
      message: 'That change is not allowed',
    });
    expect(staffRefusal(error('23505', 'A short plain line'))).toEqual({
      status: 409,
      message: 'That already exists',
    });
    expect(staffRefusal(error('22P02', 'bad'))).toEqual({
      status: 400,
      message: 'Check the values and try again',
    });
    expect(staffRefusal(error('23503'))).toBeNull();
    expect(staffRefusal(error('P0001'))).toBeNull();
    expect(staffRefusal(new Error('no code'))).toBeNull();
  });
  test('the workspace helper never passes on a message, even a short plain one', () => {
    const refusal = workspaceRefusal(error('42501', 'A short plain line'), 'ABCDEF12', {
      replyPath: false,
    });
    expect(refusal.message).not.toContain('A short plain line');
  });
});

describe('D2 mission forms ask for the code in place (source contract)', () => {
  const missions = readFileSync('apps/web/app/operator/missions.tsx', 'utf8');
  const page = readFileSync('apps/web/app/operator/[section]/[missionId]/mission-page.tsx', 'utf8');
  test('mission commands go through the code check built on withStepUp', () => {
    expect(missions).toMatch(/import \{[^}]*\bwithStepUp\b[^}]*\} from '..\/..\/lib\/ux\/step-up'/);
    expect(missions).toMatch(/export async function withCodeCheck[\s\S]{0,900}withStepUp\(/);
    expect(missions).toMatch(/export async function missionRequest[\s\S]{0,200}withCodeCheck\(/);
    expect(page).toContain('missionRequest(tenant, action, body)');
  });
  test('the purpose the website sends is untouched by this unit (unit D1 owns the cause)', () => {
    const source = readFileSync('apps/web/app/api/workspace/[action]/route.ts', 'utf8');
    expect(source).toContain(
      "const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };",
    );
  });
});
