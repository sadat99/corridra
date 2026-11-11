-- Removed members, part 5: withdrawal. The list leaves out the requests of workspaces the person is no longer a member of.
-- withdraw_request and restore_request refuse such a request with 'Request is not available', the text of an unknown request.
-- A removed person can therefore not withdraw a former workspace request; that is an open owner follow-up recorded in ADR-033.
-- Needs customer migration 0004.
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
   ('customer.my_request_withdrawals()','b48bf839a9a78d9dc80a0f1703f9262ff842271aa4ecc0bf6cb38d48584382bb','corridra_runtime'),
   ('customer.withdraw_request(uuid,uuid,text)','66cf40d8aaaa310fd7edba0823151c928e9018ed9c1af0dbae33f77423c1755f','corridra_runtime'),
   ('customer.restore_request(uuid,uuid)','312c65d0b8da15f32ff1f5f5dcefd575a6e766193b75272e6cbaaedf18a872b6','corridra_runtime')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer.my_request_withdrawals()'),
    ('customer.withdraw_request(uuid,uuid,text)'),
    ('customer.restore_request(uuid,uuid)')
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
 registered:=to_regclass('customer_request_withdrawal_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_request_withdrawal_migrations.applied WHERE name=$1' INTO recorded USING '0002_staff_withdrawal_signal.sql';
 END IF;
 -- ABSENT: none of the functions exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: request withdrawal 0002 is not applied';
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
 IF recorded IS NOT NULL AND recorded<>'c111f071cc126aa19f1d3009fc0a960fe507b5b17e29affc117f68e65de2e57e' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0002_staff_withdrawal_signal.sql';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.workspace_member_current';
 END IF;
 -- MATCHING: every function equals its constant. Remember the parts that CREATE OR REPLACE must not change, then replace all.
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO before_state
 FROM (VALUES
    ('customer.my_request_withdrawals()'),
    ('customer.withdraw_request(uuid,uuid,text)'),
    ('customer.restore_request(uuid,uuid)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 -- The helpers are definers owned by whoever installed them. A function that now calls one needs EXECUTE on it when its owner is another role.
 FOR holder IN SELECT DISTINCT pg_get_userbyid(p.proowner) FROM unnest(ARRAY['customer.my_request_withdrawals()','customer.withdraw_request(uuid,uuid,text)','customer.restore_request(uuid,uuid)']) AS u(sig)
  JOIN pg_proc p ON p.oid=to_regprocedure(u.sig) LOOP
  FOREACH helper IN ARRAY ARRAY['customer_private.workspace_member_current(uuid,uuid)'] LOOP
   IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.my_request_withdrawals() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();items jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',l.request_id,'at',l.occurred_at,'reason',l.reason) ORDER BY l.occurred_at DESC,l.request_id),'[]'::jsonb) INTO items
 FROM (SELECT DISTINCT ON (e.request_id) e.request_id,e.state,e.occurred_at,e.reason
   FROM customer_private.request_withdrawal_event e
   JOIN customer_private.owned_request o ON o.id=e.request_id
   WHERE o.principal_id=actor AND customer_private.workspace_member_current(o.workspace_id,actor)
   AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=e.request_id)
   ORDER BY e.request_id,e.seq DESC) l
 WHERE l.state='withdrawn';
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('open',customer_private.request_withdrawal_open(),'items',items);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.withdraw_request(request uuid,command uuid,why text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.request_withdrawal_event%ROWTYPE;
 was boolean;current_status text;note text:=btrim(why);
BEGIN
 IF request IS NULL OR command IS NULL OR note IS NULL OR length(note) NOT BETWEEN 10 AND 500
 THEN RAISE EXCEPTION 'Invalid withdrawal' USING ERRCODE='23514'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 OR NOT customer_private.workspace_member_current(owned.workspace_id,actor)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.request_withdrawal:'||request::text,0));
 was:=customer_private.request_withdrawn(request);
 SELECT * INTO prior FROM customer_private.request_withdrawal_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>'withdrawn' THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('withdrawn',was,'changed',false,'replayed',true);
 END IF;
 IF was THEN RETURN jsonb_build_object('withdrawn',true,'changed',false); END IF;
 IF NOT customer_private.request_withdrawal_open() THEN
  RETURN jsonb_build_object('withdrawn',false,'changed',false,'reason','closed');
 END IF;
 SELECT m.status INTO current_status FROM app.mission m WHERE m.tenant_id=owned.mission_tenant_id AND m.id=owned.mission_id;
 IF current_status IN ('CLOSED','CANCELLED') THEN
  RETURN jsonb_build_object('withdrawn',false,'changed',false,'reason','not-withdrawable');
 END IF;
 BEGIN
  INSERT INTO customer_private.request_withdrawal_event(request_id,principal_id,state,reason,command_id)
  VALUES(request,actor,'withdrawn',note,command);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501';
 END;
 PERFORM customer_private.request_withdrawal_record(owned.workspace_id,'customer.request.withdrawn',request);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('withdrawn',true,'changed',true);
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.restore_request(request uuid,command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.request_withdrawal_event%ROWTYPE;
 was boolean;
BEGIN
 IF request IS NULL OR command IS NULL THEN RAISE EXCEPTION 'Invalid withdrawal' USING ERRCODE='23514'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 OR NOT customer_private.workspace_member_current(owned.workspace_id,actor)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.request_withdrawal:'||request::text,0));
 was:=customer_private.request_withdrawn(request);
 SELECT * INTO prior FROM customer_private.request_withdrawal_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>'restored' THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('withdrawn',was,'changed',false,'replayed',true);
 END IF;
 IF NOT was THEN RETURN jsonb_build_object('withdrawn',false,'changed',false); END IF;
 BEGIN
  INSERT INTO customer_private.request_withdrawal_event(request_id,principal_id,state,reason,command_id)
  VALUES(request,actor,'restored',NULL,command);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501';
 END;
 PERFORM customer_private.request_withdrawal_record(owned.workspace_id,'customer.request.restored',request);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('withdrawn',false,'changed',true);
END $$
$fn$;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer.my_request_withdrawals()'),
    ('customer.withdraw_request(uuid,uuid,text)'),
    ('customer.restore_request(uuid,uuid)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than function bodies';
 END IF;
END $guard$;
