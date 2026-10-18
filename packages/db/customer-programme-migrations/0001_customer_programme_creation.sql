-- Forward compatible programme authority;immutable core source SQL is not rewritten.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='app.delivery_guard()'::regprocedure AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog']) OR
 NOT EXISTS(SELECT FROM pg_proc WHERE oid='app.record_change()'::regprocedure AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog']) THEN
  RAISE EXCEPTION 'Original programme guard/event security attributes changed; review required';
 END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='app.delivery_guard()'::regprocedure)<>'77177ebc76bbfbcfba62c56070620ab8e28684d1c3bfeb169c858716a0d70727' OR
 (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='app.record_change()'::regprocedure)<>'9cc9627165afa8efd614e93ca0a454bfda2a88602e18f549e89897801c345fe4' THEN
  RAISE EXCEPTION 'Original programme guard/event contract changed; review required';
 END IF;
END $$;
CREATE TABLE customer_private.programme_creation (
 programme_id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id),FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TRIGGER programme_creation_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_creation FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TABLE customer_private.programme_execution_grant (
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
 proof_hash text NOT NULL REFERENCES customer_private.session_proof(hash) ON DELETE CASCADE,
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 executor_id uuid NOT NULL REFERENCES identity.principal(id),relation_oid oid NOT NULL CHECK(relation_oid='app.delivery_programme'::regclass),
 record_digest text NOT NULL CHECK(record_digest ~ '^[a-f0-9]{64}$'),backend_pid integer NOT NULL,transaction_id bigint NOT NULL,
 command_id uuid NOT NULL,expires_at timestamptz NOT NULL
);
ALTER TABLE customer_private.programme_creation ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_execution_grant ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_creation,customer_private.programme_execution_grant FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION customer_private.programme_execution_context(relation oid,data jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permission customer_private.programme_execution_grant;actor uuid:=customer.actor_id();
BEGIN
 IF relation IS DISTINCT FROM 'app.delivery_programme'::regclass OR actor IS NULL OR data IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO permission FROM customer_private.programme_execution_grant g
 WHERE g.nonce_hash=current_setting('corridra.customer_programme_execution',true)
 AND g.proof_hash=current_setting('corridra.customer_proof_hash',true) AND g.principal_id=actor
 AND g.relation_oid=relation AND g.backend_pid=pg_backend_pid() AND g.transaction_id=txid_current()
 AND g.record_digest=encode(sha256(convert_to(data::text,'UTF8')),'hex') AND g.expires_at>clock_timestamp()
 AND EXISTS(SELECT FROM identity.principal p WHERE p.id=g.executor_id AND p.kind='service' AND p.disabled_at IS NULL);
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('executorId',permission.executor_id,'attribution',jsonb_build_object('initiator_kind','customer',
 'initiator_id',actor,'customer_workspace_id',permission.workspace_id,'command_id',permission.command_id,'authority','customer_programme_command'));
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_execution_context(oid,jsonb) FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE OR REPLACE FUNCTION app.delivery_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j jsonb;pid uuid;batch app.delivery_import; customer_execution jsonb;
BEGIN
 IF NEW.created_at<>now() THEN RAISE EXCEPTION 'Server creation time required' USING ERRCODE='23514'; END IF;
 IF nullif(current_setting('corridra.customer_programme_execution',true),'') IS NOT NULL THEN
  customer_execution:=customer_private.programme_execution_context(TG_RELID,to_jsonb(NEW));
  IF customer_execution IS NULL THEN RAISE EXCEPTION 'Customer programme execution denied' USING ERRCODE='42501'; END IF;
 ELSE
 IF NEW.created_by IS DISTINCT FROM app.actor_id() OR NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation'),false) OR coalesce(app.member_role(NEW.tenant_id),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('delivery_publication','delivery_link','delivery_request') AND (app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa()) THEN RAISE EXCEPTION 'Sharing requires owner/admin and fresh MFA' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='delivery_publication' THEN
  IF EXISTS(SELECT FROM jsonb_each(NEW.copy) v WHERE v.key=ANY(ARRAY['title','company','objective','brief','nextAction','dueAt']) AND jsonb_typeof(v.value)<>'string') THEN RAISE EXCEPTION 'Publication copy must contain text' USING ERRCODE='23514'; END IF;
  IF NEW.copy IS NULL OR NOT NEW.copy ?& ARRAY['title','company','objective','brief','nextAction','dueAt','meetings','opportunityIds','includeFinancials'] OR NEW.copy-ARRAY['title','company','objective','brief','nextAction','dueAt','meetings','opportunityIds','includeFinancials']<>'{}'::jsonb OR length(NEW.copy->>'title') NOT BETWEEN 3 AND 160 OR length(NEW.copy->>'company') NOT BETWEEN 2 AND 160 OR length(NEW.copy->>'objective') NOT BETWEEN 3 AND 500 OR length(NEW.copy->>'brief') NOT BETWEEN 10 AND 2000 OR length(NEW.copy->>'nextAction') NOT BETWEEN 3 AND 300 OR jsonb_typeof(NEW.copy->'includeFinancials')<>'boolean' OR jsonb_typeof(NEW.copy->'meetings')<>'array' OR jsonb_typeof(NEW.copy->'opportunityIds')<>'array' OR jsonb_array_length(NEW.copy->'meetings')>50 OR jsonb_array_length(NEW.copy->'opportunityIds')>100 OR (NEW.copy->>'dueAt')::timestamptz IS NULL OR NOT EXISTS(SELECT FROM app.mission_intake WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id AND retention_until>now()) THEN RAISE EXCEPTION 'Invalid reviewed publication' USING ERRCODE='23514'; END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(NEW.copy->'meetings') LOOP
   IF j-ARRAY['id','version','label']<>'{}'::jsonb OR length(j->>'label') NOT BETWEEN 3 AND 160 OR NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND id=(j->>'id')::uuid AND mission_id=NEW.mission_id AND version=(j->>'version')::integer AND app.meeting_access(tenant_id,id)) THEN RAISE EXCEPTION 'Approve a current accessible meeting on this mission' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.copy->'opportunityIds') j WHERE NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND id=j.value::uuid AND mission_id=NEW.mission_id AND app.opportunity_access(tenant_id,id))) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW.copy->'opportunityIds'))<>jsonb_array_length(NEW.copy->'opportunityIds') OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.copy->'meetings'))<>jsonb_array_length(NEW.copy->'meetings') THEN RAISE EXCEPTION 'Approve distinct opportunities and meetings on this mission' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_link' THEN
  IF (SELECT coalesce(sum(octet_length(copy::text)),0) FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=ANY(NEW.publication_ids))>3145728 OR (SELECT coalesce(sum(jsonb_array_length(copy->'meetings')),0) FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=ANY(NEW.publication_ids))>1000 THEN RAISE EXCEPTION 'Reporting scope exceeds the complete report size limit' USING ERRCODE='23514'; END IF;
  IF cardinality(NEW.publication_ids)<>(SELECT count(DISTINCT p) FROM unnest(NEW.publication_ids) p) THEN RAISE EXCEPTION 'Duplicate publication scope' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT mission_id) FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=ANY(NEW.publication_ids))<>cardinality(NEW.publication_ids) THEN RAISE EXCEPTION 'One publication per mission required' USING ERRCODE='23514'; END IF;
  FOREACH pid IN ARRAY NEW.publication_ids LOOP
   IF NOT EXISTS(SELECT FROM app.delivery_publication WHERE tenant_id=NEW.tenant_id AND id=pid) OR NOT app.delivery_publication_valid(pid) OR (NEW.programme_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.delivery_participant dp JOIN app.delivery_publication p ON p.tenant_id=dp.tenant_id AND p.mission_id=dp.mission_id WHERE dp.tenant_id=NEW.tenant_id AND dp.programme_id=NEW.programme_id AND p.id=pid)) THEN RAISE EXCEPTION 'Publication outside approved programme scope' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='delivery_request' THEN
  IF NEW.due_at<=now() OR NOT app.delivery_publication_valid(NEW.publication_id) OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active publication, owner and future deadline required' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_participant' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-programme:'||NEW.tenant_id::text||':'||NEW.programme_id::text,0));
  IF (SELECT count(*) FROM app.delivery_participant WHERE tenant_id=NEW.tenant_id AND programme_id=NEW.programme_id)>=1000 OR NOT EXISTS(SELECT FROM app.delivery_import i JOIN app.mission m ON m.tenant_id=i.tenant_id AND m.id=NEW.mission_id JOIN app.mission_intake mi ON mi.tenant_id=m.tenant_id AND mi.id=m.id WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.import_id AND i.programme_id=NEW.programme_id AND i.created_by=NEW.created_by AND i.expires_at>now() AND m.created_by=NEW.created_by AND EXISTS(SELECT FROM jsonb_array_elements(i.rows) r WHERE r->>'reference'=NEW.reference AND r->>'hash'=NEW.brief_hash AND r->'brief'=mi.brief AND r->>'status' IN ('READY','DUPLICATE_FILE'))) THEN RAISE EXCEPTION 'Participant must match its confirmed intake row' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_request_close' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-request:'||NEW.request_id::text,0));
  IF NEW.status='COMPLETED' AND NOT EXISTS(SELECT FROM app.delivery_response WHERE tenant_id=NEW.tenant_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'A response is required before completion' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_import' THEN
  IF NEW.expires_at>now()+interval '1 day' OR NEW.expires_at<=now() OR EXISTS(SELECT FROM jsonb_array_elements(NEW.rows) r WHERE r->>'status' IS NULL OR r->>'status' NOT IN ('READY','DUPLICATE_FILE','DUPLICATE_EXISTING','EMPTY','ERROR') OR jsonb_typeof(r->'row')<>'number' OR jsonb_typeof(r->'errors')<>'array') THEN RAISE EXCEPTION 'Invalid bounded preview' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='delivery_acceptance' THEN
  IF NOT NEW.result ?& ARRAY['programmeId','importId','counts','rows'] OR jsonb_typeof(NEW.result->'rows')<>'array' THEN RAISE EXCEPTION 'Complete acceptance result required' USING ERRCODE='23514'; END IF;
  SELECT * INTO batch FROM app.delivery_import WHERE tenant_id=NEW.tenant_id AND id=NEW.import_id;
  IF batch.id IS NULL OR batch.created_by<>NEW.created_by OR batch.expires_at<=now() OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) OR EXISTS(SELECT FROM jsonb_array_elements(batch.rows) r WHERE r->>'status'='ERROR') OR jsonb_array_length(NEW.result->'rows')<>jsonb_array_length(batch.rows) OR EXISTS(SELECT FROM jsonb_array_elements(batch.rows) r WHERE r->>'status'<>'EMPTY' AND NOT EXISTS(SELECT FROM app.delivery_participant p JOIN app.mission_intake i ON i.tenant_id=p.tenant_id AND i.id=p.mission_id WHERE p.tenant_id=NEW.tenant_id AND p.programme_id=batch.programme_id AND p.reference=r->>'reference' AND p.brief_hash=r->>'hash' AND i.brief=r->'brief')) THEN RAISE EXCEPTION 'A complete, owned, error-free intake is required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); a uuid:=app.actor_id(); record jsonb:=to_jsonb(NEW); v integer:=1; aggregate text; operation text; customer_execution jsonb;
BEGIN
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
END $$;

CREATE FUNCTION customer_private.programme_actor(command uuid,target uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.lock_workspace_access(command,target);
BEGIN
 IF NOT EXISTS(SELECT FROM customer.collaborative_workspaces() WHERE id=target AND role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Programme administration access denied' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;
CREATE FUNCTION customer.create_programme(command uuid,target uuid,programme_name text,why text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.programme_actor(command,target);prior customer_private.programme_creation;
 programme app.delivery_programme;executor uuid;nonce text;proof text:=current_setting('corridra.customer_proof_hash',true);expiry timestamptz;
 payload jsonb:=jsonb_build_object('workspaceId',target,'name',programme_name,'reportingPurpose',why);
BEGIN
 IF programme_name IS NULL OR why IS NULL OR length(programme_name) NOT BETWEEN 3 AND 160 OR length(why) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Programme name and reporting purpose required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM customer_private.programme_creation WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Programme command conflicts' USING ERRCODE='23514'; END IF;
  SELECT * INTO programme FROM app.delivery_programme WHERE id=prior.programme_id AND tenant_id=prior.workspace_id;
 ELSE
  IF (SELECT count(*) FROM customer_private.programme_creation WHERE workspace_id=target)>=100 THEN
   RAISE EXCEPTION 'Programme workspace limit reached' USING ERRCODE='23514'; END IF;
  SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
  WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL FOR SHARE OF p;
  IF executor IS NULL THEN RAISE EXCEPTION 'Programme execution unavailable' USING ERRCODE='42501'; END IF;
  SELECT expires_at INTO expiry FROM customer_private.session_proof WHERE hash=proof AND expires_at>clock_timestamp();
  IF expiry IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer proof expired' USING ERRCODE='42501'; END IF;
  programme.id:=gen_random_uuid();programme.tenant_id:=target;programme.name:=programme_name;
  programme.reporting_purpose:=why;programme.created_by:=executor;programme.created_at:=now();
  nonce:=encode(sha256(convert_to(gen_random_uuid()::text||proof,'UTF8')),'hex');
  INSERT INTO customer_private.programme_execution_grant(nonce_hash,proof_hash,principal_id,workspace_id,executor_id,relation_oid,record_digest,backend_pid,transaction_id,command_id,expires_at)
  VALUES(nonce,proof,actor,target,executor,'app.delivery_programme'::regclass,encode(sha256(convert_to(to_jsonb(programme)::text,'UTF8')),'hex'),pg_backend_pid(),txid_current(),command,expiry);
  PERFORM set_config('corridra.customer_programme_execution',nonce,true),set_config('corridra.correlation_id',command::text,true),set_config('corridra.causation_id',command::text,true);
  INSERT INTO app.delivery_programme(id,tenant_id,name,reporting_purpose,created_by,created_at)
  VALUES(programme.id,programme.tenant_id,programme.name,programme.reporting_purpose,programme.created_by,programme.created_at);
  DELETE FROM customer_private.programme_execution_grant WHERE nonce_hash=nonce;
  PERFORM set_config('corridra.customer_programme_execution','',true);
  INSERT INTO customer_private.programme_creation(programme_id,workspace_id,principal_id,command_id,input)
  VALUES(programme.id,target,actor,command,payload);
 END IF;
 IF programme.id IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',programme.id,'workspaceId',programme.tenant_id,'name',programme.name,
 'reportingPurpose',programme.reporting_purpose,'createdAt',programme.created_at,'synthetic',true);
END $$;
CREATE FUNCTION customer.programmes(target uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.programme_actor(gen_random_uuid(),target);items jsonb;next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'workspaceId',p.tenant_id,'name',p.name,'reportingPurpose',p.reporting_purpose,'createdAt',p.created_at,'synthetic',true) ORDER BY p.id),'[]'::jsonb) INTO items
 FROM (SELECT d.* FROM app.delivery_programme d JOIN customer_private.programme_creation c ON c.workspace_id=d.tenant_id AND c.programme_id=d.id
 WHERE d.tenant_id=target AND (after_id IS NULL OR d.id>after_id) ORDER BY d.id LIMIT page_size) p;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_creation WHERE workspace_id=target AND programme_id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmes',items,'workspaceId',target,'nextAfter',next_id,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_actor(uuid,uuid),customer.create_programme(uuid,uuid,text,text),customer.programmes(uuid,uuid,integer) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.create_programme(uuid,uuid,text,text),customer.programmes(uuid,uuid,integer) TO corridra_runtime;
