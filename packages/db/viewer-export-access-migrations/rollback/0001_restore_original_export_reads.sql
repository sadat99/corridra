-- ROLLBACK for ADR-087 U3 (0001_viewer_export_access.sql). Not applied by the installer: the migrator reads only the .sql
-- files directly in the module folder, never this rollback folder. To roll back, with the owner's word, copy this file
-- unchanged to the next free number of the module (0002_restore_original_export_reads.sql), review and merge it, and run
-- field_modules_action=viewer_export_access again. It refuses unless each policy is exactly the one 0001 installed, restores
-- the four original expressions word for word (core 0016 and real-use 0002), and proves the original fingerprints.
DO $guard$
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
  IF spec.fp IS NULL THEN
   RAISE EXCEPTION 'Viewer export access rollback: policy is missing: %.%',spec.tbl,spec.pol;
  END IF;
  IF spec.fp<>spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer export access rollback: policy is not the one the module installed: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$guard$;

ALTER POLICY read ON app.delivery_export USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation'));
ALTER POLICY real_use_read ON app.delivery_export USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))));
ALTER POLICY read ON app.delivery_export_artifact USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation'));
ALTER POLICY real_use_read ON app.delivery_export_artifact USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))));

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
   ('delivery_export','read','f5aaea339e44ddd2a00c89c7a934c52eebb3617d606b9b16fe54a4b5c77668c4'),
   ('delivery_export','real_use_read','5f5764768bd07d9629a1fbd054101a5bb84e71e7ddecdc5d33b7db14e7f91b3f'),
   ('delivery_export_artifact','read','f5aaea339e44ddd2a00c89c7a934c52eebb3617d606b9b16fe54a4b5c77668c4'),
   ('delivery_export_artifact','real_use_read','5f5764768bd07d9629a1fbd054101a5bb84e71e7ddecdc5d33b7db14e7f91b3f')
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer export access rollback: policy was not restored: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$proof$;
