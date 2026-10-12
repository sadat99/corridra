CREATE TABLE app.commercial_origin (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,target_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('QUALIFIED_SOURCING_REQUIREMENT','DOCUMENTED_RFQ','SUPPLIER_RESPONSE','ACCEPTED_INTRODUCTION')),
 source_id uuid NOT NULL,claim_id uuid NOT NULL,message_id uuid,summary text NOT NULL CHECK(length(summary) BETWEEN 3 AND 1000),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id),FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id),CHECK((kind='ACCEPTED_INTRODUCTION')=(message_id IS NOT NULL))
);
CREATE FUNCTION app.guard_commercial_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT coalesce(app.commercial_enabled(NEW.tenant_id) AND app.research_target_access(NEW.tenant_id,NEW.target_id,true) AND app.member_role(NEW.tenant_id) IN ('owner','admin','operator') AND NEW.created_by=app.actor_id(),false) THEN RAISE EXCEPTION 'Commercial origin authority required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.target_account t JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND t.mission_id=NEW.mission_id AND m.status IN ('ACTIVE','TARGETING','FOLLOW_UP','COMMERCIAL_PIPELINE')) OR NOT EXISTS(SELECT FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.claim_id AND s.id=NEW.source_id AND s.retention_until>now() AND s.observed_at<=now() AND s.ai_policy='DENY' AND s.classification IN ('PUBLIC','INTERNAL') AND app.can_access(s.tenant_id,s.classification,s.purpose) AND app.can_access(c.tenant_id,c.classification,c.purpose)) THEN RAISE EXCEPTION 'Accessible matching target, claim and current source required'; END IF;
 IF NEW.kind='ACCEPTED_INTRODUCTION' AND NOT EXISTS(SELECT FROM app.communication c JOIN app.buyer_link l ON l.tenant_id=c.tenant_id AND l.message_id=c.id JOIN app.buyer_response r ON r.tenant_id=l.tenant_id AND r.link_id=l.id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.message_id AND c.target_id=NEW.target_id AND r.status='INTERESTED' AND NOT r.opt_out) THEN RAISE EXCEPTION 'Accepted matching introduction required'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE app.commercial_origin ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.commercial_origin FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.research_target_access(tenant_id,target_id));
CREATE POLICY add ON app.commercial_origin FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.research_target_access(tenant_id,target_id,true));
GRANT SELECT,INSERT ON app.commercial_origin TO corridra_runtime;
CREATE TRIGGER guard BEFORE INSERT ON app.commercial_origin FOR EACH ROW EXECUTE FUNCTION app.guard_commercial_origin();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.commercial_origin FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER event AFTER INSERT ON app.commercial_origin FOR EACH ROW EXECUTE FUNCTION app.record_change();
REVOKE ALL ON FUNCTION app.guard_commercial_origin() FROM PUBLIC;
ALTER TABLE app.opportunity ALTER COLUMN meeting_id DROP NOT NULL;
ALTER TABLE app.opportunity ADD COLUMN origin_id uuid;
ALTER TABLE app.opportunity ADD FOREIGN KEY(tenant_id,origin_id) REFERENCES app.commercial_origin(tenant_id,id),ADD CHECK((meeting_id IS NULL)<>(origin_id IS NULL));
CREATE OR REPLACE FUNCTION app.opportunity_access(t uuid,oid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.opportunity o WHERE o.tenant_id=t AND o.id=oid AND app.can_access(t,o.classification,o.purpose) AND ((o.meeting_id IS NOT NULL AND app.meeting_access(t,o.meeting_id,writing)) OR (o.origin_id IS NOT NULL AND app.research_target_access(t,o.target_id,writing))))
$$;
DROP POLICY read ON app.opportunity;
CREATE POLICY read ON app.opportunity FOR SELECT TO corridra_runtime USING(tenant_id=(SELECT NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) AND (SELECT app.can_access(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid,'INTERNAL','synthetic_validation')) AND ((meeting_id IS NOT NULL AND app.meeting_access(tenant_id,meeting_id)) OR (origin_id IS NOT NULL AND app.research_target_access(tenant_id,target_id))));
DROP POLICY add ON app.opportunity;
CREATE POLICY add ON app.opportunity FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.commercial_enabled(tenant_id) AND app.member_role(tenant_id) IN ('owner','admin','operator') AND created_by=app.actor_id() AND ((meeting_id IS NOT NULL AND app.meeting_access(tenant_id,meeting_id,true)) OR (origin_id IS NOT NULL AND app.research_target_access(tenant_id,target_id,true))));
CREATE OR REPLACE FUNCTION app.guard_opportunity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE required_kind text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial',0));
 IF NOT app.commercial_enabled(NEW.tenant_id) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') OR NOT (CASE WHEN NEW.meeting_id IS NOT NULL THEN app.meeting_access(NEW.tenant_id,NEW.meeting_id,true) ELSE app.research_target_access(NEW.tenant_id,NEW.target_id,true) END) THEN RAISE EXCEPTION 'Commercial commands are unavailable' USING ERRCODE='42501'; END IF;
 IF NEW.meeting_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.meeting mt JOIN app.communication c ON c.tenant_id=mt.tenant_id AND c.id=mt.message_id JOIN app.mission m ON m.tenant_id=mt.tenant_id AND m.id=mt.mission_id WHERE mt.tenant_id=NEW.tenant_id AND mt.id=NEW.meeting_id AND mt.status='HELD' AND mt.mission_id=NEW.mission_id AND c.target_id=NEW.target_id AND m.status IN ('FOLLOW_UP','COMMERCIAL_PIPELINE')) THEN RAISE EXCEPTION 'Held meeting and active commercial mission required' USING ERRCODE='23514'; END IF;
 IF NEW.origin_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.commercial_origin o JOIN app.mission m ON m.tenant_id=o.tenant_id AND m.id=o.mission_id WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.origin_id AND o.mission_id=NEW.mission_id AND o.target_id=NEW.target_id AND m.status IN ('ACTIVE','TARGETING','FOLLOW_UP','COMMERCIAL_PIPELINE')) THEN RAISE EXCEPTION 'Matching commercial origin required'; END IF;
 IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active opportunity owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'LEAD' OR NEW.version<>1 OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Create a lead first' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.tenant_id,NEW.origin_id,NEW.meeting_id,NEW.mission_id,NEW.target_id,NEW.title,NEW.attribution,NEW.attribution_scope,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.origin_id,OLD.meeting_id,OLD.mission_id,OLD.target_id,OLD.title,OLD.attribution,OLD.attribution_scope,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Opportunity identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF OLD.status='LOST' OR NOT coalesce((NEW.status=OLD.status OR (app.commercial_stage(NEW.status)=app.commercial_stage(OLD.status)+1) OR (NEW.status='LOST' AND app.commercial_stage(OLD.status)<=6)),false) THEN RAISE EXCEPTION 'Invalid opportunity transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='LOST' AND coalesce((SELECT sum(r.amount_minor) FROM app.commercial_record r JOIN app.accounting_confirmation a ON a.tenant_id=r.tenant_id AND a.record_id=r.id WHERE r.tenant_id=NEW.tenant_id AND r.opportunity_id=NEW.id),0)>0 THEN RAISE EXCEPTION 'Confirmed cash must be compensated before loss' USING ERRCODE='23514'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   required_kind:=CASE NEW.status WHEN 'PROPOSAL' THEN 'PROPOSAL' WHEN 'COMMITMENT' THEN 'COMMITMENT' WHEN 'CONTRACT' THEN 'CONTRACT' WHEN 'INVOICE' THEN 'INVOICE' WHEN 'CASH_COLLECTED' THEN 'CASH_RECEIPT' WHEN 'RECURRING_REVENUE' THEN 'REPEAT_ORDER' END;
   IF required_kind IS NOT NULL AND NOT EXISTS(SELECT FROM app.commercial_record r WHERE r.tenant_id=NEW.tenant_id AND r.opportunity_id=NEW.id AND r.kind=required_kind AND r.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=r.tenant_id AND rv.reverse_of=r.id) AND (r.kind<>'CASH_RECEIPT' OR EXISTS(SELECT FROM app.accounting_confirmation ac WHERE ac.tenant_id=r.tenant_id AND ac.record_id=r.id))) THEN RAISE EXCEPTION 'Commercial evidence or confirmed cash required' USING ERRCODE='23514'; END IF;
   IF NEW.status='RECURRING_REVENUE' AND NOT EXISTS(SELECT FROM app.commercial_record rr JOIN app.commercial_record cash ON cash.tenant_id=rr.tenant_id AND cash.id=rr.parent_id JOIN app.commercial_record prior ON prior.tenant_id=rr.tenant_id AND prior.id=rr.prior_receipt_id WHERE rr.tenant_id=NEW.tenant_id AND rr.opportunity_id=NEW.id AND rr.kind='REPEAT_ORDER' AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=rr.tenant_id AND rv.reverse_of IN(cash.id,prior.id))) THEN RAISE EXCEPTION 'Unreversed repeat cash required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.guard_commercial_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o app.opportunity; src app.source_record; p app.commercial_record; original app.commercial_record; prior app.commercial_record; minimum integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial',0));
 IF NOT app.commercial_enabled(NEW.tenant_id) OR NOT app.opportunity_access(NEW.tenant_id,NEW.opportunity_id,true) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND id=NEW.opportunity_id;
 SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND classification IN ('PUBLIC','INTERNAL') AND ai_policy='DENY' AND observed_at<=now() AND retention_until>now();
 IF src.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='CONTRACT' AND src.kind='self_declaration' THEN RAISE EXCEPTION 'Observed contract evidence required' USING ERRCODE='23514'; END IF;
 NEW.retention_until:=src.retention_until;
 IF NEW.evidence_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.evidence_object e JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id JOIN app.claim c ON c.tenant_id=e.tenant_id AND c.id=e.claim_id WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.evidence_id AND c.source_id=NEW.source_id AND e.retention_until>now() AND es.status IN ('UNDER_REVIEW','VERIFIED') AND (es.scan_status='CLEAN' OR (es.scan_status='BYPASSED' AND coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=e.tenant_id AND key='evidence.scan_bypass' AND effective_from<=now() ORDER BY version DESC LIMIT 1),false))) AND e.classification IN ('PUBLIC','INTERNAL') AND app.can_access(e.tenant_id,e.classification,e.purpose)) THEN RAISE EXCEPTION 'Available matching evidence required' USING ERRCODE='23514'; END IF;
 IF NEW.reverse_of IS NOT NULL THEN
  IF app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa() THEN RAISE EXCEPTION 'Accounting authority and fresh MFA required' USING ERRCODE='42501'; END IF;
  SELECT * INTO original FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of;
  IF original.id IS NULL OR original.reverse_of IS NOT NULL OR original.opportunity_id<>NEW.opportunity_id OR original.kind<>NEW.kind OR original.currency IS DISTINCT FROM NEW.currency OR NEW.amount_minor IS DISTINCT FROM -original.amount_minor OR NEW.parent_id IS DISTINCT FROM original.parent_id OR NEW.occurred_at<original.occurred_at OR NEW.prior_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Exact compensating record required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM app.commercial_record child WHERE child.tenant_id=NEW.tenant_id AND child.parent_id=original.id AND child.kind<>'REPEAT_ORDER' AND child.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=child.tenant_id AND rv.reverse_of=child.id AND (child.kind<>'CASH_RECEIPT' OR NOT EXISTS(SELECT FROM app.accounting_confirmation ac WHERE ac.tenant_id=child.tenant_id AND ac.record_id=child.id) OR EXISTS(SELECT FROM app.accounting_confirmation ac WHERE ac.tenant_id=rv.tenant_id AND ac.record_id=rv.id)))) THEN RAISE EXCEPTION 'Compensate dependent records first' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=o.tenant_id AND id=o.mission_id AND (status IN ('FOLLOW_UP','COMMERCIAL_PIPELINE') OR (o.origin_id IS NOT NULL AND status IN ('ACTIVE','TARGETING')))) OR o.status='LOST' THEN RAISE EXCEPTION 'Active commercial opportunity required' USING ERRCODE='23514'; END IF;
 minimum:=CASE NEW.kind WHEN 'RFQ' THEN 2 WHEN 'SAMPLE' THEN 2 WHEN 'PROPOSAL' THEN 2 WHEN 'COMMITMENT' THEN 3 WHEN 'CONTRACT' THEN 4 WHEN 'INVOICE' THEN 5 WHEN 'CASH_RECEIPT' THEN 6 WHEN 'REPEAT_ORDER' THEN 7 END;
 IF app.commercial_stage(o.status)<minimum THEN RAISE EXCEPTION 'Progress the opportunity before recording this outcome' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('RFQ','SAMPLE','PROPOSAL') THEN
  IF NEW.parent_id IS NOT NULL OR NEW.prior_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected commercial parent' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id;
  IF p.id IS NULL OR p.opportunity_id<>NEW.opportunity_id OR p.reverse_of IS NOT NULL OR p.kind<>(CASE NEW.kind WHEN 'COMMITMENT' THEN 'PROPOSAL' WHEN 'CONTRACT' THEN 'COMMITMENT' WHEN 'INVOICE' THEN 'CONTRACT' WHEN 'CASH_RECEIPT' THEN 'INVOICE' WHEN 'REPEAT_ORDER' THEN 'CASH_RECEIPT' END) OR p.occurred_at>NEW.occurred_at OR EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=p.tenant_id AND reverse_of=p.id) THEN RAISE EXCEPTION 'Current matching parent required' USING ERRCODE='23514'; END IF;
  IF NEW.kind<>'REPEAT_ORDER' AND NEW.currency IS DISTINCT FROM p.currency THEN RAISE EXCEPTION 'Parent currency must match' USING ERRCODE='23514'; END IF;
  IF NEW.kind='INVOICE' AND NEW.amount_minor+coalesce((SELECT sum(amount_minor) FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND parent_id=p.id AND kind='INVOICE'),0)>p.amount_minor THEN RAISE EXCEPTION 'Invoices exceed contract amount' USING ERRCODE='23514'; END IF;
  IF NEW.kind='REPEAT_ORDER' THEN
   SELECT * INTO prior FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.prior_receipt_id;
   IF prior.id IS NULL OR prior.kind<>'CASH_RECEIPT' OR prior.reverse_of IS NOT NULL OR prior.opportunity_id<>NEW.opportunity_id OR prior.currency<>p.currency OR prior.occurred_at>=p.occurred_at OR prior.parent_id=p.parent_id OR EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=prior.tenant_id AND reverse_of=prior.id) OR NOT EXISTS(SELECT FROM app.accounting_confirmation WHERE tenant_id=p.tenant_id AND record_id=p.id) OR NOT EXISTS(SELECT FROM app.accounting_confirmation WHERE tenant_id=prior.tenant_id AND record_id=prior.id) OR EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=p.tenant_id AND kind='REPEAT_ORDER' AND parent_id=p.id) THEN RAISE EXCEPTION 'Distinct later confirmed cash required for recurrence' USING ERRCODE='23514'; END IF;
  ELSIF NEW.prior_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Prior receipt is only for recurrence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.guard_mission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='app.mission'::regclass),'MEMBER') OR NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Ingress required' USING ERRCODE='42501'; END IF;
 ELSE
  IF app.actor_id() IS NULL OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.tenant_id,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Mission identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='QUALIFICATION') OR (OLD.status='QUALIFICATION' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status='TARGETING') OR (OLD.status='TARGETING' AND NEW.status='OUTREACH') OR (OLD.status='OUTREACH' AND NEW.status='MEETINGS') OR (OLD.status='MEETINGS' AND NEW.status='FOLLOW_UP') OR (OLD.status IN ('ACTIVE','TARGETING','FOLLOW_UP') AND NEW.status='COMMERCIAL_PIPELINE') OR (OLD.status='COMMERCIAL_PIPELINE' AND NEW.status='CLOSED') OR (OLD.status IN ('QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE') AND NEW.status='ON_HOLD' AND NEW.held_from=OLD.status) OR (OLD.status='ON_HOLD' AND NEW.status=OLD.held_from AND NEW.held_from IS NULL) OR (OLD.status IN ('DRAFT','QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE','ON_HOLD') AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'Invalid mission transition' USING ERRCODE='23514'; END IF;
  IF NEW.status=OLD.status AND NEW.held_from IS DISTINCT FROM OLD.held_from THEN RAISE EXCEPTION 'Hold state mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'ON_HOLD' AND NEW.held_from IS NOT NULL THEN RAISE EXCEPTION 'Unexpected hold state' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE') AND (NOT EXISTS(SELECT FROM app.commercial_intent WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND claim_id IS NOT NULL) OR NOT EXISTS(SELECT FROM app.target_profile WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR NOT EXISTS(SELECT FROM app.mission_market WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND country_code IS NOT NULL)) THEN RAISE EXCEPTION 'Qualification records required' USING ERRCODE='23514'; END IF;
 IF NEW.status='OUTREACH' AND OLD.status='TARGETING' AND NOT EXISTS(SELECT FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id WHERE c.tenant_id=NEW.tenant_id AND t.mission_id=NEW.id) THEN RAISE EXCEPTION 'Approved introduction required'; END IF;
 IF NEW.status='MEETINGS' AND OLD.status='OUTREACH' AND NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status IN ('ACCEPTED','SCHEDULED','HELD')) THEN RAISE EXCEPTION 'Accepted meeting required'; END IF;
 IF NEW.status='FOLLOW_UP' AND OLD.status='MEETINGS' AND NOT EXISTS(SELECT FROM app.meeting m JOIN app.follow_up f ON f.tenant_id=m.tenant_id AND f.meeting_id=m.id WHERE m.tenant_id=NEW.tenant_id AND m.mission_id=NEW.id AND m.status='HELD') THEN RAISE EXCEPTION 'Held meeting and owned follow-up required'; END IF;
 IF ((NEW.status='COMMERCIAL_PIPELINE' AND OLD.status IN ('ACTIVE','TARGETING','FOLLOW_UP')) OR NEW.status='CLOSED') AND NOT app.commercial_enabled(NEW.tenant_id) THEN RAISE EXCEPTION 'Commercial commands are disabled' USING ERRCODE='23514'; END IF;
 IF NEW.status='COMMERCIAL_PIPELINE' AND OLD.status IN ('ACTIVE','TARGETING','FOLLOW_UP') AND NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status<>'LEAD') THEN RAISE EXCEPTION 'Qualified opportunity required' USING ERRCODE='23514'; END IF;
 IF NEW.status='CLOSED' AND (NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status NOT IN ('LOST','CASH_COLLECTED','RECURRING_REVENUE')) OR EXISTS(SELECT FROM app.commercial_record r JOIN app.opportunity o ON o.tenant_id=r.tenant_id AND o.id=r.opportunity_id WHERE r.tenant_id=NEW.tenant_id AND o.mission_id=NEW.id AND r.kind='CASH_RECEIPT' AND r.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.accounting_confirmation a WHERE a.tenant_id=r.tenant_id AND a.record_id=r.id) AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=r.tenant_id AND rv.reverse_of=r.id)) OR EXISTS(SELECT FROM app.follow_up f JOIN app.meeting mt ON mt.tenant_id=f.tenant_id AND mt.id=f.meeting_id WHERE f.tenant_id=NEW.tenant_id AND mt.mission_id=NEW.id AND f.status='OPEN')) THEN RAISE EXCEPTION 'Resolve commercial outcomes and meeting follow-ups before closing' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.guard_commercial_qualification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (OLD.status IN ('ACTIVE','TARGETING','FOLLOW_UP') AND NEW.status='COMMERCIAL_PIPELINE') OR (OLD.status='COMMERCIAL_PIPELINE' AND NEW.status='CLOSED') THEN
  IF NOT app.commercial_enabled(NEW.tenant_id) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Commercial authority required' USING ERRCODE='42501'; END IF;
 END IF;
 IF OLD.status IN ('ACTIVE','TARGETING','FOLLOW_UP') AND NEW.status='COMMERCIAL_PIPELINE' AND NOT EXISTS(
  SELECT FROM app.opportunity o WHERE o.tenant_id=NEW.tenant_id AND o.mission_id=NEW.id AND app.opportunity_access(o.tenant_id,o.id,true) AND EXISTS(
   SELECT FROM app.outcome_event e WHERE e.tenant_id=o.tenant_id AND e.opportunity_id=o.id
    AND e.entity_type='opportunity' AND app.commercial_stage(e.snapshot->>'status')>=2
  )
 ) THEN RAISE EXCEPTION 'Qualified opportunity history required' USING ERRCODE='23514'; END IF;
 -- Evaluate whole-mission completion without exposing private relationship records.
 -- The older invoker guard still applies every existing mission/version requirement.
 IF OLD.status='COMMERCIAL_PIPELINE' AND NEW.status='CLOSED' AND (
  NOT EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id)
  OR EXISTS(SELECT FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND status NOT IN ('LOST','CASH_COLLECTED','RECURRING_REVENUE'))
  OR EXISTS(SELECT FROM app.commercial_record r JOIN app.opportunity o ON o.tenant_id=r.tenant_id AND o.id=r.opportunity_id WHERE r.tenant_id=NEW.tenant_id AND o.mission_id=NEW.id AND r.kind='CASH_RECEIPT' AND r.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.accounting_confirmation a WHERE a.tenant_id=r.tenant_id AND a.record_id=r.id) AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=r.tenant_id AND rv.reverse_of=r.id))
  OR EXISTS(SELECT FROM app.follow_up f JOIN app.meeting mt ON mt.tenant_id=f.tenant_id AND mt.id=f.meeting_id WHERE f.tenant_id=NEW.tenant_id AND mt.mission_id=NEW.id AND f.status='OPEN')
 ) THEN RAISE EXCEPTION 'Complete every mission outcome and follow-up before closing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE app.outcome_event DROP CONSTRAINT outcome_event_schema_version_check;
ALTER TABLE app.outcome_event ADD CHECK(schema_version IN (1,2));
CREATE OR REPLACE FUNCTION app.apply_outcome(e app.outcome_event) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF e.schema_version NOT IN (1,2) THEN RAISE EXCEPTION 'Unsupported outcome event version'; END IF;
 INSERT INTO app.outcome_projection(tenant_id,opportunity_id,entity_type,entity_id,event_sequence,snapshot)
 VALUES(e.tenant_id,e.opportunity_id,e.entity_type,e.entity_id,e.sequence,e.snapshot)
 ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET event_sequence=excluded.event_sequence,snapshot=excluded.snapshot WHERE app.outcome_projection.event_sequence<excluded.event_sequence;
END $$;
CREATE OR REPLACE FUNCTION app.capture_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oid uuid; data jsonb; e app.outcome_event;
BEGIN
 IF NEW.aggregate_type='opportunity' THEN
  SELECT id,jsonb_build_object('missionId',mission_id,'meetingId',meeting_id,'originId',origin_id,'targetId',target_id,'status',status,'version',version,'ownerId',owner_id,'dueAt',due_at,'attributionScope',attribution_scope) INTO oid,data FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND id=NEW.aggregate_id::uuid;
 ELSIF NEW.aggregate_type='commercial_record' THEN
  SELECT opportunity_id,jsonb_strip_nulls(jsonb_build_object('kind',kind,'parentId',parent_id,'priorReceiptId',prior_receipt_id,'reverseOf',reverse_of,'sourceId',source_id,'evidenceId',evidence_id,'amountMinor',amount_minor::text,'currency',currency,'occurredAt',occurred_at)) INTO oid,data FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.aggregate_id::uuid;
 ELSIF NEW.aggregate_type='accounting_confirmation' THEN
  SELECT opportunity_id,jsonb_build_object('recordId',record_id,'sourceId',source_id,'occurredAt',occurred_at) INTO oid,data FROM app.accounting_confirmation WHERE tenant_id=NEW.tenant_id AND id=NEW.aggregate_id::uuid;
 ELSE RETURN NEW;
 END IF;
 IF oid IS NULL OR data IS NULL THEN RAISE EXCEPTION 'Outcome snapshot unavailable'; END IF;
 INSERT INTO app.outcome_event(id,tenant_id,opportunity_id,entity_type,entity_id,snapshot,occurred_at,schema_version) VALUES(NEW.id,NEW.tenant_id,oid,NEW.aggregate_type,NEW.aggregate_id::uuid,data,NEW.occurred_at,CASE WHEN data->>'originId' IS NOT NULL THEN 2 ELSE 1 END) RETURNING * INTO e;
 PERFORM app.apply_outcome(e); RETURN NEW;
END $$;
ALTER TABLE app.commercial_command DROP CONSTRAINT commercial_command_action_check;
ALTER TABLE app.commercial_command ADD CHECK(action IN ('create','createFromOrigin','transition','followup','record','reverse','confirm','rebuild'));
