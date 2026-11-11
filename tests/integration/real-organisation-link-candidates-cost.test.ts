import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { World } from './organisation-link-support';

// ADR-079 slice A, cost of the staff candidates. The reasons are tested on every organisation of the session side, so the
// ledger count, the side test and the suppression test must run only for the few organisations that have a reason. The
// bound is far above the time of a correct body and far below the time of one that repeats the ledger count for every
// organisation (about 25 seconds for this fixture on the body before this change), so a slow machine cannot trip it.
vi.hoisted(() => {
  (globalThis as { __linkHide?: boolean }).__linkHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    return (globalThis as { __linkHide?: boolean }).__linkHide &&
      String(path).includes('customer-real-use-migrations')
      ? names.filter((n) => !String(n).startsWith('0013_organisation_link_provenance_and_search'))
      : names;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

const organisations = 3000;
const ledgerPairs = 150;
const boundMs = 5000;
let w: World;
beforeAll(async () => {
  w = await World.build('corridra_integration');
  await w.install();
  const o = w.f.owner;
  // Many organisations on both sides, each with a current identifier, none matching the claims below.
  await o.query(
    `INSERT INTO app.organisation(id,name,country,synthetic)
     SELECT gen_random_uuid(),'Fixture '||(ARRAY['Alpha','Bravo','Delta','Echo'])[1+g%4]||' '||g||' GmbH','DE',(g%2=0) FROM generate_series(1,$1) g`,
    [organisations],
  );
  await o.query(
    `INSERT INTO app.public_identifier(organisation_id,identifier_type,identifier,domain,address,source_locator,observed_at,valid_until,synthetic)
     SELECT o.id,'registry',gen_random_uuid()::text,CASE WHEN o.synthetic THEN 'fx'||row_number() OVER ()||'.example.invalid' ELSE 'fx'||row_number() OVER ()||'.de' END,
      'Invented address','https://register.example-records.de/x',now()-interval '2 days',now()+interval '30 days',o.synthetic
     FROM app.organisation o WHERE o.name LIKE 'Fixture %'`,
  );
  // A ledger of a few hundred rows: one workspace linked and unlinked again to 150 different real organisations.
  const target = w.ws.WR5!;
  const revision = (
    await o.query(
      'SELECT id,version FROM customer_private.organisation_profile_revision WHERE tenant_id=$1 ORDER BY version DESC LIMIT 1',
      [target],
    )
  ).rows[0];
  const claim = (
    await o.query(
      `INSERT INTO customer_private.organisation_link_claim(tenant_id,profile_revision_id,profile_version,kind,name_key,country_code,note,created_by)
       VALUES($1,$2,$3,'PROPOSED_NEW','nonesuch','DE','Synthetic ledger fixture claim',$4) RETURNING id`,
      [target, revision.id, revision.version, w.principal['erin-r']],
    )
  ).rows[0].id;
  const linkable = (
    await o.query(
      'SELECT id FROM app.organisation WHERE NOT synthetic AND name LIKE $1 ORDER BY id LIMIT $2',
      ['Fixture %', ledgerPairs],
    )
  ).rows.map((r) => r.id);
  let version = 0;
  for (const id of linkable)
    for (const state of ['linked', 'unlinked'])
      await o.query(
        `INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor) VALUES($1,$2,$3,$4,$5,false,$6)`,
        [target, (version += 1), state, claim, id, w.f.users.reviewer.id],
      );
  // Open requests, so that a queue page has candidate counts to compute.
  for (let n = 0; n < 10; n += 1) {
    await w.workspace('CX' + n, 'cost' + n + '-r', 'real', 'Costco Handel ' + n + ' GmbH', null);
    await w.link('cost' + n + '-r', 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: w.ws['CX' + n],
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note: 'Review our company information',
    });
  }
  await o.query('ANALYZE');
}, 300000);
afterAll(async () => {
  // A body that is too slow may still be running when the test gives up. Stop it so the pools can close.
  await w?.f.owner.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active'",
  );
  await w?.close();
});
// Gives up at the bound, so a slow body fails the test with a plain message instead of running into the test timeout.
async function within<T>(label: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took more than ${boundMs} ms`)), boundMs);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

test('the candidates of one claim and a queue page are fast on a large catalogue and ledger', async () => {
  expect(
    Number((await w.f.owner.query('SELECT count(*)::int n FROM app.organisation')).rows[0].n),
  ).toBeGreaterThan(organisations);
  expect(
    Number(
      (await w.f.owner.query('SELECT count(*)::int n FROM customer_private.organisation_link'))
        .rows[0].n,
    ),
  ).toBeGreaterThanOrEqual(ledgerPairs * 2);
  await w.freshStaff();
  const started = Date.now();
  const review = await within(
    'The candidates of one claim',
    w.staff().review(w.rsCtx, w.claim.CR1!),
  );
  const reviewMs = Date.now() - started;
  expect(review.candidates.organisations.map((c) => c.id)).toEqual([w.org.OR1]);
  expect(review.candidates.workspaces.map((c) => c.claimId)).toEqual([w.claim.CR2]);
  expect(reviewMs).toBeLessThan(boundMs);
  await w.freshStaff();
  const queueStarted = Date.now();
  const queue = await within(
    'A queue page',
    w.staff().queue(w.rsCtx, { scope: 'open', pageSize: 20 }),
  );
  const queueMs = Date.now() - queueStarted;
  expect(queue.items.length).toBeGreaterThanOrEqual(10);
  expect(queueMs).toBeLessThan(boundMs);
  process.stderr.write(
    `COST review=${reviewMs}ms queue(${queue.items.length} claims)=${queueMs}ms bound=${boundMs}ms\n`,
  );
}, 120000);
