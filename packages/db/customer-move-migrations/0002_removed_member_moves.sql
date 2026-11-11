-- Removed members, part 4: the move list. customer.private_request_moves lists only the requests of workspaces the person is a
-- current member of, in the page query and in the next-page probe. Needs customer migration 0004.
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
-- mode, volatility, argument types and grantees are proved unchanged. The constants sit between the begin and end marker comments of the
-- fingerprint block. The live query sits between the begin and end marker comments of the fingerprint query block; an owner can copy it, add a semicolon and
-- run it on any database to read the live values.
DO $guard$
DECLARE spec record; total integer:=0; present integer:=0; wrong text; registered boolean; recorded text;
 before_state jsonb; after_state jsonb; helper text; holder text;
BEGIN
 FOR spec IN
  SELECT e.signature,e.fingerprint,e.grantees,q.fp,q.grantees live_grantees
  FROM (VALUES
   -- fingerprint-begin
   ('customer.private_request_moves(uuid,integer)','be05e066ae371e9950469f584f641f047efeb090f69fc88455822753475931f0','corridra_runtime')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer.private_request_moves(uuid,integer)')
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
 registered:=to_regclass('customer_move_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_move_migrations.applied WHERE name=$1' INTO recorded USING '0001_move_records.sql';
 END IF;
 -- ABSENT: none of the functions exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: move records 0001 is not applied';
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
 IF recorded IS NOT NULL AND recorded<>'c01949a57ca472e2683a0ba0c4c014bdbb0ea551b41e37f651e0f750c979f270' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0001_move_records.sql';
 END IF;
 IF to_regprocedure('customer_private.workspace_ids_current(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.workspace_ids_current';
 END IF;
 -- MATCHING: every function equals its constant. Remember the parts that CREATE OR REPLACE must not change, then replace all.
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO before_state
 FROM (VALUES
    ('customer.private_request_moves(uuid,integer)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 -- The helpers are definers owned by whoever installed them. A function that now calls one needs EXECUTE on it when its owner is another role.
 FOR holder IN SELECT DISTINCT pg_get_userbyid(p.proowner) FROM unnest(ARRAY['customer.private_request_moves(uuid,integer)']) AS u(sig)
  JOIN pg_proc p ON p.oid=to_regprocedure(u.sig) LOOP
  FOREACH helper IN ARRAY ARRAY['customer_private.workspace_ids_current(uuid)'] LOOP
   IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.private_request_moves(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); items jsonb; next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 IF NOT customer_private.move_open() THEN
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('open',false,'requests','[]'::jsonb,'nextAfter',NULL,'synthetic',customer_private.synthetic_context());
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',o.id,'moves',(
   SELECT jsonb_agg(jsonb_build_object('id',m.id,'verb',m.verb,'object',m.object,'holder',m.holder,'dueOn',m.due_on,'setAt',m.created_at) ORDER BY m.position,m.created_at)
   FROM app.mission_move m WHERE m.tenant_id=o.mission_tenant_id AND m.mission_id=o.mission_id
   AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id))) ORDER BY o.id),'[]'::jsonb) INTO items
 FROM (SELECT r.id,r.mission_tenant_id,r.mission_id FROM customer_private.owned_request r
   WHERE r.principal_id=actor AND r.workspace_id = ANY (ARRAY(SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid))) AND (after_id IS NULL OR r.id>after_id)
   AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)
   AND EXISTS(SELECT FROM app.mission_intake i WHERE i.id=r.mission_id AND i.tenant_id=r.mission_tenant_id AND i.retention_until>clock_timestamp())
   AND EXISTS(SELECT FROM app.mission_move m WHERE m.tenant_id=r.mission_tenant_id AND m.mission_id=r.mission_id
     AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id))
   ORDER BY r.id LIMIT page_size) o;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'requestId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.principal_id=actor AND r.workspace_id = ANY (ARRAY(SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid))) AND r.id>next_id
    AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)
    AND EXISTS(SELECT FROM app.mission_move m WHERE m.tenant_id=r.mission_tenant_id AND m.mission_id=r.mission_id
     AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id))) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('open',true,'requests',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer.private_request_moves(uuid,integer)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than function bodies';
 END IF;
END $guard$;
