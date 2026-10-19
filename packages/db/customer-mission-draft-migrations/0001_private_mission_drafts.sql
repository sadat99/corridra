-- Optional private customer mission drafts. The request factory and app.mission are untouched.
CREATE TABLE customer_private.mission_draft (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE customer_private.mission_draft_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES customer_private.mission_draft(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(draft_id,version),UNIQUE(draft_id,id)
);
CREATE TABLE customer_private.mission_draft_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 draft_id uuid NOT NULL REFERENCES customer_private.mission_draft(id),
 revision_id uuid NOT NULL UNIQUE,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id),
 FOREIGN KEY(draft_id,revision_id) REFERENCES customer_private.mission_draft_revision(draft_id,id)
);
CREATE TABLE customer_private.mission_draft_close (
 draft_id uuid PRIMARY KEY REFERENCES customer_private.mission_draft(id),
 outcome text NOT NULL CHECK(outcome IN ('SUBMITTED','DISCARDED')),
 request_id uuid REFERENCES customer_private.owned_request(id),
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((outcome='SUBMITTED')=(request_id IS NOT NULL)),UNIQUE(actor_id,command_id)
);
CREATE TRIGGER mission_draft_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_draft FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER mission_draft_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_draft_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER mission_draft_command_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_draft_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER mission_draft_close_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_draft_close FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.mission_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.mission_draft_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.mission_draft_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.mission_draft_close ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.mission_draft,customer_private.mission_draft_revision,customer_private.mission_draft_command,customer_private.mission_draft_close FROM PUBLIC,corridra_runtime,corridra_auth;

-- Whole-document validation. Free text is synthetic-only; completeness is judged later by the request schema.
CREATE FUNCTION customer_private.mission_draft_valid(d jsonb,target uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE keys text[]:=ARRAY['title','family','objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','requirements','contactName','contactEmail','profileVersion','sourcingContext','companyName'];
 outs text[];labels text[];item jsonb;
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR d-keys<>'{}'::jsonb OR NOT(d ?& keys) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'title')<>'string' OR d->>'title'<>btrim(d->>'title') OR length(d->>'title') NOT BETWEEN 11 AND 120 OR d->>'title' NOT LIKE 'Synthetic %' OR d->>'title' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'family')<>'string' OR d->>'family' NOT IN ('BUYERS_PARTNERS','SUPPLIERS_PRODUCTS','DELEGATION','OTHER') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'objective') NOT IN ('string','null') OR (jsonb_typeof(d->'objective')='string' AND d->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else')) THEN RETURN false; END IF;
 -- The objective must belong to the chosen product family; "Something else" and a business trip fit any family.
 IF jsonb_typeof(d->'objective')='string' AND d->>'objective' NOT IN ('Something else','Make an upcoming business trip more productive') AND NOT(
  (d->>'family'='BUYERS_PARTNERS' AND d->>'objective' IN ('Sell in a new market','Find customers or distributors'))
  OR (d->>'family'='SUPPLIERS_PRODUCTS' AND d->>'objective'='Source suppliers')
  OR (d->>'family'='DELEGATION' AND d->>'objective'='Run a multi-company mission')) THEN RETURN false; END IF;
 -- Sourcing context applies to Product 2 only, so a buyer or delegation draft never carries machinery detail.
 IF jsonb_typeof(d->'sourcingContext') NOT IN ('string','null') OR (jsonb_typeof(d->'sourcingContext')='string' AND (d->>'family'<>'SUPPLIERS_PRODUCTS' OR d->>'sourcingContext' NOT IN ('MACHINERY','FINISHED_PRODUCTS','MATERIALS_COMPONENTS','OEM_CUSTOM','OTHER_PROCUREMENT'))) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'companyName')<>'string' OR d->>'companyName'<>btrim(d->>'companyName') OR length(d->>'companyName')>160 OR d->>'companyName' ~ '[[:cntrl:]]' OR (d->>'companyName'<>'' AND (length(d->>'companyName')<11 OR d->>'companyName' NOT LIKE 'Synthetic %')) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'market')<>'string' OR length(d->>'market')>120 OR d->>'market'<>btrim(d->>'market') OR d->>'market' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'attendance')<>'string' OR d->>'attendance' NOT IN ('Yes','No','Not decided') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'startDate')<>'string' OR jsonb_typeof(d->'endDate')<>'string' THEN RETURN false; END IF;
 BEGIN
  IF d->>'startDate'<>'' AND (d->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((d->>'startDate')::date,'YYYY-MM-DD')<>d->>'startDate') THEN RETURN false; END IF;
  IF d->>'endDate'<>'' AND (d->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((d->>'endDate')::date,'YYYY-MM-DD')<>d->>'endDate') THEN RETURN false; END IF;
 EXCEPTION WHEN others THEN RETURN false;
 END;
 IF d->>'startDate'<>'' AND d->>'endDate'<>'' AND d->>'endDate'<d->>'startDate' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'timezone')<>'string' OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=d->>'timezone') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'offer')<>'string' OR length(d->>'offer')>2000 OR d->>'offer'<>btrim(d->>'offer') OR d->>'offer' ~ '[[:cntrl:]]' OR (d->>'offer'<>'' AND (length(d->>'offer')<11 OR d->>'offer' NOT LIKE 'Synthetic %')) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'notes')<>'string' OR length(d->>'notes')>1000 OR d->>'notes'<>btrim(d->>'notes') OR d->>'notes' ~ '[[:cntrl:]]' OR (d->>'notes'<>'' AND (length(d->>'notes')<11 OR d->>'notes' NOT LIKE 'Synthetic %')) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'website')<>'string' OR (d->>'website'<>'' AND (length(d->>'website')>200 OR d->>'website' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$')) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'outcomes')<>'array' OR jsonb_array_length(d->'outcomes')>7 OR EXISTS(SELECT FROM jsonb_array_elements(d->'outcomes') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
 SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO outs FROM jsonb_array_elements_text(d->'outcomes');
 IF EXISTS(SELECT FROM unnest(outs) o WHERE o NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) OR (SELECT count(DISTINCT o) FROM unnest(outs) o)<>cardinality(outs) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'requirements')<>'array' OR jsonb_array_length(d->'requirements')>20 THEN RETURN false; END IF;
 labels:=ARRAY[]::text[];
 FOR item IN SELECT value FROM jsonb_array_elements(d->'requirements') LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['label','value']<>'{}'::jsonb OR NOT(item ?& ARRAY['label','value']) OR jsonb_typeof(item->'label')<>'string' OR jsonb_typeof(item->'value')<>'string' THEN RETURN false; END IF;
  IF item->>'label'<>btrim(item->>'label') OR length(item->>'label') NOT BETWEEN 2 AND 60 OR item->>'label' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  IF item->>'value'<>btrim(item->>'value') OR length(item->>'value') NOT BETWEEN 11 AND 300 OR item->>'value' NOT LIKE 'Synthetic %' OR item->>'value' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  labels:=labels||lower(item->>'label');
 END LOOP;
 IF (SELECT count(DISTINCT l) FROM unnest(labels) l)<>cardinality(labels) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'contactName')<>'string' OR d->>'contactName'<>btrim(d->>'contactName') OR length(d->>'contactName')>120 OR d->>'contactName' ~ '[[:cntrl:]]' OR (d->>'contactName'<>'' AND length(d->>'contactName')<2) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'contactEmail')<>'string' OR (d->>'contactEmail'<>'' AND (length(d->>'contactEmail')>254 OR d->>'contactEmail' !~ '^[a-z0-9._+-]+@example\.invalid$')) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'profileVersion') NOT IN ('number','null') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'profileVersion')='number' THEN
  IF d->>'profileVersion' !~ '^[1-9][0-9]{0,8}$' OR NOT EXISTS(SELECT FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=target AND r.version=(d->>'profileVersion')::integer) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION customer_private.mission_draft_expiry() RETURNS timestamptz
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)))
$$;

-- Active workspace member who is also an admitted request author. Returns the actor.
CREATE FUNCTION customer_private.mission_draft_actor(target uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();
BEGIN
 IF target IS NULL OR customer_private.organisation_profile_role(target,actor) IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION customer_private.mission_draft_event(target uuid,actor uuid,command uuid,kind text,draft uuid,revision_version integer,detail jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_mission_draft' AND e.aggregate_id=draft::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,kind,1,'customer_mission_draft',draft::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('draftId',draft,'version',revision_version,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE FUNCTION customer_private.mission_draft_result(target uuid,draft uuid,command uuid,revision uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE head customer_private.mission_draft_revision;rev customer_private.mission_draft_revision;cl customer_private.mission_draft_close;
BEGIN
 SELECT * INTO head FROM customer_private.mission_draft_revision WHERE draft_id=draft ORDER BY version DESC LIMIT 1;
 IF revision IS NULL THEN rev:=head; ELSE SELECT * INTO rev FROM customer_private.mission_draft_revision WHERE draft_id=draft AND id=revision; END IF;
 SELECT * INTO cl FROM customer_private.mission_draft_close WHERE draft_id=draft;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.mission_draft_expiry(),'commandId',command,
 'currentVersion',head.version,'superseded',rev.version<>head.version,
 'draft',jsonb_build_object('id',draft,'version',rev.version,'status',coalesce(cl.outcome,'OPEN'),'requestId',cl.request_id,'updatedAt',rev.created_at,'details',rev.details));
END $$;

CREATE FUNCTION customer.mission_draft_save(command uuid,target uuid,draft uuid,expected integer,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.mission_draft_command;head integer;d customer_private.mission_draft;rev customer_private.mission_draft_revision;payload jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR (draft IS NULL AND expected<>0) OR (draft IS NOT NULL AND expected<1)
  OR NOT customer_private.mission_draft_valid(input,target) THEN RAISE EXCEPTION 'Invalid mission draft' USING ERRCODE='23514'; END IF;
 payload:=jsonb_build_object('workspaceId',target,'draftId',draft,'expectedVersion',expected,'details',input);
 actor:=customer_private.mission_draft_actor(target);
 actor:=customer_private.lock_workspace_access(command,target);
 IF customer_private.mission_draft_actor(target) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.mission_draft_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN customer_private.mission_draft_result(target,prior.draft_id,command,prior.revision_id)||jsonb_build_object('replayed',true);
 END IF;
 IF draft IS NULL THEN
  INSERT INTO customer_private.mission_draft(tenant_id,principal_id) VALUES(target,actor) RETURNING * INTO d;
  head:=0;
 ELSE
  SELECT * INTO d FROM customer_private.mission_draft WHERE id=draft AND tenant_id=target AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_draft:'||d.id::text,0));
  IF EXISTS(SELECT FROM customer_private.mission_draft_close WHERE draft_id=d.id) THEN RAISE EXCEPTION 'Draft is closed' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(version),0) INTO head FROM customer_private.mission_draft_revision WHERE draft_id=d.id;
  IF expected<>head THEN RAISE EXCEPTION 'Draft changed; reload before saving' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO customer_private.mission_draft_revision(draft_id,version,details) VALUES(d.id,head+1,input) RETURNING * INTO rev;
 INSERT INTO customer_private.mission_draft_command(actor_id,command_id,draft_id,revision_id,request) VALUES(actor,command,d.id,rev.id,payload);
 PERFORM customer_private.mission_draft_event(target,actor,command,'customer.mission_draft.saved',d.id,rev.version,jsonb_build_object('revisionId',rev.id));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Draft access expired' USING ERRCODE='42501'; END IF;
 RETURN customer_private.mission_draft_result(target,d.id,command)||jsonb_build_object('replayed',false);
END $$;

CREATE FUNCTION customer.mission_draft_close(command uuid,target uuid,draft uuid,outcome text,request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;d customer_private.mission_draft;cl customer_private.mission_draft_close;head integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR draft IS NULL OR outcome IS NULL OR outcome NOT IN ('SUBMITTED','DISCARDED') OR (outcome='SUBMITTED')<>(request IS NOT NULL) THEN RAISE EXCEPTION 'Invalid draft close' USING ERRCODE='23514'; END IF;
 actor:=customer_private.mission_draft_actor(target);
 actor:=customer_private.lock_workspace_access(command,target);
 IF customer_private.mission_draft_actor(target) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM customer_private.mission_draft WHERE id=draft AND tenant_id=target AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_draft:'||d.id::text,0));
 SELECT * INTO cl FROM customer_private.mission_draft_close WHERE draft_id=d.id;
 IF FOUND THEN
  IF cl.outcome IS DISTINCT FROM outcome OR cl.request_id IS DISTINCT FROM request OR cl.command_id IS DISTINCT FROM command THEN RAISE EXCEPTION 'Draft is already closed' USING ERRCODE='23514'; END IF;
  RETURN customer_private.mission_draft_result(target,d.id,command)||jsonb_build_object('replayed',true);
 END IF;
 IF outcome='SUBMITTED' AND NOT EXISTS(SELECT FROM customer_private.owned_request o WHERE o.id=request AND o.principal_id=actor AND o.workspace_id=target
  AND NOT EXISTS(SELECT FROM customer_private.request_revocation r WHERE r.request_id=o.id)
  AND NOT EXISTS(SELECT FROM customer_private.mission_draft_close c WHERE c.request_id=o.id)) THEN RAISE EXCEPTION 'Own current request required' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.mission_draft_close(draft_id,outcome,request_id,actor_id,command_id) VALUES(d.id,outcome,request,actor,command);
 SELECT max(version) INTO head FROM customer_private.mission_draft_revision WHERE draft_id=d.id;
 PERFORM customer_private.mission_draft_event(target,actor,command,'customer.mission_draft.closed',d.id,head,jsonb_build_object('outcome',outcome));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Draft access expired' USING ERRCODE='42501'; END IF;
 RETURN customer_private.mission_draft_result(target,d.id,command)||jsonb_build_object('replayed',false);
END $$;

CREATE FUNCTION customer.mission_draft_view(target uuid,draft uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;d customer_private.mission_draft;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.mission_draft_actor(target);
 SELECT * INTO d FROM customer_private.mission_draft WHERE id=draft AND tenant_id=target AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_draft:'||d.id::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.mission_draft_actor(target) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Draft access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.mission_draft_result(target,d.id,NULL);
 RETURN result-'commandId';
END $$;

CREATE FUNCTION customer.mission_draft_list(target uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;items jsonb;next_after uuid;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.mission_draft_actor(target);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 WITH page AS(SELECT d.* FROM customer_private.mission_draft d WHERE d.tenant_id=target AND d.principal_id=actor AND (after_id IS NULL OR d.id>after_id) ORDER BY d.id LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY id LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',r.version,'title',r.details->'title','family',r.details->'family','status',coalesce(c.outcome,'OPEN'),'requestId',c.request_id,'updatedAt',r.created_at) ORDER BY v.id)
 FROM visible v JOIN LATERAL(SELECT * FROM customer_private.mission_draft_revision x WHERE x.draft_id=v.id ORDER BY x.version DESC LIMIT 1) r ON true
 LEFT JOIN customer_private.mission_draft_close c ON c.draft_id=v.id),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END INTO items,next_after;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Draft access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.mission_draft_expiry(),'drafts',items,'nextAfter',next_after);
END $$;

REVOKE ALL ON FUNCTION customer_private.mission_draft_valid(jsonb,uuid),customer_private.mission_draft_expiry(),customer_private.mission_draft_actor(uuid),customer_private.mission_draft_event(uuid,uuid,uuid,text,uuid,integer,jsonb),customer_private.mission_draft_result(uuid,uuid,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.mission_draft_save(uuid,uuid,uuid,integer,jsonb),customer.mission_draft_close(uuid,uuid,uuid,text,uuid),customer.mission_draft_view(uuid,uuid),customer.mission_draft_list(uuid,uuid,integer) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.mission_draft_save(uuid,uuid,uuid,integer,jsonb),customer.mission_draft_close(uuid,uuid,uuid,text,uuid),customer.mission_draft_view(uuid,uuid),customer.mission_draft_list(uuid,uuid,integer) TO corridra_runtime;
