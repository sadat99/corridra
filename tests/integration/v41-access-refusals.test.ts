import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError, stepUpRequired } from '../../packages/domain/src';
import { CustomerErasureQueue } from '../../packages/auth/src/customer-erasure-queue';
import { NetworkInvitations } from '../../packages/auth/src/network-invitations';
import { RequestWithdrawalSignalService } from '../../packages/missions/src/request-withdrawal-signal';

// Team desk v4.1 access fixes. A read that is refused because the authenticator check has lapsed answers 401 with
// STEP_UP_REQUIRED, so the screen opens the in-place check; a role that may never read it keeps its plain 403 with no
// code. The services here are the real ones, run over a pool that answers only the session's role and check, so each
// refusal is the real refusal. Nothing else is reachable: a statement the fake does not know fails the test.
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '22222222-2222-4222-8222-222222222222';
const origin = 'https://corridra.example.invalid';
const session = vi.hoisted(() => ({
  role: 'owner',
  fresh: false,
  withdrawalInstalled: true,
  invitationRefusal: false,
  statements: [] as string[],
}));

function fakePool() {
  const db = {
    query: async (text: string) => {
      session.statements.push(text.trim().split('\n')[0]!.slice(0, 90));
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
      if (text.includes('set_config')) return { rows: [] };
      if (text.includes('app.actor_id() AS actor_id'))
        return { rows: [{ actor_id: 'a', role: session.role, fresh: session.fresh }] };
      if (text.includes("to_regprocedure('app.mission_request_withdrawal"))
        return { rows: [{ present: session.withdrawalInstalled }] };
      if (text.includes('app.mission_request_withdrawal($1)'))
        return { rows: [{ signal: { withdrawn: true, at: '2026-11-20T10:00:00Z' } }] };
      throw new Error('unexpected statement: ' + text.slice(0, 80));
    },
    release: () => undefined,
  };
  return {
    connect: async () => db,
    query: async (text: string) => {
      if (text.includes('to_regprocedure')) return { rows: [{ available: true }] };
      if (text.includes('network_invitation_command')) {
        if (session.invitationRefusal) throw Object.assign(new Error('denied'), { code: '42501' });
        return {
          rows: [{ result: { enabled: true, invitations: [], next: null, countries: [] } }],
        };
      }
      throw new Error('unexpected pool statement');
    },
  } as never;
}

vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => {
    const pool = fakePool();
    return {
      ready: Promise.resolve(),
      provider: { getSession: async () => ({ token: 'staff-token' }) },
      config: { APP_ORIGIN: origin },
      access: { tenants: async () => [{ id: tenant, name: 'Team', role: session.role }] },
      customerErasureQueue: new CustomerErasureQueue(pool),
      networkInvitations: new NetworkInvitations(pool, true),
      withdrawalSignal: new RequestWithdrawalSignalService(pool),
    };
  },
}));

import * as erasure from '../../apps/web/app/api/workspace/customer-erasure-queue/route';
import * as workspace from '../../apps/web/app/api/workspace/[action]/route';
import * as picker from '../../apps/web/app/api/picker/[kind]/route';
import * as withdrawal from '../../apps/web/app/api/mission-withdrawal/route';
import { deliveryError } from '../../apps/web/lib/delivery-http';

const get = (path: string) => new Request(`${origin}${path}`, { headers: { Origin: origin } });
const json = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as { error?: string; code?: string },
});
const as = (role: string, fresh: boolean) => {
  session.role = role;
  session.fresh = fresh;
};

beforeEach(() => {
  session.statements = [];
  session.withdrawalInstalled = true;
  session.invitationRefusal = false;
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('the shared delivery refusal keeps one code', () => {
  test('a lapsed authenticator check keeps STEP_UP_REQUIRED and nothing else gains a code', async () => {
    expect(await json(deliveryError(stepUpRequired()))).toEqual({
      status: 401,
      body: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
    });
    expect(await json(deliveryError(new DomainError('Access denied', 403, 'OTHER')))).toEqual({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(await json(deliveryError(new DomainError('Sign in to continue', 401)))).toEqual({
      status: 401,
      body: { error: 'Sign in to continue' },
    });
  });
});

describe('sc-26: the erasure queue read', () => {
  const read = () => erasure.GET(get(`/api/workspace/customer-erasure-queue?tenant=${tenant}`));
  test('an owner whose check has lapsed gets 401 STEP_UP_REQUIRED, not a dead end', async () => {
    as('owner', false);
    expect(await json(await read())).toEqual({
      status: 401,
      body: { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
    });
  });
  test('an admin has no erasure read: 403, no code, and the check is never what is asked', async () => {
    for (const fresh of [false, true]) {
      as('admin', fresh);
      const answer = await json(await read());
      expect(answer.status).toBe(403);
      expect(answer.body.code).toBeUndefined();
    }
  });
  test('an operator, reviewer and viewer are refused the same way', async () => {
    for (const role of ['operator', 'reviewer', 'viewer']) {
      as(role, true);
      const answer = await json(await read());
      expect(answer.status, role).toBe(403);
      expect(answer.body.code, role).toBeUndefined();
    }
  });
});

describe('sa-24 and sc-32: network invitations and the contributor picker', () => {
  const invitations = () =>
    workspace.GET(get(`/api/workspace/network-invitations?tenant=${tenant}`), {
      params: Promise.resolve({ action: 'network-invitations' }),
    });
  const contributors = () =>
    picker.GET(get(`/api/picker/contributor?tenant=${tenant}`), {
      params: Promise.resolve({ kind: 'contributor' }),
    });
  test('an owner or admin refused by the database (check lapsed) gets 401 STEP_UP_REQUIRED on both reads', async () => {
    session.invitationRefusal = true;
    for (const role of ['owner', 'admin']) {
      as(role, false);
      for (const read of [invitations, contributors]) {
        const answer = await json(await read());
        expect(answer.status, role).toBe(401);
        expect(answer.body.code, role).toBe('STEP_UP_REQUIRED');
      }
    }
  });
  test('an operator, reviewer or viewer keeps the plain 403 with no code', async () => {
    session.invitationRefusal = true;
    for (const role of ['operator', 'reviewer', 'viewer']) {
      as(role, false);
      for (const read of [invitations, contributors]) {
        const answer = await json(await read());
        expect(answer.status, role).toBe(403);
        expect(answer.body.code, role).toBeUndefined();
      }
    }
  });
  test('a fresh owner still reads (allowed path unchanged)', async () => {
    as('owner', true);
    const answer = await json(await invitations());
    expect(answer.status).toBe(200);
    const list = await json(await contributors());
    expect(list.status).toBe(200);
  });
});

describe('sc-14 and F5: the withdrawal note read', () => {
  const read = () =>
    withdrawal.GET(get(`/api/mission-withdrawal?tenant=${tenant}&mission=${mission}`));
  test('owner, admin and operator with a fresh check read it, as before', async () => {
    for (const role of ['owner', 'admin', 'operator']) {
      as(role, true);
      expect(await json(await read()), role).toEqual({
        status: 200,
        body: { withdrawn: true, at: '2026-11-20T10:00:00.000Z' },
      });
    }
  });
  test('a lapsed check is 401 STEP_UP_REQUIRED for the roles that may read it, and the database function is not called', async () => {
    for (const role of ['owner', 'admin', 'operator']) {
      as(role, false);
      session.statements = [];
      const answer = await json(await read());
      expect(answer.status, role).toBe(401);
      expect(answer.body.code, role).toBe('STEP_UP_REQUIRED');
      expect(session.statements.join('|')).not.toContain('mission_request_withdrawal($1)');
    }
  });
  test('a reviewer or viewer is refused 403 with no code, with a fresh check or not', async () => {
    for (const role of ['reviewer', 'viewer'])
      for (const fresh of [true, false]) {
        as(role, fresh);
        session.statements = [];
        const answer = await json(await read());
        expect(answer.status, `${role} ${fresh}`).toBe(403);
        expect(answer.body.code).toBeUndefined();
        expect(session.statements.join('|')).not.toContain('mission_request_withdrawal($1)');
      }
  });
  test('without the withdrawal module every role still gets "not withdrawn" (payload unchanged)', async () => {
    session.withdrawalInstalled = false;
    for (const role of ['owner', 'reviewer', 'viewer']) {
      as(role, false);
      expect(await json(await read()), role).toEqual({
        status: 200,
        body: { withdrawn: false, at: null },
      });
    }
  });
});
