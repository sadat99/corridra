import { randomUUID, createHash } from 'node:crypto';
import {
  DomainError,
  sourceInput,
  claimInput,
  assertTransition,
  type EvidenceStatus,
} from '@corridra/domain';
import { withTenant, type Pool, type RequestContext } from '@corridra/db';
export interface ObjectStorage {
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}
export interface MalwareScanner {
  scan(body: Uint8Array): Promise<{ verdict: 'CLEAN' | 'INFECTED' | 'ERROR'; engine: string }>;
}
export function inspectFile(body: Uint8Array, declaredMime: string) {
  if (body.length === 0 || body.length > 4 * 1024 * 1024)
    throw new DomainError('File must be between 1 byte and 4 MiB', 400);
  const b = Buffer.from(body);
  let mime: string | undefined;
  if (b.subarray(0, 5).equals(Buffer.from('%PDF-'))) mime = 'application/pdf';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) mime = 'image/jpeg';
  if (!mime || mime !== declaredMime)
    throw new DomainError('Unsupported file type or MIME mismatch', 400);
  return { mime, sha256: createHash('sha256').update(body).digest('hex'), size: body.length };
}
export class EvidenceService {
  constructor(
    private pool: Pool,
    private storage: ObjectStorage,
    private scanner: MalwareScanner,
  ) {}
  async workspace(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'trust.read', async (t) => ({
      role: t.role,
      actorId: t.actorId,
      tenantId: t.tenantId,
      freshMfa: t.freshMfa,
      sources: (
        await t.db.query(
          'SELECT id,kind,locator,classification,observed_at FROM app.source_record WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',
          [t.tenantId],
        )
      ).rows,
      claims: (
        await t.db.query(
          'SELECT id,source_id,statement,status FROM app.claim WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',
          [t.tenantId],
        )
      ).rows,
      evidence: (
        await t.db.query(
          'SELECT e.id,e.claim_id,e.mime,e.size_bytes,e.created_by,s.status,s.scan_status,s.version FROM app.evidence_object e JOIN app.evidence_state s USING(tenant_id,id) WHERE e.tenant_id=$1 ORDER BY e.created_at DESC LIMIT 50',
          [t.tenantId],
        )
      ).rows,
      facts: (
        await t.db.query(
          "SELECT f.id,f.statement,v.valid_until FROM app.canonical_fact f JOIN app.verification v ON v.tenant_id=f.tenant_id AND v.id=f.verification_id JOIN app.evidence_state s ON s.tenant_id=v.tenant_id AND s.id=v.evidence_id JOIN app.evidence_object e ON e.tenant_id=s.tenant_id AND e.id=s.id WHERE f.tenant_id=$1 AND v.valid_until>now() AND e.retention_until>now() AND s.status='VERIFIED'",
          [t.tenantId],
        )
      ).rows,
    }));
  }
  createSource(ctx: RequestContext, input: unknown) {
    const v = sourceInput.parse(input);
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      if (
        v.purpose !== t.purpose ||
        new Date(v.retentionUntil) <= new Date() ||
        (v.purpose === 'synthetic_validation' &&
          new Date(v.retentionUntil).getTime() > Date.now() + 30 * 86400000)
      )
        throw new DomainError('Invalid purpose or retention', 400);
      const r = await t.db.query(
        `INSERT INTO app.source_record(tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          t.tenantId,
          v.kind,
          v.locator,
          v.observedAt,
          v.classification,
          v.purpose,
          v.retentionUntil,
          v.aiPolicy,
          t.actorId,
        ],
      );
      return r.rows[0];
    });
  }
  createClaim(ctx: RequestContext, input: unknown) {
    const v = claimInput.parse(input);
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const r = await t.db.query(
        `INSERT INTO app.claim(tenant_id,source_id,statement,classification,purpose,created_by) SELECT tenant_id,id,$3,classification,purpose,$4 FROM app.source_record WHERE tenant_id=$1 AND id=$2 AND retention_until>now() RETURNING id`,
        [t.tenantId, v.sourceId, v.statement, t.actorId],
      );
      if (!r.rowCount) throw new DomainError('Source unavailable', 404);
      return r.rows[0];
    });
  }
  async upload(ctx: RequestContext, claimId: string, body: Uint8Array, mime: string) {
    const info = inspectFile(body, mime),
      id = randomUUID();
    // Authorization precedes storage. An abandoned put stays private; synthetic bucket lifecycle removes it after 35 days.
    const metadata = await withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const r = await t.db.query(
        `SELECT c.classification,c.purpose,s.retention_until,s.ai_policy FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=$1 AND c.id=$2 AND s.retention_until>now()`,
        [t.tenantId, claimId],
      );
      if (!r.rowCount) throw new DomainError('Claim unavailable', 404);
      return r.rows[0];
    });
    const key = `quarantine/${ctx.tenantId}/${id}`;
    await this.storage.put(key, body, info.mime);
    await withTenant(this.pool, ctx, 'trust.write', async (t) => {
      await t.db.query(
        `INSERT INTO app.evidence_object(id,tenant_id,claim_id,object_key,sha256,mime,size_bytes,classification,purpose,retention_until,ai_policy,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          t.tenantId,
          claimId,
          key,
          info.sha256,
          info.mime,
          info.size,
          metadata.classification,
          metadata.purpose,
          metadata.retention_until,
          metadata.ai_policy,
          t.actorId,
        ],
      );
      await t.db.query(
        `INSERT INTO app.evidence_state(id,tenant_id,classification,purpose) VALUES($1,$2,$3,$4)`,
        [id, t.tenantId, metadata.classification, metadata.purpose],
      );
    });
    return { id, status: 'SUBMITTED', scanStatus: 'PENDING' };
  }
  async scan(ctx: RequestContext, id: string) {
    const e = await withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const r = await t.db.query(
        'SELECT e.*,s.status FROM app.evidence_object e JOIN app.evidence_state s USING(tenant_id,id) WHERE e.tenant_id=$1 AND e.id=$2',
        [t.tenantId, id],
      );
      if (!r.rowCount || r.rows[0].status !== 'SUBMITTED')
        throw new DomainError('Evidence unavailable for scanning', 409);
      return r.rows[0];
    });
    let verdict: { verdict: 'CLEAN' | 'INFECTED' | 'ERROR'; engine: string } = {
      verdict: 'ERROR',
      engine: 'unavailable',
    };
    let hash = 'unavailable';
    try {
      const body = await this.storage.get(e.object_key);
      const checked = inspectFile(body, e.mime);
      hash = checked.sha256;
      if (hash === e.sha256 && body.length === Number(e.size_bytes))
        verdict = await this.scanner.scan(body);
      else verdict = { verdict: 'INFECTED', engine: 'integrity-check' };
    } catch {
      /* Fail closed. No scanner/storage details reach the caller. */
    }
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const state = await t.db.query(
        'SELECT * FROM app.evidence_state WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [t.tenantId, id],
      );
      if (state.rows[0]?.status !== 'SUBMITTED')
        throw new DomainError('Evidence changed during scanning', 409);
      await t.db.query(
        'INSERT INTO app.scan_report(tenant_id,evidence_id,verdict,engine,scanned_sha256,classification,purpose) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [t.tenantId, id, verdict.verdict, verdict.engine, hash, e.classification, e.purpose],
      );
      const next =
        verdict.verdict === 'CLEAN'
          ? 'UNDER_REVIEW'
          : verdict.verdict === 'INFECTED'
            ? 'REJECTED'
            : 'SUBMITTED';
      await t.db.query(
        'UPDATE app.evidence_state SET status=$3,scan_status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2',
        [t.tenantId, id, next, verdict.verdict],
      );
      return { id, status: next, scanStatus: verdict.verdict };
    });
  }
  verify(
    ctx: RequestContext,
    id: string,
    input: { decision: 'VERIFIED' | 'REJECTED'; method: string; scope: string; validUntil: string },
  ) {
    if (
      input.method.length < 3 ||
      input.method.length > 300 ||
      input.scope.length < 3 ||
      input.scope.length > 1000 ||
      !['VERIFIED', 'REJECTED'].includes(input.decision) ||
      !(new Date(input.validUntil) > new Date())
    )
      throw new DomainError('Invalid verification', 400);
    return withTenant(this.pool, ctx, 'trust.verify', async (t) => {
      const r = await t.db.query(
        `SELECT s.*,e.created_by,e.claim_id FROM app.evidence_state s JOIN app.evidence_object e USING(tenant_id,id) WHERE s.tenant_id=$1 AND s.id=$2 FOR UPDATE OF s`,
        [t.tenantId, id],
      );
      const e = r.rows[0];
      if (!e) throw new DomainError('Evidence unavailable', 404);
      if (e.created_by === t.actorId)
        throw new DomainError('A different reviewer must verify the evidence');
      assertTransition(e.status as EvidenceStatus, input.decision);
      if (e.scan_status !== 'CLEAN') throw new DomainError('Evidence is quarantined', 409);
      const verificationId = randomUUID();
      await t.db.query(
        `INSERT INTO app.verification(id,tenant_id,evidence_id,decision,method,scope,valid_until,reviewer_id,classification,purpose) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          verificationId,
          t.tenantId,
          id,
          input.decision,
          input.method,
          input.scope,
          input.validUntil,
          t.actorId,
          e.classification,
          e.purpose,
        ],
      );
      await t.db.query(
        'UPDATE app.evidence_state SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2',
        [t.tenantId, id, input.decision],
      );
      if (input.decision === 'VERIFIED')
        await t.db.query(
          `INSERT INTO app.canonical_fact(tenant_id,verification_id,statement,classification,purpose) SELECT tenant_id,$3,statement,classification,purpose FROM app.claim WHERE tenant_id=$1 AND id=$2`,
          [t.tenantId, e.claim_id, verificationId],
        );
      return { id: verificationId, decision: input.decision };
    });
  }
  async download(ctx: RequestContext, id: string) {
    const e = await withTenant(this.pool, ctx, 'trust.read', async (t) => {
      const r = await t.db.query(
        `SELECT e.* FROM app.evidence_object e JOIN app.evidence_state s USING(tenant_id,id) WHERE e.tenant_id=$1 AND e.id=$2 AND s.scan_status='CLEAN' AND s.status IN ('UNDER_REVIEW','VERIFIED') AND e.retention_until>now()`,
        [t.tenantId, id],
      );
      if (!r.rowCount) throw new DomainError('Evidence unavailable', 404);
      return r.rows[0];
    });
    const body = await this.storage.get(e.object_key);
    if (createHash('sha256').update(body).digest('hex') !== e.sha256)
      throw new DomainError('Evidence integrity check failed', 409);
    return { body, mime: e.mime };
  }
}
