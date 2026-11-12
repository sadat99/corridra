import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import {
  LADDER_FILE,
  World,
  fileConstraintFingerprint,
  fileFingerprints,
  ladderHash,
  liveConstraintFingerprint,
  liveFingerprints,
  liveTriggerCheck,
  openLadder,
  syntheticOptions,
} from './organisation-link-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { CustomerOrganisationLinkService } from '../../packages/auth/src/customer-organisation-links';

// ADR-079 slice A, installation. A populated database is built at the exact base state, the new ladder file is kept away
// from the migrator until each step needs it, and the guards, the preservation of data and the installers are shown.
vi.hoisted(() => {
  (globalThis as { __linkHide?: boolean }).__linkHide = true;
  // Real-use 0014 (removed member access) has its own gate here, so that this suite still proves that 0013 alone replaces
  // exactly nine functions. The last test of this file opens it. Owner decision 11 Nov 2026, "No, remove access (Recommended)".
  (globalThis as { __removedHide?: boolean }).__removedHide = true;
  (globalThis as { __feeHide?: boolean }).__feeHide = true;
  (globalThis as { __paymentHide?: boolean }).__paymentHide = true;
  (globalThis as { __outreachHide?: boolean }).__outreachHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const gate = globalThis as {
      __linkHide?: boolean;
      __removedHide?: boolean;
      __feeHide?: boolean;
      __paymentHide?: boolean;
      __outreachHide?: boolean;
    };
    if (!String(path).includes('customer-real-use-migrations')) return names;
    return names.filter(
      (n) =>
        !(
          gate.__linkHide && String(n).startsWith('0013_organisation_link_provenance_and_search')
        ) &&
        !((gate.__linkHide || gate.__removedHide) && String(n).startsWith('0014_')) &&
        // Real-use 0015 (participant fee status) is applied after 0014 and has its own gate: the last test of this file opens it.
        !(gate.__feeHide && String(n).startsWith('0015_')) &&
        // Real-use 0016 (participant payment declaration) is applied after 0015 and has its own gate: the last test opens it.
        !(gate.__paymentHide && String(n).startsWith('0016_')),
      // Real-use 0017 (experience outreach counts) is applied after 0015 and has its own gate: the last test of this file opens it.
      !(gate.__outreachHide && String(n).startsWith('0017_')),
    );
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
const byName = <T extends { signature: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
const nine = () => fileFingerprints().map((r) => r.signature);
const q = (sql: string, args: unknown[] = []) => w.f.owner.query(sql, args);
const appliedNames = async () =>
  (await q('SELECT name FROM customer_real_use_migrations.applied ORDER BY name')).rows.map(
    (r) => r.name as string,
  );
const attemptsTable = async () =>
  (await q("SELECT to_regclass('customer_private.organisation_link_search_attempt')::text t"))
    .rows[0].t as string | null;
const reportLine = async () =>
  `customer_real_use_migrations: ${(await q('SELECT count(*)::text AS n FROM customer_real_use_migrations.applied')).rows[0].n} applied`;
// Every row of every table of the four application schemas.
async function tableHashes() {
  const tables = (
    await q(
      `SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='r' AND n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1,2`,
    )
  ).rows;
  const out: Record<string, string> = {};
  for (const t of tables) {
    const name = `"${t.nspname}"."${t.relname}"`;
    out[`${t.nspname}.${t.relname}`] = (
      await q(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) h FROM ${name} t`,
      )
    ).rows[0].h;
  }
  return out;
}
// Every function of those schemas: body, settings, security mode and grants.
async function functionHashes() {
  const rows = (
    await q(
      `SELECT p.oid::regprocedure::text signature,
        md5(concat_ws('|',p.prosrc,p.proconfig::text,p.prosecdef::text,p.provolatile::text,p.proacl::text,p.pronargdefaults::text)) h
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1`,
    )
  ).rows;
  return new Map<string, string>(rows.map((r) => [r.signature, r.h]));
}
beforeAll(async () => {
  w = await World.build('corridra_upgrade');
}, 300000);
afterAll(async () => {
  await w?.close();
});

test('fingerprints: the values in the file are the values of a clean install at the base commit', async () => {
  const live = byName(await liveFingerprints(w.f.owner));
  if (process.env.LINK_PRINT_FINGERPRINTS === '1') {
    const lines = live.map((r) => `   ('${r.signature}','${r.fingerprint}','${r.grantees}')`);
    process.stderr.write(
      'FINGERPRINT VALUES\n' +
        lines.join(',\n') +
        '\nCONSTRAINT ' +
        (await liveConstraintFingerprint(w.f.owner)) +
        '\n',
    );
  }
  expect(live.map((r) => ({ ...r }))).toEqual(byName(fileFingerprints()).map((r) => ({ ...r })));
  expect(await liveConstraintFingerprint(w.f.owner)).toBe(fileConstraintFingerprint());
  // The trigger check is the third plain query in the file. The query lists exactly the guarded functions.
  expect(await liveTriggerCheck(w.f.owner)).toBe(true);
  expect(live.map((r) => r.signature)).toEqual(byName(fileFingerprints()).map((r) => r.signature));
  // Grants at the base: only the five entry points that the application calls are granted to the runtime login.
  const granted = live.filter((r) => r.grantees === 'corridra_runtime').map((r) => r.signature);
  expect(granted.sort()).toEqual(
    [
      'app.customer_organisation_link_decide(uuid,jsonb)',
      'app.customer_organisation_link_queue(text,uuid,integer)',
      'app.customer_organisation_link_review(uuid)',
      'customer.organisation_link_command(uuid,text,jsonb)',
      'customer.organisation_link_search(uuid,text)',
    ].sort(),
  );
  // The guard does not use pg_get_functiondef.
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(
    new URL('../../packages/db/customer-real-use-migrations/' + LADDER_FILE, import.meta.url),
    'utf8',
  );
  expect(sql.replace(/^\s*--.*$/gm, '')).not.toMatch(/pg_get_functiondef/);
  expect(await appliedNames()).toHaveLength(12);
  expect(await reportLine()).toBe('customer_real_use_migrations: 12 applied');
  // The file that carries these values is in the ladder directory, waiting to be applied.
  openLadder();
  expect(
    await readdir(new URL('../../packages/db/customer-real-use-migrations/', import.meta.url)),
  ).toContain(LADDER_FILE);
});

test('a changed applied file is refused before any statement runs', async () => {
  openLadder();
  // The new file is visible to the migrator, so the refusal below is a refusal with a file waiting.
  expect(
    await readdir(new URL('../../packages/db/customer-real-use-migrations/', import.meta.url)),
  ).toContain(LADDER_FILE);
  const before = await q(
    "SELECT sha256 FROM customer_real_use_migrations.applied WHERE name='0012_participant_invitation_email.sql'",
  );
  await q(
    "UPDATE customer_real_use_migrations.applied SET sha256=$1 WHERE name='0012_participant_invitation_email.sql'",
    ['0'.repeat(64)],
  );
  try {
    await expect(migrateCustomerRealUse(w.f.owner)).rejects.toThrow(
      'Customer real-use migration history mismatch',
    );
    expect(await appliedNames()).not.toContain(LADDER_FILE);
    expect(await attemptsTable()).toBeNull();
  } finally {
    await q(
      "UPDATE customer_real_use_migrations.applied SET sha256=$1 WHERE name='0012_participant_invitation_email.sql'",
      [before.rows[0].sha256],
    );
  }
  expect(await appliedNames()).toHaveLength(12);
});

// A change to the live text, settings, security mode, volatility or grants of any guarded function stops the file.
async function refusal(message: string) {
  await expect(migrateCustomerRealUse(w.f.owner)).rejects.toThrow(message);
  expect(await appliedNames()).not.toContain(LADDER_FILE);
  expect(await attemptsTable()).toBeNull();
}
const name = (signature: string) => signature.split('(')[0]!;
test('each guard refuses a changed body and leaves nothing applied', async () => {
  openLadder();
  for (const signature of nine()) {
    const original = (await q('SELECT pg_get_functiondef($1::regprocedure) d', [signature])).rows[0]
      .d as string;
    const at = original.lastIndexOf('$function$');
    await q(original.slice(0, at) + '\n-- drift\n' + original.slice(at));
    try {
      await refusal('Real-use prerequisite function differs: ' + name(signature));
    } finally {
      await q(original);
    }
  }
  const live = byName(await liveFingerprints(w.f.owner));
  expect(live.map((r) => r.fingerprint)).toEqual(
    byName(fileFingerprints()).map((r) => r.fingerprint),
  );
});

test('each guard refuses changed settings, security mode, volatility or grants', async () => {
  openLadder();
  for (const signature of nine()) {
    const info = (
      await q('SELECT provolatile v FROM pg_proc WHERE oid=$1::regprocedure', [signature])
    ).rows[0];
    const flip = info.v === 'v' ? 'STABLE' : 'VOLATILE';
    const back = info.v === 'v' ? 'VOLATILE' : info.v === 's' ? 'STABLE' : 'IMMUTABLE';
    const mutations: [string, string][] = [
      [
        `ALTER FUNCTION ${signature} SET search_path TO public`,
        `ALTER FUNCTION ${signature} SET search_path=pg_catalog`,
      ],
      [
        `ALTER FUNCTION ${signature} SECURITY INVOKER`,
        `ALTER FUNCTION ${signature} SECURITY DEFINER`,
      ],
      [`ALTER FUNCTION ${signature} ${flip}`, `ALTER FUNCTION ${signature} ${back}`],
    ];
    for (const [change, restore] of mutations) {
      await q(change);
      try {
        await refusal('Real-use prerequisite function differs: ' + name(signature));
      } finally {
        await q(restore);
      }
    }
  }
  // Grants: a new grant on a private function, and a removed grant on an entry point.
  await q(
    'GRANT EXECUTE ON FUNCTION customer_private.organisation_link_candidates(uuid) TO corridra_runtime',
  );
  try {
    await refusal(
      'Real-use prerequisite function differs: customer_private.organisation_link_candidates',
    );
  } finally {
    await q(
      'REVOKE EXECUTE ON FUNCTION customer_private.organisation_link_candidates(uuid) FROM corridra_runtime',
    );
  }
  await q(
    'REVOKE EXECUTE ON FUNCTION app.customer_organisation_link_review(uuid) FROM corridra_runtime',
  );
  try {
    await refusal('Real-use prerequisite function differs: app.customer_organisation_link_review');
  } finally {
    await q(
      'GRANT EXECUTE ON FUNCTION app.customer_organisation_link_review(uuid) TO corridra_runtime',
    );
  }
  const live = byName(await liveFingerprints(w.f.owner));
  expect(live.map((r) => [r.fingerprint, r.grantees])).toEqual(
    byName(fileFingerprints()).map((r) => [r.fingerprint, r.grantees]),
  );
});

test('a missing function, a changed constraint and a changed trigger are refused with their own message', async () => {
  openLadder();
  await q(
    'ALTER FUNCTION customer.organisation_link_search(uuid,text) RENAME TO organisation_link_search_moved',
  );
  try {
    await refusal('Real-use prerequisite function differs: customer.organisation_link_search');
  } finally {
    await q(
      'ALTER FUNCTION customer.organisation_link_search_moved(uuid,text) RENAME TO organisation_link_search',
    );
  }
  const constraint = 'ALTER TABLE customer_private.organisation_link_evidence';
  await q(`${constraint} DROP CONSTRAINT organisation_link_evidence_url_check`);
  await q(
    `${constraint} ADD CONSTRAINT organisation_link_evidence_url_check CHECK(url IS NULL OR (length(url)<=500 AND url ~ '^https://'))`,
  );
  try {
    await refusal('Real-use prerequisite constraint differs: organisation_link_evidence.url');
  } finally {
    await q(`${constraint} DROP CONSTRAINT organisation_link_evidence_url_check`);
    await q(
      `${constraint} ADD CONSTRAINT organisation_link_evidence_url_check CHECK(url IS NULL OR (length(url)<=200 AND url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$'))`,
    );
  }
  await q(
    'ALTER TABLE customer_private.organisation_link DISABLE TRIGGER organisation_link_ledger_guard',
  );
  try {
    await refusal('Real-use prerequisite trigger differs: organisation_link_ledger_guard');
  } finally {
    await q(
      'ALTER TABLE customer_private.organisation_link ENABLE TRIGGER organisation_link_ledger_guard',
    );
  }
  // After every restore the live values are the file values again, so the constraint fingerprint also ignores layout.
  expect(await liveConstraintFingerprint(w.f.owner)).toBe(fileConstraintFingerprint());
  expect(byName(await liveFingerprints(w.f.owner)).map((r) => r.fingerprint)).toEqual(
    byName(fileFingerprints()).map((r) => r.fingerprint),
  );
});

test('the three lifecycle installers refuse while the new file is present but unapplied', async () => {
  openLadder();
  const message = 'The customer real-use schema is not current';
  await expect(migrateCustomerWorkspaceLifecycle(w.f.owner)).rejects.toThrow(message);
  await expect(migrateCustomerAccountLifecycle(w.f.owner)).rejects.toThrow(message);
  await expect(migrateCustomerRequestWithdrawal(w.f.owner)).rejects.toThrow(message);
});

let before: {
  tables: Record<string, string>;
  functions: Map<string, string>;
  cross: Record<string, string>;
};
test('installing on a populated database changes no existing row and replaces exactly the nine functions', async () => {
  before = {
    tables: await tableHashes(),
    functions: await functionHashes(),
    cross: { ...w.crossRows },
  };
  expect(Object.keys(before.cross).sort()).toEqual(['LX', 'LX2', 'LX3']);
  await w.install();
  const applied = await appliedNames();
  expect(applied).toHaveLength(13);
  expect(applied[12]).toBe(LADDER_FILE);
  expect(
    (
      await q('SELECT sha256 FROM customer_real_use_migrations.applied WHERE name=$1', [
        LADDER_FILE,
      ])
    ).rows[0].sha256,
  ).toBe(ladderHash());
  expect(await reportLine()).toBe('customer_real_use_migrations: 13 applied');
  // Every pre-existing row of every table, including the link tables, the catalogue and the profile revisions.
  const after = await tableHashes();
  for (const [table, hash] of Object.entries(before.tables)) expect(after[table], table).toBe(hash);
  expect(Object.keys(after).sort()).toEqual(
    [
      ...Object.keys(before.tables),
      'customer_private.organisation_link_redaction',
      'customer_private.organisation_link_search_attempt',
      'customer_private.organisation_suppression',
    ].sort(),
  );
  const empty = md5Empty;
  for (const table of [
    'organisation_link_redaction',
    'organisation_link_search_attempt',
    'organisation_suppression',
  ])
    expect(after['customer_private.' + table]).toBe(empty);
  // The cross-provenance ledger rows, their claims and events are the same bytes.
  expect(await w.crossHash(w.ws.WR3!)).toBe(before.cross.LX);
  expect(await w.crossHash(w.ws.WR4!)).toBe(before.cross.LX2);
  expect(await w.crossHash(w.ws.WS3!)).toBe(before.cross.LX3);
  const functions = await functionHashes();
  const changed = [...functions]
    .filter(([sig, hash]) => before.functions.has(sig) && before.functions.get(sig) !== hash)
    .map(([sig]) => sig);
  expect(changed.sort()).toEqual(nine().sort());
  const added = [...functions.keys()].filter((sig) => !before.functions.has(sig)).sort();
  expect(added).toEqual(
    [
      'customer_private.organisation_link_redacted(uuid)',
      'customer_private.organisation_link_same_context(boolean,boolean)',
      'customer_private.organisation_link_search_attempt_guard()',
      'customer_private.organisation_link_suppressed(uuid)',
    ].sort(),
  );
  expect([...before.functions.keys()].filter((sig) => !functions.has(sig))).toEqual([]);
  // The eight-argument ingest function and the expiry function are not touched.
  for (const sig of [
    'app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text)',
    'customer_private.organisation_link_expiry()',
  ])
    expect(functions.get(sig), sig).toBe(before.functions.get(sig));
  // Grants of the replaced functions survive the replacement.
  const grants = byName(await liveFingerprints(w.f.owner)).map((r) => [r.signature, r.grantees]);
  expect(grants).toEqual(byName(fileFingerprints()).map((r) => [r.signature, r.grantees]));
});
const md5Empty = 'd41d8cd98f00b204e9800998ecf8427e';

test('a repeat install applies nothing and changes nothing', async () => {
  const tables = await tableHashes();
  const functions = await functionHashes();
  const applied = (
    await q('SELECT name,sha256,applied_at FROM customer_real_use_migrations.applied ORDER BY name')
  ).rows;
  await migrateCustomerRealUse(w.f.owner);
  expect(await tableHashes()).toEqual(tables);
  expect([...(await functionHashes())]).toEqual([...functions]);
  expect(
    (
      await q(
        'SELECT name,sha256,applied_at FROM customer_real_use_migrations.applied ORDER BY name',
      )
    ).rows,
  ).toEqual(applied);
  expect(await appliedNames()).toHaveLength(13);
});

test('the three lifecycle installers run once the file is applied', async () => {
  expect(await appliedNames()).toContain(LADDER_FILE);
  await migrateCustomerWorkspaceLifecycle(w.f.owner);
  await migrateCustomerAccountLifecycle(w.f.owner);
  await migrateCustomerRequestWithdrawal(w.f.owner);
});

test('the runtime and auth logins cannot read or write the new tables or call the new helpers', async () => {
  for (const pool of [w.f.runtime, w.f.auth]) {
    for (const table of [
      'organisation_suppression',
      'organisation_link_redaction',
      'organisation_link_search_attempt',
    ])
      for (const sql of [
        `SELECT * FROM customer_private.${table}`,
        `INSERT INTO customer_private.${table} DEFAULT VALUES`,
        `UPDATE customer_private.${table} SET id=id`,
        `DELETE FROM customer_private.${table}`,
      ])
        await expect(pool.query(sql), sql).rejects.toMatchObject({ code: '42501' });
    for (const sql of [
      'SELECT customer_private.organisation_link_same_context(true,true)',
      `SELECT customer_private.organisation_link_suppressed('${randomUUID()}')`,
      `SELECT customer_private.organisation_link_redacted('${randomUUID()}')`,
      'SELECT customer_private.organisation_link_search_attempt_guard()',
    ])
      await expect(pool.query(sql), sql).rejects.toMatchObject({ code: '42501' });
  }
  // Row security is on for each table and no policy exists, so nothing is visible even to a role that gains a grant.
  const flags = await q(
    `SELECT c.relname,c.relrowsecurity,(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::int policies
     FROM pg_class c WHERE c.oid IN ('customer_private.organisation_suppression'::regclass,'customer_private.organisation_link_redaction'::regclass,'customer_private.organisation_link_search_attempt'::regclass) ORDER BY 1`,
  );
  expect(flags.rows.map((r) => [r.relrowsecurity, r.policies])).toEqual([
    [true, 0],
    [true, 0],
    [true, 0],
  ]);
});

test('no application role and not PUBLIC holds any privilege on the new tables or helpers (ACL view)', async () => {
  // has_table_privilege and has_function_privilege read the ACL itself, without the schema USAGE the logins also lack.
  const tables = [
    'organisation_suppression',
    'organisation_link_redaction',
    'organisation_link_search_attempt',
  ];
  const functions = [
    'customer_private.organisation_link_same_context(boolean,boolean)',
    'customer_private.organisation_link_suppressed(uuid)',
    'customer_private.organisation_link_redacted(uuid)',
    'customer_private.organisation_link_search_attempt_guard()',
  ];
  for (const role of [
    'corridra_runtime',
    'corridra_auth',
    'corridra_runtime_local',
    'corridra_auth_local',
    'public',
  ]) {
    for (const table of tables) {
      const held = await q(
        `SELECT has_table_privilege($1,$2,'SELECT') s,has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,
          has_table_privilege($1,$2,'DELETE') d,has_table_privilege($1,$2,'TRUNCATE') t,has_table_privilege($1,$2,'REFERENCES') r,has_table_privilege($1,$2,'TRIGGER') g`,
        [role, 'customer_private.' + table],
      );
      expect(held.rows[0], `${role} on ${table}`).toEqual({
        s: false,
        i: false,
        u: false,
        d: false,
        t: false,
        r: false,
        g: false,
      });
    }
    for (const signature of functions)
      expect(
        (await q("SELECT has_function_privilege($1,$2,'EXECUTE') x", [role, signature])).rows[0].x,
        `${role} on ${signature}`,
      ).toBe(false);
  }
});

test('the evidence URL rule follows the side of the workspace', async () => {
  const real = w.link('alice-r', 'real');
  const stateBefore = await real.view({ workspaceId: w.ws.WR1 });
  const claimId = stateBefore.claim!.id!;
  const withUrl = async (url: string | null, expectedVersion: number) =>
    real.command({
      action: 'add_evidence',
      commandId: randomUUID(),
      workspaceId: w.ws.WR1,
      claimId,
      expectedVersion,
      evidenceKind: 'WEBSITE_STATEMENT',
      statement: 'The company website describes our products',
      url,
    });
  // A real tenant accepts a real https address end to end, and still accepts the old reserved host.
  const first = await withUrl('https://acme-gmbh.de/about', stateBefore.claim!.version!);
  expect(first.claim!.evidence!.map((e) => e.url)).toEqual(['https://acme-gmbh.de/about']);
  const second = await withUrl('https://business.test/catalogue', first.claim!.version!);
  expect(second.claim!.evidence!.map((e) => e.url)).toContain('https://business.test/catalogue');
  // A synthetic tenant still refuses it in the database, and still accepts the reserved host.
  const raw = new (class extends CustomerOrganisationLinkService {
    command2(payload: Record<string, unknown>) {
      return this.transaction((db) =>
        db.query('SELECT customer.organisation_link_command($1,$2,$3)', [
          randomUUID(),
          'add_evidence',
          JSON.stringify(payload),
        ]),
      );
    }
  })(w.f.runtime, w.f.auth, syntheticOptions, async () => ({
    subject: 'link-a-alice-s',
    emailVerified: true,
    expiresAt: new Date(Date.now() + 3600000),
  }));
  const syntheticView = await w.link('alice-s', 'synthetic').view({ workspaceId: w.ws.WS1 });
  const base = {
    workspaceId: w.ws.WS1,
    claimId: syntheticView.claim!.id!,
    expectedVersion: syntheticView.claim!.version!,
    evidenceKind: 'WEBSITE_STATEMENT',
    statement: 'Synthetic statement that names a site',
  };
  await expect(raw.command2({ ...base, url: 'https://acme-gmbh.de/about' })).rejects.toThrow(
    /Invalid company link request/,
  );
  await raw.command2({ ...base, url: 'https://registry.example.invalid/syn-0001' });
  // The constraint itself, as table owner, in a transaction that is rolled back.
  const insert = async (workspaceKey: string, claim: string, url: string) => {
    const db = await w.f.owner.connect();
    try {
      await db.query('BEGIN');
      const event = randomUUID();
      const actor = (
        await db.query(
          'SELECT created_by FROM customer_private.organisation_link_claim WHERE id=$1',
          [claim],
        )
      ).rows[0].created_by;
      const head = (
        await db.query(
          'SELECT seq,state FROM customer_private.organisation_link_event WHERE claim_id=$1 ORDER BY seq DESC LIMIT 1',
          [claim],
        )
      ).rows[0];
      await db.query(
        "SELECT customer_private.organisation_link_append($1,$2,'evidence_added',$3,$4,NULL,NULL,NULL,NULL)",
        [event, claim, head.state, actor],
      );
      await db.query(
        "INSERT INTO customer_private.organisation_link_evidence(tenant_id,claim_id,event_id,position,kind,statement,url,created_by) VALUES($1,$2,$3,7,'WEBSITE_STATEMENT','Synthetic statement for the check',$4,$5)",
        [w.ws[workspaceKey], claim, event, url, actor],
      );
      return 'accepted';
    } catch (error) {
      return (error as Error).message;
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };
  const realClaim = claimId;
  const syntheticClaim = syntheticView.claim!.id!;
  expect(await insert('WR1', realClaim, 'https://acme-gmbh.de/about')).toBe('accepted');
  expect(await insert('WR1', realClaim, 'https://business.test/x')).toBe('accepted');
  expect(await insert('WS1', syntheticClaim, 'https://acme-gmbh.de/about')).toMatch(
    /organisation_link_evidence_url_check/,
  );
  expect(await insert('WS1', syntheticClaim, 'https://registry.example.invalid/x')).toBe(
    'accepted',
  );
  for (const bad of [
    'https://user@acme-gmbh.de/about',
    'https://acme-gmbh.de/a b',
    'https://acme-gmbh.de/a\tb',
    'http://acme-gmbh.de/about',
  ])
    expect(await insert('WR1', realClaim, bad), bad).toMatch(
      /organisation_link_evidence_url_check/,
    );
  for (const bad of [
    'https://user@registry.example.invalid/x',
    'https://registry.example.invalid/a b',
  ])
    expect(await insert('WS1', syntheticClaim, bad), bad).toMatch(
      /organisation_link_evidence_url_check/,
    );
  // The same through the command, for both sides.
  await expect(
    withUrl('https://user@acme-gmbh.de/about', second.claim!.version!),
  ).rejects.toThrow();
});

test('removed member access (real-use 0014) is the fourteenth file, replaces functions only and is repeatable', async () => {
  expect(await appliedNames()).toHaveLength(13);
  const tables = await tableHashes();
  (globalThis as { __removedHide?: boolean }).__removedHide = false;
  await migrateCustomerRealUse(w.f.owner);
  const applied = await appliedNames();
  expect(applied).toHaveLength(14);
  expect(applied[13]).toMatch(/^0014_removed_member_access/);
  expect(await reportLine()).toBe('customer_real_use_migrations: 14 applied');
  // Functions only: every row of every table is the same bytes.
  expect(await tableHashes()).toEqual(tables);
  await migrateCustomerRealUse(w.f.owner);
  expect(await appliedNames()).toHaveLength(14);
  expect(await tableHashes()).toEqual(tables);
});

test('participant fee status (real-use 0015) is the fifteenth file, is found by the installer with no workflow change and adds one function', async () => {
  expect(await appliedNames()).toHaveLength(14);
  const tables = await tableHashes();
  expect(
    (await q("SELECT to_regprocedure('customer.own_programme_fee_status(uuid)')::text t")).rows[0]
      .t,
  ).toBeNull();
  (globalThis as { __feeHide?: boolean }).__feeHide = false;
  await migrateCustomerRealUse(w.f.owner);
  const applied = await appliedNames();
  expect(applied).toHaveLength(15);
  expect(applied[14]).toMatch(/^0015_participant_fee_status/);
  expect(await reportLine()).toBe('customer_real_use_migrations: 15 applied');
  expect(
    (await q("SELECT to_regprocedure('customer.own_programme_fee_status(uuid)')::text t")).rows[0]
      .t,
  ).toBe('customer.own_programme_fee_status(uuid)');
  // One function only: every row of every table is the same bytes.
  expect(await tableHashes()).toEqual(tables);
  await migrateCustomerRealUse(w.f.owner);
  expect(await appliedNames()).toHaveLength(15);
  expect(await tableHashes()).toEqual(tables);
});

test('participant payment declaration (real-use 0016) is the sixteenth file, adds only its own tables and functions and is repeatable', async () => {
  expect(await appliedNames()).toHaveLength(15);
  const tables = await tableHashes();
  const present = async () =>
    (await q("SELECT to_regclass('customer_private.programme_payment_declaration')::text t"))
      .rows[0].t;
  expect(await present()).toBeNull();
  (globalThis as { __paymentHide?: boolean }).__paymentHide = false;
  await migrateCustomerRealUse(w.f.owner);
  const applied = await appliedNames();
  expect(applied).toHaveLength(16);
  expect(applied[15]).toMatch(/^0016_participant_payment_declaration/);
  expect(await reportLine()).toBe('customer_real_use_migrations: 16 applied');
  expect(await present()).toBe('customer_private.programme_payment_declaration');
  // Every existing table keeps the same bytes; the three new tables start empty.
  const after = await tableHashes();
  for (const [name, hash] of Object.entries(tables)) expect(after[name]).toBe(hash);
  const added = Object.keys(after).filter((k) => !(k in tables));
  expect(added.sort()).toEqual([
    'customer_private.programme_payment_command',
    'customer_private.programme_payment_decision',
    'customer_private.programme_payment_declaration',
  ]);
  await migrateCustomerRealUse(w.f.owner);
  expect(await appliedNames()).toHaveLength(16);
  expect(await tableHashes()).toEqual(after);
});

test('experience outreach counts (real-use 0017) is the seventeenth file, is found by the installer with no workflow change and adds a column, a trigger and four functions', async () => {
  expect(await appliedNames()).toHaveLength(16);
  const before = (
    await q(
      "SELECT encode(sha256(convert_to(pg_get_functiondef('app.delivery_report(text,text)'::regprocedure),'UTF8')),'hex') h",
    )
  ).rows[0].h;
  expect(before).toBe('40ff104e2be96a328ee4d8002f474f05cc1bcc1eeef6b896952d4208dc77cad4');
  (globalThis as { __outreachHide?: boolean }).__outreachHide = false;
  await migrateCustomerRealUse(w.f.owner);
  const applied = await appliedNames();
  expect(applied).toHaveLength(17);
  expect(applied[16]).toMatch(/^0017_experience_outreach_counts/);
  expect(await reportLine()).toBe('customer_real_use_migrations: 17 applied');
  const after = (
    await q(
      "SELECT pg_get_functiondef('app.delivery_report(text,text)'::regprocedure) d, to_regprocedure('app.delivery_report_v1(text,text)')::text v",
    )
  ).rows[0];
  expect(after.d).toContain('e.outreach');
  expect(after.v).toBe('app.delivery_report_v1(text,text)');
  await migrateCustomerRealUse(w.f.owner);
  expect(await appliedNames()).toHaveLength(17);
});
