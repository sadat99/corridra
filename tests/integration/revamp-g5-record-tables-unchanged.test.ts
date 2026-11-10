import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { digest, harness, type Fixture } from './revamp-g4-support';
import { rawContext } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerInvoicingReal } from '../../packages/db/src/customer-invoicing-real-migrate';
import { migrateCustomerPaymentsSimulated } from '../../packages/db/src/customer-payments-simulated-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { migrateCustomerSpecificationConfirmation } from '../../packages/db/src/customer-specification-confirmation-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';

// CRUD G5 closes accounts and files erasure requests, and never touches records the law or a customer relies on:
// invoices, payments, credit notes, signed decisions, specification confirmations, evidence and the audit trail. Closing,
// undoing, filing and every staff transition leave every existing row of those tables byte for byte as it was, and the
// module's own SQL contains no UPDATE, DELETE or TRUNCATE at all.
let f: Fixture;
let h: ReturnType<typeof harness>;
const recordName =
  /invoice|payment|credit|decision|confirmation|evidence|ledger|billing_|subscription|audit_event/;
const migrations = resolve('packages/db/customer-account-lifecycle-migrations');

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
  await migrateCustomerAccountLifecycle(f.owner);
  h = harness(f, 'g5rec');
  await h.admit(['alice', 'bob']);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the record table tests'],
  );
});
afterAll(async () => {
  await f?.close();
});

const account = (person: string, operation: string, input: Record<string, unknown> = {}) =>
  h.sql(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
    randomUUID(),
    operation,
    JSON.stringify(input),
  ]);

describe('the record tables', () => {
  test('every existing row is unchanged after close, undo, erasure and each staff transition', async () => {
    const target = await h.provision('alice', 'Synthetic records workspace');
    await h.join('alice', 'bob', target);
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
      workspaces: await digest(f, ['customer.workspace', 'customer.membership', 'app.tenant']),
    };
    await account('bob', 'close', { confirmation: 'Close my account' });
    await account('bob', 'undo');
    await account('bob', 'close', { confirmation: 'Close my account' });
    const filed = (await account('alice', 'file_erasure')).r as { reference: string };
    const request = (
      await f.owner.query('SELECT id FROM customer_private.erasure_request WHERE reference=$1', [
        filed.reference,
      ])
    ).rows[0].id as string;
    const move = (expected: string, to: string, note: string | null) =>
      rawContext(
        f.runtime,
        f.users.owner!.ctx,
        'SELECT customer.erasure_transition($1,$2,$3,$4,$5)',
        [randomUUID(), request, expected, to, note],
      );
    await move('received', 'in_progress', null);
    await move(
      'in_progress',
      'completed',
      'Invoices and signed decisions are kept because the law requires it',
    );
    expect(await digest(f, tables)).toEqual(before.tables);
    expect(await digest(f, ['customer.workspace', 'customer.membership', 'app.tenant'])).toEqual(
      before.workspaces,
    );
    expect(await rowDigest('app.domain_event', eventIds)).toBe(before.events);
    expect(await rowDigest('app.audit_event', auditIds)).toBe(before.audits);
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
  const all = readdirSync(migrations).filter((name) => name.endsWith('.sql'));
  // The installed first file only inserts. The follow-up files (0002 and later) may replace named functions, and are
  // checked by the last tests of this group.
  const files = all.filter((name) => name.startsWith('0001_'));

  test('contains no UPDATE, DELETE or TRUNCATE at all: it only inserts', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = code(file);
      expect(text, file).not.toMatch(/\bUPDATE\s+[a-z_.]+\s+SET\b/i);
      expect(text, file).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
      expect(text, file).not.toMatch(
        /\bALTER\s+TABLE\s+(?!customer_private\.(account_|erasure_))[a-z_.]+\s+(ADD|DROP|ALTER)/i,
      );
      expect(text, file).not.toMatch(
        /\bCREATE\s+OR\s+REPLACE\b|\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY)\b/i,
      );
    }
  });

  test('never inserts into a record table, and writes events only through the one event function', () => {
    for (const file of files) {
      const text = code(file);
      const events = text.slice(
        text.indexOf('CREATE FUNCTION customer_private.account_lifecycle_event'),
        text.indexOf('-- Staff who may read'),
      );
      expect(events).toContain('INSERT INTO app.domain_event');
      const outside = text.replace(events, '');
      for (const match of outside.matchAll(/\bINSERT\s+INTO\s+([a-z_.]+)/g)) {
        const table = match[1]!;
        expect(table, `${file}: ${table}`).not.toMatch(recordName);
        expect(table, `${file}: ${table}`).not.toMatch(/^app\./);
        expect(table, `${file}: ${table}`).toMatch(/^customer_private\.(account_|erasure_)/);
      }
    }
  });

  test('the follow-up files replace only named functions, each behind a fingerprint of the live text, and never rewrite a row', () => {
    const followUps = all.filter((name) => !name.startsWith('0001_'));
    expect(followUps.length).toBeGreaterThan(0);
    for (const file of followUps) {
      const text = code(file);
      expect(text, file).not.toMatch(/\bUPDATE\s+[a-z_.]+\s+SET\b/i);
      expect(text, file).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
      expect(text, file).not.toMatch(/\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY)\b/i);
      expect(text, file).not.toMatch(
        /\bALTER\s+TABLE\s+(?!customer_private\.account_chain)[a-z_.]+\s+(ADD|DROP|ALTER)/i,
      );
      // every function that is replaced is first compared with the exact text it replaces
      const replaced = [...text.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z_.]+)/gi)].length;
      const executed = [...text.matchAll(/\bEXECUTE\s+updated\b/g)].length;
      const guards = [...text.matchAll(/encode\(sha256\(convert_to\(/g)].length;
      expect(guards, file).toBe(replaced + executed);
      for (const match of text.matchAll(/\bINSERT\s+INTO\s+([a-z_.]+)/g))
        expect(match[1], file).toBe('customer_private.account_chain');
    }
  });
});
