import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DatabasePool } from '../../packages/db/src/index';
import {
  describeSupplierChange,
  parseSupplierSecret,
  setSupplierFromSecret,
  supplierSecretMissingMessage,
} from '../../packages/auth/src/customer-invoicing-real-supplier-secret';

// Owner, 17 Nov 2026: "hide supplier input". The repository and its Actions logs are public, so set_supplier reads the
// supplier details only from the protected environment secret and prints field names, a version and a count, never a
// value. These checks need no database: they drive the same helper the installer calls and watch everything it prints
// or throws. Every value below is invented for this test; none is a real organisation's detail.
const uen = 'T00SECRET01X';
const account = 'TEST-ACCT-555-000111-9';
const gstNumber = 'TEST-GST-424242';
const address = '9 Example Quay, Test Wharf 00-01, Singapore 000099';
const legalName = 'Example Hidden Supplier Pte Ltd';
const approverEmail = 'finance.approver@example.test';
const sample = {
  legalName,
  address,
  country: 'SG',
  uen,
  gstRegistered: true,
  gstRegistrationNo: gstNumber,
  taxLabel: 'GST',
  gstRateBps: 900,
  paymentTermsDays: 30,
  paymentInstructions: `Pay by bank transfer to account ${account}, quoting the invoice number`,
  financeLabel: 'Example Finance Desk',
  approverEmail,
  madeupFields: ['finance_label'],
};
const values = [uen, account, gstNumber, address, legalName, approverEmail];

// Everything written to the console or stdout/stderr while a block runs, plus any thrown message and stack.
async function captured(run: () => Promise<unknown> | unknown) {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(keep),
    vi.spyOn(console, 'info').mockImplementation(keep),
    vi.spyOn(console, 'warn').mockImplementation(keep),
    vi.spyOn(console, 'error').mockImplementation(keep),
    vi.spyOn(console, 'debug').mockImplementation(keep),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    }),
  ];
  let result: unknown;
  let error: unknown;
  try {
    result = await run();
  } catch (caught) {
    error = caught;
    const e = caught as Error & { cause?: unknown };
    lines.push(e.message, String(e.stack), JSON.stringify(e), String(e.cause ?? ''));
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return { text: lines.join('\n'), result, error };
}

const expectNoValue = (text: string) => {
  for (const value of values) expect(text).not.toContain(value);
  // Nor a recognisable fragment of the bank account or UEN.
  expect(text).not.toMatch(
    /555-000111|SECRET01|424242|Example Quay|Hidden Supplier|finance\.approver/,
  );
};

// A stand-in pool: the helper reads the latest supplier version before and after the write.
function pool(before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  const rows = [before, after];
  return {
    query: vi.fn(async () => ({ rows: [rows.shift()].filter(Boolean) })),
  } as unknown as DatabasePool;
}
const row = (version: number, over: Record<string, unknown> = {}) => ({
  version,
  legal_name: 'Old Example Pte Ltd',
  address: '1 Old Example Road, Singapore 000001',
  country: 'SG',
  uen: 'T00OLD0000X',
  gst_registered: true,
  gst_registration_no: 'OLD-GST-1 (madeup)',
  tax_label: 'GST',
  gst_rate_bps: 900,
  payment_terms_days: 30,
  payment_instructions: 'Old example instructions (madeup)',
  finance_label: 'Old desk (madeup)',
  approver_principal_id: null,
  placeholder_fields: ['gst_registration_no', 'payment_instructions', 'finance_label'],
  executor_id: '00000000-0000-4000-8000-000000000001',
  reason: 'Old fixture reason for the supplier',
  ...over,
});

afterEach(() => vi.restoreAllMocks());

test('set_supplier prints only changed field names, the version and the made-up count', async () => {
  const configure = vi.fn(async () => ({
    enabled: false,
    requireSecondApprover: true,
    controlChanged: false,
    entityChanged: true,
  }));
  const after = row(4, {
    legal_name: legalName,
    address,
    uen,
    gst_registration_no: gstNumber,
    payment_instructions: sample.paymentInstructions,
    finance_label: sample.financeLabel,
    approver_principal_id: '00000000-0000-4000-8000-000000000009',
    placeholder_fields: ['finance_label'],
  });
  const { text, result, error } = await captured(async () => {
    const change = await setSupplierFromSecret(
      pool(row(3), after),
      { raw: JSON.stringify(sample), reason: 'Owner replaced the made-up supplier details' },
      configure,
    );
    console.log(describeSupplierChange(change));
    return change;
  });
  expect(error).toBeUndefined();
  expect(configure).toHaveBeenCalledOnce();
  expect(result).toEqual({
    changedFields: [
      'legalName',
      'address',
      'uen',
      'gstRegistrationNo',
      'paymentInstructions',
      'financeLabel',
      'approverEmail',
      'madeupFields',
    ],
    version: 4,
    madeupFieldCount: 1,
    entityChanged: true,
  });
  expect(text).toBe(
    'Supplier details: new version written; changed fields: legalName, address, uen, gstRegistrationNo, paymentInstructions, financeLabel, approverEmail, madeupFields; version 4; madeupFields count 1',
  );
  expectNoValue(text);
});

test('an unchanged supplier reports no changed field and still no value', async () => {
  const configure = vi.fn(async () => ({
    enabled: false,
    requireSecondApprover: true,
    controlChanged: false,
    entityChanged: false,
  }));
  const { text, error } = await captured(async () =>
    console.log(
      describeSupplierChange(
        await setSupplierFromSecret(
          pool(row(5), row(5)),
          { raw: JSON.stringify(sample), reason: 'Owner re-ran the same supplier details' },
          configure,
        ),
      ),
    ),
  );
  expect(error).toBeUndefined();
  expect(text).toBe(
    'Supplier details: unchanged; changed fields: none; version 5; madeupFields count 1',
  );
  expectNoValue(text);
});

test('a missing secret fails closed, names the secret and where to add it, and writes nothing', async () => {
  for (const raw of [undefined, '', '   ']) {
    const configure = vi.fn();
    const fake = pool(row(1), row(1));
    const { error } = await captured(() =>
      setSupplierFromSecret(fake, { raw, reason: 'Owner tried set_supplier' }, configure),
    );
    expect((error as Error).message).toBe(supplierSecretMissingMessage);
    expect(supplierSecretMissingMessage).toContain('REAL_INVOICING_SUPPLIER_JSON');
    expect(supplierSecretMissingMessage).toContain('customer-modules-install');
    expect(supplierSecretMissingMessage).toContain('Nothing was written');
    expect(configure).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
  }
});

test('malformed JSON is refused without quoting any of it', async () => {
  // Broken on purpose after the values, so a parser message would quote them.
  const raw = JSON.stringify(sample).slice(0, -1) + ', uen: ' + uen;
  const { text, error } = await captured(() => parseSupplierSecret(raw));
  expect((error as Error).message).toBe(
    'The REAL_INVOICING_SUPPLIER_JSON secret is not valid JSON. Nothing was written.',
  );
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  expectNoValue(text);
});

test('schema problems name field paths and codes, never the value or an unknown key', async () => {
  const wrong = {
    ...sample,
    country: `Singapore ${uen}`,
    gstRateBps: account,
    paymentInstructions: `Pay https://bank.example.test/${account}`,
    [gstNumber]: address,
  };
  const { text, error } = await captured(() => parseSupplierSecret(JSON.stringify(wrong)));
  const message = (error as Error).message;
  expect(message).toContain('country (invalid_format)');
  expect(message).toContain('gstRateBps (invalid_type)');
  expect(message).toContain('paymentInstructions (custom)');
  expect(message).toContain('1 unknown field name');
  expectNoValue(text);
});

test('a database or configuration failure is rebuilt without its detail, cause or row', async () => {
  const failure = Object.assign(new Error(`new row violates check constraint for uen ${uen}`), {
    code: '23514',
    detail: `Failing row contains (${legalName}, ${address}, ${account}).`,
  });
  const { text, error } = await captured(() =>
    setSupplierFromSecret(
      pool(row(2), row(2)),
      { raw: JSON.stringify(sample), reason: 'Owner replaced the supplier details' },
      vi.fn(async () => {
        throw failure;
      }),
    ),
  );
  expect((error as Error).message).toBe(
    'Setting the supplier details failed: database error 23514. Nothing was written.',
  );
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  expectNoValue(text);

  const known = await captured(() =>
    setSupplierFromSecret(
      pool(row(2), row(2)),
      { raw: JSON.stringify(sample), reason: 'Owner replaced the supplier details' },
      vi.fn(async () => {
        throw new Error('The approver is not an active staff account');
      }),
    ),
  );
  expect((known.error as Error).message).toBe(
    'Setting the supplier details failed: The approver is not an active staff account. Nothing was written.',
  );
  expectNoValue(known.text);
});

test('the installer never logs the supplier secret or its parsed details', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('scripts/install-customer-modules.ts', 'utf8');
  // The secret is read once, removed from the environment, and reaches only the two helpers.
  expect(source).not.toContain('real_invoicing_supplier_json');
  expect(source).not.toContain('v.REAL_INVOICING_SUPPLIER_JSON');
  expect(source.match(/supplierSecret\b/g)).toHaveLength(3);
  expect(source).toContain('delete process.env[supplierSecretName]');
  expect(source).not.toMatch(/console\.\w+\([^)]*supplierSecret/);
  expect(source).not.toMatch(/JSON\.parse\(/);
});

test('a failed summary read after the write says the version was saved, not that nothing was written', async () => {
  let reads = 0;
  const failingAfter = {
    query: vi.fn(async () => {
      reads += 1;
      if (reads === 1) return { rows: [row(6)] };
      throw Object.assign(new Error(`connection lost while reading ${uen}`), { code: '08006' });
    }),
  } as unknown as DatabasePool;
  const configure = vi.fn(async () => ({
    enabled: false,
    requireSecondApprover: true,
    controlChanged: false,
    entityChanged: true,
  }));
  const { text, error } = await captured(() =>
    setSupplierFromSecret(
      failingAfter,
      { raw: JSON.stringify(sample), reason: 'Owner replaced the supplier details' },
      configure,
    ),
  );
  expect(configure).toHaveBeenCalledOnce();
  const message = (error as Error).message;
  expect(message).toBe(
    'The supplier details were saved as a new version, but the summary could not be read: database error 08006. Run the workflow with apply=no to see the installed state; do not run set_supplier again for this.',
  );
  expect(message).not.toContain('Nothing was written');
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  expectNoValue(text);
});

// Runs the real installer script as the workflow would, with a network guard preloaded: any database connection attempt
// is refused and reported. A missing or bad secret must stop the run before the first query, so before the report, any
// migration and any write.
describe('the installer with set_supplier and a missing or bad secret', () => {
  const run = (extra: Record<string, string>) => {
    const host = 'ep-u3-fixture.eu-central-1.aws.neon.tech';
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        './tests/integration/fixtures/forbid-network.mjs',
        'scripts/install-customer-modules.ts',
      ],
      {
        encoding: 'utf8',
        timeout: 60000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          MIGRATION_DATABASE_URL: `postgresql://corridra_migrator:fixture-only@${host}/corridra?sslmode=verify-full`,
          MIGRATION_DATABASE_HOST: host,
          INSTALL_APPLY: 'yes',
          REAL_INVOICING_REASON: 'Fixture run of set_supplier with a bad secret',
          ...extra,
        },
      },
    );
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  };
  const noRunStarted = (output: string) => {
    expect(output).not.toContain('NETWORK_ATTEMPT');
    expect(output).not.toContain('Before install');
    expect(output).not.toContain('core migrations applied');
    expect(output).not.toContain('Real invoices');
    expect(output).not.toContain('Install complete');
  };

  test('the network guard does see a run that reaches the database (control case)', () => {
    const { status, output } = run({ REAL_INVOICING_ACTION: 'unchanged' });
    expect(status).not.toBe(0);
    expect(output).toContain('NETWORK_ATTEMPT');
  });

  test('a missing secret stops before any connection, names the secret and writes nothing', () => {
    for (const secret of [undefined, '', '  ']) {
      const { status, output } = run({
        REAL_INVOICING_ACTION: 'set_supplier',
        ...(secret === undefined ? {} : { REAL_INVOICING_SUPPLIER_JSON: secret }),
      });
      expect(status).not.toBe(0);
      expect(output).toContain(supplierSecretMissingMessage);
      noRunStarted(output);
    }
  });

  test('malformed or invalid JSON stops before any connection and prints no value', () => {
    for (const secret of [
      JSON.stringify(sample).slice(0, -1) + ', uen: ' + uen,
      JSON.stringify({ ...sample, country: `Singapore ${uen}`, gstRateBps: account }),
    ]) {
      const { status, output } = run({
        REAL_INVOICING_ACTION: 'set_supplier',
        REAL_INVOICING_SUPPLIER_JSON: secret,
      });
      expect(status).not.toBe(0);
      expect(output).toMatch(
        /REAL_INVOICING_SUPPLIER_JSON secret (is not valid JSON|does not match)/,
      );
      noRunStarted(output);
      expectNoValue(output);
    }
  });
});
