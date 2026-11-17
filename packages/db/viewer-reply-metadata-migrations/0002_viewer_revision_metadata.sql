-- requires-table: app.recipient_detail_response_revision
-- ADR-087 U2, part 2: the same viewer rule for the answer-correction table app.recipient_detail_response_revision. The
-- installer applies this file only where the recipient response revision module is installed (its table exists); where it is
-- not, the file is left unrecorded and is applied by the next run of this module, which the response revision install runs
-- for it. The two read policies keep their name, command, role list and permissive kind and their text exactly, with
-- "AND app.member_role(tenant_id) <> 'viewer'" added at the end. Nothing else changes and no row is written.
-- Guard and proof as in 0001: the live policies must equal the fingerprints the revision module installs, or the file stops
-- with an error and nothing changes. Rollback: rollback/0002_restore_original_revision_reads.sql.
DO $guard$
DECLARE spec record;
BEGIN
 IF to_regclass('app.recipient_detail_response_revision') IS NULL THEN
  RAISE EXCEPTION 'Viewer revision metadata needs the recipient response revision module installed first';
 END IF;
 FOR spec IN
  SELECT e.tbl,e.pol,e.fingerprint,
   (SELECT encode(sha256(convert_to(concat_ws(E'\x1f',p.polcmd::text,p.polpermissive::text,
      array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),','),
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),
      coalesce((SELECT string_agg(m.lit[1],E'\x1e' ORDER BY m.n) FROM regexp_matches(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$('(?:[^']|'')*')$q$,'g') WITH ORDINALITY AS m(lit,n)),'')),'UTF8')),'hex')
    FROM pg_policy p WHERE p.polrelid=to_regclass('app.'||e.tbl) AND p.polname=e.pol) AS fp
  FROM (VALUES
   -- fingerprint-begin
   ('recipient_detail_response_revision','read','e45864ac4eefc4684b60e22c75ecee09b4b8210e5fef75dce118d20034459cea'),
   ('recipient_detail_response_revision','real_use_read','e7a7c4a981f7782e6506b169e36d58a9286f0f994074a4591770968512b89544')
   -- fingerprint-end
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS NULL THEN
   RAISE EXCEPTION 'Viewer revision metadata prerequisite policy is missing: %.%',spec.tbl,spec.pol;
  END IF;
  IF spec.fp<>spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer revision metadata prerequisite policy differs: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$guard$;

ALTER POLICY read ON app.recipient_detail_response_revision USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now() AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY real_use_read ON app.recipient_detail_response_revision USING (app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id)) AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now() AND app.member_role(tenant_id)<>'viewer');

DO $proof$
DECLARE spec record;
BEGIN
 FOR spec IN
  SELECT e.tbl,e.pol,e.fingerprint,
   (SELECT encode(sha256(convert_to(concat_ws(E'\x1f',p.polcmd::text,p.polpermissive::text,
      array_to_string(ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1),','),
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),$q$'(?:[^']|'')*'$q$,'?','g'),'::[a-z_]+','','g'),'[a-z_]+\.','','g'),'[[:space:]()"]','','g'),
      coalesce((SELECT string_agg(m.lit[1],E'\x1e' ORDER BY m.n) FROM regexp_matches(coalesce(pg_get_expr(p.polqual,p.polrelid),''),$q$('(?:[^']|'')*')$q$,'g') WITH ORDINALITY AS m(lit,n)),'')),'UTF8')),'hex')
    FROM pg_policy p WHERE p.polrelid=to_regclass('app.'||e.tbl) AND p.polname=e.pol) AS fp
  FROM (VALUES
   ('recipient_detail_response_revision','read','1055e800cba41ac0c6d0c75eb74550a139728fc02358c08a26f9c0fb3d787b28'),
   ('recipient_detail_response_revision','real_use_read','f606982851795cdaa69169bb2dfeedf8a3563a559178d32441ac3ebd27518290')
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer revision metadata policy was not changed as expected: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$proof$;
