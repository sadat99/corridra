import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  programmeInput,
  publicationInput,
  shareInput,
  requestInput,
  publicDeliveryInput,
} from '@corridra/domain/delivery';
import { MissionService } from '@corridra/missions';
import { parseImport, importCounts, type ImportRow } from './import';
import { reportCsv, reportPdf, type DeliveryReport } from './report';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const id = z.uuid();
export class DeliveryService {
  constructor(
    private pool: DatabasePool,
    private missions: MissionService,
    private secret: string,
  ) {}
  private token(tenant: string, command: string) {
    return createHmac('sha256', this.secret)
      .update(`delivery-link:${tenant}:${command}`)
      .digest('hex');
  }
  options(ctx: RequestContext, missionId: string) {
    id.parse(missionId);
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db }) => ({
      missionId,
      meetings: (
        await db.query(
          'SELECT id,title,mission_id,version,status,starts_at,location FROM app.meeting WHERE tenant_id=$1 AND mission_id=$2 ORDER BY starts_at,id',
          [ctx.tenantId, missionId],
        )
      ).rows,
      opportunities: (
        await db.query(
          'SELECT id,title,status FROM app.opportunity WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at,id',
          [ctx.tenantId, missionId],
        )
      ).rows,
    }));
  }
  async workspace(ctx: RequestContext, programmeId?: string, offset = 0) {
    if (programmeId) id.parse(programmeId);
    z.int().min(0).max(100000).parse(offset);
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db, role }) => ({
      role,
      programmes: (
        await db.query(
          'SELECT id,name,reporting_purpose,created_at FROM app.delivery_programme WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100 OFFSET $2',
          [ctx.tenantId, offset],
        )
      ).rows,
      programmeTotal: (
        await db.query('SELECT count(*)::int n FROM app.delivery_programme WHERE tenant_id=$1', [
          ctx.tenantId,
        ])
      ).rows[0].n,
      participants: (
        await db.query(
          "SELECT dp.id,dp.reference,dp.mission_id,mi.brief->>'company' company,m.status FROM app.delivery_participant dp JOIN app.mission m ON m.tenant_id=dp.tenant_id AND m.id=dp.mission_id JOIN app.mission_intake mi ON mi.tenant_id=m.tenant_id AND mi.id=m.id WHERE dp.tenant_id=$1 AND dp.programme_id=$2 ORDER BY dp.reference LIMIT 1000",
          [ctx.tenantId, programmeId ?? null],
        )
      ).rows,
      publications: (
        await db.query(
          `SELECT DISTINCT ON(p.mission_id) p.id,p.mission_id,p.copy,p.created_at,EXISTS(SELECT FROM app.delivery_revocation r WHERE r.tenant_id=p.tenant_id AND r.publication_id=p.id) revoked FROM app.delivery_publication p WHERE p.tenant_id=$1 AND (p.mission_id IN(SELECT mission_id FROM app.delivery_participant WHERE tenant_id=$1 AND programme_id=$2) OR $2::uuid IS NULL) ORDER BY p.mission_id,p.created_at DESC,p.id LIMIT 1000`,
          [ctx.tenantId, programmeId ?? null],
        )
      ).rows,
      links: (
        await db.query(
          'SELECT l.id,l.audience,l.reporting_purpose,l.expires_at,l.allow_export,l.publication_ids,EXISTS(SELECT FROM app.delivery_revocation r WHERE r.tenant_id=l.tenant_id AND r.link_id=l.id) revoked FROM app.delivery_link l WHERE l.tenant_id=$1 AND (l.programme_id=$2 OR $2::uuid IS NULL) ORDER BY l.created_at DESC LIMIT 1000',
          [ctx.tenantId, programmeId ?? null],
        )
      ).rows,
      requests: (
        await db.query(
          `SELECT r.*,coalesce(c.status,CASE WHEN s.id IS NULL THEN 'OPEN' ELSE 'RESPONDED' END) status,s.body response,s.claim_status FROM app.delivery_request r LEFT JOIN app.delivery_response s ON s.tenant_id=r.tenant_id AND s.request_id=r.id LEFT JOIN app.delivery_request_close c ON c.tenant_id=r.tenant_id AND c.request_id=r.id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 1000`,
          [ctx.tenantId],
        )
      ).rows,
      owners: (await db.query('SELECT * FROM app.mission_owners($1)', [ctx.tenantId])).rows,
    }));
  }
  programme(ctx: RequestContext, input: unknown) {
    const v = programmeInput.parse(input);
    return withTenant(this.pool, ctx, 'delivery.manage', async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [v.commandId]);
      const old = (
        await db.query('SELECT * FROM app.delivery_programme WHERE id=$1', [v.commandId])
      ).rows[0];
      if (old) {
        if (
          old.created_by !== actorId ||
          old.name !== v.name ||
          old.reporting_purpose !== v.reportingPurpose
        )
          throw new DomainError('Programme command reused', 409);
        return { id: old.id };
      }
      await db.query(
        'INSERT INTO app.delivery_programme(id,tenant_id,name,reporting_purpose,created_by) VALUES($1,$2,$3,$4,$5)',
        [v.commandId, ctx.tenantId, v.name, v.reportingPurpose, actorId],
      );
      return { id: v.commandId };
    });
  }
  async preview(
    ctx: RequestContext,
    programmeId: string,
    commandId: string,
    bytes: Buffer,
    format: 'CSV' | 'XLSX',
  ) {
    id.parse(programmeId);
    id.parse(commandId);
    z.enum(['CSV', 'XLSX']).parse(format);
    // Authorize before spending CPU on a caller's archive.
    return withTenant(this.pool, ctx, 'delivery.manage', async (tx) => {
      const { db, actorId } = tx;
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `delivery-programme:${ctx.tenantId}:${programmeId}`,
      ]);
      const programme = (
        await db.query('SELECT id FROM app.delivery_programme WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          programmeId,
        ])
      ).rows[0];
      if (!programme) throw new DomainError('Programme not found', 404);
      const fileHash = digest(bytes);
      const old = (await db.query('SELECT * FROM app.delivery_import WHERE id=$1', [commandId]))
        .rows[0];
      if (old) {
        if (
          old.programme_id !== programmeId ||
          old.created_by !== actorId ||
          old.file_hash !== fileHash ||
          old.format !== format
        )
          throw new DomainError('Preview command reused', 409);
        return {
          id: old.id,
          rows: old.rows as ImportRow[],
          counts: importCounts(old.rows),
          expiresAt: old.expires_at,
        };
      }
      const rows = await parseImport(
        bytes,
        format,
        tx.purpose === 'synthetic_validation' ? 'synthetic' : 'real',
      );
      const existing = (
        await db.query(
          'SELECT reference,brief_hash,mission_id FROM app.delivery_participant WHERE tenant_id=$1 AND programme_id=$2',
          [ctx.tenantId, programmeId],
        )
      ).rows;
      for (const row of rows)
        if (row.status === 'READY' || row.status === 'DUPLICATE_FILE') {
          const match = existing.find((r) => r.reference === row.reference);
          if (match) {
            if (match.brief_hash === row.hash) {
              row.status = 'DUPLICATE_EXISTING';
              row.missionId = match.mission_id;
            } else {
              row.status = 'ERROR';
              row.errors = ['Participant reference already belongs to a different brief'];
            }
          }
        }
      const result = await db.query(
        'INSERT INTO app.delivery_import(id,tenant_id,programme_id,file_hash,format,rows,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING expires_at',
        [commandId, ctx.tenantId, programmeId, fileHash, format, JSON.stringify(rows), actorId],
      );
      return {
        id: commandId,
        rows,
        counts: importCounts(rows),
        expiresAt: result.rows[0].expires_at,
      };
    });
  }
  confirm(ctx: RequestContext, input: unknown) {
    const v = z
      .object({
        commandId: id,
        importId: id,
        ownerId: id,
        acknowledged: z.literal(true),
        counts: z.object({
          ready: z.int().min(0),
          duplicates: z.int().min(0),
          empty: z.int().min(0),
          errors: z.literal(0),
          total: z.int().positive(),
        }),
      })
      .parse(input);
    const h = digest(JSON.stringify(v));
    return withTenant(this.pool, ctx, 'delivery.manage', async (tx) => {
      const { db, actorId } = tx;
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [v.commandId]);
      const old = (
        await db.query(
          'SELECT * FROM app.delivery_acceptance WHERE id=$1 OR (tenant_id=$2 AND import_id=$3)',
          [v.commandId, ctx.tenantId, v.importId],
        )
      ).rows[0];
      if (old) {
        if (old.id !== v.commandId || old.input_hash !== h || old.created_by !== actorId)
          throw new DomainError('Import was already confirmed or command changed', 409);
        return old.result;
      }
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `delivery-import:${ctx.tenantId}:${v.importId}`,
      ]);
      const batch = (
        await db.query('SELECT * FROM app.delivery_import WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          v.importId,
        ])
      ).rows[0];
      if (!batch || batch.created_by !== actorId) throw new DomainError('Preview unavailable', 404);
      if (new Date(batch.expires_at) <= new Date())
        throw new DomainError('Preview expired. Upload the file again.', 409);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `delivery-programme:${ctx.tenantId}:${batch.programme_id}`,
      ]);
      const counts = importCounts(batch.rows);
      if (counts.errors || JSON.stringify(counts) !== JSON.stringify(v.counts))
        throw new DomainError('Review and acknowledge the exact preview counts', 409);
      const existing = (
        await db.query(
          'SELECT reference,brief_hash,mission_id FROM app.delivery_participant WHERE tenant_id=$1 AND programme_id=$2',
          [ctx.tenantId, batch.programme_id],
        )
      ).rows;
      const total = existing.length + counts.ready;
      if (total > 1000) throw new DomainError('Programme limit is 1000 participants', 409);
      const rows = batch.rows as ImportRow[];
      const result: { row: number; reference: string; result: string; missionId?: string }[] = [];
      for (const row of rows) {
        if (row.status === 'EMPTY') {
          result.push({ row: row.row, reference: row.reference, result: 'EMPTY' });
          continue;
        }
        let match = existing.find((p) => p.reference === row.reference);
        if (match && match.brief_hash !== row.hash)
          throw new DomainError('Programme changed. Preview the file again.', 409);
        if (!match && row.status === 'DUPLICATE_EXISTING')
          throw new DomainError('Programme changed. Preview the file again.', 409);
        let status = 'DUPLICATE';
        if (!match) {
          const missionId = await this.missions.importBrief(tx, randomUUID(), v.ownerId, row.brief);
          await db.query(
            'INSERT INTO app.delivery_participant(id,tenant_id,programme_id,import_id,reference,brief_hash,mission_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              randomUUID(),
              ctx.tenantId,
              batch.programme_id,
              v.importId,
              row.reference,
              row.hash,
              missionId,
              actorId,
            ],
          );
          match = { reference: row.reference, brief_hash: row.hash, mission_id: missionId };
          existing.push(match);
          status = 'ACCEPTED';
        }
        result.push({
          row: row.row,
          reference: row.reference,
          result: status,
          missionId: match.mission_id,
        });
      }
      const response = {
        programmeId: batch.programme_id,
        importId: v.importId,
        counts,
        rows: result,
      };
      await db.query(
        'INSERT INTO app.delivery_acceptance(id,tenant_id,import_id,owner_id,input_hash,result,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',
        [v.commandId, ctx.tenantId, v.importId, v.ownerId, h, JSON.stringify(response), actorId],
      );
      return response;
    });
  }
  publication(ctx: RequestContext, input: unknown) {
    const { commandId, missionId, approved: _approved, ...copy } = publicationInput.parse(input);
    void _approved;
    return this.insert(ctx, 'delivery.share', 'delivery_publication', commandId, {
      mission_id: missionId,
      copy,
    });
  }
  async share(ctx: RequestContext, input: unknown) {
    const v = shareInput.parse(input),
      token = this.token(ctx.tenantId, v.commandId);
    await this.insert(ctx, 'delivery.share', 'delivery_link', v.commandId, {
      programme_id: v.programmeId,
      publication_ids: v.publicationIds,
      audience: v.audience,
      reporting_purpose: v.purpose,
      token_hash: digest(token),
      expires_at: v.expiresAt,
      allow_export: v.allowExport,
      include_delegation: v.includeDelegation,
    });
    return {
      id: v.commandId,
      token,
      path: v.audience === 'CLIENT_PROGRESS' ? '/client' : '/programme',
    };
  }
  request(ctx: RequestContext, input: unknown) {
    const v = requestInput.parse(input);
    return this.insert(ctx, 'delivery.share', 'delivery_request', v.commandId, {
      publication_id: v.publicationId,
      owner_id: v.ownerId,
      title: v.title,
      instructions: v.instructions,
      due_at: v.dueAt,
    });
  }
  closeRequest(ctx: RequestContext, input: unknown) {
    const v = z
      .object({
        commandId: id,
        requestId: id,
        status: z.enum(['COMPLETED', 'CANCELLED']),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input);
    return this.insert(ctx, 'delivery.manage', 'delivery_request_close', v.commandId, {
      request_id: v.requestId,
      status: v.status,
      reason: v.reason,
    });
  }
  revoke(ctx: RequestContext, input: unknown) {
    const v = z
      .object({
        commandId: id,
        linkId: id.nullable(),
        publicationId: id.nullable(),
        reason: z.string().trim().min(3).max(500),
      })
      .refine((v) => !!v.linkId !== !!v.publicationId)
      .parse(input);
    return this.insert(ctx, 'delivery.manage', 'delivery_revocation', v.commandId, {
      link_id: v.linkId,
      publication_id: v.publicationId,
      reason: v.reason,
    });
  }
  private insert(
    ctx: RequestContext,
    permission: 'delivery.manage' | 'delivery.share',
    table: string,
    commandId: string,
    values: Record<string, unknown>,
  ) {
    // Table/column names are internal constants, never request values.
    return withTenant(this.pool, ctx, permission, async ({ db, actorId }: TenantTransaction) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [commandId]);
      const entries = Object.entries(values);
      const old = (
        await db.query(`SELECT to_jsonb(entry) record FROM app.${table} entry WHERE id=$1`, [
          commandId,
        ])
      ).rows[0]?.record;
      if (old) {
        const equal = (a: unknown, b: unknown): boolean => {
          if (a === b) return true;
          if (Array.isArray(a) && Array.isArray(b))
            return a.length === b.length && a.every((x, i) => equal(x, b[i]));
          if (a && b && typeof a === 'object' && typeof b === 'object') {
            const x = a as Record<string, unknown>,
              y = b as Record<string, unknown>;
            return (
              Object.keys(x).length === Object.keys(y).length &&
              Object.keys(x).every((k) => equal(x[k], y[k]))
            );
          }
          if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a))
            return Date.parse(a) === Date.parse(b);
          return false;
        };
        if (
          old.created_by !== actorId ||
          entries.some(
            ([key, value]) =>
              !equal(key === 'include_delegation' ? (old[key] ?? false) : old[key], value),
          )
        )
          throw new DomainError('Command key reused', 409);
        return { id: old.id };
      }
      // Legacy calls omit the new opt-in column, preserving pre-upgrade operation.
      // Its default still participates in the locked idempotency comparison above.
      const inserted = entries.filter(
        ([key, value]) => key !== 'include_delegation' || value !== false,
      );
      await db.query(
        `INSERT INTO app.${table}(id,tenant_id,created_by,${inserted.map(([k]) => k).join(',')}) VALUES($1,$2,$3,${inserted.map(([k], i) => `$${i + 4}${k === 'copy' ? '::jsonb' : ''}`).join(',')})`,
        [
          commandId,
          ctx.tenantId,
          actorId,
          ...inserted.map(([k, v]) => (k === 'copy' ? JSON.stringify(v) : v)),
        ],
      );
      return { id: commandId };
    });
  }
  async budget(client: string, token: string) {
    const h = (v: string) => createHmac('sha256', this.secret).update(v).digest('hex');
    const r = await this.pool.query(
      'SELECT app.intake_budget($1,60) a,app.intake_budget($2,60) b',
      [h(`delivery-client:${client}`), h(`delivery-capability:${token}`)],
    );
    if (!r.rows[0].a || !r.rows[0].b)
      throw new DomainError('Too many requests. Try again in an hour.', 429);
  }
  async external(
    input: unknown,
  ): Promise<
    DeliveryReport | { id: string; claimStatus: string } | { bytes: Buffer; format: 'CSV' | 'PDF' }
  > {
    const v = publicDeliveryInput.parse(input),
      h = digest(v.token);
    if (v.action === 'view')
      return (await this.pool.query('SELECT app.delivery_report($1,$2) report', [h, v.audience]))
        .rows[0].report as DeliveryReport;
    if (v.action === 'respond')
      return (
        await this.pool.query('SELECT app.delivery_respond($1,$2,$3,$4) result', [
          h,
          v.commandId,
          v.requestId,
          v.body,
        ])
      ).rows[0].result;
    const {
      rows: [r],
    } = await this.pool.query('SELECT app.delivery_export_prepare($1,$2,$3,$4) result', [
      h,
      v.commandId,
      v.format,
      v.purpose,
    ]);
    if (r.result.content)
      return { bytes: Buffer.from(r.result.content, 'base64'), format: v.format };
    const report = r.result.snapshot as DeliveryReport;
    const bytes = v.format === 'CSV' ? reportCsv(report) : await reportPdf(report);
    const saved = await this.pool.query('SELECT app.delivery_export_finish($1,$2,$3) bytes', [
      h,
      v.commandId,
      bytes,
    ]);
    return { bytes: saved.rows[0].bytes, format: v.format };
  }
}
