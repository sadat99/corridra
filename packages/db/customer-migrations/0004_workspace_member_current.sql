-- Removed members, part 1: the membership helpers and the replay of a submitted request.
-- Three read-only definer helpers carry the rule for every later file. They write nothing, have no runtime or auth grant and are
-- called only by definer functions: customer_private.workspace_member_current(workspace, person) for one pair,
-- customer_private.workspace_ids_current(person) for the set a list filters on (computed once per call), and
-- customer_private.request_author_current(request), which is false for an unknown request. They use the existing indexes on
-- customer.membership (principal_id, tenant_id), workspace_member (principal_id, tenant_id) and the unique member_id of
-- workspace_access_revocation. No new index.
-- customer.request_retry keeps its conflict check, then answers NULL for a person who is no longer a current member of the
-- workspace the command was made in. submit_private_request asks request_retry first, so the replay is refused with
-- 'Workspace access denied', the text of any workspace the person cannot use. submit_private_request itself is not changed.
-- Removed members lose access to workspace requests and reports (owner decision, 11 Nov 2026: "No, remove access (Recommended)";
-- ADR-033 amendment, with ADR-032, 035, 036, 040, 051 and 076). A request belongs to its workspace. A person who has left or been
-- removed sees none of it, including what they wrote. Requests made outside any workspace stay theirs. Fail closed.
-- One rule everywhere: a person is a current member of a workspace when a customer.membership row exists (original or transferred
-- owner, former owner who is now an admin) or a customer_private.workspace_member row exists with no workspace_access_revocation row
-- for that member (leave and owner revoke write the same row). A new invitation is a new member row, so re-admission needs no code.
-- Every denial uses the same error code and text as an unknown id on that path. Lists filter in the WHERE clause and in the
-- next-page probe and never raise. Additive: replaces functions only (same name, argument names, defaults, language, security
-- mode, volatility, search path and grants); no table, policy, trigger, row or event is created, changed or deleted.
-- Guard, one DO block that runs first. It compares every function this file replaces with the owner-run fingerprint below (stored
-- body, settings, security mode, volatility, argument types, defaults and EXECUTE grantees; no catalogue text dump, so the result
-- is the same on every PostgreSQL major version). Three states. ABSENT: none of the functions exists and the registry has no row
-- for the file before this one: a notice, nothing changed, nothing created. CHANGED: any function differs, only some exist, or the
-- registry holds another hash for the file before this one: an error, and none is replaced because all are compared first.
-- MATCHING: every function equals its constant and every grantee list is equal: all are replaced, then the owner, settings, security
-- mode, volatility, argument types and grantees are proved unchanged. The constants sit between the fingerprint-begin and
-- fingerprint-end markers. The live query sits between the fingerprint-query markers; an owner can copy it, add a semicolon and
-- run it on any database to read the live values.
DO $guard$
DECLARE spec record; total integer:=0; present integer:=0; wrong text; registered boolean; recorded text;
 before_state jsonb; after_state jsonb; helper text; holder text;
BEGIN
 FOR spec IN
  SELECT e.signature,e.fingerprint,e.grantees,q.fp,q.grantees live_grantees
  FROM (VALUES
   -- fingerprint-begin
   ('customer.request_retry(uuid,uuid,jsonb)','d50b4c5a63360ca15aa03570de35ee5560ebc8932ed86e3f513089b0397b55f7','corridra_runtime')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer.request_retry(uuid,uuid,jsonb)')
   ) v(signature)
   LEFT JOIN LATERAL (
    SELECT encode(sha256(convert_to(concat_ws(E'\x1f',p.prosrc,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),'')),'UTF8')),'hex') fp,
     (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) grantees
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(v.signature)
   ) f ON true
   -- fingerprint-query-end
  ) q ON q.signature=e.signature
 LOOP
  total:=total+1;
  IF spec.fp IS NOT NULL THEN present:=present+1; END IF;
  IF spec.fp IS DISTINCT FROM spec.fingerprint OR spec.live_grantees IS DISTINCT FROM spec.grantees THEN
   wrong:=coalesce(wrong||', ','')||split_part(spec.signature,'(',1);
  END IF;
 END LOOP;
 registered:=to_regclass('customer_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_migrations.applied WHERE name=$1' INTO recorded USING '0003_private_customer_requests.sql';
 END IF;
 -- ABSENT: none of the functions exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: customer migration 0003 is not applied';
  RETURN;
 END IF;
 -- CHANGED: some function is missing, or any compared property of any function differs, or the registry holds another hash
 -- for the file before this one. All of them are compared before the first one is replaced.
 IF present<total THEN
  RAISE EXCEPTION 'Removed member access prerequisite function is missing (% of % present)',present,total;
 END IF;
 IF wrong IS NOT NULL THEN
  RAISE EXCEPTION 'Removed member access prerequisite function differs: %',wrong;
 END IF;
 IF recorded IS NOT NULL AND recorded<>'f5ce0b4dd4bb652dd50f53ab5f48b5c2a827c238a4ecc200124e920c34ef2def' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0003_private_customer_requests.sql';
 END IF;
 -- MATCHING: every function equals its constant. Remember the parts that CREATE OR REPLACE must not change, then replace all.
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO before_state
 FROM (VALUES
    ('customer.request_retry(uuid,uuid,jsonb)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.workspace_member_current(workspace uuid,person uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=workspace AND m.principal_id=person)
  OR EXISTS(SELECT FROM customer_private.workspace_member w WHERE w.tenant_id=workspace AND w.principal_id=person
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=w.id))
$$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.workspace_ids_current(person uuid) RETURNS SETOF uuid
 LANGUAGE sql STABLE ROWS 20 SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.tenant_id FROM customer.membership m WHERE m.principal_id=person
 UNION
 SELECT w.tenant_id FROM customer_private.workspace_member w WHERE w.principal_id=person
  AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=w.id)
$$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.request_author_current(request uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT customer_private.workspace_member_current(o.workspace_id,o.principal_id)
  FROM customer_private.owned_request o WHERE o.id=request),false)
$$
$fn$;
 EXECUTE 'REVOKE ALL ON FUNCTION customer_private.workspace_member_current(uuid,uuid),customer_private.workspace_ids_current(uuid),customer_private.request_author_current(uuid) FROM PUBLIC,corridra_runtime,corridra_auth';
 -- The helpers are definers owned by whoever installed them. A function that now calls one needs EXECUTE on it when its owner is another role.
 FOR holder IN SELECT DISTINCT pg_get_userbyid(p.proowner) FROM unnest(ARRAY['customer.request_retry(uuid,uuid,jsonb)']) AS u(sig)
  JOIN pg_proc p ON p.oid=to_regprocedure(u.sig) LOOP
  FOREACH helper IN ARRAY ARRAY['customer_private.workspace_member_current(uuid,uuid)'] LOOP
   IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.request_retry(command uuid,target uuid,b jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); owned customer_private.owned_request;
BEGIN
 IF command IS NULL OR target IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Request context required' USING ERRCODE='23514'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE principal_id=actor AND command_id=command;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF owned.workspace_id<>target OR owned.brief_digest<>encode(sha256(convert_to(b::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 -- A person who is no longer a current member of the workspace has no replay: the caller then takes the normal path,
 -- which refuses with the workspace access text.
 IF NOT customer_private.workspace_member_current(owned.workspace_id,actor) THEN RETURN NULL; END IF;
 RETURN customer_private.request_result(owned.id,actor);
END $$
$fn$;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer.request_retry(uuid,uuid,jsonb)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than function bodies';
 END IF;
END $guard$;
