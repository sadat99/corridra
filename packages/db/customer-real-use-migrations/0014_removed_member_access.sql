-- Removed members, part 2: requests, saved reports, assigned missions and programme objectives.
-- Needs customer migration 0004 (the helpers) and replaces fourteen functions, and adds customer_private.link_workspace_current
-- (a saved report is tied to a workspace through the assignment of its link to a request: the report is denied only when the link
-- was delivered for a request this person wrote and they are not a current member; a report saved by a link with no assignment,
-- or assigned to a request another member wrote, stays with the holder). It lives here because it reads app.customer_delivery_assignment.
-- Replaced here because no later module reads their text. Not replaced on purpose: customer_private.request_result, which request
-- withdrawal 0001 fingerprints, and customer.submit_private_request, which the workspace lifecycle module fingerprints. They are
-- covered through the readers below and through customer.request_retry (customer migration 0004). The participant objective view
-- (programme_mission_summaries) shows an objective whose request author has left in the unavailable form an expired source takes
-- (id, version and status only), so the stop-only withdraw stays reachable; the organiser view is unchanged.
-- The function's pinned text is the one installed after real-use 0013, including the earlier text patch of 0011.
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
   ('customer.private_requests(uuid,integer)','8d7fbf5782c17b896ba433809dde50f77224eff17d5bafd0267545036bc79af9','corridra_runtime'),
   ('customer.complete_pending_request(uuid,text,uuid)','7dfd24625a0f283ea035db3deada40c4b5844774f10cd48940504e004afcf8a0','corridra_runtime'),
   ('customer.private_request_detail(uuid)','2581ff9c6da9946e0563e99764e2912d6291ced373f1b5ac2579ab7beb7ea7f2','corridra_runtime'),
   ('customer_private.assignment_summary(uuid,uuid)','37907efc878c930d3bc1af967b9ef756dac8c0734b3001b690285fcbd1850010',''),
   ('customer.assigned_missions(uuid,integer)','055b60b1ad534728522e8f94bb6b04da3388f1b3387ddc7655a5c6beff8aaab1','corridra_runtime'),
   ('customer_private.saved_mission_summary(uuid,uuid)','9c53e98badc5ae767bff09becfd65fabf3c118ae7de7dd5e4ebcad2be326f260',''),
   ('customer.saved_mission_action(uuid,uuid,uuid,text)','a322ff5d5c9014442c358e9b9726aa02ddcc7ca94a9e3fe311848a381ea601e8','corridra_runtime'),
   ('customer.save_mission_invitation(uuid,text)','362ee7bcf2ce9d1b9c69b3c0a3a0391dfc56cf3db1c382862718ce0f36a5c06b','corridra_runtime'),
   ('customer.remove_saved_mission(uuid,uuid)','77edac6d2143d1dca4cd95be331a4366d56ecb7b67916b3f729f401b5e463ad7','corridra_runtime'),
   ('customer.saved_missions(uuid,integer)','cf405ab206171edbabd03b9c21bb4ad41805c665da48a0930e3765a26cbe65fa','corridra_runtime'),
   ('customer.company_portfolio(uuid,integer)','07893fb8cb01d8c655192b93d1b0fa3f5bcf4477fbe8a21e42ada5da344e57c5','corridra_runtime'),
   ('customer.programme_mission_choices(uuid,uuid,integer)','7a0500291d82f004c0b3d19d18f583222fd7eaadbd90845c1512d69e55400cd3','corridra_runtime'),
   ('customer.programme_mission_summaries(uuid,boolean,uuid,integer)','60abe4957204625d0e87e2cfa82cb06dd2bb931856cb6dc3807247a58ce952bb','corridra_runtime'),
   ('customer_private.programme_mission_scope(uuid,uuid,uuid,boolean)','595606d7124b6a15faee23c74fc4f0a3cb208199c6bdb1267709557d6e10d641','')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer.private_requests(uuid,integer)'),
    ('customer.complete_pending_request(uuid,text,uuid)'),
    ('customer.private_request_detail(uuid)'),
    ('customer_private.assignment_summary(uuid,uuid)'),
    ('customer.assigned_missions(uuid,integer)'),
    ('customer_private.saved_mission_summary(uuid,uuid)'),
    ('customer.saved_mission_action(uuid,uuid,uuid,text)'),
    ('customer.save_mission_invitation(uuid,text)'),
    ('customer.remove_saved_mission(uuid,uuid)'),
    ('customer.saved_missions(uuid,integer)'),
    ('customer.company_portfolio(uuid,integer)'),
    ('customer.programme_mission_choices(uuid,uuid,integer)'),
    ('customer.programme_mission_summaries(uuid,boolean,uuid,integer)'),
    ('customer_private.programme_mission_scope(uuid,uuid,uuid,boolean)')
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
 registered:=to_regclass('customer_real_use_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_real_use_migrations.applied WHERE name=$1' INTO recorded USING '0013_organisation_link_provenance_and_search.sql';
 END IF;
 -- ABSENT: none of the functions exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: the real-use functions are not installed';
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
 IF recorded IS NOT NULL AND recorded<>'5d31a7eef89bf6507fa5027ed3535e567c2595f49a6edac5c17c2e9ddbfe618a' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0013_organisation_link_provenance_and_search.sql';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.workspace_member_current';
 END IF;
 IF to_regprocedure('customer_private.workspace_ids_current(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.workspace_ids_current';
 END IF;
 IF to_regprocedure('customer_private.request_author_current(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.request_author_current';
 END IF;
 -- MATCHING: every function equals its constant. Remember the parts that CREATE OR REPLACE must not change, then replace all.
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO before_state
 FROM (VALUES
    ('customer.private_requests(uuid,integer)'),
    ('customer.complete_pending_request(uuid,text,uuid)'),
    ('customer.private_request_detail(uuid)'),
    ('customer_private.assignment_summary(uuid,uuid)'),
    ('customer.assigned_missions(uuid,integer)'),
    ('customer_private.saved_mission_summary(uuid,uuid)'),
    ('customer.saved_mission_action(uuid,uuid,uuid,text)'),
    ('customer.save_mission_invitation(uuid,text)'),
    ('customer.remove_saved_mission(uuid,uuid)'),
    ('customer.saved_missions(uuid,integer)'),
    ('customer.company_portfolio(uuid,integer)'),
    ('customer.programme_mission_choices(uuid,uuid,integer)'),
    ('customer.programme_mission_summaries(uuid,boolean,uuid,integer)'),
    ('customer_private.programme_mission_scope(uuid,uuid,uuid,boolean)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.link_workspace_current(link_tenant uuid,link uuid,person uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;
BEGIN
 IF to_regclass('app.customer_delivery_assignment') IS NULL THEN RETURN true; END IF;
 SELECT o.workspace_id INTO ws FROM app.customer_delivery_assignment a JOIN customer_private.owned_request o ON o.id=a.request_id
  WHERE a.tenant_id=link_tenant AND a.link_id=link AND o.principal_id=person;
 IF NOT FOUND THEN RETURN true; END IF;
 RETURN customer_private.workspace_member_current(ws,person);
END $$
$fn$;
 EXECUTE 'REVOKE ALL ON FUNCTION customer_private.link_workspace_current(uuid,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth';
 -- The helpers are definers owned by whoever installed them. A function that now calls one needs EXECUTE on it when its owner is another role.
 FOR holder IN SELECT DISTINCT pg_get_userbyid(p.proowner) FROM unnest(ARRAY['customer.private_requests(uuid,integer)','customer.complete_pending_request(uuid,text,uuid)','customer.private_request_detail(uuid)','customer_private.assignment_summary(uuid,uuid)','customer.assigned_missions(uuid,integer)','customer_private.saved_mission_summary(uuid,uuid)','customer.saved_mission_action(uuid,uuid,uuid,text)','customer.save_mission_invitation(uuid,text)','customer.remove_saved_mission(uuid,uuid)','customer.saved_missions(uuid,integer)','customer.company_portfolio(uuid,integer)','customer.programme_mission_choices(uuid,uuid,integer)','customer.programme_mission_summaries(uuid,boolean,uuid,integer)','customer_private.programme_mission_scope(uuid,uuid,uuid,boolean)','customer_private.link_workspace_current(uuid,uuid,uuid)']) AS u(sig)
  JOIN pg_proc p ON p.oid=to_regprocedure(u.sig) LOOP
  FOREACH helper IN ARRAY ARRAY['customer_private.workspace_member_current(uuid,uuid)','customer_private.workspace_ids_current(uuid)','customer_private.request_author_current(uuid)','customer_private.link_workspace_current(uuid,uuid,uuid)'] LOOP
   IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.private_requests(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); items jsonb; next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.request_result(o.id,actor) ORDER BY o.id),'[]'::jsonb) INTO items
 FROM (SELECT r.id FROM customer_private.owned_request r WHERE r.principal_id=actor AND r.workspace_id IN (SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)) AND (after_id IS NULL OR r.id>after_id)
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id) ORDER BY r.id LIMIT page_size) o;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.principal_id=actor AND r.workspace_id IN (SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)) AND r.id>next_id
    AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requests',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.complete_pending_request(pending_key uuid,possession text,owned_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pending jsonb;actor uuid:=customer.actor_id();saved customer_private.pending_request_claim%ROWTYPE;
BEGIN
 pending:=customer.pending_request_for_claim(pending_key,possession);
 IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.id=owned_request AND r.principal_id=actor AND customer_private.workspace_member_current(r.workspace_id,actor) AND r.command_id=pending_key AND r.brief_digest=encode(sha256(convert_to((pending->'brief')::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Canonical request ownership mismatch' USING ERRCODE='42501';END IF;
 INSERT INTO customer_private.pending_request_claim(pending_id,principal_id,request_id) VALUES(pending_key,actor,owned_request) ON CONFLICT(pending_id) DO NOTHING;
 SELECT * INTO saved FROM customer_private.pending_request_claim WHERE pending_id=pending_key;
 IF saved.principal_id<>actor OR saved.request_id<>owned_request THEN RAISE EXCEPTION 'Request claim conflicts' USING ERRCODE='23514';END IF;
 RETURN customer_private.request_result(saved.request_id,actor);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.private_request_detail(resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); owned customer_private.owned_request;
 result jsonb; original jsonb; retained_until timestamptz;
BEGIN
 IF resource IS NULL THEN RAISE EXCEPTION 'Request reference required' USING ERRCODE='23514'; END IF;
 -- A request belongs to its workspace: a person who is no longer a current member gets the unknown id answer.
 IF NOT EXISTS(SELECT FROM customer_private.owned_request o WHERE o.id=resource AND o.principal_id=actor AND customer_private.workspace_member_current(o.workspace_id,actor))
 THEN RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 -- request_result locks the immutable ownership row and applies the original
 -- principal/admission/revocation and receipt checks before any source read.
 result:=customer_private.request_result(resource,actor);
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=resource AND principal_id=actor;
 IF (result->>'available')::boolean THEN
  SELECT i.brief,i.retention_until INTO original,retained_until FROM app.mission_intake i
   WHERE i.tenant_id=owned.mission_tenant_id AND i.id=owned.mission_id
   AND i.retention_until>clock_timestamp();
 END IF;
 -- Use wall-clock checks after all reads; transaction-start now() must not
 -- disclose source content after retention or the short provider proof expires.
 IF customer.actor_id() IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501';
 END IF;
 IF original IS NULL OR retained_until<=clock_timestamp() THEN
  RETURN (result || jsonb_build_object('available',false,'progress',NULL,'original',NULL));
 END IF;
 RETURN result || jsonb_build_object('original',original);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.assignment_summary(selected_assignment uuid,actor uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assigned app.customer_delivery_assignment;req customer_private.owned_request;l app.delivery_link;title text;expires timestamptz;saved uuid;
BEGIN
 IF customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';END IF;
 SELECT a.* INTO assigned FROM app.customer_delivery_assignment a JOIN customer_private.owned_request r ON r.id=a.request_id AND r.principal_id=actor AND customer_private.workspace_member_current(r.workspace_id,actor) WHERE a.id=selected_assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assigned mission unavailable' USING ERRCODE='42501';END IF;
 IF NOT app.customer_delivery_scope(assigned.tenant_id,assigned.request_id,assigned.link_id,assigned.created_by) THEN
  IF customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('id',assigned.id,'requestId',assigned.request_id,'available',false);
 END IF;
 SELECT * INTO req FROM customer_private.owned_request WHERE id=assigned.request_id AND principal_id=actor FOR SHARE;
 SELECT * INTO l FROM app.delivery_link WHERE tenant_id=assigned.tenant_id AND id=assigned.link_id;
 SELECT least(l.expires_at,retention_until) INTO expires FROM app.mission_intake WHERE tenant_id=req.mission_tenant_id AND id=req.mission_id;
 SELECT copy->>'title' INTO title FROM app.delivery_publication WHERE tenant_id=l.tenant_id AND id=l.publication_ids[1];
 SELECT id INTO saved FROM customer_private.saved_mission WHERE principal_id=actor AND link_tenant_id=l.tenant_id AND link_id=l.id AND removed_at IS NULL;
 IF customer_private.request_actor() IS DISTINCT FROM actor OR expires<=clock_timestamp() OR NOT app.customer_delivery_scope(assigned.tenant_id,assigned.request_id,assigned.link_id,assigned.created_by) THEN RAISE EXCEPTION 'Account delivery access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',assigned.id,'requestId',assigned.request_id,'available',true,'title',title,'expiresAt',expires,'savedResourceId',saved);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.assigned_missions(after_id uuid DEFAULT NULL,page_size integer DEFAULT 10) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();entry record;items jsonb:='[]'::jsonb;checked jsonb:='[]'::jsonb;last_id uuid;more boolean;
BEGIN
 IF page_size IS NULL OR page_size<1 OR page_size>25 THEN RAISE EXCEPTION 'Invalid assignment page' USING ERRCODE='22023';END IF;
 FOR entry IN SELECT a.id FROM app.customer_delivery_assignment a JOIN customer_private.owned_request r ON r.id=a.request_id AND r.principal_id=actor AND r.workspace_id IN (SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)) WHERE after_id IS NULL OR a.id>after_id ORDER BY a.id LIMIT page_size LOOP
  items:=items||jsonb_build_array(customer_private.assignment_summary(entry.id,actor));last_id:=entry.id;
 END LOOP;
 SELECT EXISTS(SELECT FROM app.customer_delivery_assignment a JOIN customer_private.owned_request r ON r.id=a.request_id AND r.principal_id=actor AND r.workspace_id IN (SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)) WHERE last_id IS NOT NULL AND a.id>last_id) INTO more;
 IF customer_private.request_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(items) LOOP checked:=checked||jsonb_build_array(customer_private.assignment_summary((entry.value->>'id')::uuid,actor));END LOOP;
 IF checked IS DISTINCT FROM items OR EXISTS(SELECT FROM jsonb_array_elements(items) item WHERE (item->>'available')::boolean AND (item->>'expiresAt')::timestamptz<=clock_timestamp()) THEN RAISE EXCEPTION 'Assigned mission availability changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('assignments',items,'nextAfter',CASE WHEN more THEN last_id END,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.saved_mission_summary(resource uuid,actor uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved customer_private.saved_mission;l app.delivery_link;title text;
BEGIN
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF saved.removed_at IS NOT NULL THEN RETURN jsonb_build_object('id',saved.id,'available',false,'removed',true); END IF;
 BEGIN
  l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
  IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.expires_at<=clock_timestamp() THEN RAISE insufficient_privilege; END IF;
  SELECT copy->>'title' INTO title FROM app.delivery_publication WHERE tenant_id=l.tenant_id AND id=l.publication_ids[1];
 EXCEPTION WHEN insufficient_privilege THEN
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('id',saved.id,'available',false,'removed',false);
 END;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF l.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('id',saved.id,'available',false,'removed',false); END IF;
 RETURN jsonb_build_object('id',saved.id,'available',true,'removed',false,'title',title,'expiresAt',l.expires_at);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.saved_mission_action(resource uuid,command uuid DEFAULT NULL,request_id uuid DEFAULT NULL,body text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;result jsonb;l app.delivery_link;
BEGIN
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND removed_at IS NULL AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) FOR SHARE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 IF command IS NULL AND request_id IS NULL AND body IS NULL THEN result:=app.delivery_report(saved.token_hash,'CLIENT_PROGRESS');
 ELSIF command IS NOT NULL AND request_id IS NOT NULL AND body IS NOT NULL THEN result:=app.delivery_respond(saved.token_hash,command,request_id,body);
 ELSE RAISE EXCEPTION 'Invalid mission action' USING ERRCODE='23514'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN command IS NULL THEN jsonb_build_object('resourceId',resource,'report',result) ELSE jsonb_build_object('resourceId',resource,'response',result) END;
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.save_mission_invitation(command uuid,h text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();l app.delivery_link;resource uuid;prior customer_private.saved_mission_command;payload jsonb:=jsonb_build_object('action','save','digest',h);
BEGIN
 IF command IS NULL OR h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invitation required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.saved_mission_command WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command conflicts' USING ERRCODE='23514'; END IF;
  RETURN customer_private.saved_mission_summary(prior.resource_id,actor);
 END IF;
 l:=app.delivery_authorized(h,'CLIENT_PROGRESS');
 IF l.programme_id IS NOT NULL OR cardinality(l.publication_ids)<>1 OR l.allow_export OR l.include_delegation OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Client mission invitation required' USING ERRCODE='42501'; END IF;
 -- A report delivered for a request of a workspace the person has left is not theirs to save again.
 IF NOT customer_private.link_workspace_current(l.tenant_id,l.id,actor) THEN RAISE EXCEPTION 'Link unavailable or expired' USING ERRCODE='42501'; END IF;
 SELECT id INTO resource FROM customer_private.saved_mission WHERE principal_id=actor AND link_tenant_id=l.tenant_id AND link_id=l.id AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN
  IF (SELECT count(*) FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL)>=100 THEN RAISE EXCEPTION 'Saved mission limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.saved_mission(principal_id,token_hash,link_tenant_id,link_id) VALUES(actor,h,l.tenant_id,l.id) RETURNING id INTO resource;
 END IF;
 INSERT INTO customer_private.saved_mission_command(principal_id,command_id,input,resource_id) VALUES(actor,command,payload,resource);
 RETURN customer_private.saved_mission_summary(resource,actor);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.remove_saved_mission(command uuid,resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;prior customer_private.saved_mission_command;payload jsonb:=jsonb_build_object('action','remove','id',resource);
BEGIN
 IF command IS NULL OR resource IS NULL THEN RAISE EXCEPTION 'Command required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.saved_mission_command WHERE principal_id=actor AND command_id=command;
 IF FOUND AND prior.input IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command conflicts' USING ERRCODE='23514'; END IF;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) FOR UPDATE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 IF saved.removed_at IS NULL THEN UPDATE customer_private.saved_mission SET removed_at=clock_timestamp() WHERE id=saved.id; END IF;
 IF prior.command_id IS NULL THEN INSERT INTO customer_private.saved_mission_command(principal_id,command_id,input,resource_id) VALUES(actor,command,payload,resource); END IF;
 RETURN jsonb_build_object('id',resource,'removed',true);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.saved_missions(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();items jsonb;next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.saved_mission_summary(s.id,actor) ORDER BY s.id),'[]'::jsonb) INTO items
 FROM (SELECT id FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) s;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('missions',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.company_portfolio(after_id uuid DEFAULT NULL,page_size integer DEFAULT 5) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;
 document jsonb;mission jsonb;target jsonb;identity_key text;organisation uuid;items jsonb:='[]'::jsonb;
 checked jsonb:='[]'::jsonb;entry jsonb;next_id uuid;last_id uuid;expiry timestamptz;minimum_expiry timestamptz;
 processed integer:=0;unavailable integer:=0;publication app.delivery_publication;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid portfolio page size' USING ERRCODE='23514'; END IF;
 FOR saved IN SELECT * FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL
 AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size FOR SHARE LOOP
  processed:=processed+1;last_id:=saved.id;
  BEGIN
   document:=customer.saved_mission_action(saved.id)->'report';
  EXCEPTION WHEN insufficient_privilege THEN
   IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
   unavailable:=unavailable+1;CONTINUE;
  END;
  expiry:=(document->>'expiresAt')::timestamptz;
  IF expiry IS NULL OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Commercial scope expired' USING ERRCODE='42501'; END IF;
  minimum_expiry:=least(minimum_expiry,expiry);
  checked:=checked||jsonb_build_array(jsonb_build_object('id',saved.id,'report',document));
  FOR mission IN SELECT value FROM jsonb_array_elements(document->'missions') LOOP
   SELECT * INTO publication FROM app.delivery_publication WHERE id=(mission->>'publicationId')::uuid AND tenant_id=saved.link_tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Approved mission unavailable' USING ERRCODE='42501'; END IF;
   FOR target IN SELECT value FROM jsonb_array_elements(coalesce(mission->'experience'->'shortlist','[]'::jsonb)) LOOP
    SELECT r.organisation_id INTO organisation FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id
    WHERE t.tenant_id=saved.link_tenant_id AND t.mission_id=publication.mission_id AND t.id=(target->>'id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Approved company unavailable' USING ERRCODE='42501'; END IF;
    -- Tenant and customer remain independent privacy boundaries. No raw global ID.
    identity_key:=encode(sha256(convert_to(actor::text||':'||saved.link_tenant_id::text||':'||organisation::text,'UTF8')),'hex');
    items:=items||jsonb_build_array(jsonb_build_object('id',identity_key,'context',jsonb_build_object(
      'resourceId',saved.id,'targetId',target->>'id','missionTitle',mission->>'title','objective',mission->>'objective',
      'company',target->>'company','country',target->>'country','fit',target->>'fit','rationale',target->>'rationale',
      'uncertainty',target->>'uncertainty','gaps',target->>'gaps','verification',target->>'verification','expiresAt',document->>'expiresAt')));
   END LOOP;
  END LOOP;
 END LOOP;
 -- A lock wait or scope change during canonical identity resolution must not
 -- return an earlier approved snapshot. Original V2 disclosure checks run again.
 FOR entry IN SELECT value FROM jsonb_array_elements(checked) LOOP
  IF (customer.saved_mission_action((entry->>'id')::uuid)->'report') IS DISTINCT FROM entry->'report' THEN
   RAISE EXCEPTION 'Approved company scope changed; reload' USING ERRCODE='42501';
  END IF;
 END LOOP;
 IF customer.actor_id() IS DISTINCT FROM actor OR minimum_expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'contexts',g.contexts) ORDER BY g.id),'[]'::jsonb) INTO items
 FROM (SELECT value->>'id' id,jsonb_agg(value->'context' ORDER BY value->'context'->>'resourceId',value->'context'->>'targetId') contexts FROM jsonb_array_elements(items) GROUP BY value->>'id') g;
 IF EXISTS(SELECT FROM customer_private.saved_mission WHERE principal_id=actor AND removed_at IS NULL AND customer_private.link_workspace_current(link_tenant_id,link_id,actor) AND id>last_id) THEN next_id:=last_id; END IF;
 RETURN jsonb_build_object('companies',items,'nextAfter',next_id,'scopesRead',processed,'unavailableScopes',unavailable,'expiresAt',minimum_expiry,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.programme_mission_choices(registration uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();reg customer_private.programme_registration;r customer_private.owned_request;
 detail jsonb;items jsonb:='[]'::jsonb;next_id uuid;expiry timestamptz:=customer_private.private_view_expiry();retained timestamptz;work uuid;command uuid:=gen_random_uuid();selected uuid[];
BEGIN
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT id FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.workspace_id IN (SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)) AND (after_id IS NULL OR o.id>after_id) AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=o.id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT workspace_id FROM (SELECT reg.workspace_id AS workspace_id UNION SELECT o.workspace_id FROM customer_private.owned_request o WHERE o.id=ANY(selected)) w ORDER BY workspace_id LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT * FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.id=ANY(selected) ORDER BY o.id LOOP
  detail:=customer.private_request_detail(r.id);next_id:=r.id;
  IF detail->'available'='true'::jsonb THEN
   SELECT retention_until INTO retained FROM app.mission_intake WHERE tenant_id=r.mission_tenant_id AND id=r.mission_id;
   expiry:=least(expiry,retained);
   items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'available',true,'label',concat_ws(' · ',detail->'original'->>'company',detail->'original'->>'objective',detail->'original'->>'market')));
  ELSE items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'available',false,'label','Original request unavailable')); END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.workspace_id IN (SELECT wsc.wid FROM customer_private.workspace_ids_current(actor) AS wsc(wid)) AND o.id>next_id AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=o.id)) THEN next_id:=NULL; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) OR customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Private source expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',registration,'requests',items,'nextAfter',next_id,'viewExpiresAt',expiry,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.programme_mission_summaries(registration uuid,manage boolean DEFAULT false,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();reg customer_private.programme_registration;l customer_private.programme_mission_link;head customer_private.programme_mission_revision;
 items jsonb:='[]'::jsonb;item jsonb;next_id uuid;retained timestamptz;expiry timestamptz:=customer_private.private_view_expiry();active boolean;own_source boolean:=false;details jsonb;n integer;work uuid;command uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF manage IS NULL THEN RAISE EXCEPTION 'Explicit objective view required' USING ERRCODE='23514'; END IF;
 IF NOT manage AND EXISTS(SELECT FROM customer_private.request_admission WHERE principal_id=actor AND disabled_at IS NULL) THEN PERFORM customer_private.request_actor();own_source:=true; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration;
 IF NOT FOUND OR (NOT manage AND reg.principal_id<>actor) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 FOR work IN SELECT workspace_id FROM (SELECT reg.workspace_id AS workspace_id UNION SELECT r.workspace_id FROM customer_private.programme_mission_link b JOIN customer_private.owned_request r ON r.id=b.request_id WHERE b.registration_id=registration) w ORDER BY workspace_id LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,manage);
 active:=NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 IF active OR NOT manage THEN
  FOR l IN SELECT * FROM customer_private.programme_mission_link WHERE registration_id=registration AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size LOOP
   next_id:=l.id;SELECT * INTO head FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1;
   retained:=CASE WHEN manage OR own_source THEN customer_private.programme_mission_source(l.id) END;
   -- The participant view of a request whose author is no longer a current member is the unavailable form (no request id, no summary).
   IF NOT manage AND retained IS NOT NULL AND NOT customer_private.request_author_current(l.request_id) THEN retained:=NULL; END IF;
   IF NOT manage AND retained IS NOT NULL THEN details:=customer.private_request_detail(l.request_id);IF details->'available' IS DISTINCT FROM 'true'::jsonb THEN retained:=NULL;END IF;END IF;
   item:=jsonb_build_object('id',l.id,'version',head.version,'status',CASE WHEN NOT active OR retained IS NULL THEN 'UNAVAILABLE' ELSE head.status END);
   IF retained IS NOT NULL THEN
    expiry:=least(expiry,retained);
    IF NOT manage THEN item:=item||jsonb_build_object('requestId',l.request_id); END IF;
    IF active AND head.status='SHARED' THEN item:=item||jsonb_build_object('summary',head.summary,'claimStatus','Self-declared','sharedAt',head.created_at); END IF;
   END IF;
   -- A late source revocation/expiry never exposes the previously projected text.
   IF customer_private.programme_mission_source(l.id) IS NULL THEN item:=jsonb_build_object('id',l.id,'version',head.version,'status','UNAVAILABLE'); END IF;
   items:=items||jsonb_build_array(item);
  END LOOP;
  IF NOT EXISTS(SELECT FROM customer_private.programme_mission_link WHERE registration_id=registration AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 FOR n IN 0..jsonb_array_length(items)-1 LOOP
  item:=items->n;
  IF customer_private.programme_mission_source((item->>'id')::uuid) IS NULL THEN items:=jsonb_set(items,ARRAY[n::text],jsonb_build_object('id',item->>'id','version',(item->>'version')::integer,'status','UNAVAILABLE')); END IF;
 END LOOP;
 IF customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Participant source access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',registration,'active',active,'objectives',items,'nextAfter',next_id,'viewExpiresAt',expiry,'synthetic',customer_private.synthetic_context());
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.programme_mission_scope(command uuid,registration uuid,request uuid,active_required boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;reg customer_private.programme_registration;source customer_private.owned_request;work uuid;detail jsonb;
BEGIN
 actor:=CASE WHEN active_required THEN customer_private.request_actor() ELSE customer.actor_id() END;
 IF actor IS NULL THEN RAISE EXCEPTION 'Participant mission access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant mission access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM customer_private.owned_request WHERE id=request AND principal_id=actor
  AND (NOT active_required OR customer_private.workspace_member_current(workspace_id,actor));
 IF NOT FOUND THEN RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 -- Reuse original locks in one global order across the two customer workspaces.
 -- The canonical mission's tenant is deliberately not treated as a customer workspace.
 FOR work IN SELECT DISTINCT value FROM unnest(ARRAY[reg.workspace_id,source.workspace_id]) value ORDER BY value LOOP
  PERFORM customer_private.lock_workspace_access(command,work);
 END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 IF active_required THEN
  IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=reg.id) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
  detail:=customer.private_request_detail(source.id);
  IF detail->'available' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Private source unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant proof expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actor',actor,'workspace',reg.workspace_id,'programme',reg.programme_id);
END $$
$fn$;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer.private_requests(uuid,integer)'),
    ('customer.complete_pending_request(uuid,text,uuid)'),
    ('customer.private_request_detail(uuid)'),
    ('customer_private.assignment_summary(uuid,uuid)'),
    ('customer.assigned_missions(uuid,integer)'),
    ('customer_private.saved_mission_summary(uuid,uuid)'),
    ('customer.saved_mission_action(uuid,uuid,uuid,text)'),
    ('customer.save_mission_invitation(uuid,text)'),
    ('customer.remove_saved_mission(uuid,uuid)'),
    ('customer.saved_missions(uuid,integer)'),
    ('customer.company_portfolio(uuid,integer)'),
    ('customer.programme_mission_choices(uuid,uuid,integer)'),
    ('customer.programme_mission_summaries(uuid,boolean,uuid,integer)'),
    ('customer_private.programme_mission_scope(uuid,uuid,uuid,boolean)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than function bodies';
 END IF;
END $guard$;
