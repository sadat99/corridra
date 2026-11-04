import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import { describeSwitches, switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames } from '../../apps/web/lib/ux-switches';
import {
  cardToken,
  cardTokenDigest,
  customerDecisionCardsEnabled,
  mapDecisionCardError,
} from '../../packages/auth/src/customer-decision-cards';

// The decision card switch (ADR-076 item 4, E3b step 3): a real owner switch, off unless exactly 'true', behind
// saved reports and decisions, and never on a locked production. The routes are proved against the real database
// in customer-decision-card-route.test.ts and the service in customer-decision-card-service.test.ts.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));
const { cardsAvailable } = await import('../../apps/web/lib/card-availability');

const prerequisites = {
  CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
  CORRIDRA_DELIVERY_ENABLED: 'true',
  CORRIDRA_CUSTOMER_DECISIONS_ENABLED: 'true',
  DATA_ENVIRONMENT: 'synthetic',
};
const on = { ...prerequisites, CORRIDRA_SHARE_CARD: 'true' };

describe('the decision card switch', () => {
  const entry = () => switchRegistry.find((s) => s.name === 'CORRIDRA_SHARE_CARD')!;
  const state = (env: NodeJS.ProcessEnv) =>
    new Map(describeSwitches(env).flatMap((g) => g.rows.map((r) => [r.name, r.state.text]))).get(
      'CORRIDRA_SHARE_CARD',
    );
  it('is a real owner switch, read through the shared switch names', () => {
    expect(entry().kind).toBe('flag');
    expect(entry().label).toBe('Decision card');
    expect(uxSwitchNames).toContain('CORRIDRA_SHARE_CARD');
  });
  it('is described in plain words: who, what, what it needs and that what was seen cannot be recalled', () => {
    const line = entry().line;
    expect(line).not.toMatch(/[\u2013\u2014]/);
    expect(line).toMatch(/owners or admins of a sample workspace/);
    expect(line).toMatch(/read-only links to one reviewed decision/);
    expect(line).toMatch(/database module installed/);
    expect(line).toMatch(/privacy review/);
    expect(line).toMatch(/can be withdrawn/);
    expect(line).toMatch(/cannot be recalled/);
    expect(line).not.toMatch(/co-owner or bank/);
  });
  it('is Off unless the setting is exactly "true"', () => {
    expect(state({})).toBe('Off');
    expect(state({ CORRIDRA_SHARE_CARD: 'true' })).toBe('On');
    for (const value of ['TRUE', 'True', '1', 'yes', 'false', '', ' true'])
      expect(state({ CORRIDRA_SHARE_CARD: value })).toBe('Off');
  });
});

describe('the application switch for the card', () => {
  it('is on only with saved reports and decisions on, the setting exactly "true" and production not locked', () => {
    expect(customerDecisionCardsEnabled(on)).toBe(true);
    expect(customerDecisionCardsEnabled({})).toBe(false);
    expect(customerDecisionCardsEnabled(prerequisites)).toBe(false);
    for (const value of ['TRUE', 'True', '1', 'yes', 'false', '', ' true'])
      expect(customerDecisionCardsEnabled({ ...on, CORRIDRA_SHARE_CARD: value })).toBe(false);
  });
  it('is off when any prerequisite is off', () => {
    for (const name of Object.keys(prerequisites))
      expect(customerDecisionCardsEnabled({ ...on, [name]: 'false' })).toBe(false);
  });
  it('is off on a production deployment the owner has not unlocked', () => {
    expect(customerDecisionCardsEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(false);
    expect(
      customerDecisionCardsEnabled({
        ...on,
        VERCEL_ENV: 'production',
        CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK: 'synthetic-only',
      }),
    ).toBe(true);
  });
});

describe('availability for a page', () => {
  afterEach(() => vi.restoreAllMocks());
  it('reads nothing from the database while the switch is off', async () => {
    const readInstalled = vi.fn(async () => true);
    expect(await cardsAvailable(readInstalled, { ...on, CORRIDRA_SHARE_CARD: 'TRUE' })).toBe(false);
    expect(await cardsAvailable(readInstalled, {})).toBe(false);
    expect(readInstalled).not.toHaveBeenCalled();
  });
  it('is true only when the switch is on and the module is installed', async () => {
    expect(await cardsAvailable(async () => true, on)).toBe(true);
    expect(await cardsAvailable(async () => false, on)).toBe(false);
  });
  it('fails closed and logs only the error code, never the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('relation "secret_table" does not exist'), {
      code: '42P01',
    });
    expect(
      await cardsAvailable(async () => {
        throw failure;
      }, on),
    ).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('42P01');
    expect(String(log.mock.calls[0]![0])).not.toContain('secret_table');
  });
});

describe('the link token', () => {
  const command = '6f1c1f1e-8f43-4a3e-9f2d-0b8f0d3c2a11';
  it('is 43 base64url characters, the same for the same customer and command, and different otherwise', () => {
    const token = cardToken('secret', 'https://issuer.invalid/auth', 'subject-1', command);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cardToken('secret', 'https://issuer.invalid/auth', 'subject-1', command)).toBe(token);
    for (const other of [
      cardToken('other', 'https://issuer.invalid/auth', 'subject-1', command),
      cardToken('secret', 'https://other.invalid/auth', 'subject-1', command),
      cardToken('secret', 'https://issuer.invalid/auth', 'subject-2', command),
      cardToken('secret', 'https://issuer.invalid/auth', 'subject-1', command.replace('6f', '7f')),
    ])
      expect(other).not.toBe(token);
  });
  it('is a labelled HMAC of the issuer, the subject and the command, and the database sees only its SHA-256', () => {
    // Fixed vector, so a change to the derivation (which would orphan every link) is a test failure.
    const token = cardToken('secret', 'https://issuer.invalid/auth', 'subject-1', command);
    expect(token).toBe('tqkVy8RGdluMnSclRb9FqsHls33EOi4onrDgY0NEp08');
    expect(cardTokenDigest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(cardTokenDigest(token)).not.toContain(token);
  });
});

describe('error mapping is by SQLSTATE and message together', () => {
  const pg = (code: string, message: string) => Object.assign(new Error(message), { code });
  const mapped = (error: unknown) => mapDecisionCardError(error) as DomainError;
  it('maps a changed card and a reached limit to distinct 409 reasons', () => {
    expect(mapped(pg('23514', 'DECISION_CARD_CHANGED'))).toMatchObject({
      status: 409,
      code: 'CHANGED',
    });
    expect(mapped(pg('53400', 'DECISION_CARD_CAP_REACHED'))).toMatchObject({
      status: 409,
      code: 'CAP_REACHED',
    });
  });
  it('maps the hourly limit to 429', () => {
    expect(mapped(pg('54000', 'DECISION_CARD_RATE_LIMITED'))).toMatchObject({ status: 429 });
  });
  it('maps every loss of access to one 403 in the same words', () => {
    const a = mapped(pg('42501', 'Decision card unavailable'));
    const b = mapped(pg('42501', 'Customer access expired'));
    expect(a).toMatchObject({ status: 403, message: 'Access denied or link unavailable' });
    expect(b.message).toBe(a.message);
    expect(b.status).toBe(403);
  });
  it('maps any other 23514 to a validation 400, never a conflict', () => {
    for (const message of ['Withdrawal command conflicts', 'Decision card request required', ''])
      expect(mapped(pg('23514', message))).toMatchObject({ status: 400 });
  });
  it('does not turn the same SQLSTATE with another message into the card answers', () => {
    const other53400 = pg('53400', 'too many rows in some other admission function');
    const other54000 = pg('54000', 'a different program limit');
    expect(mapDecisionCardError(other53400)).toBe(other53400);
    expect(mapDecisionCardError(other54000)).toBe(other54000);
    expect(mapped(pg('23514', 'decision_card_changed'))).toMatchObject({ status: 400 });
  });
  it('maps a deadlock and a lock timeout to a retryable 503', () => {
    for (const code of ['40P01', '55P03'])
      expect(mapped(pg(code, 'anything'))).toMatchObject({ status: 503, code: 'RETRYABLE' });
  });
  it('turns an account that changed mid-use (409 from the boundary) into the same 403', () => {
    expect(
      mapped(new DomainError('Your account changed. Reload before continuing.', 409)),
    ).toMatchObject({
      status: 403,
      message: 'Access denied or link unavailable',
    });
  });
  it('passes everything else through untouched', () => {
    const unauthenticated = new DomainError('Sign in to continue', 401);
    expect(mapDecisionCardError(unauthenticated)).toBe(unauthenticated);
    const missing = pg('42883', 'function does not exist');
    expect(mapDecisionCardError(missing)).toBe(missing);
    const plain = new Error('boom');
    expect(mapDecisionCardError(plain)).toBe(plain);
  });
  it('never puts the database message in the answer', () => {
    const answer = mapped(pg('23514', 'secret SQL text'));
    expect(answer.message).not.toContain('secret');
  });
});

describe('the owner route source contract', () => {
  const route = read('apps/web/app/api/customer-decision-cards/route.ts');
  it('answers POST only, never cached, on the Node runtime', () => {
    expect(route).toContain("export const runtime = 'nodejs';");
    expect(route).toContain("export const dynamic = 'force-dynamic';");
    expect(route).toContain('export async function POST(');
    expect(route).not.toMatch(/export (async )?function (GET|HEAD|PUT|PATCH|DELETE)\b/);
  });
  it('checks the switch, the origin, the content type and the body size before the service, and spends the limiter inside create', () => {
    const order = [
      'customerDecisionCardsEnabled()',
      'foundations()',
      'await s.ready',
      "request.headers.get('origin') !== s.config.APP_ORIGIN",
      "startsWith('application/json')",
      'boundedBody(request,',
      's.customerDecisionCards.create(',
      's.delivery.budget(',
    ].map((text) => route.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('spends no limiter before the session is verified and none at all on withdraw, with its own client prefix', () => {
    expect(route.indexOf('s.delivery.budget(')).toBeGreaterThan(
      route.indexOf('s.customerDecisionCards.create('),
    );
    expect(route.match(/s\.delivery\.budget\(/g)).toHaveLength(1);
    expect(route).toContain('decision-card-owner:');
    expect(route).not.toContain('decision-card:');
    expect(route).not.toMatch(/x-corridra-customer-subject'\)[^;]*budget/s);
  });
  it('shows the link only when the card is active and never logs a body, token or hash', () => {
    expect(route).not.toMatch(/console\.(log|info|warn|debug)/);
    expect(route).not.toMatch(/JSON\.stringify\((body|input|request|result|value)/);
  });
});

describe('the public route source contract', () => {
  const route = read('apps/web/app/api/decision-card/route.ts');
  const reader = read('packages/auth/src/customer-decision-cards.ts');
  it('is POST only for data: GET and HEAD answer 405 with Allow: POST', () => {
    expect(route).toContain("export const runtime = 'nodejs';");
    expect(route).toContain("export const dynamic = 'force-dynamic';");
    expect(route).toContain('export async function POST(');
    expect(route).toContain("Allow: 'POST'");
    expect(route).toContain('export const HEAD = GET;');
    expect(route).not.toMatch(/export (async )?function (PUT|PATCH|DELETE)\b/);
  });
  it('runs the transport checks first, then the switch, then the budget before the database read', () => {
    const order = [
      'foundations()',
      "request.headers.get('origin') !== s.config.APP_ORIGIN",
      "startsWith('application/json')",
      'boundedBody(request,',
      'customerDecisionCardsEnabled()',
      'await s.ready',
      's.delivery.budget(',
      's.decisionCardReader.read(',
    ].map((text) => route.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(route).not.toMatch(/searchParams|request\.url|nextUrl|cookies\(|Set-Cookie/);
  });
  it('keeps its own client prefix and no global key', () => {
    expect(route).toContain('decision-card-public:');
    expect(route).not.toContain("'decision-card-malformed'");
    expect(route).not.toContain('`decision-card:');
  });
  it('logs nothing about the visitor, the body, the token or its hash', () => {
    expect(route).not.toMatch(/console\.(log|info|warn|debug)/);
    expect(route).not.toMatch(/JSON\.stringify\((body|input|request|digest|token)/);
  });
  it('reads in a plain statement: the open counter is a write, so no read-only transaction and no replica', () => {
    expect(reader).not.toMatch(/READ ONLY|replica/i);
    expect(reader).toContain('SELECT app.read_decision_card($1)');
  });
});
