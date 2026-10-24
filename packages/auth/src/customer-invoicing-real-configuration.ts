import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// It opens or closes the database side of real invoices (ADR-064), records whether a second person must approve each
// document, and writes the supplier details printed on every document. The application switch is separate and both
// must be on before a real workspace can see an invoice or staff can issue one. A closed control keeps every record.

const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) => !/[\u0000-\u001f\u007f]/u.test(v) && !/(:\/\/|@|www\.)/.test(v),
      'Plain text only',
    );

export const supplierFields = [
  'uen',
  'gst_registration_no',
  'gst_registered',
  'payment_instructions',
  'finance_label',
] as const;
export const realInvoicingEntityInput = z
  .object({
    legalName: plain(2, 120),
    address: plain(5, 300),
    country: z.string().regex(/^[A-Z]{2}$/),
    uen: plain(3, 60).nullable(),
    gstRegistered: z.boolean(),
    gstRegistrationNo: plain(3, 60).nullable(),
    taxLabel: plain(2, 20),
    gstRateBps: z.number().int().min(0).max(3000),
    paymentTermsDays: z.number().int().min(0).max(90),
    paymentInstructions: plain(5, 400),
    financeLabel: plain(2, 120),
    // The staff account that alone may approve. Optional; resolved to an existing active staff person.
    approverEmail: z.email().nullable().default(null),
    // Fields whose value is made up. A document issued while any is listed says so on its face.
    madeupFields: z.array(z.enum(supplierFields)).default([]),
  })
  .strict()
  .refine(
    (v) => !v.gstRegistered || v.gstRegistrationNo !== null,
    'A GST registered supplier needs its number',
  );

// What the owner supplied on 24 October 2026, with the missing organisation details made up and marked (madeup).
// Each made-up field is listed in madeupFields, so every document issued with it says so until the owner replaces it.
export const defaultRealInvoicingEntity = {
  legalName: 'Corridra Pte Ltd',
  address: '101 Robinson Road, Singapore 180239',
  country: 'SG',
  uen: '202600000A (madeup)',
  gstRegistered: true,
  gstRegistrationNo: 'M9-0000000-0 (madeup)',
  taxLabel: 'GST',
  gstRateBps: 900,
  paymentTermsDays: 30,
  paymentInstructions:
    'Pay by bank transfer to Corridra Pte Ltd, account 000-000000-0 (madeup), quoting the invoice number',
  financeLabel: 'Sadat FPA (madeup)',
  approverEmail: null,
  madeupFields: [
    'uen',
    'gst_registration_no',
    'gst_registered',
    'payment_instructions',
    'finance_label',
  ],
} satisfies z.input<typeof realInvoicingEntityInput>;

export async function configureRealInvoicing(pool: DatabasePool, input: unknown) {
  const value = z
    .object({
      // Open or close the control. Omit to leave it as it is.
      enabled: z.boolean().optional(),
      // Whether a second person must approve every invoice and credit note. Omit to leave it as it is (default yes).
      requireSecondApprover: z.boolean().optional(),
      // Write the supplier details as a new version. Omit to leave them as they are; the first call seeds the defaults.
      entity: realInvoicingEntityInput.optional(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.real_invoicing_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:real-invoicing-configuration'))",
    );
    const configuration = (
      await db.query<{ executor_id: string }>(
        'SELECT executor_id FROM customer_private.real_use_configuration',
      )
    ).rows[0];
    if (!configuration) throw new Error('Real-use configuration has not been initialized');
    const executor = configuration.executor_id;
    // Supplier details: seed the defaults once, then a new version only when the supplied details differ.
    const current = (
      await db.query<{ version: number } & Record<string, unknown>>(
        'SELECT * FROM customer_private.real_invoicing_entity ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const wanted =
      value.entity ??
      (current ? undefined : realInvoicingEntityInput.parse(defaultRealInvoicingEntity));
    let entityChanged = false;
    if (wanted) {
      let approver: string | null = null;
      if (wanted.approverEmail) {
        const found = await db.query<{ id: string }>(
          `SELECT p.id FROM identity.principal p JOIN identity."user" u ON u.id=p.identity_id
          WHERE lower(u.email)=lower($1) AND p.disabled_at IS NULL`,
          [wanted.approverEmail],
        );
        if (found.rowCount !== 1) throw new Error('The approver is not an active staff account');
        approver = found.rows[0].id;
      }
      const same =
        current &&
        current.legal_name === wanted.legalName &&
        current.address === wanted.address &&
        current.country === wanted.country &&
        current.uen === wanted.uen &&
        current.gst_registered === wanted.gstRegistered &&
        current.gst_registration_no === wanted.gstRegistrationNo &&
        current.tax_label === wanted.taxLabel &&
        current.gst_rate_bps === wanted.gstRateBps &&
        current.payment_terms_days === wanted.paymentTermsDays &&
        current.payment_instructions === wanted.paymentInstructions &&
        current.finance_label === wanted.financeLabel &&
        current.approver_principal_id === approver &&
        JSON.stringify(current.placeholder_fields) === JSON.stringify([...wanted.madeupFields]);
      if (!same) {
        await db.query(
          `INSERT INTO customer_private.real_invoicing_entity(version,legal_name,address,country,uen,gst_registered,gst_registration_no,tax_label,
          gst_rate_bps,payment_terms_days,payment_instructions,finance_label,approver_principal_id,placeholder_fields,executor_id,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            (current?.version ?? 0) + 1,
            wanted.legalName,
            wanted.address,
            wanted.country,
            wanted.uen,
            wanted.gstRegistered,
            wanted.gstRegistrationNo,
            wanted.taxLabel,
            wanted.gstRateBps,
            wanted.paymentTermsDays,
            wanted.paymentInstructions,
            wanted.financeLabel,
            approver,
            wanted.madeupFields,
            executor,
            value.reason,
          ],
        );
        entityChanged = true;
      }
    }
    // Control: one row per change of either value.
    const latest = (
      await db.query<{ version: number; enabled: boolean; require_second_approver: boolean }>(
        'SELECT version,enabled,require_second_approver FROM customer_private.real_invoicing_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const enabled = value.enabled ?? latest?.enabled ?? false;
    const second = value.requireSecondApprover ?? latest?.require_second_approver ?? true;
    const controlChanged =
      (value.enabled !== undefined || value.requireSecondApprover !== undefined) &&
      ((latest?.enabled ?? false) !== enabled ||
        (latest?.require_second_approver ?? true) !== second);
    if (controlChanged)
      await db.query(
        `INSERT INTO customer_private.real_invoicing_control(version,enabled,require_second_approver,executor_id,reason)
        VALUES($1,$2,$3,$4,$5)`,
        [(latest?.version ?? 0) + 1, enabled, second, executor, value.reason],
      );
    await db.query('COMMIT');
    return { enabled, requireSecondApprover: second, controlChanged, entityChanged };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
