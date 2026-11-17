-- ADR-087 U3: report exports and snapshots for everyone on staff except viewers. A staff member whose role in the workspace
-- is viewer no longer reads rows of app.delivery_export (the frozen report snapshot) or app.delivery_export_artifact (the
-- export file). Owner, admin, operator and reviewer read exactly what they read before. The link holder's export path uses
-- its own token functions and is not touched; no staff application path reads these tables today.
-- What changes, and nothing else: the four read policies below keep their name, command, role list and permissive kind
-- (ALTER POLICY ... USING) and their text exactly, with "AND app.member_role(tenant_id) <> 'viewer'" added at the end.
-- No row is written, changed or deleted. No switch or control changes.
-- Guard and proof in the shape of commercial readiness 0012 and viewer reply metadata 0001: each live policy must equal the
-- constant below or the file stops with an error and nothing changes; afterwards the new fingerprints are proved.
-- The fingerprint strips parentheses, which is sound because every compared expression is a chain of ANDs.
-- Rollback: rollback/0001_restore_original_export_reads.sql restores the four original expressions, guarded by the
-- fingerprints this file leaves, as the next numbered file of this module. It is applied only with the owner's word.
DO $guard$
DECLARE spec record;
BEGIN
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Viewer export access needs the customer real-use modules installed first';
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
   ('delivery_export','read','f5aaea339e44ddd2a00c89c7a934c52eebb3617d606b9b16fe54a4b5c77668c4'),
   ('delivery_export','real_use_read','5f5764768bd07d9629a1fbd054101a5bb84e71e7ddecdc5d33b7db14e7f91b3f'),
   ('delivery_export_artifact','read','f5aaea339e44ddd2a00c89c7a934c52eebb3617d606b9b16fe54a4b5c77668c4'),
   ('delivery_export_artifact','real_use_read','5f5764768bd07d9629a1fbd054101a5bb84e71e7ddecdc5d33b7db14e7f91b3f')
   -- fingerprint-end
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS NULL THEN
   RAISE EXCEPTION 'Viewer export access prerequisite policy is missing: %.%',spec.tbl,spec.pol;
  END IF;
  IF spec.fp<>spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer export access prerequisite policy differs: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$guard$;

ALTER POLICY read ON app.delivery_export USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY real_use_read ON app.delivery_export USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))) AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY read ON app.delivery_export_artifact USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY real_use_read ON app.delivery_export_artifact USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))) AND app.member_role(tenant_id)<>'viewer');

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
   ('delivery_export','read','65e512807f836b553a482628e07ec7cc0d8bee31fd7a9ab1f0d8b656bd05459a'),
   ('delivery_export','real_use_read','eaa21747e112e208147efc9a47d0bed75fd360f0857265db0e5e07f51053ea79'),
   ('delivery_export_artifact','read','65e512807f836b553a482628e07ec7cc0d8bee31fd7a9ab1f0d8b656bd05459a'),
   ('delivery_export_artifact','real_use_read','eaa21747e112e208147efc9a47d0bed75fd360f0857265db0e5e07f51053ea79')
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer export access policy was not changed as expected: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$proof$;
