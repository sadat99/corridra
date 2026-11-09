import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { digest, harness, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerInvoicingReal } from '../../packages/db/src/customer-invoicing-real-migrate';
import { migrateCustomerPaymentsSimulated } from '../../packages/db/src/customer-payments-simulated-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { migrateCustomerSpecificationConfirmation } from '../../packages/db/src/customer-specification-confirmation-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';

// CRUD G4 changes workspaces, never records the law or a customer relies on: invoices, payments, credit notes,
// signed decisions, specification confirmations, evidence and the audit trail. Rename, archive, restore and handing
// over ownership leave every existing row of those tables byte for byte as it was, and the module's own SQL contains
// no other update or delete than the two named ones.
let f: Fixture;
let h: ReturnType<typeof harness>;
const recordName =
  /invoice|payment|credit|decision|confirmation|evidence|ledger|billing_|subscription|audit_event/;
const migrations = resolve('packages/db/customer-workspace-lifecycle-migrations');

async function recordTables() {
  return (
    await f.owner.query(
      `SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND n.nspname IN ('app','customer','customer_private') AND c.relname ~ $1 ORDER BY 1`,
      [recordName.source],
    )
  ).rows.map((row) => row.name as string);
}
async function rowDigest(table: string, ids: string[]) {
  return (
    await f.owner.query(
      `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS d FROM ${table} t WHERE t.id::text = ANY($1)`,
      [ids],
    )
  ).rows[0].d as string;
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerInvoicingReal(f.owner);
  await migrateCustomerPaymentsSimulated(f.owner);
  await migrateCustomerDecisionCards(f.owner);
  await migrateCustomerSpecificationConfirmation(f.owner);
  await migrateCustomerWorkspaceLifecycle(f.owner);
  h = harness(f, 'g4rec');
  await h.admit(['alice', 'bob', 'carol']);
  await h.setControl(true);
});
afterAll(async () => {
  await f?.close();
});

describe('the record tables', () => {
  test('every existing row is unchanged after rename, archive, restore and a handover of ownership', async () => {
    const title = 'Synthetic records workspace';
    const target = await h.provision('alice', title);
    const bob = await h.join('alice', 'bob', target);
    const tables = (await recordTables()).filter((table) => table !== 'app.audit_event');
    expect(tables.length).toBeGreaterThan(12);
    expect(tables).toEqual(
      expect.arrayContaining([
        'customer_private.real_invoice',
        'customer_private.real_invoice_payment',
        'customer_private.real_invoice_credit',
        'customer_private.invoicing_invoice',
        'app.delivery_specification_confirmation',
        'app.evidence_object',
      ]),
    );
    const eventIds = (await f.owner.query('SELECT id FROM app.domain_event')).rows.map(
      (row) => row.id as string,
    );
    const auditIds = (await f.owner.query('SELECT id FROM app.audit_event')).rows.map(
      (row) => row.id as string,
    );
    expect(auditIds.length).toBeGreaterThan(0);
    const before = {
      tables: await digest(f, tables),
      events: await rowDigest('app.domain_event', eventIds),
      audits: await rowDigest('app.audit_event', auditIds),
    };
    const change = (operation: string, input: Record<string, unknown>) =>
      h.lifecycle('alice', operation, input);
    await change('rename', {
      workspaceId: target,
      name: 'Synthetic records renamed',
      reason: 'The company changed its trading name',
      expectedVersion: 0,
    });
    await change('archive', {
      workspaceId: target,
      expectedVersion: 1,
      confirmName: 'Synthetic records renamed',
    });
    await change('restore', { workspaceId: target, expectedVersion: 2 });
    const made = await h.ownership('alice', 'offer', {
      workspaceId: target,
      memberId: bob,
      confirmName: 'Synthetic records renamed',
      expectedVersion: 3,
    });
    await h.ownership('alice', 'cancel', { workspaceId: target, offerId: made.offerId });
    const second = await h.ownership('alice', 'offer', {
      workspaceId: target,
      memberId: bob,
      confirmName: 'Synthetic records renamed',
      expectedVersion: 3,
    });
    await h.ownership('bob', 'accept', { offerId: second.offerId });
    expect(await digest(f, tables)).toEqual(before.tables);
    expect(await rowDigest('app.domain_event', eventIds)).toBe(before.events);
    expect(await rowDigest('app.audit_event', auditIds)).toBe(before.audits);
    // The operations did append their own events and audit rows.
    expect(
      (await f.owner.query('SELECT count(*)::int AS n FROM app.domain_event')).rows[0].n,
    ).toBeGreaterThan(eventIds.length);
    expect(
      (await f.owner.query('SELECT count(*)::int AS n FROM app.audit_event')).rows[0].n,
    ).toBeGreaterThan(auditIds.length);
  });
});

describe('the module SQL', () => {
  const code = (file: string) =>
    readFileSync(resolve(migrations, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
  const files = readdirSync(migrations).filter((name) => name.endsWith('.sql'));

  test('updates only app.tenant (the name) and customer.membership (owner to admin), and deletes nothing', () => {
    const updates: string[] = [];
    for (const file of files) {
      const text = code(file);
      updates.push(
        ...[...text.matchAll(/\bUPDATE\s+([a-z_.]+)\s+SET\s+([a-z_]+)=([^\s,;]+)/g)].map(
          (m) => `${m[1]} ${m[2]}`,
        ),
      );
      expect(text, file).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    }
    expect(updates.sort()).toEqual(['app.tenant name', 'customer.membership role']);
  });

  test('never touches a record table, and writes events only through the access event function', () => {
    for (const file of files) {
      const text = code(file);
      for (const match of text.matchAll(/\b(?:INSERT\s+INTO|UPDATE)\s+([a-z_.]+)/g)) {
        const table = match[1]!;
        expect(table, `${file}: ${table}`).not.toMatch(recordName);
        expect(table, `${file}: ${table}`).not.toMatch(/^app\.(domain_event|audit_event|outbox)/);
      }
    }
  });
});
