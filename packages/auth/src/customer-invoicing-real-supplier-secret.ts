import type { DatabasePool } from '@corridra/db';
import {
  configureRealInvoicing,
  realInvoicingEntityInput,
} from './customer-invoicing-real-configuration';

// Offline schema-owner operation only. No request handler imports this module.
// set_supplier (ADR-064) reads the supplier details ONLY from the secret REAL_INVOICING_SUPPLIER_JSON of the protected
// `customer-modules-install` GitHub environment, never from a workflow input: the repository is public and dispatch
// inputs show on the run page and in the event payload. The run log is public too, so nothing here prints, throws or
// attaches a value from the JSON. Output is limited to the names of the fields that changed, the new version number and
// how many fields are still marked made up. Every error is rebuilt from fixed text, field names and codes only, and never
// carries the original error (a JSON parse error quotes the text, a database error can quote the failing row).

export const supplierSecretName = 'REAL_INVOICING_SUPPLIER_JSON';
export const supplierSecretMissingMessage = `set_supplier needs the secret ${supplierSecretName}. Add it in the repository settings under Environments, customer-modules-install, Environment secrets, then run again. Nothing was written.`;

// The longest secret accepted. The schema allows far less per field; this only refuses something that is clearly not
// the supplier details before it is parsed.
const maximumLength = 4000;

// Database column -> the JSON field name the owner writes. Used to name, never to show, what changed.
const columnToField = {
  legal_name: 'legalName',
  address: 'address',
  country: 'country',
  uen: 'uen',
  gst_registered: 'gstRegistered',
  gst_registration_no: 'gstRegistrationNo',
  tax_label: 'taxLabel',
  gst_rate_bps: 'gstRateBps',
  payment_terms_days: 'paymentTermsDays',
  payment_instructions: 'paymentInstructions',
  finance_label: 'financeLabel',
  approver_principal_id: 'approverEmail',
  placeholder_fields: 'madeupFields',
} as const;
const knownFields = new Set<string>(Object.values(columnToField));

// Messages configureRealInvoicing throws itself. They are fixed text and name no value, so they may pass through.
const safeConfigurationMessages = new Set([
  'Offline customer schema-owner authority is required',
  'Real-use configuration has not been initialized',
  'The approver is not an active staff account',
]);

export type SupplierEntity = ReturnType<typeof realInvoicingEntityInput.parse>;

// Reads and checks the secret. Throws plain errors that name the secret, field names and problem codes only.
export function parseSupplierSecret(raw: string | undefined): SupplierEntity {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error(supplierSecretMissingMessage);
  if (raw.length > maximumLength)
    throw new Error(
      `The ${supplierSecretName} secret is longer than ${maximumLength} characters. Nothing was written.`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not rethrown and not attached: the parse error quotes part of the text.
    throw new Error(`The ${supplierSecretName} secret is not valid JSON. Nothing was written.`);
  }
  const result = realInvoicingEntityInput.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      // Only a path made of known field names (or array positions) is printed. Unknown keys are counted, not named,
      // because a mistyped key could itself be a value.
      const path = issue.path
        .map((part) =>
          typeof part === 'number'
            ? String(part)
            : knownFields.has(String(part))
              ? String(part)
              : '?',
        )
        .join('.');
      if (issue.code === 'unrecognized_keys')
        return `${issue.keys.length} unknown field name${issue.keys.length === 1 ? '' : 's'}`;
      return `${path || 'details'} (${issue.code})`;
    });
    throw new Error(
      `The ${supplierSecretName} secret does not match the supplier details: ${problems.join('; ')}. Nothing was written.`,
    );
  }
  return result.data;
}

type EntityRow = { version: number } & Record<string, unknown>;

async function latestEntity(pool: DatabasePool): Promise<EntityRow | undefined> {
  return (
    await pool.query<EntityRow>(
      'SELECT * FROM customer_private.real_invoicing_entity ORDER BY version DESC LIMIT 1',
    )
  ).rows[0];
}

const comparable = (value: unknown) =>
  value instanceof Date ? value.toISOString() : JSON.stringify(value ?? null);

export type SupplierChange = {
  changedFields: string[];
  version: number | null;
  madeupFieldCount: number;
  entityChanged: boolean;
};

// The one line the installer prints after set_supplier: field names, the version and a count. No value.
export function describeSupplierChange(change: SupplierChange) {
  const fields = change.changedFields.length ? change.changedFields.join(', ') : 'none';
  return `Supplier details: ${change.entityChanged ? 'new version written' : 'unchanged'}; changed fields: ${fields}; version ${change.version ?? 'none'}; madeupFields count ${change.madeupFieldCount}`;
}

// Writes the supplier details from the secret as a new version. Reason is required by configureRealInvoicing.
export async function setSupplierFromSecret(
  pool: DatabasePool,
  input: { raw: string | undefined; reason: string | undefined },
  configure: typeof configureRealInvoicing = configureRealInvoicing,
): Promise<SupplierChange> {
  const entity = parseSupplierSecret(input.raw);
  try {
    const before = await latestEntity(pool);
    const result = await configure(pool, { reason: input.reason, entity });
    const after = await latestEntity(pool);
    const changedFields = result.entityChanged
      ? Object.entries(columnToField)
          .filter(([column]) => comparable(before?.[column]) !== comparable(after?.[column]))
          .map(([, field]) => field)
      : [];
    return {
      changedFields,
      version: after?.version ?? null,
      madeupFieldCount: entity.madeupFields.length,
      entityChanged: result.entityChanged,
    };
  } catch (error) {
    // Rebuilt, never rethrown: a database error can carry the failing row in its detail, and a validation error the input.
    const message = error instanceof Error ? error.message : '';
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : '';
    const safe = safeConfigurationMessages.has(message)
      ? message
      : /^[0-9A-Z]{5}$/.test(code)
        ? `database error ${code}`
        : 'unexpected error';
    throw new Error(`Setting the supplier details failed: ${safe}. Nothing was written.`);
  }
}
