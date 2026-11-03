-- ADR075 amendment, 3 November 2026. Additive: replaces three functions and creates no table, policy or trigger.
-- 1. Company disclosure follows the current enrolment source. The reviewed company is returned to organisers only
--    while its workspace is still the source of the participant's current enrolment; otherwise the earlier consent
--    is dormant and the participant's own view reports sharing off with sourceChanged.
-- 2. A view never outlives its sources. expiresAt is the earlier of the short coordination expiry and the earliest
--    retention of the shared mission links whose data the view returns (the rule programme_mission_summaries uses).
-- The guards below hold the SHA-256 of pg_get_functiondef for the released 0001 bodies, computed by applying 0001
-- alone; this file refuses to replace a function that differs from what 0001 created.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.programme_projection_rows(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'3c4bda1e91f57d6a96873b5a0e7dd8055ef719388bd06a04d340e403ace6c54a' THEN RAISE EXCEPTION 'Programme projection prerequisite function differs: customer_private.programme_projection_rows';END IF;END $guard$;
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_projection_owner(uuid,uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'f2ee6680288ca4f565fb7090fcca20cb9a40a53b4753d1649b4f39be6d50feb1' THEN RAISE EXCEPTION 'Programme projection prerequisite function differs: customer.programme_projection_owner';END IF;END $guard$;
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_projection_own(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'0ca60c11222edb6b82e925b51694db497b030304fdc1878bec69e876c0f2e5f9' THEN RAISE EXCEPTION 'Programme projection prerequisite function differs: customer.programme_projection_own';END IF;END $guard$;

-- Return only the accepted company field map. This helper has no runtime/auth grant.
CREATE OR REPLACE FUNCTION customer_private.programme_projection_rows(target uuid,programme uuid)
 RETURNS TABLE(registration_id uuid,label text,company jsonb,missing text[])
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.id,r.display_label,
 CASE WHEN c.shared AND c.profile_workspace = e.profile_workspace_id AND customer_private.organisation_profile_role(c.profile_workspace,r.principal_id) = 'writer' THEN
 jsonb_build_object('name',p.details->>'legalName','countryCode',p.details->>'countryCode',
 'roles',p.details->'commercialRoles','sectors',p.details->'sectors','objective',c.objective,'profileVersion',c.profile_version,'provenance','SELF_REPORTED') END,
 array_remove(ARRAY[
 CASE WHEN e.status IS DISTINCT FROM 'PLACED' THEN 'confirmedPlace' END,
 CASE WHEN criteria.version IS NULL OR profile.details IS NULL OR cardinality(customer_private.terms_eligibility_reasons(criteria,profile.details))>0 THEN 'currentEligibility' END,
 CASE WHEN terms.version IS NULL OR NOT EXISTS(SELECT FROM customer_private.programme_terms_acceptance a WHERE a.registration_id=r.id AND a.terms_version=terms.version) THEN 'currentTerms' END,
 CASE WHEN c.shared IS DISTINCT FROM true OR p.id IS NULL OR customer_private.organisation_profile_role(c.profile_workspace,r.principal_id) <> 'writer'
 OR customer_private.organisation_profile_role(c.profile_workspace,r.principal_id) IS NULL OR c.profile_workspace IS DISTINCT FROM e.profile_workspace_id
 OR c.profile_version IS DISTINCT FROM profile.version THEN 'currentSharedCompany' END
 ],NULL)::text[]
 FROM customer_private.programme_registration r
 LEFT JOIN LATERAL(SELECT * FROM customer_private.programme_projection_company x WHERE x.registration_id=r.id ORDER BY version DESC LIMIT 1)c ON true
 LEFT JOIN customer_private.organisation_profile_revision p ON p.tenant_id=c.profile_workspace AND p.version=c.profile_version
 LEFT JOIN customer_private.programme_enrolment enrol ON enrol.registration_id=r.id
 LEFT JOIN LATERAL(SELECT * FROM customer_private.programme_enrolment_revision x WHERE x.enrolment_id=enrol.id ORDER BY version DESC LIMIT 1)e ON true
 LEFT JOIN LATERAL(SELECT * FROM customer_private.organisation_profile_revision x WHERE x.tenant_id=e.profile_workspace_id ORDER BY version DESC LIMIT 1)profile ON true
 LEFT JOIN LATERAL(SELECT * FROM customer_private.programme_eligibility_revision x WHERE x.programme_id=programme ORDER BY version DESC LIMIT 1)criteria ON true
 LEFT JOIN LATERAL(SELECT * FROM customer_private.programme_terms_revision x WHERE x.programme_id=programme ORDER BY version DESC LIMIT 1)terms ON true
 WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.programme_projection_active(r.id)
$$;

CREATE OR REPLACE FUNCTION customer.programme_projection_owner(target uuid,programme uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();command uuid:=gen_random_uuid();work uuid;ctx app.delivery_programme_context;
 items jsonb;readiness jsonb;agenda jsonb;conflicts jsonb;metrics jsonb;next_id uuid;result jsonb;source_expiry timestamptz;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT FROM customer.collaborative_workspaces() WHERE id=target AND role IN ('owner','admin'))
 OR NOT EXISTS(SELECT FROM customer_private.programme_creation WHERE workspace_id=target AND programme_id=programme) THEN RAISE EXCEPTION 'Programme owner or admin required' USING ERRCODE='42501';END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514';END IF;
 FOR work IN SELECT DISTINCT x FROM (
  SELECT target x UNION SELECT e.profile_workspace_id FROM customer_private.programme_enrolment b
   JOIN LATERAL(SELECT profile_workspace_id FROM customer_private.programme_enrolment_revision WHERE enrolment_id=b.id ORDER BY version DESC LIMIT 1)e ON true WHERE b.programme_id=programme
  UNION SELECT c.profile_workspace FROM customer_private.programme_projection_company c JOIN customer_private.programme_registration r ON r.id=c.registration_id WHERE r.programme_id=programme
  UNION SELECT o.workspace_id FROM customer_private.programme_mission_link l JOIN customer_private.programme_registration r ON r.id=l.registration_id JOIN customer_private.owned_request o ON o.id=l.request_id WHERE r.programme_id=programme
 )q WHERE x IS NOT NULL ORDER BY x LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||programme::text,0));
 WITH rows AS MATERIALIZED(SELECT * FROM customer_private.programme_projection_rows(target,programme)), page AS(
  SELECT * FROM rows WHERE after_id IS NULL OR registration_id>after_id ORDER BY registration_id LIMIT page_size
 ) SELECT jsonb_build_object('activeParticipants',count(*),'readyParticipants',count(*) FILTER(WHERE cardinality(missing)=0),'definition','ACTIVE_ELIGIBLE_PLACED_CURRENT_TERMS_SHARED_COMPANY'),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',registration_id,'label',label,'company',company,'ready',cardinality(missing)=0,'missing',missing) ORDER BY registration_id),'[]'::jsonb) FROM page),
 CASE WHEN EXISTS(SELECT FROM rows WHERE registration_id>(SELECT max(registration_id::text)::uuid FROM page)) THEN (SELECT max(registration_id::text)::uuid FROM page) END
 INTO readiness,items,next_id FROM rows;
 SELECT * INTO ctx FROM app.delivery_programme_context WHERE tenant_id=target AND programme_id=programme ORDER BY version DESC LIMIT 1;
 WITH tasks AS MATERIALIZED(
  SELECT t.id,t.seq,r.title,r.status,s.* FROM customer_private.programme_task t
  JOIN LATERAL(SELECT title,status FROM customer_private.programme_task_revision WHERE task_id=t.id ORDER BY version DESC LIMIT 1)r ON true
  LEFT JOIN LATERAL(SELECT * FROM customer_private.programme_projection_schedule WHERE task_id=t.id ORDER BY version DESC LIMIT 1)s ON true
  WHERE t.workspace_id=target AND t.programme_id=programme
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('taskId',id,'title',title,'status',status,'version',coalesce(version,0),'scheduled',coalesce(scheduled,false),
 'startsAt',starts_at,'endsAt',ends_at,'timezone',timezone,'audience',coalesce(audience,'ALL'),'attendees',coalesce((SELECT jsonb_agg(a ORDER BY a) FROM unnest(attendees)a WHERE customer_private.programme_projection_active(a)),'[]'::jsonb),
 'needsReview',scheduled AND(ctx.id IS NULL OR context_version<>ctx.version OR starts_at<(ctx.details->>'startsAt')::timestamptz OR ends_at>(ctx.details->>'endsAt')::timestamptz)) ORDER BY seq),'[]'::jsonb),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('left',a.id,'right',b.id) ORDER BY a.id,b.id),'[]'::jsonb) FROM tasks a JOIN tasks b ON a.id<b.id
 WHERE a.scheduled AND b.scheduled AND a.status<>'CANCELLED' AND b.status<>'CANCELLED' AND a.starts_at<b.ends_at AND b.starts_at<a.ends_at
 AND EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.programme_id=programme AND customer_private.programme_projection_active(r.id)
  AND(a.audience='ALL' OR r.id=ANY(a.attendees)) AND(b.audience='ALL' OR r.id=ANY(b.attendees)))) INTO agenda,conflicts FROM tasks;
 WITH consented AS MATERIALIZED(
  SELECT l.id,l.registration_id,o.mission_tenant_id,o.mission_id,customer_private.programme_mission_source(l.id) retained
  FROM customer_private.programme_mission_link l JOIN customer_private.programme_registration r ON r.id=l.registration_id
  JOIN customer_private.owned_request o ON o.id=l.request_id AND o.principal_id=r.principal_id
  JOIN LATERAL(SELECT shared FROM customer_private.programme_projection_meeting WHERE link_id=l.id ORDER BY version DESC LIMIT 1)c ON c.shared
  JOIN LATERAL(SELECT status FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1)s ON s.status='SHARED'
  WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.programme_projection_active(r.id)
 ), sources AS(SELECT DISTINCT mission_tenant_id,mission_id FROM consented WHERE retained IS NOT NULL), meetings AS(
  SELECT DISTINCT m.id,m.tenant_id,m.status FROM sources s JOIN app.meeting m ON m.tenant_id=s.mission_tenant_id AND m.mission_id=s.mission_id
 ) SELECT jsonb_build_object('state',CASE WHEN count(*)=0 THEN 'NOT_SHARED' WHEN count(*) FILTER(WHERE retained IS NOT NULL)=0 THEN 'UNAVAILABLE' WHEN bool_and(retained IS NOT NULL) THEN 'AVAILABLE' ELSE 'PARTIAL' END,
 'sharedLinks',count(*) FILTER(WHERE retained IS NOT NULL),'unavailableLinks',count(*) FILTER(WHERE retained IS NULL),'participantsSharing',count(DISTINCT registration_id) FILTER(WHERE retained IS NOT NULL),
 'scheduled',CASE WHEN count(*) FILTER(WHERE retained IS NOT NULL)>0 THEN(SELECT count(*) FROM meetings WHERE status='SCHEDULED') END,
 'qualifiedHeld',CASE WHEN count(*) FILTER(WHERE retained IS NOT NULL)>0 THEN(SELECT count(*) FROM meetings m WHERE m.status='HELD' AND EXISTS(
 SELECT FROM app.opportunity o JOIN app.outcome_event e ON e.tenant_id=o.tenant_id AND e.opportunity_id=o.id WHERE o.tenant_id=m.tenant_id AND o.meeting_id=m.id
 AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=2)) END),
 min(retained) INTO metrics,source_expiry FROM consented;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501';END IF;
 IF source_expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Programme source access expired' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',least(customer_private.coordination_expiry(),source_expiry),'readiness',readiness,'companies',items,'nextAfter',next_id,
 'context',CASE WHEN ctx.id IS NOT NULL THEN jsonb_build_object('version',ctx.version,'startsAt',ctx.details->'startsAt','endsAt',ctx.details->'endsAt','timezone',ctx.details->'timezone') END,
 'agenda',agenda,'conflicts',conflicts,'meetings',metrics,'sendsMessages',false);
 RETURN result;
END $$;

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
 LEFT JOIN LATERAL(SELECT customer_private.programme_mission_source(l.id) retained)src ON true
 WHERE l.registration_id=reg.id AND l.principal_id=actor AND(after_link IS NULL OR l.id>after_link);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501';END IF;
 IF source_expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Programme source access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',least(customer_private.coordination_expiry(),source_expiry),'active',customer_private.programme_projection_active(reg.id),
 'company',jsonb_build_object('version',coalesce(company_head.version,0),'shared',coalesce(company_head.shared AND company_head.profile_workspace IS NOT DISTINCT FROM source_workspace,false),
 'sourceChanged',coalesce(company_head.shared AND company_head.profile_workspace IS DISTINCT FROM source_workspace,false),'objective',company_head.objective),
 'profile',CASE WHEN profile.id IS NOT NULL THEN jsonb_build_object('id',profile.id,'version',profile.version,'name',profile.details->>'legalName','countryCode',profile.details->>'countryCode',
 'roles',profile.details->'commercialRoles','sectors',profile.details->'sectors') END,'missionLinks',links,'nextLinkAfter',CASE WHEN EXISTS(SELECT FROM customer_private.programme_mission_link WHERE registration_id=reg.id AND id>(SELECT max((x->>'id'))::uuid FROM jsonb_array_elements(links)x)) THEN(SELECT max((x->>'id'))::uuid FROM jsonb_array_elements(links)x) END,'sendsMessages',false);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('customer','customer_private') AND p.proname LIKE 'programme_projection_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,corridra_runtime,corridra_auth',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION customer.programme_projection_command(uuid,text,jsonb),customer.programme_projection_owner(uuid,uuid,uuid,integer),customer.programme_projection_own(uuid,uuid) TO corridra_runtime;
