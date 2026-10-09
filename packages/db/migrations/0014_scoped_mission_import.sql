-- Protected, tenant-scoped ingress. The canonical mission module owns this command.
CREATE TABLE app.mission_ingress_command (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES identity.principal(id),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),mission_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
ALTER TABLE app.mission_ingress_command ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.mission_ingress_command FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation'));
GRANT SELECT ON app.mission_ingress_command TO corridra_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.mission_ingress_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE FUNCTION app.import_mission_brief(t uuid,k uuid,o uuid,b jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid:=app.actor_id();h text;old app.mission_ingress_command;mid uuid:=gen_random_uuid();
BEGIN
 IF a IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL','synthetic_validation'),false) OR coalesce(app.member_role(t),'') NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND synthetic) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF k IS NULL OR o IS NULL OR NOT EXISTS(SELECT FROM app.mission_owners(t) WHERE user_id=o) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF b IS NULL OR jsonb_typeof(b)<>'object' OR NOT (b ?& ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','name','company','email','acknowledged']) OR length(b::text)>16000 OR b->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR EXISTS(SELECT FROM jsonb_each(b) v WHERE v.key=ANY(ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','notes','name','company','email']) AND jsonb_typeof(v.value)<>'string') OR jsonb_typeof(b->'outcomes')<>'array' THEN RAISE EXCEPTION 'Invalid intake structure' USING ERRCODE='23514'; END IF;
 IF length(b->>'offer') NOT BETWEEN 10 AND 2000 OR length(b->>'market') NOT BETWEEN 2 AND 120 OR length(b->>'name') NOT BETWEEN 2 AND 120 OR length(b->>'company') NOT BETWEEN 2 AND 160 OR length(b->>'email')>254 OR b->>'email' !~ '^[^[:space:]@]+@example[.]invalid$' OR length(b->>'notes')>1000 OR length(b->>'website')>2000 OR (b->>'website'<>'' AND b->>'website' !~ '^https?://[^[:space:]]+$') OR b->>'attendance' NOT IN ('Yes','No','Not decided') OR b->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else') OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=b->>'timezone') OR jsonb_array_length(b->'outcomes') NOT BETWEEN 1 AND 7 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(b->'outcomes'))<>jsonb_array_length(b->'outcomes') OR EXISTS(SELECT FROM jsonb_array_elements(b->'outcomes') o WHERE jsonb_typeof(o.value)<>'string' OR o.value#>>'{}' NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) THEN RAISE EXCEPTION 'Invalid intake values' USING ERRCODE='23514'; END IF;
 IF b->>'attendance'='Yes' THEN
  IF b->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR b->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' OR (b->>'endDate')::date<(b->>'startDate')::date OR to_char((b->>'startDate')::date,'YYYY-MM-DD')<>b->>'startDate' OR to_char((b->>'endDate')::date,'YYYY-MM-DD')<>b->>'endDate' THEN RAISE EXCEPTION 'Invalid visit window' USING ERRCODE='23514'; END IF;
 ELSIF b->>'startDate'<>'' OR b->>'endDate'<>'' THEN RAISE EXCEPTION 'Unexpected visit dates' USING ERRCODE='23514'; END IF;
 h:=encode(sha256(convert_to(jsonb_build_object('brief',b,'ownerId',o)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(k::text,0));
 SELECT * INTO old FROM app.mission_ingress_command WHERE id=k;
 IF old.id IS NOT NULL THEN
  IF old.tenant_id<>t OR old.actor_id<>a OR old.input_hash<>h THEN RAISE EXCEPTION 'Import command reused' USING ERRCODE='23514'; END IF;
  RETURN old.mission_id;
 END IF;
 INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES(mid,t,o,'Review programme participant brief',now()+interval '1 day','Explicitly confirmed synthetic programme intake',a);
 INSERT INTO app.mission_intake(id,tenant_id,request_key,payload_hash,receipt_hash,brief,notice_version) VALUES(mid,t,k,h,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),b,'synthetic-intake-2026-10-05-v1');
 INSERT INTO app.mission_objective(tenant_id,mission_id,objective,outcomes) VALUES(t,mid,b->>'objective',b->'outcomes');
 INSERT INTO app.mission_participant(tenant_id,mission_id,name,company,email) VALUES(t,mid,b->>'name',b->>'company',b->>'email');
 INSERT INTO app.mission_market(tenant_id,mission_id,original_text) VALUES(t,mid,b->>'market');
 INSERT INTO app.mission_window(tenant_id,mission_id,attendance,start_date,end_date,timezone) VALUES(t,mid,b->>'attendance',NULLIF(b->>'startDate','')::date,NULLIF(b->>'endDate','')::date,b->>'timezone');
 INSERT INTO app.commercial_intent(tenant_id,mission_id,original_text) VALUES(t,mid,b->>'offer');
 INSERT INTO app.mission_ingress_command(id,tenant_id,actor_id,input_hash,mission_id) VALUES(k,t,a,h,mid);
 RETURN mid;
END $$;
REVOKE ALL ON FUNCTION app.import_mission_brief(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.import_mission_brief(uuid,uuid,uuid,jsonb) TO corridra_runtime;
