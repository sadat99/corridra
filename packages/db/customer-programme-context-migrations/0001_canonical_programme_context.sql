-- Optional customer authority for the original canonical programme context.
CREATE TABLE customer_private.programme_context_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 context_id uuid NOT NULL UNIQUE REFERENCES app.delivery_programme_context(id),input jsonb NOT NULL,
 shared boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.programme_context_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TABLE customer_private.context_execution_grant (
 nonce_hash text PRIMARY KEY,proof_hash text NOT NULL REFERENCES customer_private.session_proof(hash) ON DELETE CASCADE,
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 executor_id uuid NOT NULL REFERENCES identity.principal(id),relation_oid oid NOT NULL CHECK(relation_oid='app.delivery_programme_context'::regclass),
 record_digest text NOT NULL,backend_pid integer NOT NULL,transaction_id bigint NOT NULL,command_id uuid NOT NULL,expires_at timestamptz NOT NULL
);
ALTER TABLE customer_private.programme_context_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.context_execution_grant ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_context_command,customer_private.context_execution_grant FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION customer_private.context_execution_context(relation oid,data jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g customer_private.context_execution_grant;actor uuid:=customer.actor_id();
BEGIN
 IF relation IS DISTINCT FROM 'app.delivery_programme_context'::regclass OR actor IS NULL OR data IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO g FROM customer_private.context_execution_grant v WHERE v.nonce_hash=current_setting('corridra.customer_context_execution',true)
 AND v.proof_hash=current_setting('corridra.customer_proof_hash',true) AND v.principal_id=actor AND v.relation_oid=relation
 AND v.backend_pid=pg_backend_pid() AND v.transaction_id=txid_current() AND v.record_digest=encode(sha256(convert_to(data::text,'UTF8')),'hex')
 AND v.expires_at>clock_timestamp() AND v.workspace_id=(data->>'tenant_id')::uuid
 AND EXISTS(SELECT FROM identity.principal p WHERE p.id=v.executor_id AND p.kind='service' AND p.disabled_at IS NULL);
 IF NOT FOUND OR customer_private.participant_scope(g.command_id,g.workspace_id,(data->>'programme_id')::uuid,true) IS DISTINCT FROM actor THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('executorId',g.executor_id,'attribution',jsonb_build_object('initiator_kind','customer','initiator_id',actor,
 'customer_workspace_id',g.workspace_id,'command_id',g.command_id,'authority','customer_programme_context'));
END $$;
REVOKE ALL ON FUNCTION customer_private.context_execution_context(oid,jsonb) FROM PUBLIC,corridra_runtime,corridra_auth;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='app.guard_delivery_experience()'::regprocedure AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='af25528ef5d0b292a8f3d62399aacd6ebd35c0591bad744e26535f39c31c74c6') THEN RAISE EXCEPTION 'Reviewed guard_delivery_experience dependency changed'; END IF;
END $$;
CREATE OR REPLACE FUNCTION app.guard_delivery_experience() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.delivery_publication;req app.mission_requirements;q app.mission_quotation;c app.communication;mid uuid;tid uuid;aid uuid;d jsonb;
BEGIN
 IF nullif(current_setting('corridra.customer_context_execution',true),'') IS NOT NULL THEN
  IF customer_private.context_execution_context(TG_RELID,to_jsonb(NEW)) IS NULL THEN RAISE EXCEPTION 'Customer context execution denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.created_at<>now() OR NEW.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation'),false) OR coalesce(app.member_role(NEW.tenant_id),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic actor required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME IN ('delivery_experience_publication','recipient_disclosure','delivery_participant_identity') AND (app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa()) THEN RAISE EXCEPTION 'Disclosure requires owner/admin and fresh MFA' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME IN ('delivery_programme_context','delivery_agenda') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':programme:'||NEW.programme_id::text,0));d:=NEW.details;
  IF EXISTS(SELECT FROM jsonb_each(d) j WHERE j.key=ANY(ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','ownerId','reason','label','state','nextAction','dueAt']) AND jsonb_typeof(j.value)<>'string') THEN RAISE EXCEPTION 'Typed delegation text required';END IF;
  IF NOT app.research_owner(NEW.tenant_id,(d->>'ownerId')::uuid) THEN RAISE EXCEPTION 'Active human owner required'; END IF;
  IF TG_TABLE_NAME='delivery_programme_context' THEN
   IF NEW.version<>coalesce((SELECT max(version) FROM app.delivery_programme_context WHERE tenant_id=NEW.tenant_id AND programme_id=NEW.programme_id),0)+1 OR d-ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','ownerId','reason']<>'{}'::jsonb OR NOT(d ?& ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','ownerId','reason']) OR length(d->>'organiser') NOT BETWEEN 3 AND 1000 OR length(d->>'purpose') NOT BETWEEN 3 AND 1000 OR length(d->>'reason') NOT BETWEEN 3 AND 1000 OR NOT EXISTS(SELECT FROM app.market_scope WHERE key=d->>'marketCode' AND kind IN ('COUNTRY','TRADE_BLOC')) OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=d->>'timezone') OR (d->>'endsAt')::timestamptz<=(d->>'startsAt')::timestamptz THEN RAISE EXCEPTION 'Invalid delegation context'; END IF;
  ELSE
   IF NEW.version<>coalesce((SELECT max(version) FROM app.delivery_agenda WHERE tenant_id=NEW.tenant_id AND programme_id=NEW.programme_id AND item_id=NEW.item_id),0)+1 OR d-ARRAY['label','missionIds','meetingIds','state','ownerId','nextAction','dueAt','reason','meetingVersions']<>'{}'::jsonb OR NOT(d ?& ARRAY['label','missionIds','meetingIds','state','ownerId','nextAction','dueAt','reason','meetingVersions']) OR length(d->>'label') NOT BETWEEN 3 AND 1000 OR length(d->>'nextAction') NOT BETWEEN 3 AND 1000 OR length(d->>'reason') NOT BETWEEN 3 AND 1000 OR (d->>'dueAt')::timestamptz IS NULL OR d->>'state' NOT IN ('PROPOSED','CONFIRMED','CANCELLED') OR jsonb_typeof(d->'missionIds')<>'array' OR jsonb_array_length(d->'missionIds') NOT BETWEEN 1 AND 100 OR jsonb_typeof(d->'meetingIds')<>'array' OR jsonb_array_length(d->'meetingIds')>100 THEN RAISE EXCEPTION 'Invalid delegation agenda'; END IF;
   IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(d->'missionIds'))<>jsonb_array_length(d->'missionIds') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(d->'meetingIds'))<>jsonb_array_length(d->'meetingIds') THEN RAISE EXCEPTION 'Duplicate agenda scope'; END IF;
   FOR mid IN SELECT value::uuid FROM jsonb_array_elements_text(d->'missionIds') LOOP
    IF NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.mission_intake i ON i.tenant_id=dp.tenant_id AND i.id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.programme_id=NEW.programme_id AND dp.mission_id=mid AND i.retention_until>now()) THEN RAISE EXCEPTION 'Participant outside programme'; END IF;
   END LOOP;
   FOR mid IN SELECT value::uuid FROM jsonb_array_elements_text(d->'meetingIds') LOOP
    IF NOT EXISTS(SELECT FROM app.meeting m WHERE m.tenant_id=NEW.tenant_id AND m.id=mid AND m.mission_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(d->'missionIds'))) AND app.meeting_access(NEW.tenant_id,m.id) AND (d->>'state'<>'CONFIRMED' OR m.status IN ('SCHEDULED','HELD'))) THEN RAISE EXCEPTION 'Actual participant meeting required'; END IF;
   END LOOP;
   IF jsonb_typeof(d->'meetingVersions')<>'array' OR jsonb_array_length(d->'meetingVersions')<>jsonb_array_length(d->'meetingIds') OR EXISTS(SELECT FROM jsonb_array_elements(d->'meetingVersions') v WHERE NOT EXISTS(SELECT FROM app.meeting m WHERE m.tenant_id=NEW.tenant_id AND m.id=(v->>'id')::uuid AND m.version=(v->>'version')::int AND d->'meetingIds' ? m.id::text)) THEN RAISE EXCEPTION 'Pinned actual meeting versions required'; END IF;
   IF d->>'state'='CONFIRMED' AND (SELECT count(DISTINCT ROW(m.starts_at,m.ends_at,m.location)) FROM app.meeting m WHERE m.tenant_id=NEW.tenant_id AND m.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(d->'meetingIds'))))>1 THEN RAISE EXCEPTION 'A shared confirmed activity requires the same actual time and venue';END IF;
   IF d->>'state'='CONFIRMED' AND jsonb_array_length(d->'meetingIds')=0 THEN RAISE EXCEPTION 'Confirmation requires a scheduled meeting'; END IF;
   IF d->>'state'='CONFIRMED' AND EXISTS(SELECT FROM app.delivery_agenda a WHERE a.tenant_id=NEW.tenant_id AND a.programme_id=NEW.programme_id AND a.item_id<>NEW.item_id AND a.details->>'state'='CONFIRMED' AND a.version=(SELECT max(version) FROM app.delivery_agenda n WHERE n.tenant_id=a.tenant_id AND n.programme_id=a.programme_id AND n.item_id=a.item_id) AND EXISTS(SELECT FROM jsonb_array_elements_text(a.details->'meetingIds') priorMeeting WHERE d->'meetingIds' ? priorMeeting.value)) THEN RAISE EXCEPTION 'Meeting already attributed to another confirmed activity';END IF;
   IF d->>'state'='CONFIRMED' AND EXISTS(SELECT FROM jsonb_array_elements_text(d->'missionIds') m WHERE NOT EXISTS(SELECT FROM app.meeting mt WHERE mt.tenant_id=NEW.tenant_id AND mt.mission_id=m.value::uuid AND mt.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(d->'meetingIds'))) AND mt.status IN ('SCHEDULED','HELD'))) THEN RAISE EXCEPTION 'Each confirmed participant needs an actual meeting'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='delivery_participant_identity' THEN
  IF NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.mission_intake i ON i.tenant_id=dp.tenant_id AND i.id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.id=NEW.participant_id AND i.retention_until>now()) OR NOT app.experience_source_valid(NEW.tenant_id,NEW.source_id,NEW.claim_id,NEW.created_by) OR NOT EXISTS(SELECT FROM app.organisation o JOIN app.organisation_source os ON os.organisation_id=o.id JOIN app.source_record s ON s.tenant_id=os.tenant_id AND s.id=os.source_id WHERE o.id=NEW.organisation_id AND o.synthetic AND os.tenant_id=NEW.tenant_id AND os.source_id=NEW.source_id AND s.classification='PUBLIC') THEN RAISE EXCEPTION 'Explicit source-backed participant organisation required';END IF;
 ELSIF TG_TABLE_NAME='delivery_experience_publication' THEN
  SELECT * INTO p FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=NEW.publication_id;IF p.id IS NULL OR NOT app.delivery_publication_valid(p.id) OR p.created_by<>NEW.created_by THEN RAISE EXCEPTION 'Publish only your currently authorized scope'; END IF;
  IF cardinality(NEW.target_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.target_ids)x) OR cardinality(NEW.quotation_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.quotation_ids)x) OR cardinality(NEW.agenda_item_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.agenda_item_ids)x) THEN RAISE EXCEPTION 'Duplicate disclosure scope'; END IF;
  IF NEW.requirement_id IS NOT NULL THEN SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND id=NEW.requirement_id AND mission_id=p.mission_id;IF req.id IS NULL OR NOT app.experience_source_valid(NEW.tenant_id,req.source_id,req.claim_id,NEW.created_by) THEN RAISE EXCEPTION 'Accessible mission requirement required'; END IF;END IF;
  FOREACH tid IN ARRAY NEW.target_ids LOOP IF NOT app.research_target_access(NEW.tenant_id,tid) OR NOT app.experience_target_valid(NEW.tenant_id,tid,p.mission_id,NEW.created_by) THEN RAISE EXCEPTION 'Target outside approved mission'; END IF;END LOOP;
  IF jsonb_array_length(NEW.target_snapshots)<>cardinality(NEW.target_ids) OR (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(NEW.target_snapshots)v)<>cardinality(NEW.target_ids) THEN RAISE EXCEPTION 'Pinned target assessments required';END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(NEW.target_snapshots) LOOP IF NOT (d->>'id')::uuid=ANY(NEW.target_ids) OR d-ARRAY['id','assessmentId']<>'{}'::jsonb OR (d->>'assessmentId' IS NOT NULL AND NOT EXISTS(SELECT FROM app.match_assessment ma WHERE ma.tenant_id=NEW.tenant_id AND ma.id=(d->>'assessmentId')::uuid AND ma.target_id=(d->>'id')::uuid AND app.experience_assessment_valid(NEW.tenant_id,ma.id,NEW.created_by))) THEN RAISE EXCEPTION 'Invalid pinned assessment'; END IF;END LOOP;
  FOREACH tid IN ARRAY NEW.quotation_ids LOOP SELECT * INTO q FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND id=tid AND mission_id=p.mission_id AND target_id=ANY(NEW.target_ids) AND requirement_id=NEW.requirement_id;IF q.id IS NULL OR NOT app.experience_source_valid(NEW.tenant_id,q.source_id,q.claim_id,NEW.created_by) THEN RAISE EXCEPTION 'Quotation outside participant scope'; END IF;END LOOP;
  FOREACH aid IN ARRAY NEW.agenda_item_ids LOOP IF NOT EXISTS(SELECT FROM app.delivery_agenda a JOIN app.delivery_participant dp ON dp.tenant_id=a.tenant_id AND dp.programme_id=a.programme_id AND dp.mission_id=p.mission_id WHERE a.tenant_id=NEW.tenant_id AND a.id=aid AND a.details->'missionIds' ? p.mission_id::text) THEN RAISE EXCEPTION 'Agenda outside participant scope'; END IF; END LOOP;
 ELSIF TG_TABLE_NAME='recipient_disclosure' THEN
  SELECT m.* INTO c FROM app.buyer_link l JOIN app.communication m ON m.tenant_id=l.tenant_id AND m.id=l.message_id WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.link_id;
  IF c.id IS NULL OR NOT app.buyer_link_access(NEW.tenant_id,NEW.link_id,true) OR NOT app.communication_allowed(c.id) THEN RAISE EXCEPTION 'Current authorized recipient required'; END IF;
  IF NEW.rfq_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.mission_rfq r JOIN app.target_account t ON t.tenant_id=r.tenant_id AND t.mission_id=r.mission_id AND t.id=c.target_id WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.rfq_id AND c.target_id=ANY(r.target_ids) AND app.experience_source_valid(r.tenant_id,r.source_id,r.claim_id,NEW.created_by)) THEN RAISE EXCEPTION 'RFQ does not include this recipient'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='app.record_change()'::regprocedure AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='7654715b023bc6e408afee7e76cbc0ed5495421b1690e09e0b208cebe5bc4705') THEN RAISE EXCEPTION 'Reviewed record_change dependency changed'; END IF;
END $$;
CREATE OR REPLACE FUNCTION app.record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); a uuid:=app.actor_id(); record jsonb:=to_jsonb(NEW); v integer:=1; aggregate text; operation text; customer_execution jsonb;
BEGIN
 IF nullif(current_setting('corridra.customer_context_execution',true),'') IS NOT NULL THEN
  customer_execution:=customer_private.context_execution_context(TG_RELID,record);
  IF customer_execution IS NULL THEN RAISE EXCEPTION 'Customer context execution denied' USING ERRCODE='42501'; END IF;
  a:=(customer_execution->>'executorId')::uuid;
 END IF;
 IF nullif(current_setting('corridra.customer_programme_execution',true),'') IS NOT NULL THEN
  customer_execution:=customer_private.programme_execution_context(TG_RELID,record);
  IF customer_execution IS NULL THEN RAISE EXCEPTION 'Customer programme execution denied' USING ERRCODE='42501'; END IF;
  a:=(customer_execution->>'executorId')::uuid;
 END IF;
 IF a IS NULL AND pg_has_role(session_user,(SELECT relowner FROM pg_class WHERE oid='app.membership'::regclass),'MEMBER') THEN
  SELECT id INTO a FROM identity.principal WHERE id=NULLIF(current_setting('corridra.bootstrap_actor',true),'')::uuid AND kind='service' AND disabled_at IS NULL;
 END IF;
 IF a IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 aggregate:=CASE WHEN TG_TABLE_NAME='config_version' THEN record->>'key' ELSE COALESCE(record->>'id',record->>'user_id') END;v:=COALESCE((record->>'version')::integer,1);operation:=TG_TABLE_NAME||'.'||lower(TG_OP);
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,operation,1,TG_TABLE_NAME,aggregate,v,a,now(),current_setting('corridra.correlation_id')::uuid,current_setting('corridra.causation_id')::uuid,
 (jsonb_strip_nulls(jsonb_build_object('id',aggregate,'version',v,'status',record->>'status','role',record->>'role','revoked',record->>'revoked_at' IS NOT NULL))||coalesce(customer_execution->'attribution','{}'::jsonb)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,operation);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;CREATE FUNCTION customer.programme_context_command(command uuid,target uuid,programme uuid,expected integer,input jsonb,share boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(command,target,programme,true);prior customer_private.programme_context_command;
 row app.delivery_programme_context;head integer;executor uuid;nonce text;expiry timestamptz;proof text:=current_setting('corridra.customer_proof_hash',true);payload jsonb;
BEGIN
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR share IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid context command' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','reason']<>'{}'::jsonb OR NOT(input ?& ARRAY['organiser','marketCode','purpose','startsAt','endsAt','timezone','reason'])
 OR EXISTS(SELECT FROM jsonb_each(input) j WHERE jsonb_typeof(j.value)<>'string' OR j.value #>> '{}' ~ '[[:cntrl:]]')
 OR length(input->>'organiser') NOT BETWEEN 11 AND 1000 OR input->>'organiser' NOT LIKE 'Synthetic %'
 OR length(input->>'purpose') NOT BETWEEN 11 AND 1000 OR input->>'purpose' NOT LIKE 'Synthetic %'
 OR length(input->>'reason') NOT BETWEEN 3 AND 1000
 OR NOT EXISTS(SELECT FROM app.market_scope WHERE key=input->>'marketCode' AND kind IN ('COUNTRY','TRADE_BLOC'))
 OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=input->>'timezone')
 OR NOT isfinite((input->>'startsAt')::timestamptz) OR NOT isfinite((input->>'endsAt')::timestamptz)
 OR (input->>'endsAt')::timestamptz<=(input->>'startsAt')::timestamptz THEN RAISE EXCEPTION 'Invalid synthetic programme details' USING ERRCODE='23514'; END IF;
 -- Same workspace access lock as revocation, then the existing staff programme lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text||':programme:'||programme::text,0));
 IF customer_private.participant_scope(command,target,programme,true) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context authority expired' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expectedVersion',expected,'details',input,'shared',share);
 SELECT coalesce(max(version),0) INTO head FROM app.delivery_programme_context WHERE tenant_id=target AND programme_id=programme;
 SELECT * INTO prior FROM customer_private.programme_context_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM payload OR NOT EXISTS(SELECT FROM app.delivery_programme_context WHERE id=prior.context_id AND version=head) THEN RAISE EXCEPTION 'Context command changed or superseded' USING ERRCODE='23514'; END IF;
  RETURN customer.programme_context_view(target,programme,NULL)||jsonb_build_object('commandId',command);
 END IF;
 IF expected<>head THEN RAISE EXCEPTION 'Programme details changed;reload before saving' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL FOR SHARE OF p;
 SELECT expires_at INTO expiry FROM customer_private.session_proof WHERE hash=proof AND expires_at>clock_timestamp();
 IF executor IS NULL OR expiry IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context execution unavailable' USING ERRCODE='42501'; END IF;
 row.id:=gen_random_uuid();row.tenant_id:=target;row.programme_id:=programme;row.version:=head+1;
 row.details:=input||jsonb_build_object('ownerKind','CUSTOMER','ownerId',actor);row.created_by:=executor;row.created_at:=now();
 nonce:=encode(sha256(convert_to(gen_random_uuid()::text||proof,'UTF8')),'hex');
 INSERT INTO customer_private.context_execution_grant VALUES(nonce,proof,actor,target,executor,'app.delivery_programme_context'::regclass,encode(sha256(convert_to(to_jsonb(row)::text,'UTF8')),'hex'),pg_backend_pid(),txid_current(),command,least(expiry,clock_timestamp()+interval '15 seconds'));
 PERFORM set_config('corridra.customer_context_execution',nonce,true),set_config('corridra.correlation_id',command::text,true),set_config('corridra.causation_id',command::text,true);
 INSERT INTO app.delivery_programme_context SELECT (row).*;
 PERFORM set_config('corridra.customer_context_execution','',true);
 DELETE FROM customer_private.context_execution_grant WHERE nonce_hash=nonce;
 INSERT INTO customer_private.programme_context_command VALUES(actor,command,target,programme,row.id,payload,share,clock_timestamp());
 IF customer_private.participant_scope(command,target,programme,true) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context authority expired' USING ERRCODE='42501'; END IF;
 RETURN customer.programme_context_view(target,programme,NULL)||jsonb_build_object('commandId',command);
END $$;
CREATE FUNCTION customer.programme_context_view(target uuid,programme uuid,registration uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();r customer_private.programme_registration;row app.delivery_programme_context;binding customer_private.programme_context_command;result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF registration IS NOT NULL THEN
  SELECT * INTO r FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
  target:=r.workspace_id;programme:=r.programme_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||target::text,0));
  IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 ELSE
  PERFORM customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text||':programme:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Context access expired after programme wait' USING ERRCODE='42501'; END IF;
 SELECT * INTO row FROM app.delivery_programme_context WHERE tenant_id=target AND programme_id=programme ORDER BY version DESC LIMIT 1;
 SELECT * INTO binding FROM customer_private.programme_context_command WHERE context_id=row.id;
 -- Never fall back to an earlier share or expose unbound historical staff details.
 result:=jsonb_build_object('programmeId',programme,'synthetic',true,'expiresAt',least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true))),
 'context',CASE WHEN binding.context_id IS NOT NULL AND (registration IS NULL OR binding.shared) THEN jsonb_build_object('version',row.version,'organiser',row.details->'organiser','marketCode',row.details->'marketCode','purpose',row.details->'purpose','startsAt',row.details->'startsAt','endsAt',row.details->'endsAt','timezone',row.details->'timezone','updatedAt',row.created_at) ELSE NULL END);
 IF registration IS NULL THEN result:=result||jsonb_build_object('workspaceId',target,'currentVersion',coalesce(row.version,0),'shared',coalesce(binding.shared,false),'reason',CASE WHEN binding.context_id IS NOT NULL THEN row.details->'reason' END); ELSE result:=result||jsonb_build_object('registrationId',registration); END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR (registration IS NOT NULL AND EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration)) THEN RAISE EXCEPTION 'Context access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer.programme_context_command(uuid,uuid,uuid,integer,jsonb,boolean),customer.programme_context_view(uuid,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_context_command(uuid,uuid,uuid,integer,jsonb,boolean),customer.programme_context_view(uuid,uuid,uuid) TO corridra_runtime;
