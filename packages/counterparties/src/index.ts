import { createHash } from 'node:crypto';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  researchCommand,
  researchQuery,
  type ResearchCommand,
} from '@corridra/domain/counterparties';
const fields = `tenant_id,purpose,created_by`;
const actor = (t: TenantTransaction) => [t.tenantId, t.purpose, t.actorId];
async function one(t: TenantTransaction, sql: string, args: unknown[]) {
  const r = await t.db.query(sql, args);
  if (!r.rows[0]) throw new DomainError('Record unavailable', 404);
  return r.rows[0];
}
async function enabled(t: TenantTransaction, key: string) {
  const r = await t.db.query(
    'SELECT value FROM app.config_version WHERE tenant_id=$1 AND key=$2 AND effective_from<=now() ORDER BY version DESC LIMIT 1',
    [t.tenantId, key],
  );
  if (r.rows[0]?.value.enabled === false)
    throw new DomainError('This research command is disabled', 409);
}
export class CounterpartyService {
  constructor(private pool: DatabasePool) {}
  catalogue(ctx: RequestContext, input: unknown = {}) {
    const v = researchQuery.parse(input);
    return withTenant(this.pool, ctx, 'research.read', async (t) => {
      const where = `($1='' OR to_tsvector('simple',o.name) @@ plainto_tsquery('simple',$1) OR i.domain=lower($1) OR i.identifier=upper($1))`;
      const args = [v.q, v.offset, t.tenantId];
      const total = await t.db.query(
        `SELECT count(*)::int total FROM app.organisation o LEFT JOIN app.public_identifier i ON i.organisation_id=o.id WHERE ${where}`,
        [v.q],
      );
      const r = await t.db.query(
        `SELECT o.id,o.name,o.country,o.synthetic,i.domain,i.address,i.identifier_type,i.identifier,i.source_locator,i.observed_at,i.valid_until,CASE WHEN i.id IS NULL THEN 'UNKNOWN' WHEN i.valid_until<=now() THEN 'EXPIRED' ELSE 'SOURCE_REPORTED' END identity_status,app.research_canonical($3,o.id) canonical_id FROM app.organisation o LEFT JOIN app.public_identifier i ON i.organisation_id=o.id WHERE ${where} ORDER BY o.name,o.id LIMIT 50 OFFSET $2`,
        args,
      );
      return { role: t.role, total: total.rows[0].total, offset: v.offset, organisations: r.rows };
    });
  }
  detail(ctx: RequestContext, id: string) {
    return withTenant(this.pool, ctx, 'research.read', async (t) => {
      const organisation = await one(
        t,
        'SELECT id,name,country,synthetic,app.research_canonical($2,id) canonical_id FROM app.organisation WHERE id=$1',
        [id, t.tenantId],
      );
      const aliases = await t.db.query(
        `SELECT c.left_id,c.right_id FROM app.entity_resolution r JOIN app.entity_candidate c ON c.tenant_id=r.tenant_id AND c.id=r.candidate_id WHERE r.tenant_id=$1 AND r.decision='MERGE' AND $2 IN(c.left_id,c.right_id) AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=r.tenant_id AND u.reverse_of=r.id)`,
        [t.tenantId, id],
      );
      const ids: string[] = aliases.rows[0]
        ? [aliases.rows[0].left_id, aliases.rows[0].right_id]
        : [id];
      const identities = (
        await t.db.query(
          `SELECT o.id,o.name,o.country,i.domain,i.address,i.identifier_type,i.identifier,i.source_locator,i.observed_at,i.valid_until,CASE WHEN i.id IS NULL THEN 'UNKNOWN' WHEN i.valid_until<=now() THEN 'EXPIRED' ELSE 'SOURCE_REPORTED' END status FROM app.organisation o LEFT JOIN app.public_identifier i ON i.organisation_id=o.id WHERE o.id=ANY($1::uuid[]) ORDER BY o.name,o.id`,
          [ids],
        )
      ).rows;
      const relationships = (
        await t.db.query(
          'SELECT id,organisation_id,owner_id,visibility,note,version FROM app.relationship WHERE tenant_id=$1 AND organisation_id=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 100',
          [t.tenantId, ids],
        )
      ).rows;
      const rids = relationships.map((r) => r.id);
      const contacts = (
        await t.db.query(
          `SELECT id,relationship_id,name,job_title,email,source_id,valid_until,CASE WHEN valid_until<=now() THEN 'EXPIRED' ELSE 'SOURCE_REPORTED' END status FROM app.private_contact_data WHERE tenant_id=$1 AND relationship_id=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 100`,
          [t.tenantId, rids],
        )
      ).rows;
      const notes = (
        await t.db.query(
          'SELECT id,relationship_id,body,source_id,created_at FROM app.private_note WHERE tenant_id=$1 AND relationship_id=ANY($2::uuid[]) ORDER BY created_at DESC,id LIMIT 100',
          [t.tenantId, rids],
        )
      ).rows;
      const attributes = (
        await t.db.query(
          `SELECT a.id,a.organisation_id,a.kind,a.claim_id,c.statement,c.status claim_status,s.id source_id,s.kind source_kind,s.locator,s.observed_at,s.retention_until,s.ai_policy,s.classification,a.valid_until,CASE WHEN least(a.valid_until,s.retention_until)<=now() THEN 'EXPIRED' WHEN f.id IS NOT NULL THEN 'VERIFIED' ELSE 'SELF_DECLARED' END status,f.id fact_id,v.method,v.scope,v.valid_until verification_valid_until,es.scan_status
       FROM app.organisation_attribute a JOIN app.claim c ON c.tenant_id=a.tenant_id AND c.id=a.claim_id JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
       LEFT JOIN LATERAL(SELECT f.id,v.method,v.scope,v.valid_until,e.id evidence_id FROM app.canonical_fact f JOIN app.verification v ON v.tenant_id=f.tenant_id AND v.id=f.verification_id JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id JOIN app.evidence_state st ON st.tenant_id=e.tenant_id AND st.id=e.id WHERE e.tenant_id=c.tenant_id AND e.claim_id=c.id AND v.valid_until>now() AND e.retention_until>now() AND st.status='VERIFIED' ORDER BY v.created_at DESC LIMIT 1) v ON true LEFT JOIN app.canonical_fact f ON f.tenant_id=a.tenant_id AND f.id=v.id LEFT JOIN app.evidence_state es ON es.tenant_id=a.tenant_id AND es.id=v.evidence_id
       WHERE a.tenant_id=$1 AND a.organisation_id=ANY($2::uuid[]) ORDER BY a.created_at DESC,a.id LIMIT 100`,
          [t.tenantId, ids],
        )
      ).rows;
      const publicFacts = (
        await t.db.query(
          `SELECT id,organisation_id,kind,statement,source_locator,observed_at,valid_until,method,scope,scan_status,app.public_fact_status(id) status FROM app.public_company_fact WHERE organisation_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 100`,
          [ids],
        )
      ).rows;
      const candidates = (
        await t.db.query(
          `SELECT c.*,l.name left_name,r.name right_name FROM app.entity_candidate c JOIN app.organisation l ON l.id=c.left_id JOIN app.organisation r ON r.id=c.right_id WHERE c.tenant_id=$1 AND $2 IN(c.left_id,c.right_id) ORDER BY c.created_at,c.id LIMIT 100`,
          [t.tenantId, id],
        )
      ).rows;
      const resolutions = (
        await t.db.query(
          `SELECT id,candidate_id,decision,survivor_id,reverse_of,reason,created_by,created_at FROM app.entity_resolution WHERE tenant_id=$1 AND candidate_id=ANY($2::uuid[]) ORDER BY created_at,id`,
          [t.tenantId, candidates.map((c) => c.id)],
        )
      ).rows;
      return {
        role: t.role,
        organisation,
        aliasIds: ids,
        identities,
        relationships,
        contacts,
        notes,
        attributes,
        publicFacts,
        candidates,
        resolutions,
      };
    });
  }
  shortlist(ctx: RequestContext, missionId: string, offset = 0) {
    return withTenant(this.pool, ctx, 'research.read', async (t) => {
      await one(t, 'SELECT id FROM app.mission WHERE tenant_id=$1 AND id=$2', [
        t.tenantId,
        missionId,
      ]);
      const rows = (
        await t.db.query(
          `WITH allowed AS MATERIALIZED(SELECT ta.id,ta.mission_id,ta.relationship_id,r.organisation_id,o.name organisation_name FROM app.target_account ta JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id JOIN app.organisation o ON o.id=r.organisation_id WHERE ta.tenant_id=$1 AND ta.mission_id=$2),
          latest AS MATERIALIZED(SELECT DISTINCT ON (target_id) * FROM app.match_assessment WHERE tenant_id=$1 AND target_id IN(SELECT id FROM allowed) ORDER BY target_id,version DESC)
          SELECT ta.*,app.research_canonical($1,ta.organisation_id) canonical_id,a.id assessment_id,a.version,a.fit,a.rationale,a.uncertainty,a.gaps,a.next_action,a.due_at FROM allowed ta JOIN latest a ON a.target_id=ta.id ORDER BY a.due_at,ta.id LIMIT 50 OFFSET $3`,
          [t.tenantId, missionId, offset],
        )
      ).rows;
      const ids = rows.map((r) => r.id),
        assessmentIds = rows.map((r) => r.assessment_id);
      const contacts = (
        await t.db.query(
          `SELECT tc.target_id,c.name,c.job_title,c.email,c.valid_until,CASE WHEN c.valid_until<=now() THEN 'EXPIRED' ELSE 'SOURCE_REPORTED' END status FROM app.target_contact tc JOIN app.private_contact_data c ON c.tenant_id=tc.tenant_id AND c.id=tc.contact_id WHERE tc.tenant_id=$1 AND tc.target_id=ANY($2::uuid[])`,
          [t.tenantId, ids],
        )
      ).rows;
      const sources = (
        await t.db.query(
          `WITH linked AS MATERIALIZED(SELECT assessment_id,claim_id,attribute_id FROM app.assessment_claim WHERE tenant_id=$1 AND assessment_id=ANY($2::uuid[])),
          claims AS MATERIALIZED(SELECT c.id,c.statement,c.status,c.source_id,s.locator,s.observed_at,s.retention_until,s.ai_policy FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=$1 AND c.id IN(SELECT claim_id FROM linked)),
          attrs AS MATERIALIZED(SELECT id,organisation_id,valid_until FROM app.organisation_attribute WHERE tenant_id=$1 AND id IN(SELECT attribute_id FROM linked)),
          verified AS MATERIALIZED(SELECT DISTINCT ON(e.claim_id) e.claim_id,f.id,v.method,v.scope,v.valid_until,st.scan_status FROM app.canonical_fact f JOIN app.verification v ON v.tenant_id=f.tenant_id AND v.id=f.verification_id JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id JOIN app.evidence_state st ON st.tenant_id=e.tenant_id AND st.id=e.id WHERE e.tenant_id=$1 AND e.claim_id IN(SELECT claim_id FROM linked) AND v.valid_until>now() AND e.retention_until>now() AND st.status='VERIFIED' ORDER BY e.claim_id,v.created_at DESC)
          SELECT ac.assessment_id,c.id claim_id,c.statement,c.status,c.locator,c.observed_at,c.retention_until,c.ai_policy,oa.organisation_id original_organisation_id,CASE WHEN least(c.retention_until,oa.valid_until)<=now() THEN 'EXPIRED' WHEN v.id IS NOT NULL THEN 'VERIFIED' ELSE 'SELF_DECLARED' END evidence_status,v.method,v.scope,v.valid_until verification_valid_until,v.scan_status FROM linked ac JOIN claims c ON c.id=ac.claim_id JOIN attrs oa ON oa.id=ac.attribute_id LEFT JOIN verified v ON v.claim_id=ac.claim_id ORDER BY c.id`,
          [t.tenantId, assessmentIds],
        )
      ).rows;
      const history = (
        await t.db.query(
          'SELECT target_id,version,fit,rationale,uncertainty,gaps,next_action,due_at,created_at FROM app.match_assessment WHERE tenant_id=$1 AND target_id=ANY($2::uuid[]) ORDER BY version DESC',
          [t.tenantId, ids],
        )
      ).rows;
      for (const row of rows) {
        row.contacts = contacts.filter((c) => c.target_id === row.id);
        row.sources = sources.filter((c) => c.assessment_id === row.assessment_id);
        row.history = history.filter((h) => h.target_id === row.id);
      }
      const count = await t.db.query(
        'SELECT count(*)::int total FROM app.target_account WHERE tenant_id=$1 AND mission_id=$2',
        [t.tenantId, missionId],
      );
      return { missionId, offset, total: count.rows[0].total, targets: rows };
    });
  }
  command(ctx: RequestContext, input: unknown) {
    const v = researchCommand.parse(input);
    const permission = ['resolve', 'reverse'].includes(v.action)
      ? 'research.resolve'
      : v.action === 'publish'
        ? 'trust.verify'
        : 'research.manage';
    return withTenant(this.pool, ctx, permission, async (t) => {
      const hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
      await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${t.tenantId}:research:${v.commandId}`,
      ]);
      const old = (
        await t.db.query(
          'SELECT request_hash,result FROM app.research_command WHERE tenant_id=$1 AND id=$2',
          [t.tenantId, v.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash)
          throw new DomainError('Command ID reused with different values', 409);
        return old.result;
      }
      if (
        ['ingest', 'attribute', 'contact', 'note', 'relationship', 'candidates'].includes(v.action)
      )
        await enabled(t, 'research.ingestion');
      if (['resolve', 'reverse'].includes(v.action)) await enabled(t, 'research.resolution');
      const result = await this.write(t, v);
      await t.db.query(
        `INSERT INTO app.research_command(id,${fields},request_hash,result,action) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [v.commandId, ...actor(t), hash, JSON.stringify(result), v.action],
      );
      return result;
    }).catch((error: unknown) => {
      if (error instanceof DomainError) throw error;
      const failure = error as { code?: string; message?: string };
      if (failure.code === 'P0001')
        throw new DomainError(failure.message ?? 'Check the current record state', 409);
      if (failure.code === '42501') throw new DomainError('Access denied');
      if (failure.code === '23505')
        throw new DomainError(
          'This record already exists or this command ID is unavailable. Refresh before continuing.',
          409,
        );
      if (failure.code === '23503')
        throw new DomainError('Linked record unavailable for this relationship or workspace', 409);
      if (failure.code === '23514')
        throw new DomainError('Check source validity and the submitted record values', 400);
      throw error;
    });
  }
  private async assess(
    t: TenantTransaction,
    targetId: string,
    v: Extract<ResearchCommand, { action: 'target' | 'assess' }>,
    version: number,
  ) {
    const a = await one(
      t,
      `INSERT INTO app.match_assessment(${fields},target_id,version,fit,rationale,uncertainty,gaps,next_action,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,version`,
      [
        ...actor(t),
        targetId,
        version,
        v.fit,
        v.rationale,
        v.uncertainty,
        v.gaps,
        v.nextAction,
        v.dueAt,
      ],
    );
    const relation = await one(
      t,
      'SELECT r.organisation_id FROM app.target_account ta JOIN app.relationship r ON r.tenant_id=ta.tenant_id AND r.id=ta.relationship_id WHERE ta.tenant_id=$1 AND ta.id=$2',
      [t.tenantId, targetId],
    );
    const aliases = (
      await t.db.query(
        `SELECT c.left_id,c.right_id FROM app.entity_resolution r JOIN app.entity_candidate c ON c.tenant_id=r.tenant_id AND c.id=r.candidate_id WHERE r.tenant_id=$1 AND r.decision='MERGE' AND $2 IN(c.left_id,c.right_id) AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=r.tenant_id AND u.reverse_of=r.id)`,
        [t.tenantId, relation.organisation_id],
      )
    ).rows;
    const organisationIds = aliases[0]
      ? [aliases[0].left_id, aliases[0].right_id]
      : [relation.organisation_id];
    for (const claim of [...new Set(v.claimIds)]) {
      const found = await t.db.query(
        `SELECT oa.id FROM app.organisation_attribute oa JOIN app.claim c ON c.tenant_id=oa.tenant_id AND c.id=oa.claim_id JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE oa.tenant_id=$1 AND oa.organisation_id=ANY($2::uuid[]) AND oa.claim_id=$3 AND oa.valid_until>now() AND s.retention_until>now() ORDER BY oa.created_at,oa.id LIMIT 1`,
        [t.tenantId, organisationIds, claim],
      );
      if (!found.rows[0])
        throw new DomainError('Current attributable target evidence required', 409);
      await t.db.query(
        `INSERT INTO app.assessment_claim(${fields},assessment_id,claim_id,attribute_id) VALUES($1,$2,$3,$4,$5,$6)`,
        [...actor(t), a.id, claim, found.rows[0].id],
      );
    }
    return a;
  }
  private async write(t: TenantTransaction, v: ResearchCommand): Promise<Record<string, unknown>> {
    switch (v.action) {
      case 'ingest':
        return one(t, 'SELECT app.ingest_public_organisation($1,$2,$3,$4,$5,$6,$7,$8) id', [
          t.tenantId,
          v.sourceId,
          v.name,
          v.country,
          v.domain,
          v.address,
          v.identifierType,
          v.identifier,
        ]);
      case 'relationship':
        return one(
          t,
          `INSERT INTO app.relationship(tenant_id,organisation_id,owner_id,visibility,note,classification,purpose) VALUES($1,$2,$3,$4,$5,'INTERNAL',$6) RETURNING id,version`,
          [t.tenantId, v.organisationId, v.ownerId, v.visibility, v.note, t.purpose],
        );
      case 'contact':
        return one(
          t,
          `INSERT INTO app.private_contact_data(${fields},relationship_id,source_id,name,job_title,email,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [...actor(t), v.relationshipId, v.sourceId, v.name, v.jobTitle, v.email, v.validUntil],
        );
      case 'note':
        return one(
          t,
          `INSERT INTO app.private_note(${fields},relationship_id,source_id,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [...actor(t), v.relationshipId, v.sourceId, v.body],
        );
      case 'attribute':
        return one(
          t,
          `INSERT INTO app.organisation_attribute(${fields},organisation_id,kind,claim_id,valid_until,classification) SELECT $1,$2,$3,$4,$5,$6,$7,c.classification FROM app.claim c WHERE c.tenant_id=$1 AND c.id=$6 RETURNING id`,
          [...actor(t), v.organisationId, v.kind, v.claimId, v.validUntil],
        );
      case 'publish':
        return one(t, 'SELECT app.publish_company_fact($1,$2,$3) id', [
          t.tenantId,
          v.attributeId,
          v.factId,
        ]);
      case 'candidates': {
        await one(t, 'SELECT organisation_id FROM app.public_identifier WHERE organisation_id=$1', [
          v.organisationId,
        ]);
        const r = await t.db.query(
          `INSERT INTO app.entity_candidate(${fields},left_id,right_id,reasons)
         SELECT $1,$2,$3,least(a.organisation_id,b.organisation_id),greatest(a.organisation_id,b.organisation_id),to_jsonb(array_remove(ARRAY[CASE WHEN a.domain=b.domain THEN 'Exact domain; may be shared by a group' END,CASE WHEN a.identifier_type=b.identifier_type AND a.identifier=b.identifier AND ao.country=bo.country THEN 'Exact country-scoped identifier; review source quality' END,CASE WHEN lower(a.address)=lower(b.address) AND ao.country=bo.country THEN 'Exact country-scoped address; may be shared premises' END],NULL))
         FROM app.public_identifier a JOIN app.organisation ao ON ao.id=a.organisation_id CROSS JOIN app.public_identifier b JOIN app.organisation bo ON bo.id=b.organisation_id WHERE a.organisation_id=$4 AND a.organisation_id<>b.organisation_id AND a.valid_until>now() AND b.valid_until>now() AND (a.domain=b.domain OR (ao.country=bo.country AND ((a.identifier_type=b.identifier_type AND a.identifier=b.identifier) OR lower(a.address)=lower(b.address)))) ON CONFLICT(tenant_id,left_id,right_id) DO NOTHING RETURNING id`,
          [...actor(t), v.organisationId],
        );
        return { created: r.rowCount };
      }
      case 'resolve':
        return one(
          t,
          `INSERT INTO app.entity_resolution(${fields},candidate_id,decision,survivor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [...actor(t), v.candidateId, v.decision, v.survivorId, v.reason],
        );
      case 'reverse':
        return one(
          t,
          `INSERT INTO app.entity_resolution(${fields},candidate_id,decision,survivor_id,reverse_of,reason) SELECT $1,$2,$3,candidate_id,'REVERSE',survivor_id,id,$5 FROM app.entity_resolution WHERE tenant_id=$1 AND id=$4 AND decision<>'REVERSE' RETURNING id`,
          [...actor(t), v.resolutionId, v.reason],
        );
      case 'target': {
        const target = await one(
          t,
          `INSERT INTO app.target_account(${fields},mission_id,relationship_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [...actor(t), v.missionId, v.relationshipId],
        );
        if (v.contactId)
          await t.db.query(
            `INSERT INTO app.target_contact(${fields},target_id,relationship_id,contact_id) VALUES($1,$2,$3,$4,$5,$6)`,
            [...actor(t), target.id, v.relationshipId, v.contactId],
          );
        const a = await this.assess(t, target.id, v, 1);
        return { id: target.id, assessmentId: a.id, version: a.version };
      }
      case 'assess': {
        await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${t.tenantId}:assessment:${v.targetId}`,
        ]);
        await one(t, 'SELECT id FROM app.target_account WHERE tenant_id=$1 AND id=$2', [
          t.tenantId,
          v.targetId,
        ]);
        const old = await one(
          t,
          'SELECT version FROM app.match_assessment WHERE tenant_id=$1 AND target_id=$2 ORDER BY version DESC LIMIT 1',
          [t.tenantId, v.targetId],
        );
        if (old.version !== v.version)
          throw new DomainError('Assessment changed. Refresh before saving.', 409);
        const a = await this.assess(t, v.targetId, v, old.version + 1);
        return { id: v.targetId, assessmentId: a.id, version: a.version };
      }
    }
  }
}
