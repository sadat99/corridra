import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { RequestContext } from '../../packages/db/src/index';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';
import { rawContext } from './support';
import type { World } from './organisation-link-support';
import { SOURCE_RIGHTS_FILE } from './source-rights-hide';

// ADR-079 slice B (ADR-082 S1) test support: a request context for each staff role on each side, ingestion through the
// application service (which picks the rights wrapper once it is installed), and raw calls to the staff functions.
export { SOURCE_RIGHTS_FILE };
export const rightsBase = process.env.RIGHTS_BASE_CHECK === '1';
export const rightsFileUrl = new URL(
  '../../packages/db/customer-real-use-migrations/' + SOURCE_RIGHTS_FILE,
  import.meta.url,
);
export const rightsSql = () => readFileSync(rightsFileUrl, 'utf8');
export const between = (sql: string, name: string) => {
  const open = `-- ${name}-begin`;
  const a = sql.indexOf(open);
  const b = sql.indexOf(`-- ${name}-end`);
  if (a < 0 || b < a) throw new Error('Missing marker ' + name);
  return sql.slice(a + open.length, b);
};
export const sourceTypes = [
  'government_registry',
  'company_website',
  'trade_body_list',
  'event_list',
  'staff_research',
  'licensed_dataset',
  'other',
] as const;
export type Side = 'real' | 'synthetic';
export type Who = 'owner' | 'operator' | 'reviewer' | 'viewer' | 'other';
export const unavailable = 'Organisation unavailable';

export class Staff {
  constructor(public w: World) {}
  ctx(who: Who, side: Side): RequestContext {
    const user = this.w.f.users[who]!;
    if (side === 'real')
      return { ...user.ctx, tenantId: this.w.intake, purpose: 'commercial_qualification' };
    return { ...user.ctx, tenantId: who === 'other' ? this.w.f.tenantB : this.w.f.tenantA };
  }
  // One statement inside a staff session of the runtime login.
  async call(ctx: RequestContext, sql: string, args: unknown[] = []) {
    return (await rawContext(this.w.f.runtime, ctx, sql, args)).rows;
  }
  async fn(ctx: RequestContext, name: string, ...args: unknown[]) {
    const marks = args.map((_, i) => '$' + (i + 1)).join(',');
    return (await this.call(ctx, `SELECT ${name}(${marks}) AS result`, args))[0]!.result;
  }
  async source(side: Side, who: Who = 'owner') {
    const unexpected = async () => {
      throw new Error('No file operation in this test');
    };
    const evidence = new EvidenceService(
      this.w.f.runtime,
      { put: unexpected, get: unexpected },
      { scan: unexpected },
    );
    const made = await evidence.createSource(this.ctx(who, side), {
      kind: 'public_record',
      locator:
        side === 'real'
          ? `https://register.example-records.de/${randomUUID()}`
          : `https://registry.example.invalid/${randomUUID()}`,
      observedAt: new Date(Date.now() - 86400000).toISOString(),
      classification: 'PUBLIC',
      purpose: side === 'real' ? 'commercial_qualification' : 'synthetic_validation',
      retentionUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      aiPolicy: 'DENY',
    });
    return made.id as string;
  }
  // The five identity fields of one ingestion. The domain is made from the name so two companies never share a key.
  identity(side: Side, name: string, over: Partial<Identity> = {}): Identity {
    const slug = randomUUID().slice(0, 8);
    return {
      name,
      country: 'DE',
      domain: side === 'real' ? `c-${slug}.de` : `c-${slug}.example.invalid`,
      address: 'Invented address 1',
      identifierType: 'registry',
      identifier: randomUUID().toUpperCase(),
      ...over,
    };
  }
  // Through the application service, as the staff form does.
  async ingest(
    side: Side,
    id: Identity,
    sourceType: string | undefined,
    who: Who = 'owner',
    sourceId?: string,
  ) {
    const made = await new CounterpartyService(this.w.f.runtime).command(this.ctx(who, side), {
      action: 'ingest',
      commandId: randomUUID(),
      sourceId: sourceId ?? (await this.source(side, who)),
      ...id,
      ...(sourceType === undefined ? {} : { sourceType }),
    });
    return made as { id: string; warnings?: string[] };
  }
  async rightsRows(organisationId: string) {
    return (
      await this.w.f.owner.query(
        'SELECT * FROM customer_private.organisation_source_rights WHERE organisation_id=$1 ORDER BY version',
        [organisationId],
      )
    ).rows;
  }
  async suppressionRows(organisationId: string) {
    return (
      await this.w.f.owner.query(
        'SELECT * FROM customer_private.organisation_suppression WHERE organisation_id=$1 ORDER BY version',
        [organisationId],
      )
    ).rows;
  }
  async events(type: string) {
    return (
      await this.w.f.owner.query(
        'SELECT e.* FROM app.domain_event e WHERE e.type=$1 ORDER BY e.occurred_at',
        [type],
      )
    ).rows;
  }
  hide = (ctx: RequestContext, organisationId: string, over: Record<string, unknown> = {}) =>
    this.fn(
      ctx,
      'app.customer_organisation_suppress',
      randomUUID(),
      JSON.stringify({
        organisationId,
        state: 'hidden',
        reason: 'Takedown requested by the company',
        reference: 'TICKET-1001',
        ...over,
      }),
    );
}
export type Identity = {
  name: string;
  country: string;
  domain: string;
  address: string;
  identifierType: 'registry' | 'tax' | 'source_id';
  identifier: string;
};
