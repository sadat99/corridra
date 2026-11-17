-- ADR-087 U2, part 1: staff viewers read reply and answer metadata only. A staff member whose role in the workspace is viewer
-- no longer reads the rows (and so the bodies) of app.recipient_detail_response (a supplier or buyer reply) or
-- app.delivery_response (an evidence answer). Owner, admin, operator and reviewer read exactly what they read before, and a link
-- holder's token reads go through their own definer functions and are not touched. The answer-correction table
-- (app.recipient_detail_response_revision) is changed by file 0002, which the installer applies only where that module exists.
-- What changes, and nothing else:
--   * the four read policies below keep their name, command, role list and permissive kind (ALTER POLICY ... USING) and keep
--     their text exactly, with "AND app.member_role(tenant_id) <> 'viewer'" added at the end;
--   * two new typed meta reads, app.reply_meta(tenant, link) and app.delivery_response_meta(tenant, request): security
--     definer, search path pg_catalog, executable by corridra_runtime only, and gated by exactly the scope the two original
--     policies gave together (sample OR real use), so a viewer still sees that a reply or answer exists, its source kind and
--     its dates, and never its body. They read, and write nothing.
-- No row is written, changed or deleted. No switch or control changes. app.buyer_response holds no free text and is unchanged.
-- Guard, one DO block that runs first, in the shape of commercial readiness 0012: it compares each live policy with the
-- constant below (command, permissive kind, role names, and the expressions with string literals taken out and casts, schema
-- names, parentheses, quotes and spaces removed, so the result is the same on every PostgreSQL major version). A policy that is
-- missing or differs stops the file with an error and nothing changes. The two function names must be free. After the change a
-- second block proves the new fingerprints, the role lists, and the definer, search path and grants of both functions.
-- Rollback: rollback/0001_restore_original_reads.sql restores the four original expressions, guarded by the fingerprints this
-- file leaves, as the next numbered file of this module. It is applied only with the owner's word.
DO $guard$
DECLARE spec record;
BEGIN
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Viewer reply metadata needs the customer real-use modules installed first';
 END IF;
 IF to_regprocedure('app.reply_meta(uuid,uuid)') IS NOT NULL OR to_regprocedure('app.delivery_response_meta(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Viewer reply metadata: a meta function already exists';
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
   ('recipient_detail_response','read','e45864ac4eefc4684b60e22c75ecee09b4b8210e5fef75dce118d20034459cea'),
   ('recipient_detail_response','real_use_read','e7a7c4a981f7782e6506b169e36d58a9286f0f994074a4591770968512b89544'),
   ('delivery_response','read','f5aaea339e44ddd2a00c89c7a934c52eebb3617d606b9b16fe54a4b5c77668c4'),
   ('delivery_response','real_use_read','5f5764768bd07d9629a1fbd054101a5bb84e71e7ddecdc5d33b7db14e7f91b3f')
   -- fingerprint-end
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS NULL THEN
   RAISE EXCEPTION 'Viewer reply metadata prerequisite policy is missing: %.%',spec.tbl,spec.pol;
  END IF;
  IF spec.fp<>spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer reply metadata prerequisite policy differs: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
END
$guard$;

ALTER POLICY read ON app.recipient_detail_response USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now() AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY real_use_read ON app.recipient_detail_response USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id)) AND app.buyer_link_access(tenant_id,link_id) AND retention_until>now()) AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY read ON app.delivery_response USING (app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id)<>'viewer');
ALTER POLICY real_use_read ON app.delivery_response USING (app.real_use_allowed(tenant_id) AND (app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))) AND app.member_role(tenant_id)<>'viewer');

-- Replies on one private link: the same scope as the two original read policies together (sample OR real use, the link
-- holder's relationship scope through app.buyer_link_access, retention not passed), and no body. Where answer correction is
-- installed, the latest correction's version and date come with each reply (never its body); otherwise both are null.
CREATE FUNCTION app.reply_meta(target uuid,lid uuid)
RETURNS TABLE(id uuid,link_id uuid,source_kind text,created_at timestamptz,retention_until timestamptz,latest_version integer,latest_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
BEGIN
 IF NOT coalesce(app.buyer_link_access(target,lid) AND (app.can_access(target,'INTERNAL','synthetic_validation')
   OR (app.real_use_allowed(target) AND app.can_access(target,'INTERNAL',app.tenant_processing_purpose(target)))),false) THEN
  RETURN;
 END IF;
 IF to_regclass('app.recipient_detail_response_revision') IS NULL THEN
  RETURN QUERY SELECT d.id,d.link_id,d.source_kind,d.created_at,d.retention_until,NULL::integer,NULL::timestamptz
   FROM app.recipient_detail_response d WHERE d.tenant_id=target AND d.link_id=lid AND d.retention_until>now()
   ORDER BY d.created_at DESC,d.id;
 ELSE
  RETURN QUERY EXECUTE 'SELECT d.id,d.link_id,d.source_kind,d.created_at,d.retention_until,y.version,y.created_at
   FROM app.recipient_detail_response d
   LEFT JOIN LATERAL(SELECT r.version,r.created_at FROM app.recipient_detail_response_revision r
    WHERE r.tenant_id=d.tenant_id AND r.response_id=d.id AND r.retention_until>now() ORDER BY r.version DESC LIMIT 1) y ON true
   WHERE d.tenant_id=$1 AND d.link_id=$2 AND d.retention_until>now() ORDER BY d.created_at DESC,d.id' USING target,lid;
 END IF;
END
$$;

-- Answers to one evidence request: the same scope as the two original read policies together, and no body.
CREATE FUNCTION app.delivery_response_meta(target uuid,request uuid)
RETURNS TABLE(id uuid,request_id uuid,link_id uuid,source_kind text,claim_status text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.id,s.request_id,s.link_id,s.source_kind,s.claim_status,s.created_at FROM app.delivery_response s
 WHERE s.tenant_id=target AND s.request_id=request
  AND coalesce(app.can_access(target,'INTERNAL','synthetic_validation')
   OR (app.real_use_allowed(target) AND app.can_access(target,'INTERNAL',app.tenant_processing_purpose(target))),false)
 ORDER BY s.created_at DESC,s.id
$$;

REVOKE ALL ON FUNCTION app.reply_meta(uuid,uuid),app.delivery_response_meta(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.reply_meta(uuid,uuid),app.delivery_response_meta(uuid,uuid) TO corridra_runtime;

-- Proof: the four policies now carry the viewer clause and nothing else changed in them; both functions are definer, with the
-- fixed search path, and only the owner and corridra_runtime may execute them.
DO $proof$
DECLARE spec record; f text;
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
   ('recipient_detail_response','read','1055e800cba41ac0c6d0c75eb74550a139728fc02358c08a26f9c0fb3d787b28'),
   ('recipient_detail_response','real_use_read','f606982851795cdaa69169bb2dfeedf8a3563a559178d32441ac3ebd27518290'),
   ('delivery_response','read','65e512807f836b553a482628e07ec7cc0d8bee31fd7a9ab1f0d8b656bd05459a'),
   ('delivery_response','real_use_read','eaa21747e112e208147efc9a47d0bed75fd360f0857265db0e5e07f51053ea79')
  ) AS e(tbl,pol,fingerprint)
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint THEN
   RAISE EXCEPTION 'Viewer reply metadata policy was not changed as expected: %.%',spec.tbl,spec.pol;
  END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['app.reply_meta(uuid,uuid)','app.delivery_response_meta(uuid,uuid)'] LOOP
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure(f) AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'])
   OR has_function_privilege('corridra_auth',f,'EXECUTE') OR NOT has_function_privilege('corridra_runtime',f,'EXECUTE')
   OR EXISTS(SELECT FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=to_regprocedure(f) AND a.grantee=0) THEN
   RAISE EXCEPTION 'Viewer reply metadata function is not definer, fixed path and runtime only: %',f;
  END IF;
 END LOOP;
END
$proof$;
