-- Reuse the canonical meeting transitions, acceptance, attendance and owned follow-up.
ALTER TABLE app.meeting ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE app.meeting ADD COLUMN target_id uuid, ADD COLUMN activity_kind text NOT NULL DEFAULT 'BUYER_MEETING' CHECK(activity_kind IN ('BUYER_MEETING','SUPPLIER_MEETING','FACTORY_VISIT','SHOWROOM_VISIT','TECHNICAL_EVALUATION','INSTITUTIONAL_MEETING','TRADE_FAIR_MEETING')), ADD COLUMN activity_context jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(activity_context)='object' AND length(activity_context::text)<=4000), ADD FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id), ADD CHECK((message_id IS NULL)<>(target_id IS NULL));
CREATE FUNCTION app.meeting_parent_access(target uuid,message uuid,account uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN message IS NOT NULL THEN app.communication_access(target,message,writing) ELSE app.research_target_access(target,account,writing) END
$$;
CREATE OR REPLACE FUNCTION app.meeting_access(target uuid,mid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.meeting m WHERE m.tenant_id=target AND m.id=mid AND app.meeting_parent_access(target,m.message_id,m.target_id,writing))
$$;
REVOKE ALL ON FUNCTION app.meeting_parent_access(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.meeting_parent_access(uuid,uuid,uuid,boolean) TO corridra_runtime;
ALTER POLICY meeting_read ON app.meeting USING(app.can_access(tenant_id,classification,purpose) AND app.meeting_parent_access(tenant_id,message_id,target_id));
ALTER POLICY meeting_insert ON app.meeting WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator') AND created_by=app.actor_id() AND app.meeting_parent_access(tenant_id,message_id,target_id,true));
ALTER POLICY meeting_update ON app.meeting USING(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator') AND app.meeting_parent_access(tenant_id,message_id,target_id,true)) WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.meeting_parent_access(tenant_id,message_id,target_id,true));
CREATE OR REPLACE FUNCTION app.guard_meeting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.message_id IS NOT NULL THEN
 IF NOT EXISTS(SELECT FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.message_id AND t.mission_id=NEW.mission_id AND (m.status IN ('TARGETING','OUTREACH','MEETINGS','FOLLOW_UP') OR (TG_OP='UPDATE' AND NEW.status IN ('CANCELLED','DECLINED')))) THEN RAISE EXCEPTION 'Active introduction mission required'; END IF;
 ELSE
  IF NOT EXISTS(SELECT FROM app.target_account t JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND m.id=NEW.mission_id AND (m.status IN ('ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE') OR (TG_OP='UPDATE' AND NEW.status IN ('CANCELLED','DECLINED'))) AND app.research_target_access(NEW.tenant_id,t.id,true)) THEN RAISE EXCEPTION 'Accessible active activity target required'; END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active meeting owner required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PROPOSED' OR NEW.version<>1 OR NEW.acceptance IS NOT NULL OR NEW.response_id IS NOT NULL OR NEW.starts_at IS NOT NULL THEN RAISE EXCEPTION 'Propose a meeting first'; END IF;
 ELSE
  IF (NEW.id,NEW.tenant_id,NEW.message_id,NEW.target_id,NEW.activity_kind,NEW.activity_context,NEW.mission_id,NEW.title,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.message_id,OLD.target_id,OLD.activity_kind,OLD.activity_context,OLD.mission_id,OLD.title,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Meeting identity/version mismatch'; END IF;
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
