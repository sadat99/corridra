-- ROLLBACK for the ADR-087 quotation link check (0001_quotation_linked_claim.sql). Not applied by the installer: the migrator
-- reads only the .sql files directly in the module folder, never this rollback folder. To roll back, with the owner's word,
-- copy this file unchanged to the next free number of the module (0002_drop_quotation_linked_claim.sql), review and merge it,
-- and run field_modules_action=quotation_link_check again. It drops the function and the two indexes 0001 created, and
-- nothing else. quotationLinkedClaimSql sees the function is gone and falls back to the row-security check by itself, so a
-- staff viewer reads again what it read before 0001 (the U1r residue). No customer row is written, changed or deleted.
DROP FUNCTION IF EXISTS app.quotation_linked_claim(uuid, uuid);
DROP INDEX IF EXISTS app.mission_quotation_tenant_claim_link;
DROP INDEX IF EXISTS app.mission_quotation_tenant_source_link;
DO $proof$
BEGIN
 IF to_regprocedure('app.quotation_linked_claim(uuid,uuid)') IS NOT NULL
  OR to_regclass('app.mission_quotation_tenant_claim_link') IS NOT NULL
  OR to_regclass('app.mission_quotation_tenant_source_link') IS NOT NULL THEN
  RAISE EXCEPTION 'Quotation link check rollback: the function or an index is still present';
 END IF;
END
$proof$;
