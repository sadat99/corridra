-- Public ingress is a fixed-purpose, fixed-destination capability. Runtime cannot
-- read configuration, select an actor, create memberships or insert mission rows.
CREATE TABLE app.intake_destination (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 service_id uuid NOT NULL REFERENCES identity.principal(id), owner_id uuid NOT NULL REFERENCES identity.principal(id),
 enabled boolean NOT NULL DEFAULT false, notice_version text NOT NULL CHECK(notice_version='synthetic-intake-2026-10-05-v1')
);
REVOKE ALL ON app.intake_destination FROM PUBLIC,corridra_runtime,corridra_auth;
ALTER TABLE app.intake_destination ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app.record_intake_destination() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO identity.security_event(identity_id,action) VALUES(NEW.service_id::text,'intake.destination.'||lower(TG_OP)); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.record_intake_destination() FROM PUBLIC;
CREATE TRIGGER intake_destination_audit AFTER INSERT OR UPDATE ON app.intake_destination FOR EACH ROW EXECUTE FUNCTION app.record_intake_destination();
CREATE TABLE app.mission (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE','CLOSED','CANCELLED','ON_HOLD')),
 held_from text, version integer NOT NULL DEFAULT 1 CHECK(version>0), owner_id uuid NOT NULL REFERENCES identity.principal(id),
 next_action text NOT NULL CHECK(length(next_action) BETWEEN 3 AND 300), due_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500), created_by uuid NOT NULL REFERENCES identity.principal(id),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE app.mission_intake (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, request_key uuid NOT NULL UNIQUE,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'), receipt_hash text NOT NULL UNIQUE CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
 brief jsonb NOT NULL CHECK(jsonb_typeof(brief)='object' AND length(brief::text)<16000 AND brief->>'email' LIKE '%@example.invalid'),
 notice_version text NOT NULL CHECK(notice_version='synthetic-intake-2026-10-05-v1'), acknowledged_at timestamptz NOT NULL DEFAULT now(),
 source_kind text NOT NULL DEFAULT 'self_declaration' CHECK(source_kind='self_declaration'), claim_status text NOT NULL DEFAULT 'self_declared' CHECK(claim_status='self_declared'),
 retention_until timestamptz NOT NULL DEFAULT now()+interval '30 days', created_at timestamptz NOT NULL DEFAULT now(),
 classification text NOT NULL DEFAULT 'INTERNAL', purpose text NOT NULL DEFAULT 'synthetic_validation',
 FOREIGN KEY(tenant_id,id) REFERENCES app.mission(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE INDEX intake_deduplication ON app.mission_intake(payload_hash,created_at);
CREATE TABLE app.mission_objective (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL, objective text NOT NULL,outcomes jsonb NOT NULL,
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), UNIQUE(tenant_id,mission_id)
);
CREATE TABLE app.mission_participant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL, name text NOT NULL,company text NOT NULL,email text NOT NULL,
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), UNIQUE(tenant_id,mission_id)
);
CREATE TABLE app.mission_market (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL, original_text text NOT NULL,country_code text CHECK(country_code IN ('BD','ES','DE','OTHER')),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), UNIQUE(tenant_id,mission_id)
);
CREATE TABLE app.mission_window (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL,attendance text NOT NULL CHECK(attendance IN ('Yes','No','Not decided')),
 start_date date,end_date date,timezone text NOT NULL,CHECK((attendance='Yes' AND start_date IS NOT NULL AND end_date>=start_date) OR (attendance<>'Yes' AND start_date IS NULL AND end_date IS NULL)),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), UNIQUE(tenant_id,mission_id)
);
CREATE TABLE app.commercial_intent (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL,original_text text NOT NULL,claim_id uuid,
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id), UNIQUE(tenant_id,mission_id)
);
CREATE TABLE app.target_profile (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mission_id uuid NOT NULL,description text NOT NULL,version integer NOT NULL CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),UNIQUE(tenant_id,mission_id,version)
);
CREATE TABLE app.mission_command (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,input_hash text NOT NULL,details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),reason text NOT NULL,action text NOT NULL,actor_id uuid NOT NULL,
 resulting_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE TABLE app.mission_reply (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 3 AND 2000),created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(),classification text NOT NULL DEFAULT 'INTERNAL',purpose text NOT NULL DEFAULT 'synthetic_validation',
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE TABLE app.intake_rate_limit (key text PRIMARY KEY, window_start timestamptz NOT NULL,count integer NOT NULL);
REVOKE ALL ON app.intake_rate_limit FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION app.mission_owners(t uuid) RETURNS TABLE(user_id uuid,role text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.user_id,m.role,u.name FROM app.membership m JOIN identity.principal p ON p.id=m.user_id JOIN identity."user" u ON u.id=p.identity_id
 WHERE m.tenant_id=t AND app.can_access(t,'INTERNAL','synthetic_validation') AND m.role IN ('owner','admin','operator') AND m.revoked_at IS NULL AND p.disabled_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.mission_owners(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mission_owners(uuid) TO corridra_runtime;
CREATE FUNCTION app.intake_budget(k text,maximum integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF k !~ '^[a-f0-9]{64}$' OR maximum NOT IN (6,60) THEN RAISE EXCEPTION 'Invalid budget'; END IF;
 INSERT INTO app.intake_rate_limit VALUES(k,date_trunc('hour',now()),1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN app.intake_rate_limit.window_start<date_trunc('hour',now()) THEN 1 ELSE app.intake_rate_limit.count+1 END,window_start=date_trunc('hour',now()) RETURNING count INTO n;
 RETURN n<=maximum;
END $$;
CREATE FUNCTION app.guard_mission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='app.mission'::regclass),'MEMBER') OR NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Ingress required' USING ERRCODE='42501'; END IF;
 ELSE
  IF app.actor_id() IS NULL OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.tenant_id,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Mission identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='QUALIFICATION') OR (OLD.status='QUALIFICATION' AND NEW.status='ACTIVE') OR (OLD.status IN ('QUALIFICATION','ACTIVE') AND NEW.status='ON_HOLD' AND NEW.held_from=OLD.status) OR (OLD.status='ON_HOLD' AND NEW.status=OLD.held_from AND NEW.held_from IS NULL) OR (OLD.status IN ('DRAFT','QUALIFICATION','ACTIVE','ON_HOLD') AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'Invalid mission transition' USING ERRCODE='23514'; END IF;
  IF NEW.status=OLD.status AND NEW.held_from IS DISTINCT FROM OLD.held_from THEN RAISE EXCEPTION 'Hold state mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'ON_HOLD' AND NEW.held_from IS NOT NULL THEN RAISE EXCEPTION 'Unexpected hold state' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('QUALIFICATION','ACTIVE') AND (NOT EXISTS(SELECT FROM app.commercial_intent WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND claim_id IS NOT NULL) OR NOT EXISTS(SELECT FROM app.target_profile WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR NOT EXISTS(SELECT FROM app.mission_market WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND country_code IS NOT NULL)) THEN RAISE EXCEPTION 'Qualification records required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE FUNCTION app.record_mission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid:=app.actor_id();eid uuid:=gen_random_uuid();
BEGIN
 IF TG_OP='INSERT' THEN a:=NEW.created_by; END IF;
 IF a IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,'mission.'||lower(TG_OP),1,'mission',NEW.id::text,NEW.version,a,now(),current_setting('corridra.correlation_id')::uuid,current_setting('corridra.causation_id')::uuid,jsonb_build_object('id',NEW.id,'status',NEW.status,'version',NEW.version));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,'mission.'||lower(TG_OP));
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;
CREATE TRIGGER mission_guard BEFORE INSERT OR UPDATE ON app.mission FOR EACH ROW EXECUTE FUNCTION app.guard_mission();
CREATE TRIGGER mission_event AFTER INSERT OR UPDATE ON app.mission FOR EACH ROW EXECUTE FUNCTION app.record_mission();
CREATE FUNCTION app.submit_mission(k uuid,h text,r text,b jsonb,n text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.intake_destination;old app.mission_intake;mid uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO d FROM app.intake_destination WHERE singleton AND enabled;
 IF d.tenant_id IS NULL OR NOT EXISTS(SELECT FROM app.tenant WHERE id=d.tenant_id AND synthetic) OR NOT EXISTS(SELECT FROM identity.principal WHERE id=d.service_id AND kind='service' AND disabled_at IS NULL) THEN RAISE EXCEPTION 'Intake unavailable' USING ERRCODE='42501'; END IF;
 IF h IS NULL OR r IS NULL OR n IS NULL OR b IS NULL OR h !~ '^[a-f0-9]{64}$' OR r !~ '^[a-f0-9]{64}$' OR n<>d.notice_version OR NOT (b ?& ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','name','company','email','acknowledged']) OR b->>'acknowledged'<>'true' OR b->>'email' NOT LIKE '%@example.invalid' OR length(b::text)>16000 OR length(b->>'offer') NOT BETWEEN 10 AND 2000 OR length(b->>'market') NOT BETWEEN 2 AND 120 OR length(b->>'name') NOT BETWEEN 2 AND 120 OR length(b->>'company') NOT BETWEEN 2 AND 160 OR length(b->>'email')>254 OR length(b->>'notes')>1000 OR (b->>'website'<>'' AND b->>'website' !~ '^https?://') OR jsonb_typeof(b->'outcomes')<>'array' THEN RAISE EXCEPTION 'Invalid intake' USING ERRCODE='23514'; END IF;
 IF b->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR EXISTS(SELECT FROM jsonb_each(b) v WHERE v.key=ANY(ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','notes','name','company','email']) AND jsonb_typeof(v.value)<>'string') OR jsonb_array_length(b->'outcomes') NOT BETWEEN 1 AND 7 OR EXISTS(SELECT FROM jsonb_array_elements_text(b->'outcomes') o WHERE o.value NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) OR b->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else') OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=b->>'timezone') THEN RAISE EXCEPTION 'Invalid intake structure' USING ERRCODE='23514'; END IF;
 -- Serialize duplicate detection across instances and different retry keys.
 PERFORM pg_advisory_xact_lock(hashtext('corridra:intake'));
 SELECT * INTO old FROM app.mission_intake WHERE request_key=k;
 IF old.id IS NOT NULL THEN
  IF old.payload_hash<>h OR old.receipt_hash<>r THEN RAISE EXCEPTION 'Retry key reused' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('id',old.id,'duplicate',true);
 END IF;
 IF EXISTS(SELECT FROM app.mission_intake WHERE payload_hash=h AND created_at>now()-interval '24 hours') THEN RETURN jsonb_build_object('duplicate',true); END IF;
 PERFORM set_config('corridra.correlation_id',gen_random_uuid()::text,true),set_config('corridra.causation_id',k::text,true);
 INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES(mid,d.tenant_id,d.owner_id,'Review submitted brief',now()+interval '1 day','Public test intake received',d.service_id);
 INSERT INTO app.mission_intake(id,tenant_id,request_key,payload_hash,receipt_hash,brief,notice_version) VALUES(mid,d.tenant_id,k,h,r,b,n);
 INSERT INTO app.mission_objective(tenant_id,mission_id,objective,outcomes) VALUES(d.tenant_id,mid,b->>'objective',b->'outcomes');
 INSERT INTO app.mission_participant(tenant_id,mission_id,name,company,email) VALUES(d.tenant_id,mid,b->>'name',b->>'company',b->>'email');
 INSERT INTO app.mission_market(tenant_id,mission_id,original_text) VALUES(d.tenant_id,mid,b->>'market');
 INSERT INTO app.mission_window(tenant_id,mission_id,attendance,start_date,end_date,timezone) VALUES(d.tenant_id,mid,b->>'attendance',NULLIF(b->>'startDate','')::date,NULLIF(b->>'endDate','')::date,b->>'timezone');
 INSERT INTO app.commercial_intent(tenant_id,mission_id,original_text) VALUES(d.tenant_id,mid,b->>'offer');
 RETURN jsonb_build_object('id',mid,'duplicate',false);
END $$;
CREATE FUNCTION app.mission_receipt(r text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('status',m.status,'receivedAt',i.created_at,'replies',COALESCE((SELECT jsonb_agg(jsonb_build_object('body',p.body,'createdAt',p.created_at) ORDER BY p.created_at) FROM app.mission_reply p WHERE p.tenant_id=i.tenant_id AND p.mission_id=i.id),'[]'::jsonb))
 FROM app.mission_intake i JOIN app.mission m ON m.tenant_id=i.tenant_id AND m.id=i.id WHERE i.receipt_hash=r AND i.retention_until>now()
$$;
REVOKE ALL ON FUNCTION app.intake_budget(text,integer),app.guard_mission(),app.record_mission(),app.submit_mission(uuid,text,text,jsonb,text),app.mission_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.intake_budget(text,integer),app.submit_mission(uuid,text,text,jsonb,text),app.mission_receipt(text) TO corridra_runtime;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['mission','mission_intake','mission_objective','mission_participant','mission_market','mission_window','commercial_intent','target_profile','mission_command','mission_reply'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation''))',t);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['mission','mission_market','commercial_intent'] LOOP
  EXECUTE format('CREATE POLICY modify ON app.%I FOR UPDATE TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'')) WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation''))',t);
  EXECUTE format('GRANT UPDATE ON app.%I TO corridra_runtime',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['target_profile','mission_command','mission_reply'] LOOP
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('GRANT INSERT ON app.%I TO corridra_runtime',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['mission_intake','mission_objective','mission_participant','mission_window','mission_command','mission_reply','target_profile'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
 END LOOP;
END $$;
CREATE TRIGGER mission_reply_event AFTER INSERT ON app.mission_reply FOR EACH ROW EXECUTE FUNCTION app.record_change();
CREATE FUNCTION app.guard_mission_child() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.tenant_id,NEW.mission_id) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.mission_id) THEN RAISE EXCEPTION 'Immutable identity' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='mission_market' THEN IF NEW.original_text<>OLD.original_text THEN RAISE EXCEPTION 'Original market is immutable' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='commercial_intent' THEN IF NEW.original_text<>OLD.original_text OR OLD.claim_id IS NOT NULL THEN RAISE EXCEPTION 'Original intent is immutable' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='mission_reply' THEN IF NEW.created_by<>app.actor_id() THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501'; END IF; END IF;
 IF TG_TABLE_NAME='mission_command' THEN IF NEW.actor_id<>app.actor_id() THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501'; END IF; END IF;
 IF TG_TABLE_NAME='target_profile' THEN IF NEW.version<>(SELECT version+1 FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Target profile version mismatch' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_mission_child() FROM PUBLIC;
CREATE TRIGGER guard BEFORE UPDATE ON app.mission_market FOR EACH ROW EXECUTE FUNCTION app.guard_mission_child();
CREATE TRIGGER guard BEFORE UPDATE ON app.commercial_intent FOR EACH ROW EXECUTE FUNCTION app.guard_mission_child();
CREATE TRIGGER guard BEFORE INSERT ON app.mission_reply FOR EACH ROW EXECUTE FUNCTION app.guard_mission_child();
CREATE TRIGGER guard BEFORE INSERT ON app.mission_command FOR EACH ROW EXECUTE FUNCTION app.guard_mission_child();
CREATE TRIGGER guard BEFORE INSERT ON app.target_profile FOR EACH ROW EXECUTE FUNCTION app.guard_mission_child();
CREATE INDEX mission_queue ON app.mission(tenant_id,status,due_at);
