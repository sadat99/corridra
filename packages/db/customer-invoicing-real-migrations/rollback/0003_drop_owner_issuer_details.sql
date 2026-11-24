-- ADR-092 rollback. Removes the Invoice issuer screen's database side: its two functions, its helpers, its command record
-- and the "typed by" column. Run only as a reviewed forward run by the schema owner, after CORRIDRA_INVOICE_ISSUER is off.
-- Every supplier version stays exactly as saved, including the versions an owner typed, so issued documents keep the
-- version they name and the real-invoice refusal (D3) keeps reading the same record. What is lost: who typed a version on
-- the screen (the executor on each version still names the same person) and the replay record of past saves.
-- The applied line is removed so a later install puts the change back.
DROP FUNCTION app.real_invoicing_issuer_save(uuid,jsonb);
DROP FUNCTION app.real_invoicing_issuer_view();
DROP FUNCTION customer_private.real_invoicing_issuer_owner(boolean);
DROP FUNCTION customer_private.real_invoicing_issuer_madeup(customer_private.real_invoicing_entity);
DROP TABLE customer_private.real_invoicing_issuer_command;
ALTER TABLE customer_private.real_invoicing_entity DROP COLUMN owner_entered_by;
DELETE FROM customer_invoicing_real_migrations.applied WHERE name='0003_owner_issuer_details.sql';
