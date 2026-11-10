import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import {
  CustomerOrganisationLinkService,
  StaffOrganisationLinkService,
} from '../../packages/auth/src/customer-organisation-links';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';

// ADR-079 slice A test support. The ladder file under test is hidden from the migrator (the vi.mock in each test file
// filters the directory listing while the gate is closed), so a database can be built at the exact base state, filled
// with data, and only then given the new file. LINK_BASE_CHECK=1 never opens the gate: every suite then runs against the
// base SQL, which is how each new test is shown to fail on the commit before this change.
export const LADDER_FILE = '0013_organisation_link_provenance_and_search.sql';
export const baseCheck = process.env.LINK_BASE_CHECK === '1';
const gate = globalThis as { __linkHide?: boolean };
const hideLadder = () => {
  gate.__linkHide = true;
};
export const openLadder = () => {
  if (!baseCheck) gate.__linkHide = false;
};

const ladderUrl = new URL(
  '../../packages/db/customer-real-use-migrations/' + LADDER_FILE,
  import.meta.url,
);
export const ladderSql = () => readFileSync(ladderUrl, 'utf8');
export const ladderHash = () => createHash('sha256').update(ladderSql()).digest('hex');
const between = (sql: string, name: string) => {
  const open = `-- ${name}-begin`;
  const a = sql.indexOf(open);
  const b = sql.indexOf(`-- ${name}-end`);
  if (a < 0 || b < a) throw new Error('Missing marker ' + name);
  return sql.slice(a + open.length, b);
};
// What the file claims the base fingerprints are.
export function fileFingerprints() {
  const text = between(ladderSql(), 'fingerprint');
  const rows = [...text.matchAll(/\('([^']+)','([0-9a-f]{64})','([^']*)'\)/g)].map((m) => ({
    signature: m[1]!,
    fingerprint: m[2]!,
    grantees: m[3]!,
  }));
  if (rows.length !== 9)
    throw new Error('Expected nine function fingerprints, found ' + rows.length);
  return rows;
}
export function fileConstraintFingerprint() {
  const found = between(ladderSql(), 'constraint-expected').match(/'([0-9a-f]{64})'/);
  if (!found) throw new Error('Missing constraint fingerprint');
  return found[1]!;
}
type Db = {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
// The same query text the file runs, taken from between its markers, so a test cannot drift from the guard.
export async function liveFingerprints(db: Db) {
  const query = between(ladderSql(), 'fingerprint-query');
  const signatures = fileFingerprints()
    .map((r) => `('${r.signature}')`)
    .join(',');
  return (
    await db.query(
      `SELECT v.signature,f.fp fingerprint,f.grantees FROM (VALUES ${signatures}) v(signature) LEFT JOIN LATERAL (${query}) f ON true ORDER BY v.signature`,
    )
  ).rows as unknown as { signature: string; fingerprint: string | null; grantees: string | null }[];
}
export async function liveConstraintFingerprint(db: Db) {
  const query = between(ladderSql(), 'constraint-query').replace(' INTO v_url', '').trim();
  return (await db.query(query.replace(/;$/, ''))).rows[0]?.encode as string | undefined;
}

export const issuer =
  'https://ep-link-a-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
export const realOptions = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
export const syntheticOptions = { enabled: true, synthetic: true, production: false, issuer };
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Mode = 'real' | 'synthetic';
const session =
  (label: string, mode: Mode, ttl: number): (() => Promise<CustomerSession>) =>
  async () => ({
    subject: 'link-a-' + label,
    email: mode === 'real' ? `${label}@business.test` : undefined,
    emailVerified: true,
    expiresAt: new Date(Date.now() + ttl),
  });
const details = (name: string, website: string | null, country = 'DE', synthetic = false) => ({
  legalName: name,
  countryCode: country,
  website,
  commercialRoles: ['SUPPLIER'],
  sectors: ['Textiles'],
  sizeBand: '11-50',
  summary:
    (synthetic ? 'Synthetic invented' : 'Invented') +
    ' company used only for the company link tests',
});
export const hidden = 'This text is hidden.';

type OrgSpec = {
  key: string;
  name: string;
  synthetic: boolean;
  host: string | null;
  expired?: boolean;
  country?: string;
};
const organisationSpecs: OrgSpec[] = [
  { key: 'OR1', name: 'Acme Realwerk GmbH', synthetic: false, host: 'acme-gmbh.de' },
  { key: 'OS1', name: 'Acme Realwerk AG', synthetic: true, host: 'acme.example.invalid' },
  { key: 'OS2', name: 'Orchid Synthwerk AG', synthetic: true, host: 'orchid.example.invalid' },
  { key: 'OR2', name: 'Beta Werke GmbH', synthetic: false, host: 'beta-werke.de', expired: true },
  { key: 'OR3', name: 'Gamma Handel GmbH', synthetic: false, host: 'gamma-handel.de' },
  { key: 'OR5', name: 'Pilot Realwerk GmbH', synthetic: false, host: 'pilot-realwerk.de' },
  { key: 'OS3', name: 'Pilot Synthwerk AG', synthetic: true, host: 'pilot.example.invalid' },
  { key: 'OR6', name: 'Epsilon Linked GmbH', synthetic: false, host: 'epsilon-linked.de' },
];

// One populated database: two sides (real and synthetic), staff on each side, the catalogue of the design spec
// section 5, claims, links and the cross-provenance ledger rows LX, LX2 and LX3 made as table owner at the base state.
export class World {
  f!: Fixture;
  intake = '';
  org: Record<string, string> = {};
  ws: Record<string, string> = {};
  claim: Record<string, string> = {};
  principal: Record<string, string> = {};
  crossRows: Record<string, string> = {};
  database = '';
  static async build(database = 'corridra_integration') {
    const w = new World();
    w.database = database;
    hideLadder();
    vi.stubEnv('DATA_ENVIRONMENT', 'real');
    vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
    w.f = await fixture(database);
    const f = w.f;
    await migrateCustomerRealUse(f.owner);
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'local-bootstrap-fixture',
      executorId: f.serviceId,
      reason: 'Local fixture authority only; never a production customer',
    });
    await f.owner.query(
      "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
      [f.tenantA, f.serviceId, f.users.owner.id],
    );
    await configureCustomerRealUse(f.owner, {
      enabled: true,
      reason: 'Local functional fixture with owner-approved real use and deferred scanning',
    });
    w.intake = (
      await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
    ).rows[0].intake_tenant_id;
    for (const who of ['alice-s', 'bob-s', 'carl-s', 'dana'])
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: 'link-a-' + who,
        executorId: f.serviceId,
        reason: 'Explicit invented company link test identity; no real account or email',
      });
    for (const spec of organisationSpecs) await w.addOrganisation(spec);
    await w.ingestDelta();
    // Real workspaces (profile website is the saved company site) and synthetic workspaces.
    await w.workspace('WR1', 'alice-r', 'real', 'Acme Realwerk GmbH', 'https://www.acme-gmbh.de');
    await w.workspace('WR2', 'bob-r', 'real', 'Acme Realwerk GmbH', 'https://www.acme-gmbh.de');
    await w.workspace('WR3', 'carol-r', 'real', 'Zeta Handel GmbH', null);
    await w.workspace('WR4', 'dave-r', 'real', 'Omega Bau GmbH', null);
    await w.workspace('WR5', 'erin-r', 'real', 'Nonesuch Handel GmbH', null);
    await w.workspace('WR6', 'frank-r', 'real', 'Epsilon Linked GmbH', null);
    await w.workspace('WRP', 'dana', 'real', 'Pilot Realwerk GmbH', null);
    await w.workspace('WS1', 'alice-s', 'synthetic', 'Synthetic Acme Realwerk AG', null);
    await w.workspace('WS2', 'bob-s', 'synthetic', 'Synthetic Acme Realwerk AG', null);
    await w.workspace('WS3', 'carl-s', 'synthetic', 'Synthetic Sigma Werk AG', null);
    await w.workspace('WSP', 'dana', 'synthetic', 'Synthetic Pilot Synthwerk AG', null);
    // Same-side links through the ordinary flow: CR2 (WR2 to OR1), CS2 (WS2 to OS1), CRP, CSP and CR6.
    w.claim.CR2 = await w.fileExisting('WR2', 'bob-r', 'real', 'OR1');
    await w.approve('real', w.claim.CR2!, 'OR1');
    w.claim.CS2 = await w.fileExisting('WS2', 'bob-s', 'synthetic', 'OS1');
    await w.approve('synthetic', w.claim.CS2!, 'OS1');
    w.claim.CRP = await w.fileExisting('WRP', 'dana', 'real', 'OR5');
    await w.approve('real', w.claim.CRP!, 'OR5');
    w.claim.CSP = await w.fileExisting('WSP', 'dana', 'synthetic', 'OS3');
    await w.approve('synthetic', w.claim.CSP!, 'OS3');
    w.claim.CR6 = await w.fileExisting('WR6', 'frank-r', 'real', 'OR6');
    await w.approve('real', w.claim.CR6!, 'OR6');
    // Open claims.
    w.claim.CR1 = await w.fileExisting('WR1', 'alice-r', 'real', 'OR1');
    w.claim.CS1 = (
      await w.link('alice-s', 'synthetic').command({
        action: 'file',
        commandId: randomUUID(),
        workspaceId: w.ws.WS1,
        expectedProfileVersion: 1,
        kind: 'PROPOSED_NEW',
        organisationId: null,
        note: 'Synthetic request that this invented company is the catalogue company',
      })
    ).claim!.id!;
    // Cross-provenance rows, made as table owner exactly as an old release could have left them.
    await w.crossRow('LX', 'WR3', 'carol-r', 'OS2', false);
    await w.crossRow('LX2', 'WR4', 'dave-r', 'OS1', true);
    await w.crossRow('LX3', 'WS3', 'carl-s', 'OR1', true);
    await w.snapshotCross();
    return w;
  }
  async addOrganisation(spec: OrgSpec) {
    const id = randomUUID();
    this.org[spec.key] = id;
    await this.f.owner.query(
      'INSERT INTO app.organisation(id,name,country,synthetic) VALUES($1,$2,$3,$4)',
      [id, spec.name, spec.country ?? 'DE', spec.synthetic],
    );
    if (spec.host)
      await this.f.owner.query(
        `INSERT INTO app.public_identifier(organisation_id,identifier_type,identifier,domain,address,source_locator,observed_at,valid_until,synthetic)
         VALUES($1,'registry',$2,$3,'Invented address 1',$4,now()-interval '2 days',$5,$6)`,
        [
          id,
          randomUUID(),
          spec.host,
          spec.synthetic
            ? 'https://registry.example.invalid/x'
            : 'https://register.example-records.de/x',
          spec.expired ? new Date(Date.now() - 86400000) : new Date(Date.now() + 30 * 86400000),
          spec.synthetic,
        ],
      );
    return id;
  }
  // OR4 is made by the unchanged 8-argument function from the real intake tenant, as production staff would.
  async ingestDelta() {
    const f = this.f;
    const ctx = {
      ...f.users.owner.ctx,
      tenantId: this.intake,
      purpose: 'commercial_qualification',
    };
    const unexpected = async () => {
      throw new Error('No file operation in this test');
    };
    const evidence = new EvidenceService(
      f.runtime,
      { put: unexpected, get: unexpected },
      { scan: unexpected },
    );
    const source = await evidence.createSource(ctx, {
      kind: 'public_record',
      locator: 'https://register.example-records.de/delta',
      observedAt: new Date(Date.now() - 86400000).toISOString(),
      classification: 'PUBLIC',
      purpose: 'commercial_qualification',
      retentionUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      aiPolicy: 'DENY',
    });
    const made = await new CounterpartyService(f.runtime).command(ctx, {
      action: 'ingest',
      commandId: randomUUID(),
      sourceId: source.id,
      name: 'Delta Bau GmbH',
      country: 'DE',
      domain: 'delta-bau.de',
      address: 'Invented address 4',
      identifierType: 'registry',
      identifier: randomUUID(),
    });
    this.org.OR4 = made.id as string;
  }
  get rsCtx() {
    return { ...this.f.users.reviewer.ctx, tenantId: this.intake };
  }
  get ssCtx() {
    return this.f.users.reviewer.ctx;
  }
  staff = () => new StaffOrganisationLinkService(this.f.runtime);
  svcOptions = (mode: Mode) => (mode === 'real' ? realOptions : syntheticOptions);
  profiles = (who: string, mode: Mode, ttl = 3600000) =>
    new CustomerOrganisationProfileService(
      this.f.runtime,
      this.f.auth,
      this.svcOptions(mode),
      session(who, mode, ttl),
    );
  workspaces = (who: string, mode: Mode, ttl = 3600000) =>
    new CustomerWorkspaceService(
      this.f.runtime,
      this.f.auth,
      this.svcOptions(mode),
      session(who, mode, ttl),
    );
  link = (who: string, mode: Mode, ttl = 3600000) =>
    new CustomerOrganisationLinkService(
      this.f.runtime,
      this.f.auth,
      this.svcOptions(mode),
      session(who, mode, ttl),
    );
  async workspace(
    key: string,
    who: string,
    mode: Mode,
    legalName: string,
    website: string | null,
    country = 'DE',
  ) {
    const name = mode === 'real' ? `${legalName} workspace` : `Synthetic ${key} workspace`;
    const made = await this.workspaces(who, mode).provision({ commandId: randomUUID(), name });
    this.ws[key] = made.id;
    await this.profiles(who, mode).command({
      commandId: randomUUID(),
      workspaceId: made.id,
      expectedVersion: 0,
      ...details(legalName, website, country, mode === 'synthetic'),
      reason: 'Invented profile for the company link tests',
      acknowledged: true,
    });
    this.principal[who] = (
      await this.f.owner.query(
        'SELECT id FROM customer_private.principal WHERE issuer=$1 AND subject=$2',
        [issuer, 'link-a-' + who],
      )
    ).rows[0].id;
    return made.id as string;
  }
  note = (mode: Mode) =>
    mode === 'real'
      ? 'Review our company information'
      : 'Synthetic request that this invented company is the catalogue company';
  async fileExisting(key: string, who: string, mode: Mode, org: string) {
    const view = await this.link(who, mode).command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: this.ws[key],
      expectedProfileVersion: 1,
      kind: 'EXISTING',
      organisationId: this.org[org],
      note: this.note(mode),
    });
    return view.claim!.id!;
  }
  ctxFor = (mode: Mode) => (mode === 'real' ? this.rsCtx : this.ssCtx);
  async approve(mode: Mode, claimId: string, org: string, over: Record<string, unknown> = {}) {
    const ctx = this.ctxFor(mode);
    const review = await this.staff().review(ctx, claimId);
    return this.staff().decide(ctx, {
      commandId: randomUUID(),
      claimId,
      expectedVersion: review.version,
      decision: 'approve',
      reason: 'Reviewed the supplied evidence against the catalogue record',
      internalNote: null,
      organisationId: this.org[org],
      shareConfirmed: false,
      ...over,
    });
  }
  // A claim, its events and a ledger row inserted as table owner. Never possible through a released function.
  async crossRow(name: string, wsKey: string, who: string, org: string, withEvents: boolean) {
    const o = this.f.owner;
    const target = this.ws[wsKey]!;
    const rev = (
      await o.query(
        'SELECT id,version,details FROM customer_private.organisation_profile_revision WHERE tenant_id=$1 ORDER BY version DESC LIMIT 1',
        [target],
      )
    ).rows[0];
    const claim = (
      await o.query(
        `INSERT INTO customer_private.organisation_link_claim(tenant_id,profile_revision_id,profile_version,kind,organisation_id,name_key,country_code,host_key,note,created_by)
         VALUES($1,$2,$3,'EXISTING',$4,customer_private.organisation_link_name_key($5),$6,customer_private.organisation_link_host_key($7),'Synthetic cross side fixture claim',$8) RETURNING id`,
        [
          target,
          rev.id,
          rev.version,
          this.org[org],
          rev.details.legalName,
          rev.details.countryCode,
          rev.details.website,
          this.principal[who],
        ],
      )
    ).rows[0].id as string;
    this.claim[name === 'LX' ? 'CX3' : name === 'LX2' ? 'CR4' : 'CS3'] = claim;
    if (withEvents) {
      await o.query(
        "SELECT customer_private.organisation_link_append(gen_random_uuid(),$1,'filed','pending',$2,NULL,NULL,NULL,NULL)",
        [claim, this.principal[who]],
      );
      await o.query(
        "SELECT customer_private.organisation_link_append(gen_random_uuid(),$1,'approved','approved',NULL,$2,'Reviewed the supplied evidence against the catalogue record',NULL,$3)",
        [claim, this.f.users.reviewer.id, this.org[org]],
      );
    }
    await o.query(
      "INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor) VALUES($1,1,'linked',$2,$3,false,$4)",
      [target, claim, this.org[org], this.f.users.reviewer.id],
    );
  }
  async snapshotCross() {
    for (const [name, key] of [
      ['LX', 'WR3'],
      ['LX2', 'WR4'],
      ['LX3', 'WS3'],
    ] as const)
      this.crossRows[name] = await this.crossHash(this.ws[key]!);
  }
  async crossHash(workspaceId: string) {
    return (
      await this.f.owner.query(
        `SELECT md5((SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.version),'[]') FROM customer_private.organisation_link l WHERE l.tenant_id=$1)::text
          ||(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM customer_private.organisation_link_claim c WHERE c.tenant_id=$1)::text
          ||(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.claim_id,e.seq),'[]') FROM customer_private.organisation_link_event e WHERE e.tenant_id=$1)::text) h`,
        [workspaceId],
      )
    ).rows[0].h as string;
  }
  // The new file is applied here, and the fixtures that need its tables are added after.
  async install() {
    openLadder();
    await migrateCustomerRealUse(this.f.owner);
  }
  async suppress(org: string, state: 'hidden' | 'shown' = 'hidden') {
    if (baseCheck) return;
    const version =
      Number(
        (
          await this.f.owner.query(
            'SELECT coalesce(max(version),0) v FROM customer_private.organisation_suppression WHERE organisation_id=$1',
            [this.org[org]],
          )
        ).rows[0].v,
      ) + 1;
    await this.f.owner.query(
      `INSERT INTO customer_private.organisation_suppression(organisation_id,version,state,reason,reference,staff_actor,command_id,request)
       VALUES($1,$2,$3,'Takedown requested by the company',$4,$5,$6,'{}')`,
      [
        this.org[org],
        version,
        state,
        'TICKET-' + randomUUID().slice(0, 8),
        this.f.users.reviewer.id,
        randomUUID(),
      ],
    );
  }
  async redact(claimId: string) {
    if (baseCheck) return;
    await this.f.owner.query(
      `INSERT INTO customer_private.organisation_link_redaction(claim_id,reason,reference,staff_actor,command_id,request)
       VALUES($1,'Erasure request from the company',$2,$3,$4,'{}')`,
      [claimId, 'TICKET-' + randomUUID().slice(0, 8), this.f.users.reviewer.id, randomUUID()],
    );
  }
  principalId = async (who: string) =>
    this.principal[who] ??
    ((
      await this.f.owner.query(
        'SELECT id FROM customer_private.principal WHERE issuer=$1 AND subject=$2',
        [issuer, 'link-a-' + who],
      )
    ).rows[0]?.id as string);
  // A fresh real person with a real workspace whose own company matches nothing unless a name is given.
  async freshWriter(
    label: string,
    legalName = 'Nonesuch Handel GmbH',
    website: string | null = null,
    country = 'DE',
  ) {
    const key = 'F-' + label;
    await this.workspace(key, label, 'real', legalName, website, country);
    return { who: label, workspaceId: this.ws[key]! };
  }
  async attempts(who: string) {
    if (baseCheck) return 0;
    return Number(
      (
        await this.f.owner.query(
          'SELECT count(*)::int n FROM customer_private.organisation_link_search_attempt WHERE actor_id=$1',
          [await this.principalId(who)],
        )
      ).rows[0].n,
    );
  }
  async addAttempts(who: string, ages: string[]) {
    const actor = await this.principalId(who);
    for (const age of ages)
      await this.f.owner.query(
        'INSERT INTO customer_private.organisation_link_search_attempt(actor_id,created_at) VALUES($1,clock_timestamp()-$2::interval)',
        [actor, age],
      );
  }
  async close() {
    await this.f.close();
    vi.unstubAllEnvs();
  }
}
export const randomLabel = () => randomUUID().slice(0, 8);
