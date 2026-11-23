-- B11a (owner decision 23 Nov 2026). The owner of new real requests can be changed without touching the one
-- immutable row customer_private.real_use_configuration: a new owner is appended here and the newest row wins.
-- With no row the configuration owner is used, exactly as before. Installing this file alone changes no owner.
-- Additive only: no existing row, request, membership, user or account is changed or removed by this file.
-- Existing requests keep the owner recorded on them. The sample intake (app.intake_destination) is not read differently.
DO $pre$ BEGIN
 IF to_regclass('customer_private.real_use_configuration') IS NULL
 THEN RAISE EXCEPTION 'Install the real-use schema (customer-real-use-migrations) before the real intake owner module'; END IF;
END $pre$;
CREATE TABLE customer_private.real_intake_owner_version (
 id integer PRIMARY KEY CHECK(id>0),
 owner_id uuid NOT NULL REFERENCES identity.principal(id),
 set_by uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.real_intake_owner_version ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.real_intake_owner_version FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER real_intake_owner_version_immutable BEFORE UPDATE OR DELETE ON customer_private.real_intake_owner_version
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- One change to app.submit_mission, real branch only: the owner comes from the newest version row when one exists, and that
-- owner must be an active owner or admin of the real intake workspace with the real processing purpose, or real intake is
-- refused. The sample branch (ELSE) and everything after it are the installed text, unchanged.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.submit_mission(uuid,text,text,jsonb,text)'::regprocedure),'UTF8')),'hex')<>'b389b936999303645506ebd88a66e2df4b39c2007409a02e3af20c65161d0810' THEN RAISE EXCEPTION 'Real intake owner prerequisite function differs: app.submit_mission';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.submit_mission(k uuid, h text, r text, b jsonb, n text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d app.intake_destination;old app.mission_intake;mid uuid:=gen_random_uuid();
BEGIN
 IF n='real-intake-2026-10-21-v1' THEN
  IF NOT customer_private.real_admission_open() OR NOT customer_private.real_session() OR NOT EXISTS(SELECT FROM customer_private.request_attestation a WHERE a.proof_hash=current_setting('corridra.customer_proof_hash',true) AND a.request_key=k AND a.payload_hash=h AND a.receipt_hash=r AND a.notice_version=n AND a.brief_digest=encode(sha256(convert_to(b::text,'UTF8')),'hex') AND NOT app.tenant_is_synthetic(a.workspace_id)) THEN RAISE EXCEPTION 'Verified private request attestation required' USING ERRCODE='42501';END IF;
  SELECT true,c.intake_tenant_id,c.executor_id,coalesce((SELECT o.owner_id FROM customer_private.real_intake_owner_version o ORDER BY o.id DESC LIMIT 1),c.owner_id),c.enabled,c.notice_version INTO d FROM customer_private.real_use_configuration c WHERE c.enabled;
  IF NOT app.real_use_allowed(d.tenant_id) OR NOT customer_private.real_brief_valid(b) THEN RAISE EXCEPTION 'Real intake unavailable or invalid' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT FROM app.membership m JOIN identity.principal p ON p.id=m.user_id WHERE m.tenant_id=d.tenant_id AND m.user_id=d.owner_id AND m.revoked_at IS NULL AND m.role IN ('owner','admin') AND 'commercial_qualification'=ANY(m.allowed_purposes) AND p.disabled_at IS NULL) THEN RAISE EXCEPTION 'Real intake unavailable' USING ERRCODE='42501';END IF;
  PERFORM set_config('corridra.purpose','commercial_qualification',true);
 ELSE
  SELECT * INTO d FROM app.intake_destination WHERE singleton AND enabled;
 END IF;
 IF d.tenant_id IS NULL OR NOT EXISTS(SELECT FROM app.tenant WHERE id=d.tenant_id AND (synthetic OR (n='real-intake-2026-10-21-v1' AND app.real_use_allowed(d.tenant_id)))) OR NOT EXISTS(SELECT FROM identity.principal WHERE id=d.service_id AND kind='service' AND disabled_at IS NULL) THEN RAISE EXCEPTION 'Intake unavailable' USING ERRCODE='42501'; END IF;
 IF h IS NULL OR r IS NULL OR n IS NULL OR b IS NULL OR h !~ '^[a-f0-9]{64}$' OR r !~ '^[a-f0-9]{64}$' OR n<>d.notice_version OR NOT (b ?& ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','name','company','email','acknowledged']) OR b->>'acknowledged'<>'true' OR (b->>'email' NOT LIKE '%@example.invalid' AND n<>'real-intake-2026-10-21-v1') OR length(b::text)>16000 OR length(b->>'offer') NOT BETWEEN 10 AND 2000 OR length(b->>'market') NOT BETWEEN 2 AND 120 OR length(b->>'name') NOT BETWEEN 2 AND 120 OR length(b->>'company') NOT BETWEEN 2 AND 160 OR length(b->>'email')>254 OR length(b->>'notes')>1000 OR (b->>'website'<>'' AND b->>'website' !~ '^https?://') OR jsonb_typeof(b->'outcomes')<>'array' THEN RAISE EXCEPTION 'Invalid intake' USING ERRCODE='23514'; END IF;
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
 INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES(mid,d.tenant_id,d.owner_id,'Review submitted brief',now()+interval '1 day',CASE WHEN n='real-intake-2026-10-21-v1' THEN 'Private customer request received' ELSE 'Public test intake received' END,d.service_id);
 INSERT INTO app.mission_intake(id,tenant_id,request_key,payload_hash,receipt_hash,brief,notice_version) VALUES(mid,d.tenant_id,k,h,r,b,n);
 INSERT INTO app.mission_objective(tenant_id,mission_id,objective,outcomes) VALUES(d.tenant_id,mid,b->>'objective',b->'outcomes');
 INSERT INTO app.mission_participant(tenant_id,mission_id,name,company,email) VALUES(d.tenant_id,mid,b->>'name',b->>'company',b->>'email');
 INSERT INTO app.mission_market(tenant_id,mission_id,original_text) VALUES(d.tenant_id,mid,b->>'market');
 INSERT INTO app.mission_window(tenant_id,mission_id,attendance,start_date,end_date,timezone) VALUES(d.tenant_id,mid,b->>'attendance',NULLIF(b->>'startDate','')::date,NULLIF(b->>'endDate','')::date,b->>'timezone');
 INSERT INTO app.commercial_intent(tenant_id,mission_id,original_text) VALUES(d.tenant_id,mid,b->>'offer');
 RETURN jsonb_build_object('id',mid,'duplicate',false);
END $function$
;
