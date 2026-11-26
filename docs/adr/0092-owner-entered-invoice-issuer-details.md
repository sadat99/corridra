# ADR-092: Invoice issuer details typed by the owner

Status: Proposed 23 November 2026 for the owner decision of 23 November 2026 (commercial-ready run, section 1, row "Invoice data"): "The owner types issuer details in a new Owner-only staff screen with an authenticator check". Unit B8. This record opens nothing: real invoices go live only on the owner's word "live", and real payments and payouts stay closed. Update 26 November 2026 (records, decided by Guardian G65 on the owner's delegation): built and merged in PR 622 (`5e274731`, unit B8) and the addendum below in PR 631 (`fe621d82`, unit B8b). `CORRIDRA_INVOICE_ISSUER` is off by default; no production install is recorded; real invoices still need the owner's word "live". This note changes no decision.

Amends ADR-064 forward. ADR-064 and its amendment of 17 November 2026 say the supplier details are written only by the offline install step from the protected secret. From this record on, the owner may also type them on a staff screen. Everything else ADR-064, ADR-062 and ADR-065 decide stays in force. Those records are not edited.

## Context

- The supplier record of ADR-064 (`customer_private.real_invoicing_entity`) is versioned and append-only. Install seeds it with made-up values, each listed in `placeholder_fields` and carrying the text "(madeup)".
- D3 (`refuseMadeupIssue` in `packages/delivery/src/customer-invoicing-real-staff.ts`) refuses a real invoice or credit note in the live deployment while any supplier field is made up.
- The only way to replace a made-up value was `set_supplier`: a JSON secret in the `customer-modules-install` GitHub environment and a workflow run. The owner asked for a screen instead.
- The UEN was replaced with the real one earlier (install 49). GST status and number, payment instructions and the finance label were still made up.

## Decision

### The screen

- Address `/operator/invoice-issuer`, inside the staff area. It exists only while `CORRIDRA_INVOICE_ISSUER` is exactly `true` (default off); otherwise the page and its data route answer 404 before any session is read.
- Owner only. The page offers itself to a staff member with the owner role; an admin, operator, reviewer or viewer gets one plain line. The service and the database repeat the rule.
- One workspace only. The supplier record is one for the whole platform, so the database lets only the owner of the one Corridra staff workspace read or save it: the real intake workspace named by the real-use configuration. The owner of any other real workspace is refused.
- Four short steps: Company (legal name, UEN, registered address), GST (status, and the number when registered), Payment (payment instructions, finance contact label), Check And Save (every answer shown, then the authenticator code).
- A value that is still made up never reaches the screen: the field arrives empty and the owner types it. A typed value that contains "(madeup)", a link or an email address is refused. The values the install step seeds (the placeholder UEN, GST number, account number and finance label) are refused even with the "(madeup)" text taken off.
- Country, tax name, tax rate and payment terms are not asked. They are carried from the version before and stay under the install step.

### The authenticator check

- The code is asked for on the save step, checked at that moment through the staff sign-in service, and never stored, shown or sent with the details.
- The save runs under the `delivery.share` permission (fresh check required) and the database function requires an authenticator check on the same session within the last five minutes. Without it the answer is `STEP_UP_REQUIRED` and nothing is written. Reading needs the owner, not a fresh check.

### The write

- Additive migration `packages/db/customer-invoicing-real-migrations/0003_owner_issuer_details.sql`, installed by the existing `real_invoicing_action=install` step. No new workflow input.
- `app.real_invoicing_issuer_save(command, input)` writes ONE new version of the supplier record: the typed fields, the carried fields, `placeholder_fields` emptied for every field the screen asks for, `executor_id` and the new column `owner_entered_by` set to the owner. No earlier version, issued document, payment or credit note is touched; a document keeps the version it was issued under.
- A made-up mark on a field the screen does not ask for (the tax rate) is kept, so the details stay incomplete and D3 stays in force until the install step corrects it.
- The save is keyed by (owner, command id). A repeat answers the recorded result; the command record keeps a digest of the request, never the details. A save against an older version is refused (`ISSUER_DETAILS_CHANGED`). Saving the same details again writes nothing.
- It takes the same advisory lock as the offline configuration, so the two writers never take the same version number.
- One domain event, audit event and outbox row per new version (`customer.real_invoicing.issuer_saved`): the version number and the names of the changed fields. Never a value.
- The runtime login can execute only `app.real_invoicing_issuer_view()` and `app.real_invoicing_issuer_save(uuid,jsonb)`. Tables and helper functions stay closed to it. Row level security stays enabled on every table.

### D3

- The guard logic is unchanged. It lifts when no supplier field is made up, which a complete owner save achieves. Until then real invoices stay refused, and the message now says: "Real invoices are refused until the issuer details are complete. The workspace owner types them on the Invoice issuer screen and confirms with an authenticator code. Then try again."
- The secret path of ADR-064 (`set_supplier`) keeps working and stays owner only. A version written that way has no `owner_entered_by`.

### What stays closed

- Saving issuer details switches nothing on. A real workspace sees an invoice only when real plans are on, `CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED` is on and the database control is open. All three are untouched here and stay off until the owner says "live".
- No payment provider, no money movement, no payout. Amounts stay exact whole minor units; nothing here reads or writes an amount.

### Billing dates

- Dates on `/account/billing` go through `apps/web/lib/ux/format.ts`. A period, issue, due, payment or credit date is a calendar day and is formatted in UTC ("23 Oct 2026"), so it never shifts with the reader's time zone. A moment keeps its time and names its zone.

## Rollback

1. Set `CORRIDRA_INVOICE_ISSUER` off. The screen and its route answer 404 at once; nothing else changes.
2. If the database side must go: run `packages/db/customer-invoicing-real-migrations/rollback/0003_drop_owner_issuer_details.sql` as a reviewed forward run by the schema owner. It drops the two functions, the two helpers, the command record and the `owner_entered_by` column, and removes the applied line so a later install puts the change back. Every saved supplier version stays, so issued documents and D3 read the same record as before.
3. To refuse real invoices again after an owner save, close the real invoicing control with the existing `real_invoicing_action=pause` step, or write a new supplier version with `set_supplier`.

## Tests

- `tests/integration/customer-invoicing-real-issuer.test.ts`: install and repeat; owner only (admin, other roles, sample workspace refused); a stale check answers `STEP_UP_REQUIRED` and writes nothing; every refusal rule in the service and again in the database; D3 before and after; one new version with the earlier one unchanged; event and audit line without values; command replay and conflict; stale version; unchanged save; a second owner; the kept tax-rate mark and D3 still refusing with it; the secret path after an owner save; the owner of another real workspace refused; the seeded values refused; closed tables and functions for the runtime logins; rollback.
- `tests/integration/invoice-issuer-route.test.ts`: 404 with the switch off before anything is touched; session, workspace, origin, content type and size refusals; codes passed on, unexpected error text never sent.
- `tests/operator/v3-invoice-issuer-ui.spec.ts`: the four steps, each refusal line, the code checked before the single save and never sent with it, retry under the same command, load latest, the denied, not installed and switched-off lines, phone width, axe.
- `tests/integration/billing-dates.test.ts`: a billing day reads the same west of UTC, east of UTC and in UTC.
- `tests/operator/v3-billing-ui.spec.ts`, `v3-invoicing-ui.spec.ts`, `v3-real-invoicing-ui.spec.ts`: the customer billing dates in the shared format.

## Addendum, 24 November 2026 (unit B8b): the tax rate follows the GST answer

Status: Proposed with this record. It changes two lines of the Decision above and nothing else: "Country, tax name, tax rate and payment terms are not asked" and "A made-up mark on a field the screen does not ask for (the tax rate) is kept". Country, tax name and payment terms are still carried and stay under the install step.

### Why

- The screen did not ask for the tax rate, so a made-up mark on it survived every owner save and D3 kept refusing real invoices after a complete save. The owner's decision was one screen that completes the details.

### What changes

- The tax rate is still never typed and never sent. The database derives it from the GST answer the owner already gives on the GST step, for a Singapore GST issuer (country `SG`, tax name `GST`):
  - GST registered: the Singapore standard rate, 9% (900 basis points).
  - Not GST registered: 0.
- The rate source: IRAS, "Current GST rates" and "Prevailing GST rate" (iras.gov.sg), read 24 November 2026: "The current GST rate in Singapore is 9%", in force since 1 January 2024. The install seed of ADR-064 already carried 900 (`defaultRealInvoicingEntity.gstRateBps`).
- The rate lives in one place, `customer_private.real_invoicing_issuer_rate(entity, registered)`. A change of the standard rate is a new reviewed migration, never an input or a setting.
- `app.real_invoicing_issuer_save` writes the derived rate in the same ONE new supplier version and clears the mark on it, so one complete owner save leaves no made-up field and D3 lifts. The request, its digest, the command replay, the lock and every authority check are unchanged. `gstRateBps` joins the changed field names of the event when the rate or its mark changed. The event, the audit line and the command record still carry no value.
- For an issuer that is not a Singapore GST issuer the screen sets no rate: the rate is carried and a made-up mark on it is kept, as before.
- `app.real_invoicing_issuer_view` adds, under `fixed`, the rate each answer would write (`rateWhenRegisteredBps`, `rateWhenNotRegisteredBps`; null when the screen sets none). The GST step and the Check And Save step show it ("Tax rate on invoices") before the save. Before this install the two values are absent and the screen promises no rate.
- A version written by the secret path (`set_supplier`) with another rate is replaced by the derived rate on the next owner save. That is intended: for a Singapore GST issuer the standard rate is the only rate this module charges.
- Additive migration `packages/db/customer-invoicing-real-migrations/0004_issuer_tax_rate.sql`, installed by the existing `real_invoicing_action=install` step. No new workflow input, no new grant: the runtime login still executes only the view and the save.

### What stays closed

- Unchanged from the record above. Saving switches nothing on, no saved version or issued document is touched, and a document keeps the version, and so the rate, it was issued under.

### Rollback

- The screen off (`CORRIDRA_INVOICE_ISSUER`) stops all owner saves at once.
- The rollback file of this record (`rollback/0003_drop_owner_issuer_details.sql`) now also drops the rate function and removes the applied line of 0004, so a later install puts both back. There is no separate rollback for 0004: to correct a rate without it, write a new supplier version with `set_supplier`.

### Owner page link

- The Owner page shows a link "Invoice issuer details" to `/operator/invoice-issuer` at the top of "What is on and off", only to the owner of the chosen workspace and only while `CORRIDRA_INVOICE_ISSUER` is exactly `true`. An admin sees no link.

### Tests

- `tests/integration/customer-invoicing-real-issuer.test.ts`: the fourth migration; the view's two rates; a rate in the request refused in the service and in the database; a marked rate cleared by one owner save with 900 written, earlier versions unchanged, the event without a value, D3 lifted; not registered writes 0 and registering again writes 900; an issuer outside Singapore GST keeps its rate and mark; the rate function closed to the runtime logins; rollback.
- `tests/operator/v3-invoice-issuer-ui.spec.ts`: the rate on the GST step and on Check And Save for both answers, never sent, and no rate promised when the view carries none.
- `tests/integration/owner-page.test.ts`: the link for the owner with the switch on; none with the switch off or for any other role.
