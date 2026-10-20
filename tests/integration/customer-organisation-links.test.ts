import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { accessFixture } from './access-fixture';
import { rawContext } from './support';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerOrganisationLinks } from '../../packages/db/src/customer-organisation-link-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import {
  CustomerOrganisationLinkService,
  StaffOrganisationLinkService,
  customerOrganisationLinkCommandInput,
  customerOrganisationLinksEnabled,
  organisationLinkLabel,
} from '../../packages/auth/src/customer-organisation-links';

// Invented provider-session fixtures exercise the real restricted SQL logins and the real staff roles.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-links-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina', 'hugo', 'iris', 'jack'];
let f: Awaited<ReturnType<typeof accessFixture>>;
let before: Awaited<ReturnType<typeof snapshot>>;
const ws: Record<string, string> = {};
const orgs: Record<string, string> = {};
const session = (person: string, ttl = 3600000): CustomerSession => ({
  subject: 'synthetic-links-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + ttl),
});
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const profiles = (person = 'alice') =>
  new CustomerOrganisationProfileService(f.runtime, f.auth, options, async () => session(person));
const roles = (person = 'alice') =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(person));
const links = (person = 'alice', ttl = 3600000) =>
  new CustomerOrganisationLinkService(f.runtime, f.auth, options, async () => session(person, ttl));
// Sends hostile payloads straight to the SQL command inside a real customer session.
class RawLinks extends CustomerOrganisationLinkService {
  raw(operation: string, payload: Record<string, unknown>) {
    return this.transaction((db) =>
      db.query('SELECT customer.organisation_link_command($1,$2,$3)', [
        randomUUID(),
        operation,
        JSON.stringify(payload),
      ]),
    );
  }
}
const raw = (person: string) =>
  new RawLinks(f.runtime, f.auth, options, async () => session(person));
const staff = () => new StaffOrganisationLinkService(f.runtime);
const reviewer = () => f.users.reviewer.ctx;
const details = (name: string, website: string | null, country = 'BD') => ({
  legalName: name,
  countryCode: country,
  website,
  commercialRoles: ['SUPPLIER'],
  sectors: ['Textiles'],
  sizeBand: '11-50',
  summary: 'Synthetic invented company used only for company link tests',
});
async function saveProfile(
  person: string,
  workspaceId: string,
  name: string,
  website: string | null,
  expectedVersion = 0,
  country = 'BD',
) {
  return profiles(person).command({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion,
    ...details(name, website, country),
    reason: 'Invented profile for the company link tests',
    acknowledged: true,
  });
}
const file = (
  person: string,
  workspaceId: string,
  over: Record<string, unknown> = {},
  commandId = randomUUID(),
) =>
  links(person).command({
    action: 'file',
    commandId,
    workspaceId,
    expectedProfileVersion: 1,
    kind: 'PROPOSED_NEW',
    organisationId: null,
    note: 'Synthetic request that this invented company is the catalogue company',
    ...over,
  });
const evidence = (
  person: string,
  workspaceId: string,
  claimId: string,
  expectedVersion: number,
  over: Record<string, unknown> = {},
  commandId = randomUUID(),
) =>
  links(person).command({
    action: 'add_evidence',
    commandId,
    workspaceId,
    claimId,
    expectedVersion,
    evidenceKind: 'REGISTRATION_STATEMENT',
    statement: 'Synthetic registration statement SYN-0001 for the invented company',
    url: 'https://registry.example.invalid/syn-0001',
    ...over,
  });
const decide = (
  claimId: string,
  expectedVersion: number,
  decision: 'approve' | 'approve_creation' | 'request_evidence' | 'reject' | 'revoke',
  over: Record<string, unknown> = {},
  ctx = reviewer(),
) =>
  staff().decide(ctx, {
    commandId: randomUUID(),
    claimId,
    expectedVersion,
    decision,
    reason: 'Reviewed the supplied evidence against the catalogue record',
    internalNote: null,
    organisationId: null,
    shareConfirmed: false,
    ...over,
  });
async function claimOf(person: string, workspaceId: string) {
  const v = await links(person).view({ workspaceId });
  return v.claim!;
}
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.organisation_link_claim) claims,
 (SELECT count(*)::int FROM customer_private.organisation_link_event) history,
 (SELECT count(*)::int FROM customer_private.organisation_link_evidence) evidence,
 (SELECT count(*)::int FROM customer_private.organisation_link) ledger,
 (SELECT count(*)::int FROM customer_private.organisation_link_request) requests,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_organisation_link') events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type='customer_organisation_link') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_organisation_link') outbox,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id)::text,'')) FROM app.organisation o) catalogue,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'')) FROM customer_private.organisation_profile_revision r) profile_revisions`)
  ).rows[0];
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT n.nspname,c.relname,c.relacl::text acl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows;
  const records: Record<string, string> = {};
  for (const row of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    records[row.nspname + '.' + row.relname] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) d FROM ${q(row.nspname)}.${q(row.relname)} t`,
      )
    ).rows[0].d;
  }
  return {
    functions,
    tables,
    records,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
  };
}
async function organisation(name: string, country: string, host: string | null) {
  const id = randomUUID();
  await f.owner.query(
    'INSERT INTO app.organisation(id,name,country,synthetic) VALUES($1,$2,$3,true)',
    [id, name, country],
  );
  if (host)
    await f.owner.query(
      `INSERT INTO app.public_identifier(organisation_id,identifier_type,identifier,domain,address,source_locator,observed_at,valid_until,synthetic)
 VALUES($1,'registry',$2,$3,'Synthetic address','https://registry.example.invalid/x',now()-interval '1 day',now()+interval '30 days',true)`,
      [id, randomUUID(), host],
    );
  return id;
}
async function join(person: string, target: string, owner = 'alice') {
  const invited = await workspaces(owner).access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: target,
    label: 'Synthetic invited ' + person,
  });
  return (
    await workspaces(person).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invited.token!,
    })
  ).memberId!;
}

beforeAll(async () => {
  f = await accessFixture();
  // Stage the released base plus the profile and member-role modules, populated, before this module exists.
  await migrateCustomerMemberRoles(f.owner);
  for (const person of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'synthetic-links-' + person,
      executorId: f.serviceId,
      reason: 'Explicit invented company link test identity; no real account or email',
    });
  const make = async (key: string, person: string) => {
    ws[key] = (
      await workspaces(person).provision({
        commandId: randomUUID(),
        name: 'Synthetic ' + key + ' link workspace',
      })
    ).id;
  };
  await make('one', 'alice');
  await make('two', 'erin');
  await make('three', 'frank');
  await make('four', 'gina');
  await make('five', 'hugo');
  await make('six', 'iris');
  // The two workspaces below deliberately look like the same company as workspace one.
  await saveProfile(
    'alice',
    ws.one!,
    'Synthetic Dhaka Textiles Ltd',
    'https://www.dhaka-textiles.example.invalid',
  );
  await saveProfile(
    'erin',
    ws.two!,
    'Synthetic Dhaka Textiles Limited',
    'https://dhaka-textiles.example.invalid/about',
  );
  await saveProfile('frank', ws.three!, 'Synthetic Rival Garments', null);
  await saveProfile('gina', ws.four!, 'Synthetic Race Weavers', null);
  await saveProfile('hugo', ws.five!, 'Synthetic Race Weavers Co', null);
  await saveProfile('iris', ws.six!, 'Synthetic Spanish Olive Oils', null, 0, 'ES');
  orgs.textiles = await organisation(
    'Synthetic Dhaka Textiles',
    'BD',
    'dhaka-textiles.example.invalid',
  );
  orgs.weavers = await organisation('Synthetic Race Weavers', 'BD', 'race-weavers.example.invalid');
  orgs.unpublished = await organisation('Synthetic Dhaka Hidden Mills', 'BD', null);
  orgs.spanish = await organisation('Synthetic Dhaka Olive Oils', 'ES', 'olive.example.invalid');
  orgs.other = await organisation(
    'Synthetic Third Catalogue Company',
    'BD',
    'third.example.invalid',
  );
  orgs.upgrade = await organisation(
    'Synthetic Replacement Catalogue Company',
    'BD',
    'replacement.example.invalid',
  );
  ws.bob = await join('bob', ws.one!);
  await join('carol', ws.one!);
  await roles('alice').command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId: ws.one!,
    memberId: ws.bob,
    role: 'admin',
    expectedRole: 'member',
  });
  before = await snapshot();
  await migrateCustomerOrganisationLinks(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('installing the module on a populated database changes no existing object and adds only new ones', async () => {
  const after = await snapshot();
  const oldByName = new Map(before.functions.map((r) => [r.name, r]));
  expect(
    after.functions
      .filter(
        (r) => oldByName.has(r.name) && JSON.stringify(oldByName.get(r.name)) !== JSON.stringify(r),
      )
      .map((r) => r.name),
  ).toEqual([]);
  expect(
    after.functions
      .filter((r) => !oldByName.has(r.name))
      .map((r) => r.name)
      .sort(),
  ).toEqual(
    [
      'app.customer_organisation_link_decide(uuid,jsonb)',
      'app.customer_organisation_link_queue(text,uuid,integer)',
      'app.customer_organisation_link_review(uuid)',
      'customer.organisation_link_command(uuid,text,jsonb)',
      'customer.organisation_link_overview()',
      'customer.organisation_link_search(uuid,text)',
      'customer.organisation_link_view(uuid)',
      'customer_private.organisation_link_append(uuid,uuid,text,text,uuid,uuid,text,text,uuid)',
      'customer_private.organisation_link_candidates(uuid)',
      'customer_private.organisation_link_domain_event(uuid,text,uuid,uuid,text,uuid,integer,text)',
      'customer_private.organisation_link_event_guard()',
      'customer_private.organisation_link_expiry()',
      'customer_private.organisation_link_head(uuid)',
      'customer_private.organisation_link_host_key(text)',
      'customer_private.organisation_link_ledger_guard()',
      'customer_private.organisation_link_name_key(text)',
      'customer_private.organisation_link_open_claim(uuid)',
      'customer_private.organisation_link_public_organisation(uuid)',
      'customer_private.organisation_link_staff()',
      'customer_private.organisation_link_state(uuid,boolean)',
    ].sort(),
  );
  const oldTables = new Set(before.tables.map((t) => t.nspname + '.' + t.relname));
  expect(
    after.tables
      .map((t) => t.nspname + '.' + t.relname)
      .filter((t) => !oldTables.has(t))
      .sort(),
  ).toEqual([
    'customer_private.organisation_link',
    'customer_private.organisation_link_claim',
    'customer_private.organisation_link_event',
    'customer_private.organisation_link_evidence',
    'customer_private.organisation_link_request',
  ]);
  for (const [name, digest] of Object.entries(before.records))
    expect(after.records[name]).toBe(digest);
  expect(
    after.policies.filter(
      (p) =>
        !before.policies.some((q) => q.policyname === p.policyname && q.tablename === p.tablename),
    ),
  ).toEqual([]);
  for (const t of before.tables) {
    const n = after.tables.find((x) => x.nspname === t.nspname && x.relname === t.relname)!;
    expect(n.acl).toBe(t.acl);
    expect(n.relrowsecurity).toBe(t.relrowsecurity);
  }
  for (const t of after.tables.filter((x) => x.relname.startsWith('organisation_link')))
    expect(t.relrowsecurity).toBe(true);
});

test('the runtime and auth logins cannot read or write any private table or call any private helper', async () => {
  const tables = [
    'organisation_link_claim',
    'organisation_link_event',
    'organisation_link_evidence',
    'organisation_link',
    'organisation_link_request',
  ];
  for (const pool of [f.runtime, f.auth]) {
    for (const t of tables) {
      await expect(pool.query(`SELECT * FROM customer_private.${t}`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(pool.query(`DELETE FROM customer_private.${t}`)).rejects.toThrow(
        /permission denied/i,
      );
    }
    await expect(
      pool.query("SELECT customer_private.organisation_link_name_key('Synthetic X')"),
    ).rejects.toThrow(/permission denied/i);
    await expect(pool.query('SELECT customer_private.organisation_link_staff()')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      pool.query('SELECT customer_private.organisation_link_candidates($1)', [randomUUID()]),
    ).rejects.toThrow(/permission denied/i);
  }
  // The auth login cannot call the customer or staff commands at all.
  await expect(f.auth.query('SELECT customer.organisation_link_overview()')).rejects.toThrow(
    /permission denied/i,
  );
  await expect(
    f.auth.query("SELECT app.customer_organisation_link_queue('open',NULL,5)"),
  ).rejects.toThrow(/permission denied/i);
  // Without a customer session or a staff session the callable functions deny.
  await expect(f.runtime.query('SELECT customer.organisation_link_overview()')).rejects.toThrow(
    /denied/i,
  );
  await expect(
    f.runtime.query("SELECT app.customer_organisation_link_queue('open',NULL,5)"),
  ).rejects.toThrow(/access required|denied/i);
  await expect(
    f.runtime.query("SELECT customer.organisation_link_command($1,'file',$2)", [
      randomUUID(),
      JSON.stringify({ workspaceId: ws.one }),
    ]),
  ).rejects.toThrow(/denied/i);
});

test('matching keys are normalised in the database, deterministically', async () => {
  const key = async (v: string | null) =>
    (await f.owner.query('SELECT customer_private.organisation_link_name_key($1) k', [v])).rows[0]
      .k;
  expect(await key('Synthetic Dhaka Textiles Ltd.')).toBe('dhakatextiles');
  expect(await key('synthetic  DHAKA-Textiles, Limited')).toBe('dhakatextiles');
  expect(await key('Dhaka Textiles')).toBe('dhakatextiles');
  expect(await key('Synthetic Ltd')).toBe('');
  const host = async (v: string | null) =>
    (await f.owner.query('SELECT customer_private.organisation_link_host_key($1) k', [v])).rows[0]
      .k;
  expect(await host('https://www.Dhaka-Textiles.example.invalid/about')).toBe(
    'dhaka-textiles.example.invalid',
  );
  expect(await host(null)).toBeNull();
});

test('the catalogue search is for workspace writers, bounded and limited to the public catalogue in the profile country', async () => {
  const found = await links('alice').search({ workspaceId: ws.one, q: 'dhaka' });
  expect(found.organisations.map((o) => o.name)).toEqual(['Synthetic Dhaka Textiles']);
  expect(Object.keys(found.organisations[0]!).sort()).toEqual(['country', 'id', 'name']);
  // An organisation with no public identity and one in another country are never returned.
  expect(JSON.stringify(found)).not.toContain('Hidden Mills');
  expect(JSON.stringify(found)).not.toContain('Olive');
  await expect(links('carol').search({ workspaceId: ws.one, q: 'dhaka' })).rejects.toThrow(
    /owner or admin required/i,
  );
  await expect(links('erin').search({ workspaceId: ws.one, q: 'dhaka' })).rejects.toThrow(
    /owner or admin required/i,
  );
  await expect(links('alice').search({ workspaceId: ws.one, q: 'dh' })).rejects.toThrow();
  await expect(
    links('alice').search({ workspaceId: ws.one, q: 'dh' + '\u0007x' }),
  ).rejects.toThrow();
  const underscore = await links('alice').search({ workspaceId: ws.one, q: '%%%' });
  expect(underscore.organisations).toEqual([]);
});

test('only a workspace owner or admin can file; a member only reads; outsiders and forged workspaces are denied', async () => {
  const start = await counts();
  const view = await links('carol').view({ workspaceId: ws.one });
  expect(view).toMatchObject({
    status: 'none',
    canEdit: false,
    canFile: false,
    claim: null,
    link: null,
  });
  await expect(file('carol', ws.one!)).rejects.toThrow(/owner or admin required/i);
  await expect(links('erin').view({ workspaceId: ws.one })).rejects.toThrow(/unavailable/i);
  await expect(file('erin', ws.one!)).rejects.toThrow();
  await expect(file('alice', randomUUID())).rejects.toThrow();
  // The caller cannot name a role, subject or organisation id of their own authority.
  for (const bad of [
    { role: 'owner' },
    { subject: 'synthetic-links-alice' },
    { organisationId: orgs.textiles },
    { kind: 'EXISTING' },
    { expectedProfileVersion: 0 },
    { note: 'not synthetic text at all here' },
    { note: 'Synthetic ' },
  ])
    expect(
      customerOrganisationLinkCommandInput.safeParse({
        action: 'file',
        commandId: randomUUID(),
        workspaceId: ws.one,
        expectedProfileVersion: 1,
        kind: 'PROPOSED_NEW',
        organisationId: null,
        note: 'Synthetic request that this invented company is the catalogue company',
        ...bad,
      }).success,
    ).toBe(false);
  expect(await counts()).toEqual(start);
});

test('filing needs a current profile, a catalogue organisation in the profile country, and writes nothing otherwise', async () => {
  const start = await counts();
  // A workspace with no profile.
  const empty = (
    await workspaces('jack').provision({
      commandId: randomUUID(),
      name: 'Synthetic empty link workspace',
    })
  ).id;
  await expect(file('jack', empty)).rejects.toThrow(/profile/i);
  await expect(file('alice', ws.one!, { expectedProfileVersion: 2 })).rejects.toThrow(
    /profile changed/i,
  );
  await expect(
    file('alice', ws.one!, { kind: 'EXISTING', organisationId: orgs.unpublished }),
  ).rejects.toThrow(/cannot be requested/i);
  await expect(
    file('alice', ws.one!, { kind: 'EXISTING', organisationId: orgs.spanish }),
  ).rejects.toThrow(/cannot be requested/i);
  await expect(
    file('alice', ws.one!, { kind: 'EXISTING', organisationId: randomUUID() }),
  ).rejects.toThrow(/cannot be requested/i);
  // Hostile payloads straight to SQL.
  for (const [operation, payload] of [
    [
      'file',
      {
        workspaceId: ws.one,
        expectedProfileVersion: 1,
        kind: 'PROPOSED_NEW',
        organisationId: orgs.textiles,
        note: 'Synthetic note that is long enough',
      },
    ],
    [
      'file',
      {
        workspaceId: ws.one,
        expectedProfileVersion: 1,
        kind: 'PROPOSED_NEW',
        organisationId: null,
        note: 'Synthetic note that is long enough',
        extra: 1,
      },
    ],
    [
      'file',
      {
        workspaceId: ws.one,
        expectedProfileVersion: '1',
        kind: 'PROPOSED_NEW',
        organisationId: null,
        note: 'Synthetic note that is long enough',
      },
    ],
    [
      'file',
      {
        workspaceId: ws.one,
        expectedProfileVersion: 1,
        kind: 'PROPOSED_NEW',
        organisationId: null,
        note: 'Real company statement that is long enough',
      },
    ],
    ['withdraw', { workspaceId: ws.one, claimId: randomUUID() }],
    ['delete', { workspaceId: ws.one }],
  ] as const)
    await expect(raw('alice').raw(operation, payload)).rejects.toThrow();
  expect(await counts()).toEqual(start);
});

test('a claim snapshots the profile, is idempotent, conflicts on changed content and allows one open claim per workspace', async () => {
  const start = await counts();
  const command = randomUUID();
  const first = await file(
    'alice',
    ws.one!,
    { kind: 'EXISTING', organisationId: orgs.textiles },
    command,
  );
  expect(first).toMatchObject({ status: 'pending', commandId: command, canFile: false });
  expect(first.claim).toMatchObject({
    state: 'pending',
    kind: 'EXISTING',
    profileVersion: 1,
    version: 1,
    evidenceCount: 0,
    canAddEvidence: true,
    canWithdraw: true,
    target: { name: 'Synthetic Dhaka Textiles', country: 'BD' },
  });
  const retry = await file(
    'alice',
    ws.one!,
    { kind: 'EXISTING', organisationId: orgs.textiles },
    command,
  );
  expect({ ...retry, expiresAt: 0 }).toEqual({ ...first, expiresAt: 0 });
  await expect(
    file('alice', ws.one!, { kind: 'PROPOSED_NEW', organisationId: null }, command),
  ).rejects.toThrow(/conflicts/i);
  await expect(
    file('alice', ws.one!, { note: 'Synthetic a different note for the same command' }, command),
  ).rejects.toThrow(/conflicts/i);
  // A second filing while one is open is refused, for the owner and for an admin.
  await expect(file('alice', ws.one!)).rejects.toThrow(/already open/i);
  await expect(file('bob', ws.one!)).rejects.toThrow(/already open/i);
  const end = await counts();
  expect(end.claims).toBe(start.claims + 1);
  expect(end.history).toBe(start.history + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.audits).toBe(start.audits + 1);
  expect(end.outbox).toBe(start.outbox + 1);
  // The admin sees the same open claim; a member sees only the status and kind.
  expect((await links('bob').view({ workspaceId: ws.one })).claim).toMatchObject({
    id: first.claim!.id,
    state: 'pending',
  });
  const member = await links('carol').view({ workspaceId: ws.one });
  expect(member.status).toBe('pending');
  expect(member.claim).toEqual({
    state: 'pending',
    awaitingCreation: false,
    kind: 'EXISTING',
    filedAt: expect.any(String),
    profileVersion: 1,
    profileChanged: false,
  });
});

test('two admins filing at once produce exactly one open claim', async () => {
  const racers = await Promise.allSettled([
    file('gina', ws.four!, { kind: 'EXISTING', organisationId: orgs.weavers }),
    file('gina', ws.four!),
  ]);
  expect(racers.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const open = await f.owner.query(
    'SELECT count(*)::int n FROM customer_private.organisation_link_claim WHERE tenant_id=$1',
    [ws.four],
  );
  expect(open.rows[0].n).toBe(1);
});

test('evidence is typed synthetic text, version-checked, bounded and append only', async () => {
  const claim = await claimOf('alice', ws.one!);
  const start = await counts();
  await expect(
    evidence('alice', ws.one!, claim.id!, claim.version!, {
      statement: 'Registration statement without the prefix',
    }),
  ).rejects.toThrow();
  await expect(
    evidence('alice', ws.one!, claim.id!, claim.version!, {
      url: 'https://real-company.com/registry',
    }),
  ).rejects.toThrow();
  await expect(
    evidence('alice', ws.one!, claim.id!, claim.version!, { evidenceKind: 'FILE_UPLOAD' }),
  ).rejects.toThrow();
  await expect(evidence('carol', ws.one!, claim.id!, claim.version!)).rejects.toThrow(
    /owner or admin required/i,
  );
  await expect(evidence('erin', ws.two!, claim.id!, claim.version!)).rejects.toThrow(
    /unavailable/i,
  );
  await expect(evidence('alice', ws.one!, claim.id!, claim.version! + 1)).rejects.toThrow(
    /changed/i,
  );
  expect(await counts()).toEqual(start);
  const added = await evidence('bob', ws.one!, claim.id!, claim.version!);
  expect(added.claim).toMatchObject({ version: 2, evidenceCount: 1, state: 'pending' });
  expect(added.claim!.evidence![0]).toMatchObject({
    kind: 'REGISTRATION_STATEMENT',
    url: 'https://registry.example.invalid/syn-0001',
  });
  // A stale version cannot append after the claim moved on.
  await expect(evidence('alice', ws.one!, claim.id!, claim.version!)).rejects.toThrow(/changed/i);
  // Members never see evidence text.
  expect(JSON.stringify(await links('carol').view({ workspaceId: ws.one }))).not.toContain(
    'SYN-0001',
  );
  // Evidence rows cannot be rewritten.
  await expect(
    f.owner.query(
      "UPDATE customer_private.organisation_link_evidence SET statement='Synthetic changed statement text'",
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.organisation_link_evidence'),
  ).rejects.toThrow();
});

test('at most eight evidence items per claim', async () => {
  const claim = await claimOf('gina', ws.four!);
  let version = claim.version!;
  for (let i = 0; i < 8; i++) {
    const v = await evidence('gina', ws.four!, claim.id!, version, {
      evidenceKind: [
        'WEBSITE_STATEMENT',
        'TRADE_REFERENCE_STATEMENT',
        'AUTHORISATION_STATEMENT',
        'REGISTRATION_STATEMENT',
      ][i % 4],
      statement: `Synthetic statement number ${i + 1} about the invented company`,
      url: null,
    });
    version = v.claim!.version!;
  }
  await expect(evidence('gina', ws.four!, claim.id!, version, { url: null })).rejects.toThrow(
    /limit/i,
  );
  expect((await claimOf('gina', ws.four!)).evidenceCount).toBe(8);
});

test('staff see the queue and candidates; operators, viewers and other tenants are denied; customers learn nothing of matches', async () => {
  // Workspace two files for the same company: same name key and the same website host.
  await file('erin', ws.two!, { kind: 'PROPOSED_NEW', organisationId: null });
  await file('frank', ws.three!, { kind: 'PROPOSED_NEW', organisationId: null });
  const queue = await staff().queue(reviewer(), { scope: 'open' });
  expect(queue.items.map((i) => i.workspaceId).sort()).toEqual(
    [ws.one, ws.two, ws.three, ws.four].sort(),
  );
  const one = queue.items.find((i) => i.workspaceId === ws.one)!;
  expect(one).toMatchObject({
    workspaceName: 'Synthetic one link workspace',
    state: 'pending',
    kind: 'EXISTING',
    evidenceCount: 1,
  });
  // Workspace one matches the catalogue organisation and workspace two; workspace three matches nothing.
  expect(one.candidateCount).toBe(2);
  expect(queue.items.find((i) => i.workspaceId === ws.three)!.candidateCount).toBe(0);
  const review = await staff().review(reviewer(), one.claimId);
  expect(review.candidates.organisations).toEqual([
    expect.objectContaining({
      id: orgs.textiles,
      reasons: expect.arrayContaining(['name_country', 'website_host', 'chosen_by_customer']),
      linkedWorkspaces: 0,
    }),
  ]);
  expect(review.candidates.workspaces).toEqual([
    expect.objectContaining({
      workspaceId: ws.two,
      reasons: ['name_country', 'website_host'],
      legalName: 'Synthetic Dhaka Textiles Limited',
    }),
  ]);
  expect(review.evidence).toHaveLength(1);
  expect(review.decisions).toEqual(['approve', 'request_evidence', 'reject']);
  expect(review.profile).toMatchObject({
    legalName: 'Synthetic Dhaka Textiles Ltd',
    countryCode: 'BD',
    version: 1,
  });
  // Only the allowed staff roles reach it, and only in the enabled intake tenant.
  for (const user of [f.users.operator, f.users.viewer])
    await expect(staff().queue(user.ctx, {})).rejects.toThrow();
  await expect(staff().queue(f.users.other.ctx, {})).rejects.toThrow(/reviewer access/i);
  await expect(staff().review(f.users.other.ctx, one.claimId)).rejects.toThrow();
  await expect(
    decide(one.claimId, one.version, 'reject', {}, f.users.operator.ctx),
  ).rejects.toThrow();
  await expect(decide(one.claimId, one.version, 'reject', {}, f.users.other.ctx)).rejects.toThrow();
  // The same denial holds when SQL is called directly with the staff session.
  for (const user of [f.users.operator, f.users.viewer, f.users.other])
    await expect(
      rawContext(f.runtime, user.ctx, "SELECT app.customer_organisation_link_queue('open',NULL,5)"),
    ).rejects.toThrow(/reviewer access/i);
  await expect(
    rawContext(
      f.runtime,
      f.users.reviewer.ctx,
      "SELECT app.customer_organisation_link_queue('open',NULL,5)",
    ),
  ).resolves.toBeTruthy();
  // A customer session is not a staff session and the customer logins cannot reach it.
  await expect(
    rawContext(
      f.runtime,
      { ...reviewer(), token: randomBytes(16).toString('hex') },
      "SELECT app.customer_organisation_link_queue('open',NULL,5)",
    ),
  ).rejects.toThrow();
  // Customers see no match, other workspace, candidate or staff name.
  for (const [person, workspaceId] of [
    ['alice', ws.one],
    ['bob', ws.one],
    ['carol', ws.one],
    ['erin', ws.two],
  ] as const) {
    const json = JSON.stringify(await links(person).view({ workspaceId }));
    for (const secret of [
      'candidate',
      'Rival Garments',
      'Dhaka Textiles Limited',
      ws.two!,
      ws.three!,
      'linkedWorkspaces',
      'internalNote',
      'staff_actor',
    ])
      if (
        !(person === 'erin' && secret === 'Dhaka Textiles Limited') &&
        !(person === 'erin' && secret === ws.two)
      )
        expect(json).not.toContain(secret);
  }
  const overview = JSON.stringify(await links('alice').overview());
  expect(overview).not.toContain(ws.two!);
  expect(overview).not.toContain('candidate');
});

test('a stale authenticator check or a missing reason cannot decide', async () => {
  const one = (await staff().queue(reviewer(), {})).items.find((i) => i.workspaceId === ws.one)!;
  const start = await counts();
  for (const bad of [
    { reason: '' },
    { reason: 'ok' },
    { reason: 'x'.repeat(1001) },
    { internalNote: 'no' },
    { decision: 'approve', organisationId: null },
    { organisationId: orgs.textiles },
  ])
    await expect(decide(one.claimId, one.version, 'reject', bad)).rejects.toThrow();
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [f.users.reviewer.sessionId],
  );
  await expect(decide(one.claimId, one.version, 'reject')).rejects.toThrow(/authenticator/i);
  await expect(
    rawContext(f.runtime, reviewer(), "SELECT app.customer_organisation_link_queue('open',NULL,5)"),
  ).rejects.toThrow(/reviewer access/i);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    f.users.reviewer.sessionId,
  ]);
  expect(await counts()).toEqual(start);
});

test('staff can request more evidence; the customer sees the reason but never the internal note, and adding evidence reopens review', async () => {
  const one = (await staff().queue(reviewer(), {})).items.find((i) => i.workspaceId === ws.one)!;
  await expect(decide(one.claimId, one.version + 1, 'request_evidence')).rejects.toThrow(
    /changed/i,
  );
  const command = randomUUID();
  const requested = await staff().decide(reviewer(), {
    commandId: command,
    claimId: one.claimId,
    expectedVersion: one.version,
    decision: 'request_evidence',
    reason: 'Please add a trade reference statement for the invented company',
    internalNote: 'Private staff note: looks fine but ask once more',
    organisationId: null,
    shareConfirmed: false,
  });
  expect(requested).toMatchObject({ state: 'needs_evidence', version: one.version + 1 });
  // Exact retry returns the original; the same id with other content is refused.
  expect(
    await staff().decide(reviewer(), {
      commandId: command,
      claimId: one.claimId,
      expectedVersion: one.version,
      decision: 'request_evidence',
      reason: 'Please add a trade reference statement for the invented company',
      internalNote: 'Private staff note: looks fine but ask once more',
      organisationId: null,
      shareConfirmed: false,
    }),
  ).toEqual(requested);
  await expect(
    staff().decide(reviewer(), {
      commandId: command,
      claimId: one.claimId,
      expectedVersion: one.version,
      decision: 'reject',
      reason: 'Please add a trade reference statement for the invented company',
      internalNote: null,
      organisationId: null,
      shareConfirmed: false,
    }),
  ).rejects.toThrow(/conflicts/i);
  const seen = await links('alice').view({ workspaceId: ws.one });
  expect(seen.status).toBe('needs_evidence');
  expect(seen.claim!.decision).toMatchObject({
    kind: 'evidence_requested',
    reason: 'Please add a trade reference statement for the invented company',
  });
  for (const person of ['alice', 'bob', 'carol'])
    expect(JSON.stringify(await links(person).view({ workspaceId: ws.one }))).not.toContain(
      'Private staff note',
    );
  // Staff do see their own note.
  expect(JSON.stringify(await staff().review(reviewer(), one.claimId))).toContain(
    'Private staff note',
  );
  // The customer answers with evidence and the request is open for review again.
  const answered = await evidence('alice', ws.one!, one.claimId, one.version + 1, {
    evidenceKind: 'TRADE_REFERENCE_STATEMENT',
    statement: 'Synthetic trade reference statement from an invented buyer',
    url: null,
  });
  expect(answered.status).toBe('pending');
  expect(answered.claim!.history!.map((h) => h.kind)).toEqual([
    'filed',
    'evidence_added',
    'evidence_requested',
    'evidence_added',
  ]);
  // While waiting for evidence staff could only reject, not approve.
  await expect(
    decide(one.claimId, one.version + 1, 'approve', { organisationId: orgs.textiles }),
  ).rejects.toThrow(/changed|not allowed/i);
});

test('approval links the workspace to the catalogue organisation without touching the catalogue, the profile or its verification', async () => {
  const one = (await staff().queue(reviewer(), {})).items.find((i) => i.workspaceId === ws.one)!;
  const start = await counts();
  const profileBefore = await profiles('alice').view({ workspaceId: ws.one });
  const approved = await decide(one.claimId, one.version, 'approve', {
    organisationId: orgs.textiles,
    reason: 'Name, country and registration statement agree with the catalogue record',
    internalNote: 'Checked the invented registry statement',
  });
  expect(approved).toMatchObject({ state: 'approved', decision: 'approve', shared: false });
  const end = await counts();
  expect(end.catalogue).toBe(start.catalogue);
  expect(end.profile_revisions).toBe(start.profile_revisions);
  expect(end.ledger).toBe(start.ledger + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.audits).toBe(start.audits + 1);
  expect(end.outbox).toBe(start.outbox + 1);
  for (const person of ['alice', 'bob', 'carol']) {
    const v = await links(person).view({ workspaceId: ws.one });
    expect(v.status).toBe('approved');
    expect(v.link).toMatchObject({
      organisation: { name: 'Synthetic Dhaka Textiles', country: 'BD' },
      label: organisationLinkLabel,
      reviewedProfileVersion: 1,
      profileChanged: false,
    });
    expect(v.canFile).toBe(person !== 'carol');
  }
  // The staff reason is for writers only; a member sees the link and the label.
  expect((await links('alice').view({ workspaceId: ws.one })).link!.reason).toContain(
    'agree with the catalogue record',
  );
  expect((await links('carol').view({ workspaceId: ws.one })).link).not.toHaveProperty('reason');
  expect(organisationLinkLabel).toBe(
    'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)',
  );
  // The ADR 0044 profile view is exactly as before: self-reported, unverified, no canonical id.
  const profileAfter = await profiles('alice').view({ workspaceId: ws.one });
  expect({ ...profileAfter, expiresAt: 0 }).toEqual({ ...profileBefore, expiresAt: 0 });
  expect(profileAfter).toMatchObject({
    organisationId: null,
    canonicalLinked: false,
    verified: false,
    provenance: 'SELF_REPORTED',
  });
  // The workspace list status carries the status and approved name only.
  const overview = await links('carol').overview();
  expect(overview.workspaces.find((w) => w.workspaceId === ws.one)).toEqual({
    workspaceId: ws.one,
    status: 'approved',
    organisationName: 'Synthetic Dhaka Textiles',
  });
  expect(overview.workspaces.map((w) => w.workspaceId)).not.toContain(ws.two);
  // A decided claim cannot be decided again.
  await expect(decide(one.claimId, approved.version, 'reject')).rejects.toThrow(/not allowed/i);
  await expect(evidence('alice', ws.one!, one.claimId, approved.version)).rejects.toThrow(
    /closed/i,
  );
});

test('a second workspace claiming the same canonical organisation needs an explicit shared-link decision, or is rejected', async () => {
  const two = (await staff().queue(reviewer(), {})).items.find((i) => i.workspaceId === ws.two)!;
  const review = await staff().review(reviewer(), two.claimId);
  // Staff now see that workspace one already holds the catalogue organisation.
  expect(review.candidates.organisations[0]).toMatchObject({
    id: orgs.textiles,
    linkedWorkspaces: 1,
  });
  const start = await counts();
  await expect(
    decide(two.claimId, two.version, 'approve', { organisationId: orgs.textiles }),
  ).rejects.toThrow(/another workspace is already linked/i);
  expect(await counts()).toEqual(start);
  const shared = await decide(two.claimId, two.version, 'approve', {
    organisationId: orgs.textiles,
    shareConfirmed: true,
    reason: 'Same organisation; both workspaces are contacts of one canonical identity',
  });
  expect(shared).toMatchObject({ state: 'approved', shared: true });
  // Each customer sees only their own link; neither learns of the other.
  const first = JSON.stringify(await links('alice').view({ workspaceId: ws.one }));
  const second = JSON.stringify(await links('erin').view({ workspaceId: ws.two }));
  expect(first).not.toContain('Limited');
  expect(first).not.toContain(ws.two!);
  expect(second).not.toContain(ws.one!);
  expect(second).not.toContain('shared');
  expect((await links('erin').view({ workspaceId: ws.two })).link!.organisation.name).toBe(
    'Synthetic Dhaka Textiles',
  );
  // Workspace three is unrelated and can simply be rejected, with a reason the customer can read.
  const three = (await staff().queue(reviewer(), {})).items.find(
    (i) => i.workspaceId === ws.three,
  )!;
  const rejected = await decide(three.claimId, three.version, 'reject', {
    reason: 'The evidence does not match any catalogue company',
  });
  expect(rejected.state).toBe('rejected');
  const seen = await links('frank').view({ workspaceId: ws.three });
  expect(seen.status).toBe('rejected');
  expect(seen.claim!.decision).toMatchObject({
    kind: 'rejected',
    reason: 'The evidence does not match any catalogue company',
  });
  expect(seen.canFile).toBe(true);
});

test('two reviewers approving different workspaces to one organisation at once cannot both link without confirmation', async () => {
  const five = await file('hugo', ws.five!, { kind: 'PROPOSED_NEW', organisationId: null });
  const four = await claimOf('gina', ws.four!);
  const results = await Promise.allSettled([
    decide(four.id!, four.version!, 'approve', { organisationId: orgs.weavers }),
    decide(five.claim!.id!, five.claim!.version!, 'approve', { organisationId: orgs.weavers }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const linked = await f.owner.query(
    "SELECT count(*)::int n FROM customer_private.organisation_link WHERE organisation_id=$1 AND state='linked'",
    [orgs.weavers],
  );
  expect(linked.rows[0].n).toBe(1);
});

test('a proposed new organisation is recorded as approved for creation, then linked once it exists', async () => {
  // Workspace six: a Spanish company with no catalogue organisation yet.
  const filed = await file(
    'iris',
    ws.six!,
    { kind: 'PROPOSED_NEW', organisationId: null },
    randomUUID(),
  );
  const claim = filed.claim!;
  await expect(
    decide(claim.id!, claim.version!, 'approve_creation', { organisationId: orgs.textiles }),
  ).rejects.toThrow();
  const creation = await decide(claim.id!, claim.version!, 'approve_creation', {
    reason: 'Looks like a genuine new company; the record will be created',
  });
  expect(creation.state).toBe('creation_approved');
  const waiting = await links('iris').view({ workspaceId: ws.six });
  expect(waiting).toMatchObject({ status: 'pending', claim: { awaitingCreation: true } });
  expect(waiting.link).toBeNull();
  const created = await organisation(
    'Synthetic Spanish Olive Oils',
    'ES',
    'spanish-olive.example.invalid',
  );
  const review = await staff().review(reviewer(), claim.id!);
  expect(review.candidates.organisations.map((o) => o.id)).toContain(created);
  expect(review.decisions).toEqual(['approve', 'reject']);
  await decide(claim.id!, creation.version, 'approve', {
    organisationId: created,
    reason: 'Linked to the newly created record',
  });
  expect((await links('iris').view({ workspaceId: ws.six })).link!.organisation.name).toBe(
    'Synthetic Spanish Olive Oils',
  );
});

test('a newer decision supersedes the active link, history is appended never rewritten, and only one link is ever active', async () => {
  const profileV = (await profiles('alice').view({ workspaceId: ws.one })).currentVersion;
  const filed = await file('alice', ws.one!, {
    kind: 'EXISTING',
    organisationId: orgs.upgrade,
    expectedProfileVersion: profileV,
  });
  const second = filed.claim!;
  // The old link stays active, and visible, while the new request is open.
  expect(filed.status).toBe('pending');
  expect(filed.link!.organisation.name).toBe('Synthetic Dhaka Textiles');
  const ledgerBefore = (
    await f.owner.query(
      'SELECT version,state FROM customer_private.organisation_link WHERE tenant_id=$1 ORDER BY version',
      [ws.one],
    )
  ).rows;
  expect(ledgerBefore).toEqual([{ version: 1, state: 'linked' }]);
  await decide(second.id!, second.version!, 'approve', {
    organisationId: orgs.upgrade,
    reason: 'Newer evidence points to the replacement record',
  });
  const ledger = (
    await f.owner.query(
      'SELECT version,state,organisation_id FROM customer_private.organisation_link WHERE tenant_id=$1 ORDER BY version',
      [ws.one],
    )
  ).rows;
  expect(ledger.map((r) => [r.version, r.state])).toEqual([
    [1, 'linked'],
    [2, 'unlinked'],
    [3, 'linked'],
  ]);
  expect(ledger[1].organisation_id).toBe(orgs.textiles);
  expect(ledger[2].organisation_id).toBe(orgs.upgrade);
  const view = await links('alice').view({ workspaceId: ws.one });
  expect(view.link!.organisation.name).toBe('Synthetic Replacement Catalogue Company');
  const old = await f.owner.query(
    "SELECT e.kind,e.state FROM customer_private.organisation_link_event e JOIN customer_private.organisation_link_claim c ON c.id=e.claim_id WHERE c.tenant_id=$1 AND e.kind='link_ended'",
    [ws.one],
  );
  expect(old.rows).toHaveLength(1);
  // The database itself refuses a second active link or an out-of-order row.
  const claimId = (
    await f.owner.query(
      'SELECT id FROM customer_private.organisation_link_claim WHERE tenant_id=$1 LIMIT 1',
      [ws.one],
    )
  ).rows[0].id;
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,staff_actor) VALUES($1,4,'linked',$2,$3,$4)",
      [ws.one, claimId, orgs.textiles, f.users.reviewer.id],
    ),
  ).rejects.toThrow(/only one active/i);
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,staff_actor) VALUES($1,9,'unlinked',$2,$3,$4)",
      [ws.one, claimId, orgs.textiles, f.users.reviewer.id],
    ),
  ).rejects.toThrow(/in order/i);
  // Staff can also end the active link outright; the ledger gets one more row.
  const latest = (await staff().queue(reviewer(), { scope: 'closed' })).items.find(
    (i) => i.workspaceId === ws.one && i.state === 'approved',
  )!;
  const review = await staff().review(reviewer(), latest.claimId);
  expect(review.decisions).toEqual(['revoke']);
  expect(review.activeLink).toMatchObject({ organisation: { id: orgs.upgrade } });
  await decide(latest.claimId, latest.version, 'revoke', {
    reason: 'The company asked for the link to be removed',
  });
  expect((await links('alice').view({ workspaceId: ws.one })).status).toBe('none');
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.organisation_link WHERE tenant_id=$1',
        [ws.one],
      )
    ).rows[0].n,
  ).toBe(4);
});

test('a customer can withdraw an open claim and file again; a withdrawn claim cannot be decided', async () => {
  const filed = await file('alice', ws.one!, {
    kind: 'PROPOSED_NEW',
    organisationId: null,
    expectedProfileVersion: (await profiles('alice').view({ workspaceId: ws.one })).currentVersion,
  });
  const claim = filed.claim!;
  await expect(
    links('carol').command({
      action: 'withdraw',
      commandId: randomUUID(),
      workspaceId: ws.one,
      claimId: claim.id,
      expectedVersion: claim.version,
    }),
  ).rejects.toThrow(/owner or admin/i);
  await expect(
    links('alice').command({
      action: 'withdraw',
      commandId: randomUUID(),
      workspaceId: ws.one,
      claimId: claim.id,
      expectedVersion: claim.version! + 1,
    }),
  ).rejects.toThrow(/changed/i);
  const withdrawn = await links('bob').command({
    action: 'withdraw',
    commandId: randomUUID(),
    workspaceId: ws.one,
    claimId: claim.id,
    expectedVersion: claim.version,
  });
  expect(withdrawn.status).toBe('none');
  expect(withdrawn.canFile).toBe(true);
  await expect(decide(claim.id!, claim.version! + 1, 'reject')).rejects.toThrow(/not allowed/i);
  await expect(
    links('alice').command({
      action: 'withdraw',
      commandId: randomUUID(),
      workspaceId: ws.one,
      claimId: claim.id,
      expectedVersion: claim.version! + 1,
    }),
  ).rejects.toThrow(/closed/i);
  expect(
    (
      await file('alice', ws.one!, {
        expectedProfileVersion: (await profiles('alice').view({ workspaceId: ws.one }))
          .currentVersion,
      })
    ).status,
  ).toBe('pending');
});

test('editing the profile later does not change or verify an approved link, and the view says so', async () => {
  const view = await links('iris').view({ workspaceId: ws.six });
  expect(view.link!.profileChanged).toBe(false);
  await saveProfile('iris', ws.six!, 'Synthetic Spanish Olive Oils SL', null, 1, 'ES');
  const own = await links('iris').view({ workspaceId: ws.six });
  expect(own.link).toMatchObject({ profileChanged: true, reviewedProfileVersion: 1 });
  expect(own.currentProfileVersion).toBe(2);
});

test('every history table rejects updates and deletes, even for the owner role', async () => {
  for (const t of [
    'organisation_link_claim',
    'organisation_link_event',
    'organisation_link_evidence',
    'organisation_link',
    'organisation_link_request',
  ]) {
    await expect(
      f.owner.query(`UPDATE customer_private.${t} SET created_at=now()`),
    ).rejects.toThrow();
    await expect(f.owner.query(`DELETE FROM customer_private.${t}`)).rejects.toThrow();
  }
});

test('event chains carry ids and versions only, one per real change, and never customer or staff text', async () => {
  const events = (
    await f.owner.query(
      "SELECT type,payload,aggregate_version,actor_id FROM app.domain_event WHERE aggregate_type='customer_organisation_link'",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(15);
  const types = new Set(events.map((e) => e.type));
  for (const t of [
    'filed',
    'evidence_added',
    'evidence_requested',
    'approved',
    'rejected',
    'creation_approved',
    'link_ended',
    'withdrawn',
  ])
    expect(types.has('customer.organisation_link.' + t)).toBe(true);
  for (const e of events) {
    expect(Object.keys(e.payload).sort()).toEqual([
      'claimId',
      'initiator_id',
      'initiator_kind',
      'state',
      'synthetic',
      'version',
    ]);
    expect(['customer', 'staff']).toContain(e.payload.initiator_kind);
  }
  const json = JSON.stringify(events);
  for (const secret of [
    'Dhaka Textiles',
    'registration statement',
    'Private staff note',
    'Reviewed the supplied',
    'dhaka-textiles',
    'SYN-0001',
  ])
    expect(json).not.toContain(secret);
  const stats = (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_organisation_link') e,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event d ON d.id=a.domain_event_id WHERE d.aggregate_type='customer_organisation_link') a,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event d ON d.id=o.event_id WHERE d.aggregate_type='customer_organisation_link') o,
 (SELECT count(*)::int FROM customer_private.organisation_link_event) h`)
  ).rows[0];
  expect(stats.a).toBe(stats.e);
  expect(stats.o).toBe(stats.e);
  // Every claim history row has exactly one event, plus nothing else.
  expect(stats.e).toBe(stats.h);
  // Staff decisions are attributed to the staff principal, customer ones to the service executor.
  expect(
    events
      .filter((e) => e.payload.initiator_kind === 'staff')
      .every((e) => e.actor_id === f.users.reviewer.id),
  ).toBe(true);
});

test('expired proof, revoked members and disabled accounts read as no access', async () => {
  await expect(links('alice', -1000).view({ workspaceId: ws.one })).rejects.toThrow(/sign in/i);
  await expect(links('alice', -1000).overview()).rejects.toThrow(/sign in/i);
  const dave = await join('dave', ws.two!, 'erin');
  expect((await links('dave').view({ workspaceId: ws.two })).canEdit).toBe(false);
  await workspaces('erin').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId: ws.two,
    kind: 'membership',
    targetId: dave,
  });
  await expect(links('dave').view({ workspaceId: ws.two })).rejects.toThrow(/unavailable/i);
  await expect(
    links('dave')
      .overview()
      .then((o) => o.workspaces.map((w) => w.workspaceId)),
  ).resolves.not.toContain(ws.two);
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    ['synthetic-links-bob'],
  );
  await expect(links('bob').view({ workspaceId: ws.one })).rejects.toThrow();
  await expect(file('bob', ws.one!)).rejects.toThrow();
});

test('the flag, synthetic and production gates stay binding and the installer is repeatable', async () => {
  const on = { DATA_ENVIRONMENT: 'synthetic', CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true' };
  expect(customerOrganisationLinksEnabled(on)).toBe(false);
  expect(
    customerOrganisationLinksEnabled({
      ...on,
      CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED: 'true',
    }),
  ).toBe(true);
  expect(
    customerOrganisationLinksEnabled({
      ...on,
      CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'real',
    }),
  ).toBe(false);
  expect(
    customerOrganisationLinksEnabled({
      ...on,
      CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED: 'true',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  const disabled = new CustomerOrganisationLinkService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  await expect(disabled.view({ workspaceId: ws.one })).rejects.toThrow();
  const first = (await f.owner.query('SELECT * FROM customer_organisation_link_migrations.applied'))
    .rows;
  await migrateCustomerOrganisationLinks(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_organisation_link_migrations.applied')).rows,
  ).toEqual(first);
  expect(first).toHaveLength(1);
  await f.owner.query('UPDATE customer_organisation_link_migrations.applied SET sha256=$1', [
    randomBytes(32).toString('hex'),
  ]);
  await expect(migrateCustomerOrganisationLinks(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_organisation_link_migrations.applied SET sha256=$1', [
    first[0].sha256,
  ]);
});
