import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NEW_FILES,
  appliedNames,
  fileSql,
  hideNewFiles,
  openNewFiles,
} from './removed-member-support';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import {
  assertNoneBehind,
  refreshInstalledOptionalModules,
} from '../../packages/db/src/customer-optional-refresh';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCustomerRequestDetails } from '../../packages/db/src/customer-detail-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../../packages/db/src/customer-mission-draft-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeContext } from '../../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerProgrammeEconomics } from '../../packages/db/src/customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from '../../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerProgrammeTemplates } from '../../packages/db/src/customer-programme-templates-migrate';
import { migrateCustomerProgrammePricing } from '../../packages/db/src/customer-programme-pricing-migrate';
import { migrateCustomerMissionShares } from '../../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerAdmission } from '../../packages/db/src/customer-admission-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerOrganisationLinks } from '../../packages/db/src/customer-organisation-link-migrate';
import { migrateCustomerRequestAdmission } from '../../packages/db/src/customer-request-admission-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { migrateCustomerServiceRequests } from '../../packages/db/src/customer-service-request-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';
import { migrateCustomerInvoicing } from '../../packages/db/src/customer-invoicing-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';

const BASE_INSTALLERS = {
  migrateCustomerAuthority,
  migrateCustomerSavedMissions,
  migrateCustomerCompanies,
  migrateCustomerDecisions,
  migrateCustomerDelivery,
  migrateCustomerRequestDetails,
  migrateCustomerOrganisationProfiles,
  migrateCustomerMissionDrafts,
  migrateCustomerProgrammes,
  migrateCustomerParticipants,
  migrateCustomerProgrammeContext,
  migrateCustomerProgrammeEconomics,
  migrateCustomerProgrammeCoordination,
  migrateCustomerProgrammeTemplates,
  migrateCustomerProgrammePricing,
  migrateCustomerMissionShares,
  migrateCustomerAdmission,
  migrateCustomerMemberRoles,
  migrateCustomerOrganisationLinks,
  migrateCustomerRequestAdmission,
  migrateCustomerProgrammeTerms,
  migrateCustomerServiceRequests,
  migrateCustomerBilling,
  migrateCustomerInvoicing,
  migrateCommercialReadiness,
  migrateCustomerProgrammeProjections,
  migrateCustomerBooks,
  migrateCustomerDecisionCards,
};

// Removed members, the verified production ladder (install run 42950597177, 11 Nov 2026): customer migrations 3, real-use 13,
// commercial readiness 10, decision cards 1, programme projections 2 (in the base run: 2 to 3), move records 1, request withdrawal 2, mission mail 3, notifications 5, response
// revision not installed. The fixture below is built to exactly those counts with the new files hidden. One run is then made the
// way the install job makes it for apply=yes with real_use_action=install: the base installers in the order the script lists
// them (read from the script, so the list cannot drift), the real-use migration, the refresh, the report, the refresh again and
// the refusal check. It ends green, every line moves as it should and nothing else changes: no control row, no switch, no
// grant, no other registry. The script itself cannot be started here (it insists on the Frankfurt host and the migrator login),
// so this is its code path, step by step; the static installer suite proves the script wires exactly these steps.
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

type Pool = Awaited<ReturnType<typeof fixture>>['owner'];
const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
const issuer =
  'https://ep-removed-production.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let f: Awaited<ReturnType<typeof fixture>>;

// The base installers, in the script's own order.
const baseInstallers = () => {
  const slice = script.slice(
    script.indexOf('const installers'),
    script.indexOf('const pool = databasePool'),
  );
  return [...slice.matchAll(/\['([^']+)', (migrate\w+)\]/g)].map((m) => ({
    label: m[1]!,
    install: BASE_INSTALLERS[m[2] as keyof typeof BASE_INSTALLERS] as (pool: Pool) => Promise<void>,
    name: m[2]!,
  }));
};
// Every migration registry that exists, with its count (the core one included).
async function registries(owner: Pool) {
  const schemas = (
    await owner.query(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE '%\\_migrations' OR nspname='migrations' ORDER BY 1",
    )
  ).rows.map((r) => r.nspname as string);
  const out: Record<string, number> = {};
  for (const schema of schemas) {
    if (
      !(await owner.query('SELECT to_regclass($1) IS NOT NULL AS p', [schema + '.applied'])).rows[0]
        .p
    )
      continue;
    out[schema] = (await owner.query(`SELECT count(*)::int AS n FROM ${schema}.applied`)).rows[0].n;
  }
  return out;
}
// Controls and configuration tables, rows and timestamps included.
async function controls(owner: Pool) {
  const tables = (
    await owner.query(
      `SELECT table_schema||'.'||table_name AS t FROM information_schema.tables
       WHERE table_schema IN ('app','customer','customer_private','identity') AND table_type='BASE TABLE'
       AND (table_name LIKE '%\\_control' OR table_name LIKE '%\\_configuration' OR table_name='configuration') ORDER BY 1`,
    )
  ).rows.map((r) => r.t as string);
  const out: Record<string, unknown[]> = {};
  for (const table of tables)
    out[table] = (
      await owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
    ).rows.map((r) => r.row);
  return out;
}
// Grants: the access list of every function and table, the column grants, and every policy but the one this change alters.
async function grants(owner: Pool) {
  const functions = (
    await owner.query(
      `SELECT p.oid::regprocedure::text AS s,coalesce(p.proacl::text,'') AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1`,
    )
  ).rows;
  const tables = (
    await owner.query(
      `SELECT c.oid::regclass::text AS s,coalesce(c.relacl::text,'') AS acl,c.relrowsecurity AS rls,
        coalesce((SELECT string_agg(a.attname||':'||a.attacl::text,',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL),'') AS cols
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='r' AND n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1`,
    )
  ).rows;
  const policies = (
    await owner.query(
      `SELECT c.oid::regclass::text||'.'||p.polname AS s,md5(concat_ws('|',p.polcmd,p.polpermissive,p.polroles::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))) AS h
       FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE p.polname<>'inbox_customer_read' ORDER BY 1`,
    )
  ).rows;
  return { functions, tables, policies };
}
const functionNames = async (owner: Pool) =>
  (
    await owner.query(
      `SELECT p.oid::regprocedure::text AS s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','customer','customer_private','identity') ORDER BY 1`,
    )
  ).rows.map((r) => r.s as string);

// The one run: apply=yes, real_use_action=install, every other action unchanged.
async function singleRun(owner: Pool) {
  const lines: string[] = [];
  for (const installer of baseInstallers()) await installer.install(owner);
  await migrateCustomerRealUse(owner);
  const first = await refreshInstalledOptionalModules(owner);
  for (const row of first) lines.push(`optional module ${row.module}: ${row.state}`);
  const after = await registries(owner);
  assertNoneBehind(await refreshInstalledOptionalModules(owner));
  return { first, lines, after };
}

beforeAll(async () => {
  hideNewFiles();
  f = await fixture();
  const owner = f.owner;
  // The base run production has had, then real-use 13, then the four optional modules at their production counts.
  for (const installer of baseInstallers()) await installer.install(owner);
  await migrateCustomerRealUse(owner);
  await migrateCustomerRequestWithdrawal(owner);
  await migrateCustomerMoves(owner);
  await migrateCustomerMissionMail(owner);
  await migrateCustomerNotifications(owner);
  // Controls with real rows in them, so that "untouched" means something.
  await pinCustomerAuthority(owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(owner, {
    enabled: true,
    reason: 'Owner approved real work for the production ladder test',
  });
  await configureMoveRecords(owner, {
    enabled: true,
    reason: 'Owner approved Move records for the production ladder test',
  });
}, 1200000);
afterAll(async () => {
  await f?.close();
});

describe('the verified production ladder', () => {
  const production = {
    customer_migrations: 3,
    customer_real_use_migrations: 13,
    commercial_readiness_migrations: 10,
    customer_decision_card_migrations: 1,
    // The projection module is in the base run: it moves by one on every apply=yes. N is read from the fixture below.
    customer_programme_projection_migrations: 2,
    customer_move_migrations: 1,
    customer_request_withdrawal_migrations: 2,
    customer_mission_mail_migrations: 3,
    customer_notification_migrations: 5,
  };
  let before: Awaited<ReturnType<typeof registries>>;
  let controlsBefore: Awaited<ReturnType<typeof controls>>;
  let grantsBefore: Awaited<ReturnType<typeof grants>>;
  let namesBefore: string[];

  test('the fixture has exactly the production counts, and response revision is not installed', async () => {
    fileSql('realUse');
    before = await registries(f.owner);
    for (const [registry, count] of Object.entries(production))
      expect(before[registry], registry).toBe(count);
    expect(before.recipient_response_revision_migrations).toBeUndefined();
    controlsBefore = await controls(f.owner);
    grantsBefore = await grants(f.owner);
    namesBefore = await functionNames(f.owner);
    expect(Object.keys(controlsBefore).length).toBeGreaterThan(5);
  });

  test('one apply=yes run with real_use_action=install ends green and every named line moves by exactly one file (readiness by two)', async () => {
    openNewFiles();
    const run = await singleRun(f.owner);
    expect(run.first.map((r) => `${r.module}:${r.state}`)).toEqual([
      'request withdrawal:advanced',
      'move records:advanced',
      'mission mail:advanced',
      'notifications:advanced',
    ]);
    const now = await registries(f.owner);
    const expected = { ...before };
    for (const [registry, n] of Object.entries({
      customer_migrations: 4,
      customer_real_use_migrations: 14,
      commercial_readiness_migrations: 12,
      customer_decision_card_migrations: 2,
      customer_programme_projection_migrations: 3,
      customer_move_migrations: 2,
      customer_request_withdrawal_migrations: 3,
      customer_mission_mail_migrations: 4,
      customer_notification_migrations: 6,
    }))
      expected[registry] = n;
    expect(now).toEqual(expected);
    // Each module gained its own new file and kept its old ones.
    for (const key of [
      'customer',
      'realUse',
      'readiness',
      'inbox',
      'decisionCards',
      'projection',
      'move',
      'withdrawal',
      'mail',
      'notifications',
    ] as const)
      expect(await appliedNames(f.owner, NEW_FILES[key].registry), key).toContain(
        NEW_FILES[key].name,
      );
  }, 900000);

  test('no control row, switch or timestamp changed', async () => {
    fileSql('realUse');
    const now = await controls(f.owner);
    for (const table of Object.keys(controlsBefore))
      expect(now[table], table).toEqual(controlsBefore[table]);
    // A control table that is new (request withdrawal starts one) is closed.
    for (const table of Object.keys(now))
      if (!(table in controlsBefore))
        expect(JSON.stringify(now[table]), table).not.toMatch(/"enabled": ?true/);
    expect(
      (await f.owner.query('SELECT customer_private.request_withdrawal_open() AS open')).rows[0]
        .open,
    ).toBe(false);
  });

  test('no grant, no policy other than inbox_customer_read and no table access list changed; the only new functions are the helpers', async () => {
    fileSql('realUse');
    const now = await grants(f.owner);
    const known = new Set(namesBefore);
    expect(now.functions.filter((r) => known.has(r.s))).toEqual(grantsBefore.functions);
    expect(now.tables).toEqual(grantsBefore.tables);
    expect(now.policies).toEqual(grantsBefore.policies);
    const added = (await functionNames(f.owner)).filter((s) => !known.has(s));
    expect(added.sort()).toEqual(
      [
        'app.inbox_notice_visible(uuid,text,text,jsonb)',
        'customer_private.link_workspace_current(uuid,uuid,uuid)',
        'customer_private.request_author_current(uuid)',
        'customer_private.workspace_ids_current(uuid)',
        'customer_private.workspace_member_current(uuid,uuid)',
      ].sort(),
    );
    // The new helpers are for nobody but the definers; the inbox function is for the reading role only.
    for (const s of added.filter((name) => name.startsWith('customer_private.')))
      expect(
        (
          await f.owner.query(
            "SELECT has_function_privilege('corridra_runtime',$1::regprocedure,'EXECUTE') AS r,has_function_privilege('corridra_auth',$1::regprocedure,'EXECUTE') AS a",
            [s],
          )
        ).rows[0],
        s,
      ).toEqual({ r: false, a: false });
    expect(
      (
        await f.owner.query(
          "SELECT has_function_privilege('corridra_runtime','app.inbox_notice_visible(uuid,text,text,jsonb)'::regprocedure,'EXECUTE') AS r,has_function_privilege('corridra_auth','app.inbox_notice_visible(uuid,text,text,jsonb)'::regprocedure,'EXECUTE') AS a,has_function_privilege('public','app.inbox_notice_visible(uuid,text,text,jsonb)'::regprocedure,'EXECUTE') AS p",
        )
      ).rows[0],
    ).toEqual({ r: true, a: false, p: false });
  });

  test('a second run changes nothing at all', async () => {
    fileSql('realUse');
    const registriesNow = await registries(f.owner);
    const controlsNow = await controls(f.owner);
    const run = await singleRun(f.owner);
    expect(run.first.map((r) => r.state)).toEqual(['current', 'current', 'current', 'current']);
    expect(await registries(f.owner)).toEqual(registriesNow);
    expect(await controls(f.owner)).toEqual(controlsNow);
  }, 900000);

  test('the script wires exactly these steps: the list it installs, then real-use, then the refresh, then the report and the check', () => {
    fileSql('realUse');
    const names = baseInstallers().map((i) => i.name);
    expect(names).toHaveLength(28);
    expect(names).toContain('migrateCustomerDecisionCards');
    expect(names).toContain('migrateCommercialReadiness');
    expect(names).not.toContain('migrateCustomerRealUse');
    const real = script.indexOf("if (v.REAL_USE_ACTION !== 'unchanged') {");
    expect(script.indexOf('const installers')).toBeLessThan(real);
    expect(script.indexOf('refreshInstalledOptionalModules(pool)', real)).toBeGreaterThan(
      script.indexOf('await migrateCustomerRealUse(pool);', real),
    );
    expect(script.indexOf("await report('After install');")).toBeLessThan(
      script.indexOf('assertNoneBehind('),
    );
  });
});
