import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import type { DatabaseClient, DatabasePool } from '../../packages/db/src/index';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';
import {
  CustomerAccountLifecycleService,
  closedAccountGate,
  resetClosedAccountGateCache,
} from '../../packages/auth/src/customer-account-lifecycle';

// CRUD G5, the closed-account check in the shared customer session boundary. With the app flag off the boundary
// issues exactly the queries it issued before this change. With it on, and the module installed, a closed person
// reaches only the closure status and the undo command.
let f: Fixture;
let h: ReturnType<typeof harness>;
const flag = 'CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED';
const phrase = 'Close my account';

// Every statement a pool or a client of it receives, in order, with white space collapsed.
function recording(pool: DatabasePool, log: string[]): DatabasePool {
  const note = (text: unknown) =>
    log.push(
      (typeof text === 'string' ? text : String((text as { text?: string }).text))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90),
    );
  return {
    query: ((text: unknown, ...rest: unknown[]) => {
      note(text);
      return (pool.query as (...args: unknown[]) => unknown)(text, ...rest);
    }) as DatabasePool['query'],
    end: () => pool.end(),
    connect: async () => {
      const client = await pool.connect();
      return {
        release: (...args: Parameters<DatabaseClient['release']>) => client.release(...args),
        query: ((text: unknown, ...rest: unknown[]) => {
          note(text);
          return (client.query as (...args: unknown[]) => unknown)(text, ...rest);
        }) as DatabaseClient['query'],
      } as DatabaseClient;
    },
  };
}
class Probe extends CustomerSessionBoundary {
  run<T>(work: (db: DatabaseClient) => Promise<T>, allowClosedAccount = false) {
    return this.transaction(async (db) => work(db), undefined, undefined, undefined, {
      allowClosedAccount,
    });
  }
}
const probeFor = (person: string, log: string[] = []) =>
  new Probe(recording(f.runtime, log), recording(f.auth, log), options, async () =>
    h.session(person),
  );
// The check needs the account switch and customer workspaces, the same condition the screens use.
const workspacesFlag = 'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED';
async function withFlag<T>(
  value: string | undefined,
  work: () => Promise<T>,
  workspaces: string | null = 'true',
) {
  const names = [flag, workspacesFlag, 'DATA_ENVIRONMENT'] as const;
  const before = names.map((name) => process.env[name]);
  const set = (name: string, next: string | undefined) => {
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  };
  set(flag, value);
  set(workspacesFlag, workspaces ?? undefined);
  set('DATA_ENVIRONMENT', 'synthetic');
  resetClosedAccountGateCache();
  try {
    return await work();
  } finally {
    names.forEach((name, index) => set(name, before[index]));
    resetClosedAccountGateCache();
  }
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerAccountLifecycle(f.owner);
  h = harness(f, 'g5gate');
  await h.admit(['alice', 'bob', 'carol']);
  await h.provision('alice', 'Synthetic gate workspace');
  await h.provision('carol', 'Synthetic carol workspace');
  const [workspace] = (await h.state('alice')) as { workspaceId: string }[];
  await h.join('alice', 'bob', workspace!.workspaceId);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the session gate tests'],
  );
});
afterAll(async () => {
  await f?.close();
});

// The statements the boundary issued before the gate existed (recorded from the code at the previous commit).
const baseline = [
  'SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,pg_has_rol',
  'SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,pg_has_rol',
  'SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.n',
  'SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.n',
  'INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3',
  'SELECT customer_private.set_view_expiry($1,$2)',
  'BEGIN',
  "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_has",
  'SELECT 1',
  'COMMIT',
  'DELETE FROM customer_private.session_proof WHERE hash=$1 OR expires_at<=clock_timestamp()',
];
const gateProbe =
  "SELECT to_regprocedure('customer.account_closed_gate()') IS NOT NULL AS installed";
const gateCall = 'SELECT customer.account_closed_gate() AS closed';
const queries = async (person: string) => {
  const log: string[] = [];
  await probeFor(person, log).run(async (db) => db.query('SELECT 1'));
  return log;
};

describe('with the app flag off', () => {
  test('the boundary issues exactly the queries it issued before, even though the module is installed', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1'])
      expect(await withFlag(value, () => queries('alice')), String(value)).toEqual(baseline);
  });

  test('the account switch alone, without customer workspaces, checks nothing, as the screens show nothing', async () => {
    expect(await withFlag('true', () => queries('alice'), null)).toEqual(baseline);
    expect(await withFlag('true', () => queries('alice'), 'false')).toEqual(baseline);
  });

  test('a closed person is not stopped, because nothing checks', async () => {
    await withFlag('true', async () => {
      await h.sql('carol', 'SELECT 1');
    });
    await h.lifecycle('carol', 'archive', {
      workspaceId: ((await h.state('carol')) as { workspaceId: string }[])[0]!.workspaceId,
      expectedVersion: 0,
      confirmName: 'Synthetic carol workspace',
    });
    await withFlag('true', () => account('carol', 'close', { confirmation: phrase }));
    await withFlag(undefined, async () => {
      expect(await queries('carol')).toEqual(baseline);
      expect(await h.sql('carol', 'SELECT 1 AS one')).toEqual({ one: 1 });
    });
    await withFlag('true', () => account('carol', 'undo'));
  });
});

const account = (person: string, action: string, extra: Record<string, unknown> = {}) =>
  new CustomerAccountLifecycleService(f.runtime, f.auth, options, async () =>
    h.session(person),
  ).command({ action, commandId: randomUUID(), ...extra });

describe('with the app flag on and the module installed', () => {
  test('an active person adds one probe on the first call, then one gate query per call', async () => {
    await withFlag('true', async () => {
      expect(await queries('alice')).toEqual([
        ...baseline.slice(0, 8),
        gateProbe.slice(0, 90),
        gateCall.slice(0, 90),
        ...baseline.slice(8),
      ]);
      expect(await queries('alice')).toEqual([
        ...baseline.slice(0, 8),
        gateCall.slice(0, 90),
        ...baseline.slice(8),
      ]);
    });
  });

  test('a closed person is refused with 403 account_closed and the date, and work never runs', async () => {
    await withFlag('true', async () => {
      await account('bob', 'close', { confirmation: phrase });
      let ran = false;
      const error = await probeFor('bob')
        .run(async () => {
          ran = true;
        })
        .catch((e) => e);
      expect(ran).toBe(false);
      expect(error).toMatchObject({ status: 403, code: 'account_closed' });
      expect(error.message).toMatch(
        /^Your account is closed\. Undo is available until \d{4}-\d{2}-\d{2}\.$/,
      );
      const until = (
        await new CustomerAccountLifecycleService(f.runtime, f.auth, options, async () =>
          h.session('bob'),
        ).state()
      ).undoUntil!;
      expect(error.message).toContain(new Date(until).toISOString().slice(0, 10));
    });
  });

  test('a closed person can still read the status, undo and ask for erasure, and nothing else of the lifecycle', async () => {
    await withFlag('true', async () => {
      const service = () =>
        new CustomerAccountLifecycleService(f.runtime, f.auth, options, async () =>
          h.session('bob'),
        );
      expect(await service().state()).toMatchObject({ status: 'closed', canUndo: true });
      // The right to ask for erasure does not end with the closing.
      expect(
        await service().command({ action: 'file_erasure', commandId: randomUUID() }),
      ).toMatchObject({ operation: 'file_erasure', changed: true });
      await expect(
        service().command({ action: 'close', commandId: randomUUID(), confirmation: phrase }),
      ).rejects.toMatchObject({ status: 403, code: 'account_closed' });
      expect(await service().command({ action: 'undo', commandId: randomUUID() })).toMatchObject({
        status: 'active',
      });
      expect(
        await probeFor('bob').run(async (db) => (await db.query('SELECT 1 AS one')).rows[0]),
      ).toEqual({ one: 1 });
    });
  });

  test('another customer service is refused for a closed person, and the final state says it is closed without a date', async () => {
    await withFlag('true', async () => {
      await account('bob', 'close', { confirmation: phrase });
      await expect(h.workspaces('bob').list()).rejects.toMatchObject({
        status: 403,
        code: 'account_closed',
      });
      await f.owner.query(
        `WITH t AS (SELECT clock_timestamp()-interval '31 days' AS at)
         INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
         SELECT p.id,'closed',t.at,t.at+interval '30 days',$2 FROM t,customer_private.principal p WHERE p.subject=$1`,
        [h.session('bob').subject, randomUUID()],
      );
      // the latest row is the closed one, and day 30 has passed
      await expect(probeFor('bob').run(async () => 1)).rejects.toMatchObject({
        status: 403,
        code: 'account_closed',
        message: 'Your account is closed.',
      });
    });
  });

  test('pausing the control never reopens a closed account', async () => {
    await withFlag('true', async () => {
      await f.owner.query(
        'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(2,false,$1,$2)',
        [f.serviceId, 'Pausing the module for the session gate tests'],
      );
      await expect(probeFor('bob').run(async () => 1)).rejects.toMatchObject({
        code: 'account_closed',
      });
    });
  });
});

describe('with the app flag on and the module not installed', () => {
  const fake = (installed: boolean, log: string[]) =>
    ({
      query: async (text: string) => {
        log.push(text);
        return { rows: [{ installed, closed: false }] };
      },
      release: () => undefined,
    }) as unknown as DatabaseClient;

  test('probes once, caches the absence for a minute, probes again after, and caches a presence for good', async () => {
    vi.useFakeTimers();
    try {
      resetClosedAccountGateCache();
      const log: string[] = [];
      await closedAccountGate(fake(false, log));
      await closedAccountGate(fake(false, log));
      expect(log).toEqual([gateProbe]);
      vi.advanceTimersByTime(59000);
      await closedAccountGate(fake(false, log));
      expect(log).toHaveLength(1);
      vi.advanceTimersByTime(2000);
      await closedAccountGate(fake(true, log));
      expect(log).toEqual([gateProbe, gateProbe, gateCall]);
      vi.advanceTimersByTime(3600000);
      await closedAccountGate(fake(true, log));
      expect(log).toEqual([gateProbe, gateProbe, gateCall, gateCall]);
    } finally {
      vi.useRealTimers();
      resetClosedAccountGateCache();
    }
  });
});

describe('every customer route reaches data through the session boundary', () => {
  const root = resolve('.');
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = resolve(directory, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const text = (path: string) => readFileSync(path, 'utf8');

  test('no customer route opens a database connection of its own', () => {
    const routes = walk(resolve(root, 'apps/web/app/api')).filter((path) =>
      /\/api\/(customer-[a-z-]+|account)\/route\.ts$/.test(path),
    );
    expect(routes.length).toBeGreaterThan(30);
    for (const path of routes)
      expect(text(path), path).not.toMatch(
        /@corridra\/db|\.query\(|\.connect\(|from 'pg'|new Pool/,
      );
  });

  test('every customer data class extends the boundary, except these named offline or staff modules', () => {
    // Offline owner procedures (run by the protected installer, never by a request) and the staff erasure queue.
    const exceptions = new Set([
      'customer-account-gate.ts',
      'customer-admission.ts',
      'customer-authority-pin.ts',
      'customer-request-admission.ts',
      'customer-erasure-queue.ts',
      'customer-session.ts',
      'mission-mail.ts',
    ]);
    const files = [
      ...readdirSync(resolve(root, 'packages/auth/src')).map((n) =>
        resolve(root, 'packages/auth/src', n),
      ),
      ...readdirSync(resolve(root, 'apps/web/lib')).map((n) => resolve(root, 'apps/web/lib', n)),
    ].filter((path) => path.endsWith('.ts') && !statSync(path).isDirectory());
    const direct = files.filter((path) =>
      /customer\.[a-z_]+\(|customer_private\./.test(text(path)),
    );
    expect(direct.length).toBeGreaterThan(25);
    const outside = direct
      .filter((path) => !/extends CustomerSessionBoundary/.test(text(path)))
      .map((path) => path.split('/').pop()!)
      .filter((name) => !exceptions.has(name) && !/-configuration\.ts$/.test(name));
    expect(outside).toEqual([]);
  });

  test('no request handler imports an offline configuration or install module', () => {
    const pages = walk(resolve(root, 'apps/web')).filter(
      (path) =>
        /\.(ts|tsx)$/.test(path) && !path.includes('node_modules') && !path.includes('.next'),
    );
    for (const path of pages)
      expect(text(path), path).not.toMatch(
        /customer-account-lifecycle-configuration|customer-account-lifecycle-migrate/,
      );
  });
});
