-- Removed members, part 10: the participant's own projection view. customer.programme_projection_own returned each shared
-- mission link's summary and availability from customer_private.programme_mission_source alone, with no check that the request
-- author is still a member of the request's workspace (real-use 0014 added that check to programme_mission_summaries only). A link
-- whose author has left now reads like an expired source: summary NULL and available false, nothing raised, every other output
-- identical. The organiser view (programme_projection_owner) is unchanged. Needs customer migration 0004.
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
   ('customer.programme_projection_own(uuid,uuid)','eefe46009f627f90bef94fab9fa22a94bad6935c46e530c96dea18ac0641d5db','corridra_runtime')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('customer.programme_projection_own(uuid,uuid)')
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
 registered:=to_regclass('customer_programme_projection_migrations.applied') IS NOT NULL;
 IF registered THEN
  EXECUTE 'SELECT sha256 FROM customer_programme_projection_migrations.applied WHERE name=$1' INTO recorded USING '0002_projection_source_and_retention.sql';
 END IF;
 -- ABSENT: none of the functions exists and the registry has no row for the file before this one. Nothing is changed or created.
 IF present=0 AND recorded IS NULL THEN
  RAISE NOTICE 'Removed member access skipped: programme projection 0002 is not applied';
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
 IF recorded IS NOT NULL AND recorded<>'bc8944148a4f18bb0b6769649cee20adf9023adf40deab8a9b3dd527a39a3597' THEN
  RAISE EXCEPTION 'Removed member access prerequisite file differs: 0002_projection_source_and_retention.sql';
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
    ('customer.programme_projection_own(uuid,uuid)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 -- The helpers are definers owned by whoever installed them. A function that now calls one needs EXECUTE on it when its owner is another role.
 FOR holder IN SELECT DISTINCT pg_get_userbyid(p.proowner) FROM unnest(ARRAY['customer.programme_projection_own(uuid,uuid)']) AS u(sig)
  JOIN pg_proc p ON p.oid=to_regprocedure(u.sig) LOOP
  FOREACH helper IN ARRAY ARRAY['customer_private.request_author_current(uuid)'] LOOP
   IF pg_get_userbyid((SELECT h.proowner FROM pg_proc h WHERE h.oid=to_regprocedure(helper)))<>holder THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE $fn$
CREATE OR REPLACE FUNCTION customer.programme_projection_own(registration uuid,after_link uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();reg customer_private.programme_registration;work uuid;source_workspace uuid;
 profile customer_private.organisation_profile_revision;company_head customer_private.programme_projection_company;links jsonb;source_expiry timestamptz;
BEGIN
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
 IF actor IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Own programme registration required' USING ERRCODE='42501';END IF;
 SELECT e.profile_workspace_id INTO source_workspace FROM customer_private.programme_enrolment b JOIN customer_private.programme_enrolment_revision e ON e.enrolment_id=b.id WHERE b.registration_id=reg.id ORDER BY e.version DESC LIMIT 1;
 FOR work IN SELECT DISTINCT x FROM unnest(ARRAY[reg.workspace_id,source_workspace])x WHERE x IS NOT NULL ORDER BY x LOOP PERFORM customer_private.lock_workspace_access(gen_random_uuid(),work);END LOOP;
 PERFORM customer_private.participant_scope(gen_random_uuid(),reg.workspace_id,reg.programme_id,false);
 SELECT * INTO company_head FROM customer_private.programme_projection_company WHERE registration_id=reg.id ORDER BY version DESC LIMIT 1;
 IF customer_private.programme_projection_active(reg.id) AND customer_private.organisation_profile_role(source_workspace,actor) = 'writer' THEN
  SELECT * INTO profile FROM customer_private.organisation_profile_revision WHERE tenant_id=source_workspace ORDER BY version DESC LIMIT 1;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'version',coalesce(c.version,0),'shared',coalesce(c.shared,false),
 'summary',CASE WHEN src.retained IS NOT NULL THEN s.summary END,'available',customer_private.programme_projection_active(reg.id) AND s.status='SHARED' AND src.retained IS NOT NULL) ORDER BY l.id),'[]'::jsonb),
 min(src.retained) INTO links,source_expiry FROM (SELECT * FROM customer_private.programme_mission_link WHERE registration_id=reg.id AND principal_id=actor AND(after_link IS NULL OR id>after_link) ORDER BY id LIMIT 25)l
 LEFT JOIN LATERAL(SELECT version,shared FROM customer_private.programme_projection_meeting WHERE link_id=l.id ORDER BY version DESC LIMIT 1)c ON true
 LEFT JOIN LATERAL(SELECT status,summary FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1)s ON true
 -- A link whose request author is no longer a current member of the request's workspace reads as an expired source: no summary,
 -- not available. The same rule programme_mission_summaries uses for the participant view.
 LEFT JOIN LATERAL(SELECT CASE WHEN customer_private.request_author_current(l.request_id) THEN customer_private.programme_mission_source(l.id) END retained)src ON true
 WHERE l.registration_id=reg.id AND l.principal_id=actor AND(after_link IS NULL OR l.id>after_link);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501';END IF;
 IF source_expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Programme source access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',least(customer_private.coordination_expiry(),source_expiry),'active',customer_private.programme_projection_active(reg.id),
 'company',jsonb_build_object('version',coalesce(company_head.version,0),'shared',coalesce(company_head.shared AND company_head.profile_workspace IS NOT DISTINCT FROM source_workspace,false),
 'sourceChanged',coalesce(company_head.shared AND company_head.profile_workspace IS DISTINCT FROM source_workspace,false),'objective',company_head.objective),
 'profile',CASE WHEN profile.id IS NOT NULL THEN jsonb_build_object('id',profile.id,'version',profile.version,'name',profile.details->>'legalName','countryCode',profile.details->>'countryCode',
 'roles',profile.details->'commercialRoles','sectors',profile.details->'sectors') END,'missionLinks',links,'nextLinkAfter',CASE WHEN EXISTS(SELECT FROM customer_private.programme_mission_link WHERE registration_id=reg.id AND id>(SELECT max((x->>'id'))::uuid FROM jsonb_array_elements(links)x)) THEN(SELECT max((x->>'id'))::uuid FROM jsonb_array_elements(links)x) END,'sendsMessages',false);
END $$
$fn$;
 SELECT coalesce(jsonb_object_agg(v.signature,encode(sha256(convert_to(concat_ws(E'\x1f',p.proowner::regrole::text,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),''),
      (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)),'UTF8')),'hex')),'{}'::jsonb) INTO after_state
 FROM (VALUES
    ('customer.programme_projection_own(uuid,uuid)')
   ) v(signature)
 JOIN pg_proc p ON p.oid=to_regprocedure(v.signature) JOIN pg_language l ON l.oid=p.prolang;
 IF after_state IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Removed member access changed more than function bodies';
 END IF;
END $guard$;
