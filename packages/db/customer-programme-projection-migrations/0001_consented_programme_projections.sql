-- ADR075. Optional, explicit programme disclosure; no historic rows, policies or grants are rewritten.
CREATE TABLE customer_private.programme_projection_company (
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 version integer NOT NULL CHECK(version>0), shared boolean NOT NULL,
 profile_workspace uuid REFERENCES customer.workspace(tenant_id), profile_version integer,
 objective text, actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(registration_id,version),
 CHECK((shared AND profile_workspace IS NOT NULL AND profile_version>0 AND length(objective) BETWEEN 2 AND 500)
 OR(NOT shared AND profile_workspace IS NULL AND profile_version IS NULL AND objective IS NULL))
);
CREATE TABLE customer_private.programme_projection_meeting (
 link_id uuid NOT NULL REFERENCES customer_private.programme_mission_link(id),
 version integer NOT NULL CHECK(version>0), shared boolean NOT NULL,
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(link_id,version)
);
CREATE TABLE customer_private.programme_projection_schedule (
 task_id uuid NOT NULL REFERENCES customer_private.programme_task(id),
 version integer NOT NULL CHECK(version>0), scheduled boolean NOT NULL,
 starts_at timestamptz,ends_at timestamptz,context_version integer,timezone text,audience text NOT NULL CHECK(audience IN ('ALL','SELECTED')),
 attendees uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(task_id,version),
 CHECK((scheduled AND starts_at IS NOT NULL AND ends_at>starts_at AND context_version IS NOT NULL AND timezone IS NOT NULL) OR(NOT scheduled AND starts_at IS NULL AND ends_at IS NULL)),
 CHECK((audience='ALL' AND cardinality(attendees)=0) OR(audience='SELECTED' AND cardinality(attendees)>0))
);
CREATE TABLE customer_private.programme_projection_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('company','meetings','schedule')),
 request jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['programme_projection_company','programme_projection_meeting','programme_projection_schedule','programme_projection_command'] LOOP
  EXECUTE format('ALTER TABLE customer_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON customer_private.%I FROM PUBLIC,corridra_runtime,corridra_auth',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
 END LOOP;
END $$;
CREATE TRIGGER company_version BEFORE INSERT ON customer_private.programme_projection_company FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('registration_id');
CREATE TRIGGER meeting_version BEFORE INSERT ON customer_private.programme_projection_meeting FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('link_id');
CREATE TRIGGER schedule_version BEFORE INSERT ON customer_private.programme_projection_schedule FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('task_id');

CREATE FUNCTION customer_private.programme_projection_active(registration uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.programme_registration r JOIN customer_private.principal p ON p.id=r.principal_id AND p.disabled_at IS NULL
 WHERE r.id=registration AND customer_private.coordination_registration_state(r.id)='ACTIVE')
$$;

-- Return only the accepted company field map. This helper has no runtime/auth grant.
CREATE FUNCTION customer_private.programme_projection_rows(target uuid,programme uuid)
 RETURNS TABLE(registration_id uuid,label text,company jsonb,missing text[])
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.id,r.display_label,
 CASE WHEN c.shared AND customer_private.organisation_profile_role(c.profile_workspace,r.principal_id) = 'writer' THEN
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

CREATE FUNCTION customer.programme_projection_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();reg customer_private.programme_registration;link customer_private.programme_mission_link;
 task customer_private.programme_task;profile customer_private.organisation_profile_revision;
 work uuid;programme uuid;source_workspace uuid;reviewed_workspace uuid;resource uuid;prior customer_private.programme_projection_command;
 expected integer;current_version integer;result jsonb;head record;ctx app.delivery_programme_context;
 start_time timestamptz;end_time timestamptz;selected uuid[]:=ARRAY[]::uuid[];objective text;shared boolean;
BEGIN
 IF command IS NULL OR actor IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'Programme command unavailable' USING ERRCODE='42501'; END IF;
 expected:=(input->>'expectedVersion')::integer;
 IF expected IS NULL OR expected<0 OR expected>1000000 THEN RAISE EXCEPTION 'Invalid expected version' USING ERRCODE='23514';END IF;
 IF operation='company' THEN
  IF input-ARRAY['registrationId','expectedVersion','shared','profileId','profileVersion','objective','acknowledged']<>'{}'::jsonb OR jsonb_typeof(input->'shared') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid company command' USING ERRCODE='23514';END IF;
  SELECT * INTO reg FROM customer_private.programme_registration WHERE id=(input->>'registrationId')::uuid AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Own registration required' USING ERRCODE='42501';END IF;
  work:=reg.workspace_id;programme:=reg.programme_id;resource:=reg.id;shared:=(input->>'shared')::boolean;
  SELECT e.profile_workspace_id INTO source_workspace FROM customer_private.programme_enrolment b JOIN customer_private.programme_enrolment_revision e ON e.enrolment_id=b.id
   WHERE b.registration_id=reg.id ORDER BY e.version DESC LIMIT 1;
  IF shared AND (NOT customer_private.programme_projection_active(reg.id) OR customer_private.organisation_profile_role(source_workspace,actor) IS NULL
   OR customer_private.organisation_profile_role(source_workspace,actor) <> 'writer') THEN RAISE EXCEPTION 'Current company authority required' USING ERRCODE='42501';END IF;
 ELSIF operation='meetings' THEN
  IF input-ARRAY['linkId','expectedVersion','shared','acknowledged']<>'{}'::jsonb OR jsonb_typeof(input->'shared') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid meeting consent' USING ERRCODE='23514';END IF;
  SELECT * INTO link FROM customer_private.programme_mission_link WHERE id=(input->>'linkId')::uuid AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Own mission link required' USING ERRCODE='42501';END IF;
  SELECT * INTO reg FROM customer_private.programme_registration WHERE id=link.registration_id AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Own registration required' USING ERRCODE='42501';END IF;
  work:=reg.workspace_id;programme:=reg.programme_id;resource:=link.id;shared:=(input->>'shared')::boolean;
  PERFORM customer_private.programme_mission_scope(command,reg.id,link.request_id,shared);
  IF shared AND ((SELECT status FROM customer_private.programme_mission_revision WHERE link_id=link.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'SHARED'
   OR customer_private.programme_mission_source(link.id) IS NULL) THEN RAISE EXCEPTION 'Current shared mission required' USING ERRCODE='42501';END IF;
 ELSIF operation='schedule' THEN
  IF input-ARRAY['workspaceId','programmeId','taskId','expectedVersion','scheduled','startsAt','endsAt','audience','attendees','acknowledged']<>'{}'::jsonb OR jsonb_typeof(input->'scheduled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid schedule command' USING ERRCODE='23514';END IF;
  SELECT * INTO task FROM customer_private.programme_task WHERE id=(input->>'taskId')::uuid AND workspace_id=(input->>'workspaceId')::uuid AND programme_id=(input->>'programmeId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme task unavailable' USING ERRCODE='42501';END IF;
  work:=task.workspace_id;programme:=task.programme_id;resource:=task.id;
 ELSE RAISE EXCEPTION 'Unknown projection command' USING ERRCODE='23514';END IF;
 reviewed_workspace:=source_workspace;
 -- Use the same global workspace lock order as the existing mission sharing path.
 FOR source_workspace IN SELECT DISTINCT x FROM unnest(ARRAY[work,source_workspace])x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM customer_private.lock_workspace_access(command,source_workspace);
 END LOOP;
 PERFORM customer_private.participant_scope(command,work,programme,operation='schedule');
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||programme::text,0));
 IF operation='company' THEN SELECT e.profile_workspace_id INTO source_workspace FROM customer_private.programme_enrolment b JOIN customer_private.programme_enrolment_revision e ON e.enrolment_id=b.id WHERE b.registration_id=reg.id ORDER BY e.version DESC LIMIT 1;END IF;
 IF operation='company' AND source_workspace IS DISTINCT FROM reviewed_workspace THEN RAISE EXCEPTION 'Company source changed; review before sharing' USING ERRCODE='23514';END IF;
 IF operation='company' AND shared AND (NOT customer_private.programme_projection_active(reg.id) OR customer_private.organisation_profile_role(source_workspace,actor) IS NULL
 OR customer_private.organisation_profile_role(source_workspace,actor) <> 'writer') THEN RAISE EXCEPTION 'Current company authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM customer_private.programme_projection_command q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request IS DISTINCT FROM input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF operation='company' THEN
  SELECT coalesce(max(version),0) INTO current_version FROM customer_private.programme_projection_company WHERE registration_id=resource;
  IF shared THEN
   SELECT e.profile_workspace_id INTO source_workspace FROM customer_private.programme_enrolment b JOIN customer_private.programme_enrolment_revision e ON e.enrolment_id=b.id WHERE b.registration_id=reg.id ORDER BY e.version DESC LIMIT 1;
   SELECT * INTO profile FROM customer_private.organisation_profile_revision WHERE tenant_id=source_workspace ORDER BY version DESC LIMIT 1;
   IF NOT FOUND OR profile.id IS DISTINCT FROM (input->>'profileId')::uuid OR profile.version IS DISTINCT FROM (input->>'profileVersion')::integer THEN RAISE EXCEPTION 'Company profile changed; review before sharing' USING ERRCODE='23514';END IF;
   objective:=customer_private.coordination_text(input->'objective',11,500,true);
  END IF;
  IF current_version<>expected THEN RAISE EXCEPTION 'Company sharing changed; reload' USING ERRCODE='23514';END IF;
  INSERT INTO customer_private.programme_projection_company(registration_id,version,shared,profile_workspace,profile_version,objective,actor_id)
   VALUES(resource,expected+1,shared,CASE WHEN shared THEN source_workspace END,CASE WHEN shared THEN profile.version END,CASE WHEN shared THEN objective END,actor);
 ELSIF operation='meetings' THEN
  SELECT coalesce(max(version),0) INTO current_version FROM customer_private.programme_projection_meeting WHERE link_id=resource;
  IF current_version<>expected THEN RAISE EXCEPTION 'Meeting sharing changed; reload' USING ERRCODE='23514';END IF;
  INSERT INTO customer_private.programme_projection_meeting VALUES(resource,expected+1,shared,actor,clock_timestamp());
 ELSE
  SELECT coalesce(max(version),0) INTO current_version FROM customer_private.programme_projection_schedule WHERE task_id=resource;
  IF current_version<>expected THEN RAISE EXCEPTION 'Activity changed; reload' USING ERRCODE='23514';END IF;
  IF (input->>'scheduled')::boolean THEN
   SELECT * INTO ctx FROM app.delivery_programme_context WHERE tenant_id=work AND programme_id=programme ORDER BY version DESC LIMIT 1;
   start_time:=(input->>'startsAt')::timestamptz;end_time:=(input->>'endsAt')::timestamptz;
   IF ctx.id IS NULL OR start_time IS NULL OR end_time IS NULL OR end_time<=start_time OR start_time<(ctx.details->>'startsAt')::timestamptz OR end_time>(ctx.details->>'endsAt')::timestamptz THEN RAISE EXCEPTION 'Activity must be within programme dates' USING ERRCODE='23514';END IF;
   IF (SELECT status FROM customer_private.programme_task_revision WHERE task_id=resource ORDER BY version DESC LIMIT 1)='CANCELLED' THEN RAISE EXCEPTION 'Cancelled task cannot be scheduled' USING ERRCODE='23514';END IF;
   IF input->>'audience' NOT IN ('ALL','SELECTED') OR jsonb_typeof(input->'attendees') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'attendees')>10000 THEN RAISE EXCEPTION 'Invalid attendees' USING ERRCODE='23514';END IF;
   SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid),ARRAY[]::uuid[]) INTO selected FROM jsonb_array_elements_text(input->'attendees')x;
   IF cardinality(selected)<>(SELECT count(DISTINCT x) FROM unnest(selected)x) OR (input->>'audience'='ALL' AND cardinality(selected)<>0) OR(input->>'audience'='SELECTED' AND cardinality(selected)=0)
   OR EXISTS(SELECT FROM unnest(selected)x WHERE NOT EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.id=x AND r.workspace_id=work AND r.programme_id=programme AND customer_private.programme_projection_active(r.id))) THEN RAISE EXCEPTION 'Only active programme attendees may be selected' USING ERRCODE='23514';END IF;
  END IF;
  INSERT INTO customer_private.programme_projection_schedule(task_id,version,scheduled,starts_at,ends_at,context_version,timezone,audience,attendees,actor_id)
   VALUES(resource,expected+1,(input->>'scheduled')::boolean,start_time,end_time,ctx.version,ctx.details->>'timezone',CASE WHEN (input->>'scheduled')::boolean THEN input->>'audience' ELSE 'ALL' END,selected,actor);
 END IF;
 PERFORM customer_private.terms_event(work,actor,command,programme,'projection_'||operation,resource);
 result:=jsonb_build_object('commandId',command,'workspaceId',work,'programmeId',programme,'resourceId',resource,'version',expected+1);
 INSERT INTO customer_private.programme_projection_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501';END IF;
 RETURN result||jsonb_build_object('replayed',false,'expiresAt',customer_private.coordination_expiry());
END $$;

CREATE FUNCTION customer.programme_projection_owner(target uuid,programme uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();command uuid:=gen_random_uuid();work uuid;ctx app.delivery_programme_context;
 items jsonb;readiness jsonb;agenda jsonb;conflicts jsonb;metrics jsonb;next_id uuid;result jsonb;
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
  SELECT l.id,l.registration_id,o.mission_tenant_id,o.mission_id,customer_private.programme_mission_source(l.id) IS NOT NULL available
  FROM customer_private.programme_mission_link l JOIN customer_private.programme_registration r ON r.id=l.registration_id
  JOIN customer_private.owned_request o ON o.id=l.request_id AND o.principal_id=r.principal_id
  JOIN LATERAL(SELECT shared FROM customer_private.programme_projection_meeting WHERE link_id=l.id ORDER BY version DESC LIMIT 1)c ON c.shared
  JOIN LATERAL(SELECT status FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1)s ON s.status='SHARED'
  WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.programme_projection_active(r.id)
 ), sources AS(SELECT DISTINCT mission_tenant_id,mission_id FROM consented WHERE available), meetings AS(
  SELECT DISTINCT m.id,m.tenant_id,m.status FROM sources s JOIN app.meeting m ON m.tenant_id=s.mission_tenant_id AND m.mission_id=s.mission_id
 ) SELECT jsonb_build_object('state',CASE WHEN count(*)=0 THEN 'NOT_SHARED' WHEN count(*) FILTER(WHERE available)=0 THEN 'UNAVAILABLE' WHEN bool_and(available) THEN 'AVAILABLE' ELSE 'PARTIAL' END,
 'sharedLinks',count(*) FILTER(WHERE available),'unavailableLinks',count(*) FILTER(WHERE NOT available),'participantsSharing',count(DISTINCT registration_id) FILTER(WHERE available),
 'scheduled',CASE WHEN count(*) FILTER(WHERE available)>0 THEN(SELECT count(*) FROM meetings WHERE status='SCHEDULED') END,
 'qualifiedHeld',CASE WHEN count(*) FILTER(WHERE available)>0 THEN(SELECT count(*) FROM meetings m WHERE m.status='HELD' AND EXISTS(
 SELECT FROM app.opportunity o JOIN app.outcome_event e ON e.tenant_id=o.tenant_id AND e.opportunity_id=o.id WHERE o.tenant_id=m.tenant_id AND o.meeting_id=m.id
 AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=2)) END) INTO metrics FROM consented;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'readiness',readiness,'companies',items,'nextAfter',next_id,
 'context',CASE WHEN ctx.id IS NOT NULL THEN jsonb_build_object('version',ctx.version,'startsAt',ctx.details->'startsAt','endsAt',ctx.details->'endsAt','timezone',ctx.details->'timezone') END,
 'agenda',agenda,'conflicts',conflicts,'meetings',metrics,'sendsMessages',false);
 RETURN result;
END $$;

CREATE FUNCTION customer.programme_projection_own(registration uuid,after_link uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();reg customer_private.programme_registration;work uuid;source_workspace uuid;
 profile customer_private.organisation_profile_revision;company_head customer_private.programme_projection_company;links jsonb;
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
 'summary',CASE WHEN customer_private.programme_mission_source(l.id) IS NOT NULL THEN s.summary END,'available',customer_private.programme_projection_active(reg.id) AND s.status='SHARED' AND customer_private.programme_mission_source(l.id) IS NOT NULL) ORDER BY l.id),'[]'::jsonb)
 INTO links FROM (SELECT * FROM customer_private.programme_mission_link WHERE registration_id=reg.id AND principal_id=actor AND(after_link IS NULL OR id>after_link) ORDER BY id LIMIT 25)l
 LEFT JOIN LATERAL(SELECT version,shared FROM customer_private.programme_projection_meeting WHERE link_id=l.id ORDER BY version DESC LIMIT 1)c ON true
 LEFT JOIN LATERAL(SELECT status,summary FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1)s ON true
 WHERE l.registration_id=reg.id AND l.principal_id=actor AND(after_link IS NULL OR l.id>after_link);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'expiresAt',customer_private.coordination_expiry(),'active',customer_private.programme_projection_active(reg.id),
 'company',jsonb_build_object('version',coalesce(company_head.version,0),'shared',coalesce(company_head.shared,false),'objective',company_head.objective),
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
