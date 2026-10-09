CREATE TABLE app.meeting (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, message_id uuid NOT NULL, mission_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160), status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','ACCEPTED','SCHEDULED','HELD','DECLINED','CANCELLED','NO_SHOW','RESCHEDULE_REQUIRED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), owner_id uuid NOT NULL REFERENCES identity.principal(id), next_action text NOT NULL CHECK(length(next_action) BETWEEN 3 AND 300), due_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500), acceptance text, response_id uuid,
 starts_at timestamptz, ends_at timestamptz, timezone text, local_start text, local_end text, location text,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,response_id) REFERENCES app.buyer_response(tenant_id,id),
 CHECK((starts_at IS NULL AND ends_at IS NULL AND timezone IS NULL AND local_start IS NULL AND local_end IS NULL AND location IS NULL) OR (starts_at IS NOT NULL AND ends_at>starts_at AND ends_at<=starts_at+interval '8 hours' AND timezone IS NOT NULL AND local_start IS NOT NULL AND local_end IS NOT NULL AND length(location) BETWEEN 3 AND 500))
);
CREATE TABLE app.meeting_participant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,meeting_id) REFERENCES app.meeting(tenant_id,id)
);
CREATE TABLE app.meeting_brief (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 3 AND 2000),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,meeting_id), FOREIGN KEY(tenant_id,meeting_id) REFERENCES app.meeting(tenant_id,id)
);
CREATE TABLE app.meeting_outcome (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('HELD','NO_SHOW')), summary text NOT NULL CHECK(length(summary) BETWEEN 3 AND 2000),
 observed_at timestamptz NOT NULL DEFAULT now() CHECK(observed_at<=now()),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,meeting_id) REFERENCES app.meeting(tenant_id,id)
);
CREATE TABLE app.follow_up (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, outcome_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES identity.principal(id),
 next_action text NOT NULL CHECK(length(next_action) BETWEEN 3 AND 300), due_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','CANCELLED')), version integer NOT NULL DEFAULT 1 CHECK(version>0), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,meeting_id), FOREIGN KEY(tenant_id,meeting_id) REFERENCES app.meeting(tenant_id,id), FOREIGN KEY(tenant_id,outcome_id) REFERENCES app.meeting_outcome(tenant_id,id)
);
CREATE TABLE app.meeting_command (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, action text NOT NULL, input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), details jsonb NOT NULL, result jsonb NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,meeting_id) REFERENCES app.meeting(tenant_id,id)
);
CREATE FUNCTION app.meeting_access(target uuid,mid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.meeting m WHERE m.tenant_id=target AND m.id=mid AND app.communication_access(target,m.message_id,writing))
$$;
CREATE FUNCTION app.guard_meeting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.message_id AND t.mission_id=NEW.mission_id AND (m.status IN ('TARGETING','OUTREACH','MEETINGS','FOLLOW_UP') OR (TG_OP='UPDATE' AND NEW.status IN ('CANCELLED','DECLINED')))) THEN RAISE EXCEPTION 'Active introduction mission required'; END IF;
 IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active meeting owner required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PROPOSED' OR NEW.version<>1 OR NEW.acceptance IS NOT NULL OR NEW.response_id IS NOT NULL OR NEW.starts_at IS NOT NULL THEN RAISE EXCEPTION 'Propose a meeting first'; END IF;
 ELSE
  IF (NEW.id,NEW.tenant_id,NEW.message_id,NEW.mission_id,NEW.title,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.message_id,OLD.mission_id,OLD.title,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Meeting identity/version mismatch'; END IF;
  IF NOT ((OLD.status='PROPOSED' AND NEW.status IN ('ACCEPTED','DECLINED','CANCELLED')) OR (OLD.status='ACCEPTED' AND NEW.status IN ('SCHEDULED','DECLINED','CANCELLED')) OR (OLD.status='SCHEDULED' AND NEW.status IN ('HELD','CANCELLED','NO_SHOW','RESCHEDULE_REQUIRED')) OR (OLD.status='RESCHEDULE_REQUIRED' AND NEW.status IN ('SCHEDULED','DECLINED','CANCELLED')) OR (OLD.status='NO_SHOW' AND NEW.status='RESCHEDULE_REQUIRED')) THEN RAISE EXCEPTION 'Invalid meeting transition'; END IF;
  IF NOT EXISTS(SELECT FROM app.meeting_brief WHERE tenant_id=NEW.tenant_id AND meeting_id=NEW.id) OR (SELECT count(*) FROM app.meeting_participant WHERE tenant_id=NEW.tenant_id AND meeting_id=NEW.id)<2 THEN RAISE EXCEPTION 'Brief and participants required'; END IF;
  IF NEW.status='ACCEPTED' THEN
   IF length(coalesce(NEW.acceptance,'')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Acceptance source required'; END IF;
   IF NEW.response_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.buyer_response br JOIN app.buyer_link l ON l.tenant_id=br.tenant_id AND l.id=br.link_id WHERE br.tenant_id=NEW.tenant_id AND br.id=NEW.response_id AND br.status='INTERESTED' AND NOT br.opt_out AND l.message_id=NEW.message_id) THEN RAISE EXCEPTION 'Interested response from this introduction required'; END IF;
  ELSIF (NEW.acceptance,NEW.response_id) IS DISTINCT FROM (OLD.acceptance,OLD.response_id) THEN RAISE EXCEPTION 'Acceptance is immutable'; END IF;
  IF NEW.status<>'SCHEDULED' AND (NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.local_start,NEW.local_end,NEW.location) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.local_start,OLD.local_end,OLD.location) THEN RAISE EXCEPTION 'Change schedule only after acceptance or reschedule request'; END IF;
 END IF;
 IF NEW.status IN ('SCHEDULED','HELD','NO_SHOW') AND (NEW.starts_at IS NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=NEW.timezone) OR to_char(NEW.starts_at AT TIME ZONE NEW.timezone,'YYYY-MM-DD"T"HH24:MI')<>NEW.local_start OR to_char(NEW.ends_at AT TIME ZONE NEW.timezone,'YYYY-MM-DD"T"HH24:MI')<>NEW.local_end OR date_trunc('minute',NEW.starts_at)<>NEW.starts_at OR date_trunc('minute',NEW.ends_at)<>NEW.ends_at) THEN RAISE EXCEPTION 'Valid timezone-aware schedule required'; END IF;
 IF NEW.status IN ('HELD','NO_SHOW') AND NEW.starts_at>now() THEN RAISE EXCEPTION 'A future meeting has no observed outcome'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE FUNCTION app.guard_meeting_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='meeting_outcome' THEN
  IF NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND id=NEW.meeting_id AND status=NEW.status AND starts_at<=NEW.observed_at) THEN RAISE EXCEPTION 'Observed meeting outcome required'; END IF;
 ELSIF TG_TABLE_NAME='follow_up' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.status<>'OPEN' OR NEW.version<>1 OR NEW.due_at<=now() OR NOT EXISTS(SELECT FROM app.meeting_outcome WHERE tenant_id=NEW.tenant_id AND id=NEW.outcome_id AND meeting_id=NEW.meeting_id AND status='HELD') OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Held outcome and active follow-up owner required'; END IF;
  ELSE
   IF (NEW.id,NEW.tenant_id,NEW.meeting_id,NEW.outcome_id,NEW.owner_id,NEW.next_action,NEW.due_at,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.meeting_id,OLD.outcome_id,OLD.owner_id,OLD.next_action,OLD.due_at,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 OR OLD.status<>'OPEN' OR NEW.status NOT IN ('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'Invalid follow-up transition'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('meeting_brief','meeting_participant') THEN
  IF NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND id=NEW.meeting_id AND status='PROPOSED' AND version=1) THEN RAISE EXCEPTION 'Initial proposed meeting required'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Deferred guards make the held outcome + follow-up an atomic contract even for raw SQL.
CREATE FUNCTION app.check_held_meeting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='HELD' AND (NOT EXISTS(SELECT FROM app.meeting_outcome WHERE tenant_id=NEW.tenant_id AND meeting_id=NEW.id AND status='HELD') OR NOT EXISTS(SELECT FROM app.follow_up WHERE tenant_id=NEW.tenant_id AND meeting_id=NEW.id)) THEN RAISE EXCEPTION 'Held outcome and follow-up must commit together'; END IF;
 IF NEW.status='NO_SHOW' AND NOT EXISTS(SELECT FROM app.meeting_outcome WHERE tenant_id=NEW.tenant_id AND meeting_id=NEW.id AND status='NO_SHOW') THEN RAISE EXCEPTION 'No-show outcome required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER held_meeting_complete AFTER INSERT OR UPDATE ON app.meeting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_held_meeting();
DO $$
DECLARE tbl text; extra text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['meeting','meeting_participant','meeting_brief','meeting_outcome','follow_up','meeting_command'] LOOP
  extra:=CASE WHEN tbl='meeting' THEN 'app.communication_access(tenant_id,message_id)' ELSE 'app.meeting_access(tenant_id,meeting_id)' END;
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND %s)',tbl||'_read',tbl,extra);
  extra:=CASE WHEN tbl='meeting' THEN 'app.communication_access(tenant_id,message_id,true)' ELSE 'app.meeting_access(tenant_id,meeting_id,true)' END;
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'') AND created_by=app.actor_id() AND %s)',tbl||'_insert',tbl,extra);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',tbl);
  IF tbl IN ('meeting','follow_up') THEN
   EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'') AND %s) WITH CHECK(app.can_access(tenant_id,classification,purpose) AND %s)',tbl||'_update',tbl,extra,extra);
   EXECUTE format('GRANT UPDATE ON app.%I TO corridra_runtime',tbl);
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl||'_event',tbl);
  ELSE
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',tbl||'_immutable',tbl);
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl||'_event',tbl);
  END IF;
  IF tbl='meeting' THEN
   EXECUTE 'CREATE TRIGGER meeting_guard BEFORE INSERT OR UPDATE ON app.meeting FOR EACH ROW EXECUTE FUNCTION app.guard_meeting()';
  ELSIF tbl IN ('meeting_outcome','follow_up','meeting_brief','meeting_participant') THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_meeting_record()',tbl||'_guard',tbl);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.meeting_access(uuid,uuid,boolean),app.guard_meeting(),app.guard_meeting_record(),app.check_held_meeting() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.meeting_access(uuid,uuid,boolean) TO corridra_runtime;
CREATE INDEX meeting_mission_idx ON app.meeting(tenant_id,mission_id,starts_at,id);
CREATE INDEX meeting_participant_meeting_idx ON app.meeting_participant(tenant_id,meeting_id);
CREATE INDEX meeting_outcome_meeting_idx ON app.meeting_outcome(tenant_id,meeting_id);
CREATE INDEX follow_up_due_idx ON app.follow_up(tenant_id,due_at) WHERE status='OPEN';

-- Extend the implemented mission paths; Part 07 commercial states remain reserved.
CREATE OR REPLACE FUNCTION app.guard_mission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='app.mission'::regclass),'MEMBER') OR NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Ingress required' USING ERRCODE='42501'; END IF;
 ELSE
  IF app.actor_id() IS NULL OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.tenant_id,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Mission identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='QUALIFICATION') OR (OLD.status='QUALIFICATION' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status='TARGETING') OR (OLD.status='TARGETING' AND NEW.status='OUTREACH') OR (OLD.status='OUTREACH' AND NEW.status='MEETINGS') OR (OLD.status='MEETINGS' AND NEW.status='FOLLOW_UP') OR (OLD.status IN ('QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP') AND NEW.status='ON_HOLD' AND NEW.held_from=OLD.status) OR (OLD.status='ON_HOLD' AND NEW.status=OLD.held_from AND NEW.held_from IS NULL) OR (OLD.status IN ('DRAFT','QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','ON_HOLD') AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'Invalid mission transition' USING ERRCODE='23514'; END IF;
  IF NEW.status=OLD.status AND NEW.held_from IS DISTINCT FROM OLD.held_from THEN RAISE EXCEPTION 'Hold state mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'ON_HOLD' AND NEW.held_from IS NOT NULL THEN RAISE EXCEPTION 'Unexpected hold state' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP') AND (NOT EXISTS(SELECT FROM app.commercial_intent WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND claim_id IS NOT NULL) OR NOT EXISTS(SELECT FROM app.target_profile WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR NOT EXISTS(SELECT FROM app.mission_market WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND country_code IS NOT NULL)) THEN RAISE EXCEPTION 'Qualification records required' USING ERRCODE='23514'; END IF;
 IF NEW.status='OUTREACH' AND OLD.status='TARGETING' AND NOT EXISTS(SELECT FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id WHERE c.tenant_id=NEW.tenant_id AND t.mission_id=NEW.id) THEN RAISE EXCEPTION 'Approved introduction required'; END IF;
 IF NEW.status='MEETINGS' AND OLD.status='OUTREACH' AND NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status IN ('ACCEPTED','SCHEDULED','HELD')) THEN RAISE EXCEPTION 'Accepted meeting required'; END IF;
 IF NEW.status='FOLLOW_UP' AND OLD.status='MEETINGS' AND NOT EXISTS(SELECT FROM app.meeting m JOIN app.follow_up f ON f.tenant_id=m.tenant_id AND f.meeting_id=m.id WHERE m.tenant_id=NEW.tenant_id AND m.mission_id=NEW.id AND m.status='HELD') THEN RAISE EXCEPTION 'Held meeting and owned follow-up required'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
