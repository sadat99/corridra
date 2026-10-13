import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext, freshDatabase, connection, sandbox } from './support';
import { Pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import { seedSyntheticWorkspace } from '../../packages/auth/src/bootstrap';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService, type ObjectStorage } from '../../packages/evidence/src/index';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { AccessService } from '../../packages/auth/src/access';
let f: Awaited<ReturnType<typeof fixture>>,
  s: CounterpartyService,
  e: EvidenceService,
  m: MissionService;
const blobs = new Map<string, Uint8Array>();
const storage: ObjectStorage = {
  async put(k, b) {
    blobs.set(k, b);
  },
  async get(k) {
    if (!blobs.has(k)) throw new Error('Missing');
    return blobs.get(k)!;
  },
};
const until = () => new Date(Date.now() + 86400000).toISOString();
const cmd = (action: string, data: Record<string, unknown>) => ({
  action,
  commandId: randomUUID(),
  ...data,
});
async function source(
  ctx = f.users.operator.ctx,
  classification = 'PUBLIC',
  kind = 'public_record',
) {
  return e.createSource(ctx, {
    kind,
    classification,
    locator: 'https://example.invalid/registry',
    observedAt: new Date().toISOString(),
    purpose: 'synthetic_validation',
    retentionUntil: until(),
    aiPolicy: 'DENY',
  });
}
async function company(
  name = `Synthetic ${randomUUID()}`,
  domain = 'shared.example.invalid',
  ctx = f.users.operator.ctx,
) {
  const src = await source(ctx);
  const org = await s.command(
    ctx,
    cmd('ingest', {
      sourceId: src.id,
      name,
      country: 'ES',
      domain,
      address: 'Synthetic Test Business Park',
      identifierType: 'registry',
      identifier: randomUUID(),
    }),
  );
  return { id: org.id as string, sourceId: src.id };
}
async function relationship(
  organisationId: string,
  ownerId = f.users.operator.id,
  visibility = 'OWNER',
  ctx = f.users.operator.ctx,
) {
  return s.command(
    ctx,
    cmd('relationship', {
      organisationId,
      ownerId,
      visibility,
      note: 'Private synthetic negotiation context',
    }),
  );
}
async function attribute(organisationId: string, kind = 'capability', ctx = f.users.operator.ctx) {
  const src = await source(ctx);
  const c = await e.createClaim(ctx, {
    sourceId: src.id,
    statement: 'Synthetic factory declares capacity of 100 units',
  });
  const a = await s.command(
    ctx,
    cmd('attribute', {
      organisationId,
      kind,
      claimId: c.id,
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    }),
  );
  return { id: a.id as string, claimId: c.id, sourceId: src.id };
}
async function mission() {
  const brief = {
    objective: 'Sell in a new market',
    market: 'Spain',
    attendance: 'No',
    startDate: '',
    endDate: '',
    timezone: 'Europe/Madrid',
    offer: `Synthetic offer ${randomUUID()}`,
    website: '',
    outcomes: ['Relevant meetings'],
    notes: '',
    name: 'Synthetic Person',
    company: 'Research Test Mission',
    email: 'research@example.invalid',
    acknowledged: true,
  };
  const r = await m.submit(randomUUID(), brief);
  for (const [i, action] of ['qualify', 'activate'].entries())
    await m.command(f.users.operator.ctx, {
      id: r.id,
      version: i + 1,
      commandId: randomUUID(),
      action,
      ownerId: f.users.operator.id,
      reason: 'Synthetic research qualification',
      nextAction: 'Build a sourced shortlist',
      dueAt: until(),
      marketCode: 'ES',
      targetProfile: 'Synthetic distributor target profile',
    });
  return r.id!;
}
const assessment = (claimId: string) => ({
  claimIds: [claimId],
  fit: 'POSSIBLE',
  rationale: 'Declared capacity fits the synthetic requirement',
  uncertainty: 'Capacity is self-declared and buyer interest unknown',
  gaps: 'Independent capacity and decision-maker validation needed',
  nextAction: 'Request evidence and confirm requirements',
  dueAt: until(),
});
beforeAll(async () => {
  f = await fixture();
  s = new CounterpartyService(f.runtime);
  e = new EvidenceService(f.runtime, storage, {
    async scan() {
      return { verdict: 'CLEAN', engine: 'test-contract' };
    },
  });
  m = new MissionService(f.runtime, 'research-test-secret');
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
});
afterAll(async () => {
  await f?.close();
});
test('public ingestion is idempotent, attributed, synthetic-only and rejects private sources', async () => {
  const src = await source();
  const input = cmd('ingest', {
    sourceId: src.id,
    name: 'Research Search Company',
    country: 'DE',
    domain: 'search.example.invalid',
    address: 'Synthetic Search Park',
    identifierType: 'registry',
    identifier: 'SEARCH-1',
  });
  const results = await Promise.all([
    s.command(f.users.operator.ctx, input),
    s.command(f.users.operator.ctx, input),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await s.catalogue(f.users.viewer.ctx, { q: 'Research Search' })).total).toBe(1);
  expect((await s.catalogue(f.users.other.ctx, { q: 'search.example.invalid' })).total).toBe(1);
  await expect(s.command(f.users.operator.ctx, { ...input, name: 'Changed' })).rejects.toThrow(
    'reused',
  );
  const privateSource = await source(f.users.operator.ctx, 'INTERNAL', 'observation');
  await expect(
    s.command(f.users.operator.ctx, {
      ...input,
      commandId: randomUUID(),
      sourceId: privateSource.id,
    }),
  ).rejects.toThrow('public-record');
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.organisation_source WHERE organisation_id=$1',
        [results[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.domain_event d JOIN app.outbox o ON o.event_id=d.id JOIN app.audit_event a ON a.domain_event_id=d.id WHERE d.type='organisation_source.insert' AND d.aggregate_id=(SELECT id::text FROM app.organisation_source WHERE organisation_id=$1)",
        [results[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    s.command(f.users.viewer.ctx, { ...input, commandId: randomUUID() }),
  ).rejects.toThrow('Access denied');
});
test('relationship ownership and team visibility isolate contacts, private notes, search and joins', async () => {
  const org = await company();
  const own = await relationship(org.id),
    team = await relationship(org.id, f.users.operator.id, 'TEAM');
  const src = await source();
  for (const r of [own, team]) {
    await s.command(
      f.users.operator.ctx,
      cmd('contact', {
        relationshipId: r.id,
        sourceId: src.id,
        name: 'Synthetic Buyer',
        jobTitle: 'Test procurement lead',
        email: 'buyer@example.invalid',
        validUntil: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
    await s.command(
      f.users.operator.ctx,
      cmd('note', { relationshipId: r.id, sourceId: src.id, body: `Private note ${r.id}` }),
    );
  }
  const viewer = await s.detail(f.users.viewer.ctx, org.id);
  expect(viewer.relationships.map((r) => r.id)).toEqual([team.id]);
  expect(viewer.contacts).toHaveLength(1);
  expect(viewer.notes).toHaveLength(1);
  const other = await s.detail(f.users.other.ctx, org.id);
  expect(other.relationships).toHaveLength(0);
  expect(other.contacts).toHaveLength(0);
  expect(other.notes).toHaveLength(0);
  expect((await s.catalogue(f.users.other.ctx, { q: 'buyer@example.invalid' })).total).toBe(0);
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.other.ctx,
        'SELECT c.email,n.body FROM app.private_contact_data c JOIN app.private_note n ON n.relationship_id=c.relationship_id',
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    s.command(
      f.users.other.ctx,
      cmd('note', { relationshipId: own.id, sourceId: src.id, body: 'Cross-tenant injection' }),
    ),
  ).rejects.toThrow();
  await expect(
    s.command(
      f.users.operator.ctx,
      cmd('relationship', {
        organisationId: org.id,
        ownerId: f.users.outsider.id,
        visibility: 'TEAM',
        note: 'Invalid owner',
      }),
    ),
  ).rejects.toThrow('owner required');
});
test('five company detail families retain original self-declared claims and visibly expire', async () => {
  const org = await company();
  for (const k of ['product', 'capability', 'certification', 'requirement', 'market'])
    await attribute(org.id, k);
  let detail = await s.detail(f.users.operator.ctx, org.id);
  expect(detail.attributes.map((a) => a.kind).sort()).toEqual([
    'capability',
    'certification',
    'market',
    'product',
    'requirement',
  ]);
  expect(
    detail.attributes.every(
      (a) =>
        a.status === 'SELF_DECLARED' &&
        a.claim_status === 'self_declared' &&
        a.ai_policy === 'DENY',
    ),
  ).toBe(true);
  // Advance only the disposable fixture clock metadata as its owner; immutable runtime rows cannot be edited.
  await f.owner.query(
    'ALTER TABLE app.organisation_attribute DISABLE TRIGGER organisation_attribute_immutable',
  );
  await f.owner.query(
    "UPDATE app.organisation_attribute SET valid_until=created_at+interval '1 millisecond' WHERE organisation_id=$1",
    [org.id],
  );
  await f.owner.query(
    'ALTER TABLE app.organisation_attribute ENABLE TRIGGER organisation_attribute_immutable',
  );
  detail = await s.detail(f.users.operator.ctx, org.id);
  expect(detail.attributes.every((a) => a.status === 'EXPIRED')).toBe(true);
});
test('ambiguous deterministic collisions require review and reversible merge preserves all attribution', async () => {
  const a = await company('Synthetic Duplicate A'),
    b = await company('Synthetic Duplicate B');
  const rel = await relationship(b.id);
  await s.command(f.users.operator.ctx, cmd('candidates', { organisationId: a.id }));
  let d = await s.detail(f.users.owner.ctx, a.id);
  const c = d.candidates.find((c) => [c.left_id, c.right_id].includes(b.id))!;
  expect(c.reasons).toContain('Exact domain; may be shared by a group');
  expect(d.organisation.canonical_id).toBe(a.id);
  await expect(
    s.command(
      f.users.operator.ctx,
      cmd('resolve', {
        candidateId: c.id,
        decision: 'MERGE',
        survivorId: a.id,
        reason: 'Operator cannot review resolution',
      }),
    ),
  ).rejects.toThrow('Access denied');
  const merge = await s.command(
    f.users.owner.ctx,
    cmd('resolve', {
      candidateId: c.id,
      decision: 'MERGE',
      survivorId: a.id,
      reason: 'Human reviewed the duplicate identity sources',
    }),
  );
  d = await s.detail(f.users.owner.ctx, b.id);
  expect(d.organisation.canonical_id).toBe(a.id);
  expect(d.relationships.some((r) => r.id === rel.id && r.organisation_id === b.id)).toBe(true);
  expect(d.aliasIds.sort()).toEqual([a.id, b.id].sort());
  await expect(
    s.command(
      f.users.owner.ctx,
      cmd('resolve', {
        candidateId: c.id,
        decision: 'DISTINCT',
        survivorId: a.id,
        reason: 'Concurrent overwriting attempt',
      }),
    ),
  ).rejects.toThrow('Reverse');
  await s.command(
    f.users.owner.ctx,
    cmd('reverse', {
      resolutionId: merge.id,
      reason: 'New source confirms separate legal entities',
    }),
  );
  d = await s.detail(f.users.owner.ctx, b.id);
  expect(d.organisation.canonical_id).toBe(b.id);
  expect(d.relationships[0].organisation_id).toBe(b.id);
  expect(d.resolutions).toHaveLength(2);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.organisation_source WHERE organisation_id=ANY($1::uuid[])',
        [[a.id, b.id]],
      )
    ).rows[0].n,
  ).toBe(2);
  await s.command(
    f.users.owner.ctx,
    cmd('resolve', {
      candidateId: c.id,
      decision: 'DISTINCT',
      survivorId: a.id,
      reason: 'Reviewed entities are separate despite domain collision',
    }),
  );
});
test('merge decisions require fresh MFA and cannot chain or cross tenants', async () => {
  const a = await company(),
    b = await company(),
    c = await company();
  await s.command(f.users.operator.ctx, cmd('candidates', { organisationId: a.id }));
  const d = await s.detail(f.users.owner.ctx, a.id),
    ab = d.candidates.find((r) => [r.left_id, r.right_id].includes(b.id))!,
    ac = d.candidates.find((r) => [r.left_id, r.right_id].includes(c.id))!;
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  await expect(
    s.command(
      f.users.owner.ctx,
      cmd('resolve', {
        candidateId: ab.id,
        decision: 'MERGE',
        survivorId: a.id,
        reason: 'MFA is stale',
      }),
    ),
  ).rejects.toThrow('authenticator');
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    f.users.owner.sessionId,
  ]);
  await s.command(
    f.users.owner.ctx,
    cmd('resolve', {
      candidateId: ab.id,
      decision: 'MERGE',
      survivorId: a.id,
      reason: 'Reviewed duplicate source identities',
    }),
  );
  await expect(
    s.command(
      f.users.owner.ctx,
      cmd('resolve', {
        candidateId: ac.id,
        decision: 'MERGE',
        survivorId: a.id,
        reason: 'Unsafe chain merge',
      }),
    ),
  ).rejects.toThrow('chaining');
  await expect(
    s.command(
      f.users.other.ctx,
      cmd('resolve', {
        candidateId: ab.id,
        decision: 'MERGE',
        survivorId: a.id,
        reason: 'Cross-tenant resolution',
      }),
    ),
  ).rejects.toThrow();
});
test('mission shortlist explains fit, sources, uncertainty and next action without upgrading claims', async () => {
  const org = await company(),
    rel = await relationship(org.id),
    a = await attribute(org.id),
    id = await mission();
  const target = await s.command(
    f.users.operator.ctx,
    cmd('target', {
      missionId: id,
      relationshipId: rel.id,
      contactId: null,
      ...assessment(a.claimId),
    }),
  );
  let list = await s.shortlist(f.users.operator.ctx, id);
  expect(list.targets).toHaveLength(1);
  expect(list.targets[0]).toMatchObject({ fit: 'POSSIBLE', version: 1 });
  expect(list.targets[0].sources[0].status).toBe('self_declared');
  const v = cmd('assess', {
    targetId: target.id,
    version: 1,
    ...assessment(a.claimId),
    fit: 'STRONG',
  });
  await s.command(f.users.operator.ctx, v);
  expect(await s.command(f.users.operator.ctx, v)).toMatchObject({ version: 2 });
  list = await s.shortlist(f.users.operator.ctx, id);
  expect(list.targets[0].history).toHaveLength(2);
  expect(list.targets[0].sources[0].status).toBe('self_declared');
  expect((await s.shortlist(f.users.viewer.ctx, id)).targets).toHaveLength(0);
  await expect(s.shortlist(f.users.other.ctx, id)).rejects.toThrow('unavailable');
  await expect(s.command(f.users.operator.ctx, { ...v, commandId: randomUUID() })).rejects.toThrow(
    'changed',
  );
});
test('shortlist rejects unrelated claims, mismatched contacts and failed transactions leave no target', async () => {
  const a = await company(),
    b = await company(),
    ra = await relationship(a.id),
    rb = await relationship(b.id),
    attr = await attribute(b.id),
    id = await mission();
  const src = await source();
  const contact = await s.command(
    f.users.operator.ctx,
    cmd('contact', {
      relationshipId: rb.id,
      sourceId: src.id,
      name: 'Synthetic Contact',
      jobTitle: 'Test buyer',
      email: 'other@example.invalid',
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    }),
  );
  const n = (await f.owner.query('SELECT count(*)::int n FROM app.target_account')).rows[0].n;
  await expect(
    s.command(
      f.users.operator.ctx,
      cmd('target', {
        missionId: id,
        relationshipId: ra.id,
        contactId: null,
        ...assessment(attr.claimId),
      }),
    ),
  ).rejects.toThrow('attributable');
  await expect(
    s.command(
      f.users.operator.ctx,
      cmd('target', {
        missionId: id,
        relationshipId: ra.id,
        contactId: contact.id,
        ...assessment(attr.claimId),
      }),
    ),
  ).rejects.toThrow();
  expect((await f.owner.query('SELECT count(*)::int n FROM app.target_account')).rows[0].n).toBe(n);
});
test('only an independently verified PUBLIC fact can be promoted; public claims alone stay unverified', async () => {
  const org = await company(),
    a = await attribute(org.id);
  await expect(
    s.command(f.users.owner.ctx, cmd('publish', { attributeId: a.id, factId: randomUUID() })),
  ).rejects.toThrow('verification required');
  const file = await e.upload(
    f.users.operator.ctx,
    a.claimId,
    Buffer.from('%PDF-1.7\nSynthetic public registry certificate'),
    'application/pdf',
  );
  await e.scan(f.users.operator.ctx, file.id);
  await e.verify(f.users.reviewer.ctx, file.id, {
    decision: 'VERIFIED',
    method: 'Synthetic registry and certificate comparison',
    scope: 'Synthetic capacity statement only; no buyer fit assurance',
    validUntil: until(),
  });
  const detail = await s.detail(f.users.operator.ctx, org.id);
  expect(detail.attributes[0].status).toBe('VERIFIED');
  expect(detail.attributes[0].claim_status).toBe('self_declared');
  const fact = detail.attributes[0].fact_id;
  await expect(
    s.command(f.users.owner.ctx, cmd('publish', { attributeId: a.id, factId: fact })),
  ).rejects.toThrow('verification required');
  await s.command(f.users.reviewer.ctx, cmd('publish', { attributeId: a.id, factId: fact }));
  const other = await s.detail(f.users.other.ctx, org.id);
  expect(other.attributes).toHaveLength(0);
  expect(other.publicFacts[0]).toMatchObject({
    status: 'VERIFIED',
    statement: 'Synthetic factory declares capacity of 100 units',
    scope: 'Synthetic capacity statement only; no buyer fit assurance',
  });
  const internal = await source(f.users.operator.ctx, 'INTERNAL', 'observation');
  const claim = await e.createClaim(f.users.operator.ctx, {
    sourceId: internal.id,
    statement: 'Private negotiation cannot become public',
  });
  const attr = await s.command(
    f.users.operator.ctx,
    cmd('attribute', {
      organisationId: org.id,
      kind: 'requirement',
      claimId: claim.id,
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    }),
  );
  await expect(
    s.command(f.users.reviewer.ctx, cmd('publish', { attributeId: attr.id, factId: fact })),
  ).rejects.toThrow('verification required');
});
test('research feature controls stop ingestion and resolution while read models stay available', async () => {
  const access = new AccessService(f.runtime),
    src = await source();
  await access.appendConfig(f.users.owner.ctx, { key: 'research.ingestion', enabled: false });
  await expect(
    s.command(
      f.users.operator.ctx,
      cmd('ingest', {
        sourceId: src.id,
        name: 'Disabled Company',
        country: 'DE',
        domain: 'disabled.example.invalid',
        address: 'Test Park',
        identifierType: 'registry',
        identifier: 'DISABLED',
      }),
    ),
  ).rejects.toThrow('disabled');
  expect((await s.catalogue(f.users.owner.ctx)).total).toBeGreaterThan(0);
  await access.appendConfig(f.users.owner.ctx, { key: 'research.ingestion', enabled: true });
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      "UPDATE app.organisation_attribute SET kind='certification'",
    ),
  ).rejects.toThrow();
  expect((await f.runtime.query('SELECT * FROM app.private_contact_data')).rowCount).toBe(0);
});
test('catalogue and scoped shortlist paginate without omissions or private counts', async () => {
  const token = `Pagination${randomUUID().replaceAll('-', '')}`;
  const orgs = (
    await f.owner.query(
      `INSERT INTO app.organisation(name,country,synthetic) SELECT $1||' '||n,'DE',true FROM generate_series(1,55) n RETURNING id`,
      [token],
    )
  ).rows;
  const first = await s.catalogue(f.users.operator.ctx, { q: token }),
    last = await s.catalogue(f.users.operator.ctx, { q: token, offset: 50 });
  expect(first.total).toBe(55);
  expect(first.organisations).toHaveLength(50);
  expect(last.organisations).toHaveLength(5);
  expect(new Set([...first.organisations, ...last.organisations].map((o) => o.id)).size).toBe(55);
  const src = await source();
  const claim = await e.createClaim(f.users.operator.ctx, {
    sourceId: src.id,
    statement: 'Synthetic pagination evidence',
  });
  const id = await mission();
  // Bulk fixture setup uses the restricted runtime and real RLS/triggers. Command behavior is covered above.
  const args = [f.tenantA, f.users.operator.id, orgs.map((o) => o.id), id, claim.id];
  await rawContext(
    f.runtime,
    f.users.operator.ctx,
    `INSERT INTO app.relationship(tenant_id,organisation_id,owner_id,visibility,note,classification,purpose) SELECT $1,id,$2,'OWNER','Synthetic paging relationship','INTERNAL','synthetic_validation' FROM app.organisation WHERE id=ANY($3::uuid[])`,
    args.slice(0, 3),
  );
  await rawContext(
    f.runtime,
    f.users.operator.ctx,
    `INSERT INTO app.organisation_attribute(tenant_id,organisation_id,kind,claim_id,valid_until,classification,purpose,created_by) SELECT $1,id,'capability',$4,now()+interval '1 hour','PUBLIC','synthetic_validation',$2 FROM app.organisation WHERE id=ANY($3::uuid[])`,
    [args[0], args[1], args[2], claim.id],
  );
  await rawContext(
    f.runtime,
    f.users.operator.ctx,
    `INSERT INTO app.target_account(tenant_id,mission_id,relationship_id,purpose,created_by) SELECT $1,$4,id,'synthetic_validation',$2 FROM app.relationship WHERE tenant_id=$1 AND organisation_id=ANY($3::uuid[])`,
    args.slice(0, 4),
  );
  await rawContext(
    f.runtime,
    f.users.operator.ctx,
    `INSERT INTO app.match_assessment(tenant_id,target_id,version,fit,rationale,uncertainty,gaps,next_action,due_at,purpose,created_by) SELECT $1,id,1,'POSSIBLE','Synthetic matched requirement','Synthetic unconfirmed capacity','Synthetic evidence needed','Review synthetic evidence',now()+interval '1 day','synthetic_validation',$2 FROM app.target_account WHERE tenant_id=$1 AND mission_id=$3`,
    [f.tenantA, f.users.operator.id, id],
  );
  await rawContext(
    f.runtime,
    f.users.operator.ctx,
    `INSERT INTO app.assessment_claim(tenant_id,assessment_id,claim_id,attribute_id,purpose,created_by) SELECT $1,a.id,$4,oa.id,'synthetic_validation',$2 FROM app.match_assessment a JOIN app.target_account t ON t.tenant_id=a.tenant_id AND t.id=a.target_id JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation_attribute oa ON oa.tenant_id=r.tenant_id AND oa.organisation_id=r.organisation_id WHERE a.tenant_id=$1 AND t.mission_id=$3 AND oa.claim_id=$4`,
    [f.tenantA, f.users.operator.id, id, claim.id],
  );
  const readStarted = Date.now();
  const a = await s.shortlist(f.users.operator.ctx, id),
    b = await s.shortlist(f.users.operator.ctx, id, 50);
  expect(Date.now() - readStarted).toBeLessThan(10000);
  expect(a.total).toBe(55);
  expect(a.targets).toHaveLength(50);
  expect(b.targets).toHaveLength(5);
  expect(new Set([...a.targets, ...b.targets].map((t) => t.id)).size).toBe(55);
  expect(await s.shortlist(f.users.viewer.ctx, id)).toMatchObject({ total: 0, targets: [] });
}, 60000);
test('a reversed merge preserves past shortlist source attribution but cannot support a new mismatched claim', async () => {
  const a = await company(),
    b = await company(),
    rel = await relationship(a.id),
    attr = await attribute(b.id),
    id = await mission();
  await s.command(f.users.operator.ctx, cmd('candidates', { organisationId: a.id }));
  const d = await s.detail(f.users.owner.ctx, a.id),
    candidate = d.candidates.find((c) => [c.left_id, c.right_id].includes(b.id))!;
  const merged = await s.command(
    f.users.owner.ctx,
    cmd('resolve', {
      candidateId: candidate.id,
      decision: 'MERGE',
      survivorId: a.id,
      reason: 'Reviewed synthetic duplicate identifiers',
    }),
  );
  const target = await s.command(
    f.users.operator.ctx,
    cmd('target', {
      missionId: id,
      relationshipId: rel.id,
      contactId: null,
      ...assessment(attr.claimId),
    }),
  );
  await s.command(
    f.users.owner.ctx,
    cmd('reverse', {
      resolutionId: merged.id,
      reason: 'Original legal entities confirmed distinct',
    }),
  );
  const list = await s.shortlist(f.users.operator.ctx, id);
  expect(list.targets[0].sources[0].original_organisation_id).toBe(b.id);
  expect(list.targets[0].sources[0].statement).toBe(
    'Synthetic factory declares capacity of 100 units',
  );
  await expect(
    s.command(
      f.users.operator.ctx,
      cmd('assess', { targetId: target.id, version: 1, ...assessment(attr.claimId) }),
    ),
  ).rejects.toThrow('attributable');
});
test('TARGETING follows activation and supports hold/resume/cancel without enabling outreach', async () => {
  const id = await mission();
  let version = 3;
  for (const action of ['targeting', 'pause', 'resume', 'cancel']) {
    await m.command(f.users.operator.ctx, {
      id,
      version,
      commandId: randomUUID(),
      action,
      ownerId: f.users.operator.id,
      reason: 'Synthetic targeting state validation',
      nextAction: 'Review target evidence',
      dueAt: until(),
      marketCode: 'ES',
      targetProfile: 'Synthetic distributor target profile',
    });
    version++;
  }
  expect((await m.queue(f.users.operator.ctx)).missions.find((r) => r.id === id)?.status).toBe(
    'CANCELLED',
  );
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      "UPDATE app.mission SET status='OUTREACH',version=version+1 WHERE id=$1",
      [id],
    ),
  ).rejects.toThrow('Invalid mission transition');
});
test('populated Part 04 upgrade preserves the mission brief, owner, legacy relationship and migration hashes', async () => {
  const owner = await freshDatabase('corridra_upgrade');
  const runtime = new Pool(
    connection('corridra_upgrade', 'corridra_runtime_local', sandbox.runtimePassword),
  );
  try {
    await migrate(owner, '0007_mission_core.sql');
    const seed = await seedSyntheticWorkspace(owner, {
      email: 'upgrade@example.invalid',
      password: 'Synthetic-upgrade-test-123456',
      name: 'Synthetic Upgrade Owner',
    });
    await configureSyntheticIntake(owner, seed.tenantId, seed.principalId);
    const service = new MissionService(runtime, 'upgrade-test-secret');
    const submitted = await service.submit(randomUUID(), {
      objective: 'Sell in a new market',
      market: 'Spain',
      attendance: 'No',
      startDate: '',
      endDate: '',
      timezone: 'Europe/Madrid',
      offer: 'Synthetic pre-upgrade distributor offer',
      website: '',
      outcomes: ['Relevant meetings'],
      notes: 'Original pre-upgrade test brief',
      name: 'Synthetic Upgrade Submitter',
      company: 'Synthetic Upgrade Company',
      email: 'upgrade-intake@example.invalid',
      acknowledged: true,
    });
    const {
      rows: [original],
    } = await owner.query(
      'SELECT m.id,m.owner_id,m.status,i.brief,i.notice_version,i.retention_until FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.id=$1',
      [submitted.id],
    );
    const previousHash = (
      await owner.query("SELECT sha256 FROM migrations.applied WHERE name='0007_mission_core.sql'")
    ).rows[0].sha256;
    const c = await owner.connect();
    let relationshipId: string;
    try {
      await c.query('BEGIN');
      const {
        rows: [destination],
      } = await c.query('SELECT service_id FROM app.intake_destination');
      await c.query(
        "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
        [destination.service_id, randomUUID(), randomUUID()],
      );
      const org = (
        await c.query(
          "INSERT INTO app.organisation(name,country,synthetic) VALUES('Synthetic Legacy Company','DE',true) RETURNING id",
        )
      ).rows[0];
      relationshipId = (
        await c.query(
          "INSERT INTO app.relationship(tenant_id,organisation_id,owner_id,note,classification,purpose) VALUES($1,$2,$3,'Original private legacy context','INTERNAL','synthetic_validation') RETURNING id",
          [seed.tenantId, org.id, seed.principalId],
        )
      ).rows[0].id;
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    await migrate(owner);
    await migrate(owner);
    expect(
      (
        await owner.query(
          'SELECT m.id,m.owner_id,m.status,i.brief,i.notice_version,i.retention_until FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.id=$1',
          [submitted.id],
        )
      ).rows[0],
    ).toEqual(original);
    expect(
      (
        await owner.query('SELECT visibility,note,owner_id FROM app.relationship WHERE id=$1', [
          relationshipId,
        ])
      ).rows[0],
    ).toMatchObject({
      visibility: 'OWNER',
      note: 'Original private legacy context',
      owner_id: seed.principalId,
    });
    expect(
      (
        await owner.query(
          "SELECT sha256 FROM migrations.applied WHERE name='0007_mission_core.sql'",
        )
      ).rows[0].sha256,
    ).toBe(previousHash);
    expect((await runtime.query('SELECT * FROM app.mission')).rowCount).toBe(0);
    expect((await owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n).toBe(
      28,
    );
  } finally {
    await runtime.end();
    await owner.end();
  }
});
