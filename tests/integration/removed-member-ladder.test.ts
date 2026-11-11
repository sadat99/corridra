import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FILE_KEYS,
  FUNCTION_KEYS,
  REGISTRY_KEYS,
  HISTORY_TABLES,
  NEW_FILES,
  appliedNames,
  buildWorld,
  bodyHash,
  definitionHash,
  digest,
  fileSignatures,
  fileSql,
  hideNewFiles,
  openNewFiles,
  type World,
} from './removed-member-support';
import { fixture } from './support';
import type { PoolClient } from '../../packages/db/src/index';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import { refreshInstalledOptionalModules } from '../../packages/db/src/customer-optional-refresh';

// Removed members, the ladder (owner decision, 11 Nov 2026: "No, remove access (Recommended)"). Later modules fingerprint the
// exact text of some functions on every fresh ladder, so six of them are NOT replaced by this change and a catalogue test
// proves their text is untouched by each new file. The seven files apply in every install order without raising and leave the
// same bodies, the upgrade from the production state (real-use 13, mail 0001 to 0003, notifications 0001 to 0005, move 0001,
// withdrawal 0001 and 0002) adds one file per module and no row of any history table changes. Fails on main.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

// Later modules pin the text of these, so no new file may touch it.
const UNTOUCHED = [
  'customer_private.request_result(uuid,uuid)',
  'customer.submit_private_request(uuid,uuid,jsonb)',
  'customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text)',
  'customer.claim_mission_mail(uuid,text)',
  'customer_private.notification_valid(customer_private.notification_outbox)',
  'customer.enqueue_move_notifications(uuid)',
  'customer.mute_mission_mail(uuid,text)',
  'customer.mute_notifications(uuid,text)',
];
const allSignatures = () => FUNCTION_KEYS.flatMap((key) => fileSignatures(key));
const registries = Object.fromEntries(FILE_KEYS.map((key) => [key, NEW_FILES[key].registry]));
const PRE = {
  customer: 3,
  realUse: 13,
  readiness: 10,
  move: 1,
  withdrawal: 2,
  mail: 3,
  notifications: 5,
  decisionCards: 1,
};
const POST = {
  customer: 4,
  realUse: 14,
  readiness: 12,
  move: 2,
  withdrawal: 3,
  mail: 4,
  notifications: 6,
  decisionCards: 2,
};
let w: World;
let before: Record<string, string>;
const untouchedHashes = async (owner: World['f']['owner']) =>
  Object.fromEntries(
    await Promise.all(UNTOUCHED.map(async (s) => [s, await definitionHash(owner, s)] as const)),
  );
const counts = async (owner: World['f']['owner']) => {
  const out: Record<string, number> = {};
  for (const key of REGISTRY_KEYS) out[key] = (await appliedNames(owner, registries[key]!)).length;
  return out;
};

describe('the production state, populated, then upgraded', () => {
  beforeAll(async () => {
    // Everything is built with the seven files hidden, so people leave and write under the old functions.
    hideNewFiles();
    w = await buildWorld();
    await w.leave('lena', w.W);
    await w.revoke('olive', w.W, w.members.rex!);
    before = await digest(w.f.owner, HISTORY_TABLES);
  }, 900000);
  afterAll(async () => {
    await w?.f.close();
  });

  test('CONTROL (the pre-state, holds on main): before the upgrade a person who left still reads what they wrote, which is the behaviour the owner decision replaces', async () => {
    expect(await counts(w.f.owner)).toEqual(PRE);
    expect((await w.listRequests('lena')).ids).toEqual(
      expect.arrayContaining([...w.requests.lena!, w.ownWorkspaceRequest.lena!]),
    );
    expect(await w.savedIds('rex')).toContain(w.reports.rex!.savedId);
  });

  test('the catalogue: no new file changes the text of a function that a later module fingerprints', async () => {
    const hashes = await untouchedHashes(w.f.owner);
    const db = (await w.f.owner.connect()) as unknown as PoolClient;
    try {
      await db.query('BEGIN');
      for (const key of FILE_KEYS) {
        await db.query(fileSql(key));
        for (const signature of UNTOUCHED) {
          const row = await db.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [
            signature,
          ]);
          expect(
            createHash('sha256')
              .update(row.rows[0].d as string)
              .digest('hex'),
            `${key}: ${signature}`,
          ).toBe(hashes[signature]);
        }
      }
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(await untouchedHashes(w.f.owner)).toEqual(hashes);
  });

  test('the installer path adds exactly one file to each module, and no history table changes by one byte', async () => {
    const hashes = await untouchedHashes(w.f.owner);
    openNewFiles();
    await migrateCustomerAuthority(w.f.owner);
    expect((await appliedNames(w.f.owner, 'customer_migrations')).length).toBe(4);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before);
    await migrateCommercialReadiness(w.f.owner);
    expect((await appliedNames(w.f.owner, 'commercial_readiness_migrations')).length).toBe(12);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before);
    await migrateCustomerRealUse(w.f.owner);
    expect((await appliedNames(w.f.owner, 'customer_real_use_migrations')).length).toBe(14);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before);
    await migrateCustomerDecisionCards(w.f.owner);
    expect((await appliedNames(w.f.owner, 'customer_decision_card_migrations')).length).toBe(2);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before);
    const refreshed = await refreshInstalledOptionalModules(w.f.owner);
    expect(refreshed.map((r) => `${r.module}:${r.state}`)).toEqual([
      'request withdrawal:advanced',
      'move records:advanced',
      'mission mail:advanced',
      'notifications:advanced',
    ]);
    expect(await counts(w.f.owner)).toEqual(POST);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before);
    expect(await untouchedHashes(w.f.owner)).toEqual(hashes);
    // Run again: nothing to do.
    expect((await refreshInstalledOptionalModules(w.f.owner)).map((r) => r.state)).toEqual([
      'current',
      'current',
      'current',
      'current',
    ]);
    expect(await counts(w.f.owner)).toEqual(POST);
  });

  test('after the upgrade the removed people see none of the requests and reports they made in the workspace', async () => {
    for (const person of ['lena', 'rex']) {
      const ids = (await w.listRequests(person)).ids;
      for (const id of w.requests[person]!) expect(ids).not.toContain(id);
      expect(await w.savedIds(person)).not.toContain(w.reports[person]!.savedId);
    }
    expect((await w.listRequests('lena')).ids).toContain(w.ownWorkspaceRequest.lena);
    expect((await w.listRequests('sam')).ids.sort()).toEqual([...w.requests.sam!].sort());
    // The number the installer prints before and after: requests whose author is no longer a member. History did not change,
    // so it is the same number in both reports.
    const hidden = await w.f.owner.query(
      `SELECT count(*)::int AS n FROM customer_private.owned_request r
       WHERE NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=r.workspace_id AND m.principal_id=r.principal_id)
       AND NOT EXISTS(SELECT FROM customer_private.workspace_member x WHERE x.tenant_id=r.workspace_id AND x.principal_id=r.principal_id
        AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation v WHERE v.member_id=x.id))`,
    );
    expect(hidden.rows[0].n).toBe(w.requests.lena!.length + w.requests.rex!.length);
  });

  test('every replaced function equals the text in its file, and the workspace lifecycle late files still pass', async () => {
    for (const signature of allSignatures())
      expect(await bodyHash(w.f.owner, signature)).toBeTruthy();
    await migrateCustomerWorkspaceLifecycle(w.f.owner);
    await migrateCustomerAccountLifecycle(w.f.owner);
    await migrateCustomerProblemReports(w.f.owner);
    expect(await digest(w.f.owner, HISTORY_TABLES)).toEqual(before);
  });
});

describe('fresh ladders in every install order', () => {
  const orders: Record<string, (owner: World['f']['owner']) => Promise<void>> = {
    'installer order': async (o) => {
      await migrateCustomerAuthority(o);
      await migrateCommercialReadiness(o);
      await migrateCustomerDecisionCards(o);
      await migrateCustomerRealUse(o);
      await migrateCustomerRequestWithdrawal(o);
      await migrateCustomerMoves(o);
      await migrateCustomerMissionMail(o);
      await migrateCustomerNotifications(o);
      await migrateCustomerWorkspaceLifecycle(o);
      await migrateCustomerAccountLifecycle(o);
      await migrateCustomerProblemReports(o);
    },
    'real-use, withdrawal, mail, notifications, lifecycles, problem reports': async (o) => {
      await migrateCustomerRealUse(o);
      await migrateCustomerRequestWithdrawal(o);
      await migrateCustomerMissionMail(o);
      await migrateCustomerNotifications(o);
      await migrateCustomerWorkspaceLifecycle(o);
      await migrateCustomerAccountLifecycle(o);
      await migrateCustomerProblemReports(o);
      await migrateCommercialReadiness(o);
      await migrateCustomerDecisionCards(o);
    },
    'the explicit mail path, withdrawal first, notifications before lifecycle': async (o) => {
      await migrateCustomerRealUse(o);
      await migrateCustomerRequestWithdrawal(o);
      await migrateCustomerMissionMail(o);
      await migrateCustomerNotifications(o);
      await migrateCommercialReadiness(o);
      await migrateCustomerDecisionCards(o);
    },
    'workspace lifecycle before mail': async (o) => {
      await migrateCustomerRealUse(o);
      await migrateCustomerWorkspaceLifecycle(o);
      await migrateCustomerRequestWithdrawal(o);
      await migrateCustomerMissionMail(o);
      await migrateCustomerNotifications(o);
      await migrateCommercialReadiness(o);
      await migrateCustomerDecisionCards(o);
      await migrateCustomerWorkspaceLifecycle(o);
    },
  };
  const finals: Record<string, Record<string, string | null>> = {};
  test.each(Object.keys(orders))(
    '%s never raises and applies every new file',
    async (name) => {
      openNewFiles();
      const f = await fixture();
      try {
        await orders[name]!(f.owner);
        for (const key of FILE_KEYS)
          expect(await appliedNames(f.owner, registries[key]!), `${name}: ${key}`).toContain(
            NEW_FILES[key].name,
          );
        finals[name] = Object.fromEntries(
          await Promise.all(
            allSignatures().map(async (s) => [s, await bodyHash(f.owner, s)] as const),
          ),
        );
      } finally {
        await f.close();
      }
    },
    600000,
  );

  test('the text of every replaced function is the same in every order', () => {
    const all = Object.values(finals);
    expect(all.length).toBe(Object.keys(orders).length);
    // The modules the shorter orders leave out have no mail or notification functions; compare what each order has.
    for (const signature of allSignatures()) {
      const seen = new Set(all.map((final) => final[signature]).filter(Boolean));
      expect(seen.size, signature).toBe(1);
    }
  });
});
