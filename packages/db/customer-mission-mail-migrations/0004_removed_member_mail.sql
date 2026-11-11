-- Removed members, part 6: mission mail. customer_private.mission_mail_block_reason, which enqueue_mission_mail and
-- claim_mission_mail already ask, gains a third answer, 'removed', for a request whose author is no longer a current member of its
-- workspace. A new message is then not queued, and a queued message is suppressed when it is claimed (status SUPPRESSED, the
-- recipient row removed), exactly as for a withdrawn or muted request. The two readers are not changed: later modules
-- fingerprint them. The mute list leaves out requests the person can no longer see and set_mission_mail_mute refuses them with
-- 'Request is not available'. The no-sign-in mute link (mute_mission_mail) is stop-only and is not changed.
-- Needs customer migration 0004 and mission mail 0003.
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
   ('customer_private.mission_mail_block_reason(uuid,timestamp with time zone)','7a8821f235046a31f9737f05811289b59dcf1436ae02ec263e1ae2d56c78916d',''),
   ('customer.my_mission_mail_mutes()','8a8c3001be6e57881fcdf579af70054c66463a04373066edab8eff8d8889e8db','corridra_runtime'),
   ('customer.set_mission_mail_mute(uuid,uuid,boolean)','fffe088ad6132b832c6e20d3bab12e405e523910416c2aacbde694c0e3dccc9b','corridra_runtime')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer_private.mission_mail_block_reason(uuid,timestamp with time zone)'),
    ('customer.my_mission_mail_mutes()'),
    ('customer.set_mission_mail_mute(uuid,uuid,boolean)')
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
 registered:=to_regclass('customer_mission_mail_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_mission_mail_migrations.applied WHERE name=$1' INTO recorded USING '0003_withdrawn_requests.sql';
 END IF;
 -- ABSENT: none of the functions exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: mission mail 0003 is not applied';
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
 IF recorded IS NOT NULL AND recorded<>'b9fd3fe951a5790ad1500413fcd85b3a0dca72cbe93de8d94dcc26b6863cbe35' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0003_withdrawn_requests.sql';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Removed member access needs customer migration 0004_workspace_member_current.sql first: customer_private.workspace_member_current';
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
    ('customer_private.mission_mail_block_reason(uuid,timestamp with time zone)'),
    ('customer.my_mission_mail_mutes()'),
    ('customer.set_mission_mail_mute(uuid,uuid,boolean)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 -- The helpers are definers owned by whoever installed them. A function that now calls one needs EXECUTE on it when its owner is another role.
 FOR holder IN SELECT DISTINCT pg_get_userbyid(p.proowner) FROM unnest(ARRAY['customer_private.mission_mail_block_reason(uuid,timestamp with time zone)','customer.my_mission_mail_mutes()','customer.set_mission_mail_mute(uuid,uuid,boolean)']) AS u(sig)
  JOIN pg_proc p ON p.oid=to_regprocedure(u.sig) LOOP
  FOREACH helper IN ARRAY ARRAY['customer_private.workspace_member_current(uuid,uuid)','customer_private.request_author_current(uuid)'] LOOP
   IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer_private.mission_mail_block_reason(request uuid,since timestamptz) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN customer_private.request_withdrawn_since(request,since) THEN 'withdrawn'
  WHEN customer_private.mission_mail_muted(request) THEN 'muted'
  WHEN NOT customer_private.request_author_current(request) THEN 'removed' END
$$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.my_mission_mail_mutes() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',t.request_id,'muted',t.state='muted','at',t.at) ORDER BY t.at DESC,t.request_id),'[]'::jsonb) INTO result
 FROM (SELECT l.request_id,l.state,l.at FROM (
   SELECT DISTINCT ON (s.request_id) s.request_id,s.state,s.at FROM (
    SELECT m.request_id,'muted'::text AS state,m.created_at AS at,0::bigint AS n FROM customer_private.mission_mail_mute m
     JOIN customer_private.owned_request o ON o.id=m.request_id WHERE o.principal_id=actor AND customer_private.workspace_member_current(o.workspace_id,actor)
    UNION ALL
    SELECT e.request_id,e.state,e.occurred_at,e.seq FROM customer_private.mission_mail_mute_event e
     JOIN customer_private.owned_request o ON o.id=e.request_id WHERE o.principal_id=actor AND customer_private.workspace_member_current(o.workspace_id,actor)) s
   WHERE NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=s.request_id)
   ORDER BY s.request_id,s.n DESC) l
  ORDER BY l.at DESC,l.request_id LIMIT 100) t;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$
$fn$;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.set_mission_mail_mute(request uuid,command uuid,mute boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.mission_mail_mute_event%ROWTYPE;
 want text;was boolean;
BEGIN
 IF request IS NULL OR command IS NULL OR mute IS NULL THEN RAISE EXCEPTION 'Invalid mute choice' USING ERRCODE='23514'; END IF;
 want:=CASE WHEN mute THEN 'muted' ELSE 'unmuted' END;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 OR NOT customer_private.workspace_member_current(owned.workspace_id,actor)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_mail:'||request::text,0));
 was:=customer_private.mission_mail_muted(request);
 SELECT * INTO prior FROM customer_private.mission_mail_mute_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>want THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  -- A repeat answers with how things stand now, never with what that command once asked for.
  RETURN jsonb_build_object('muted',was,'changed',false,'replayed',true);
 END IF;
 IF NOT mute AND NOT customer_private.mission_mail_open() THEN
  RETURN jsonb_build_object('muted',was,'changed',false,'reason','closed');
 END IF;
 IF was=mute THEN RETURN jsonb_build_object('muted',was,'changed',false); END IF;
 BEGIN
  INSERT INTO customer_private.mission_mail_mute_event(request_id,principal_id,state,via,command_id)
  VALUES(request,actor,want,'signed-in',command);
 EXCEPTION WHEN unique_violation THEN
  -- The same command id used for another request at the same moment: the same refusal as any reused id.
  RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501';
 END;
 IF mute THEN
  UPDATE customer_private.mission_mail_queue SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL
  WHERE request_id=request AND status IN ('PENDING','LEASED');
  DELETE FROM customer_private.mission_mail_recipient r USING customer_private.mission_mail_queue x
  WHERE x.id=r.queue_id AND x.request_id=request AND x.status IN ('SENT','DEAD','SUPPRESSED');
 END IF;
 -- Turning mail on again is the choice that matters most, so its record is never skipped.
 PERFORM customer_private.mission_mail_record(owned.workspace_id,CASE WHEN mute THEN 'customer.mission_mail.muted' ELSE 'customer.mission_mail.unmuted' END,request,NOT mute);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('muted',mute,'changed',true);
END $$
$fn$;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer_private.mission_mail_block_reason(uuid,timestamp with time zone)'),
    ('customer.my_mission_mail_mutes()'),
    ('customer.set_mission_mail_mute(uuid,uuid,boolean)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than function bodies';
 END IF;
END $guard$;
