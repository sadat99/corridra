-- ADR-087 quotation link check: closes the U1r residue. A staff role without delivery.read_body reads no statement, verified
-- fact or evidence file of a claim that any quotation in the same tenant names (claim_id) or whose source a quotation names
-- (source_id), whatever target or relationship visibility that quotation sits on. Before this module the check ran under the
-- reader's own row security, so a quotation on a target the reader cannot see did not count.
-- What this file adds, and nothing else: app.quotation_linked_claim(tenant, claim), a SECURITY DEFINER function that answers
-- one boolean, and two new indexes on app.mission_quotation. It returns plain false unless the tenant equals
-- the caller's corridra.tenant_id setting (the setting every read policy uses), so it never answers for another tenant. It
-- returns no row, no id, no count and no text. quotationLinkedClaimSql ORs it with the row-security check once the reader
-- learns it exists, so nothing a reader already withheld becomes readable. The installer creates the index without CONCURRENTLY
-- inside its one transaction: mission_quotation is small, so writes to it wait only briefly while the two indexes build.
-- No row is written, changed or deleted. No policy, switch or control changes.
-- Rollback: rollback/0001_drop_quotation_linked_claim.sql drops the function and the two indexes this file created; the
-- application then falls back to the row-security check by itself. It is applied only with the owner's word.
DO $guard$
BEGIN
 IF to_regclass('app.mission_quotation') IS NULL OR to_regclass('app.claim') IS NULL THEN
  RAISE EXCEPTION 'Quotation link check needs the commercial mission tables';
 END IF;
 IF to_regprocedure('app.quotation_linked_claim(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Quotation link check: app.quotation_linked_claim already exists outside this module';
 END IF;
 IF to_regclass('app.mission_quotation_tenant_claim_link') IS NOT NULL OR to_regclass('app.mission_quotation_tenant_source_link') IS NOT NULL THEN
  RAISE EXCEPTION 'Quotation link check: an index of this module already exists outside this module';
 END IF;
END
$guard$;

CREATE FUNCTION app.quotation_linked_claim(p_tenant uuid, p_claim uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
 SELECT coalesce(
  p_tenant = NULLIF(pg_catalog.current_setting('corridra.tenant_id', true), '')::uuid
  AND EXISTS(
   SELECT FROM app.claim lc
   WHERE lc.tenant_id = p_tenant AND lc.id = p_claim
    AND (EXISTS(SELECT FROM app.mission_quotation q WHERE q.tenant_id = lc.tenant_id AND q.claim_id = lc.id)
     OR EXISTS(SELECT FROM app.mission_quotation q WHERE q.tenant_id = lc.tenant_id AND q.source_id = lc.source_id))),
  false)
$$;
REVOKE ALL ON FUNCTION app.quotation_linked_claim(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.quotation_linked_claim(uuid, uuid) TO corridra_runtime;
COMMENT ON FUNCTION app.quotation_linked_claim(uuid, uuid) IS
 'ADR-087 quotation link check: true when a quotation in the caller''s own tenant names the claim or its source. Boolean only.';

-- Each claim read by a staff viewer asks this once, so the two lookups use an index. Neither existed before this module
-- (core 0023 indexes mission_quotation by id, rfq, target and revision, and previous id only).
CREATE INDEX mission_quotation_tenant_claim_link ON app.mission_quotation(tenant_id, claim_id);
CREATE INDEX mission_quotation_tenant_source_link ON app.mission_quotation(tenant_id, source_id);

DO $proof$
DECLARE f record;
BEGIN
 SELECT p.prosecdef,p.provolatile,p.proconfig,p.proacl,p.prorettype::regtype::text AS ret INTO f
  FROM pg_proc p WHERE p.oid=to_regprocedure('app.quotation_linked_claim(uuid,uuid)');
 IF f IS NULL OR NOT f.prosecdef OR f.provolatile<>'s' OR f.ret<>'boolean'
  OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, app'] THEN
  RAISE EXCEPTION 'Quotation link check: the function is not the one this file defines';
 END IF;
 IF EXISTS(SELECT FROM aclexplode(f.proacl) a WHERE a.grantee=0) THEN
  RAISE EXCEPTION 'Quotation link check: PUBLIC must not execute the function';
 END IF;
 IF NOT has_function_privilege('corridra_runtime','app.quotation_linked_claim(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Quotation link check: the runtime role must execute the function';
 END IF;
 -- The function reads every row of both tables only because its owner is not held to their row security: it owns both, or
 -- has BYPASSRLS (or is a superuser), and neither table has FORCE ROW LEVEL SECURITY. Otherwise its answer would quietly
 -- depend on the owner's own policies, so refuse.
 IF EXISTS(
  SELECT FROM pg_class c, pg_proc p, pg_roles r
  WHERE c.oid IN ('app.claim'::regclass,'app.mission_quotation'::regclass)
   AND p.oid=to_regprocedure('app.quotation_linked_claim(uuid,uuid)') AND r.oid=p.proowner
   AND (c.relforcerowsecurity OR NOT (c.relowner=p.proowner OR r.rolbypassrls OR r.rolsuper))) THEN
  RAISE EXCEPTION 'Quotation link check: the function owner must own app.claim and app.mission_quotation or bypass row security, and neither may force row security';
 END IF;
END
$proof$;
