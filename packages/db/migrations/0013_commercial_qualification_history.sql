-- Forward correction after isolated preview review: loss alone is not qualification.
-- Retain migrations 0011/0012 and all existing records/events unchanged.
CREATE FUNCTION app.guard_commercial_qualification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (OLD.status='FOLLOW_UP' AND NEW.status='COMMERCIAL_PIPELINE') OR (OLD.status='COMMERCIAL_PIPELINE' AND NEW.status='CLOSED') THEN
  IF NOT app.commercial_enabled(NEW.tenant_id) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Commercial authority required' USING ERRCODE='42501'; END IF;
 END IF;
 IF OLD.status='FOLLOW_UP' AND NEW.status='COMMERCIAL_PIPELINE' AND NOT EXISTS(
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
REVOKE ALL ON FUNCTION app.guard_commercial_qualification() FROM PUBLIC;
CREATE TRIGGER commercial_qualification BEFORE UPDATE ON app.mission FOR EACH ROW EXECUTE FUNCTION app.guard_commercial_qualification();
