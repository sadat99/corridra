-- Explicit temporary policy exception. BYPASSED never represents a clean malware scan.
ALTER TABLE app.evidence_state DROP CONSTRAINT evidence_state_scan_status_check;
ALTER TABLE app.evidence_state ADD CONSTRAINT evidence_state_scan_status_check CHECK(scan_status IN ('PENDING','CLEAN','INFECTED','ERROR','BYPASSED'));
ALTER TABLE app.scan_report DROP CONSTRAINT scan_report_verdict_check;
ALTER TABLE app.scan_report ADD CONSTRAINT scan_report_verdict_check CHECK(verdict IN ('CLEAN','INFECTED','ERROR','BYPASSED'));
CREATE FUNCTION app.scan_bypass_allowed(tid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT t.synthetic AND COALESCE((SELECT (c.value->>'enabled')::boolean FROM app.config_version c WHERE c.tenant_id=tid AND c.key='evidence.scan_bypass' AND c.effective_from<=now() ORDER BY c.version DESC LIMIT 1),false) FROM app.tenant t WHERE t.id=tid),false)
$$;
REVOKE ALL ON FUNCTION app.scan_bypass_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.scan_bypass_allowed(uuid) TO corridra_runtime;
CREATE OR REPLACE FUNCTION app.guard_evidence_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'SUBMITTED' OR NEW.scan_status<>'PENDING' OR NEW.version<>1 THEN RAISE EXCEPTION 'Evidence must start quarantined'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.classification<>OLD.classification OR NEW.purpose<>OLD.purpose OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid evidence version or identity'; END IF;
 IF NEW.status<>OLD.status AND NOT (
 (OLD.status='SUBMITTED' AND NEW.status IN ('UNDER_REVIEW','REJECTED')) OR
 (OLD.status='UNDER_REVIEW' AND NEW.status IN ('VERIFIED','REJECTED')) OR
 (OLD.status='VERIFIED' AND NEW.status IN ('EXPIRED','SUPERSEDED')) OR
 (OLD.status='EXPIRED' AND NEW.status='SUPERSEDED')) THEN RAISE EXCEPTION 'Invalid evidence transition'; END IF;
 IF NEW.scan_status='CLEAN' AND NOT EXISTS(SELECT 1 FROM app.scan_report r JOIN app.evidence_object e ON e.tenant_id=r.tenant_id AND e.id=r.evidence_id WHERE r.tenant_id=NEW.tenant_id AND r.evidence_id=NEW.id AND r.verdict='CLEAN' AND r.scanned_sha256=e.sha256) THEN RAISE EXCEPTION 'Clean scan evidence required'; END IF;
 IF NEW.scan_status='BYPASSED' AND (NOT app.scan_bypass_allowed(NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM app.scan_report r JOIN app.evidence_object e ON e.tenant_id=r.tenant_id AND e.id=r.evidence_id WHERE r.tenant_id=NEW.tenant_id AND r.evidence_id=NEW.id AND r.verdict='BYPASSED' AND r.engine='owner-authorized-bypass' AND r.scanned_sha256=e.sha256)) THEN RAISE EXCEPTION 'Explicit bypass authorization and integrity report required'; END IF;
 IF NEW.status IN ('UNDER_REVIEW','VERIFIED') AND NEW.scan_status NOT IN ('CLEAN','BYPASSED') THEN RAISE EXCEPTION 'Evidence remains quarantined'; END IF;
 IF NEW.status='VERIFIED' AND NOT EXISTS(SELECT 1 FROM app.verification v JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id WHERE v.tenant_id=NEW.tenant_id AND v.evidence_id=NEW.id AND v.decision='VERIFIED' AND v.valid_until>now() AND v.reviewer_id<>e.created_by) THEN RAISE EXCEPTION 'Independent verification required'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.guard_provenance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent record;
BEGIN
 IF TG_TABLE_NAME='claim' THEN
  SELECT classification,purpose,retention_until INTO parent FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id;
  IF NOT FOUND OR parent.retention_until<=now() THEN RAISE EXCEPTION 'Source unavailable'; END IF;
 ELSIF TG_TABLE_NAME='evidence_object' THEN
  SELECT c.classification,c.purpose,s.retention_until,s.ai_policy INTO parent FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.claim_id;
  IF NOT FOUND OR parent.retention_until<=now() OR NEW.retention_until<>parent.retention_until OR NEW.ai_policy<>parent.ai_policy THEN RAISE EXCEPTION 'Invalid evidence provenance'; END IF;
 ELSIF TG_TABLE_NAME IN ('evidence_state','scan_report','verification') THEN
  SELECT classification,purpose,created_by,retention_until INTO parent FROM app.evidence_object WHERE tenant_id=NEW.tenant_id AND id=CASE WHEN TG_TABLE_NAME='evidence_state' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'evidence_id')::uuid END;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evidence unavailable'; END IF;
  IF TG_TABLE_NAME='verification' THEN
   IF NEW.reviewer_id=parent.created_by OR parent.retention_until<=now() OR NOT EXISTS(SELECT 1 FROM app.evidence_state WHERE tenant_id=NEW.tenant_id AND id=NEW.evidence_id AND status='UNDER_REVIEW' AND (scan_status='CLEAN' OR (scan_status='BYPASSED' AND app.scan_bypass_allowed(NEW.tenant_id)))) THEN RAISE EXCEPTION 'Independent review of eligible evidence required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='canonical_fact' THEN
  SELECT c.classification,c.purpose,c.statement INTO parent FROM app.verification v JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id JOIN app.claim c ON c.tenant_id=e.tenant_id AND c.id=e.claim_id JOIN app.evidence_state s ON s.tenant_id=e.tenant_id AND s.id=e.id WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.verification_id AND v.decision='VERIFIED' AND v.valid_until>now() AND s.status='VERIFIED' AND e.retention_until>now();
  IF NOT FOUND OR NEW.statement<>parent.statement THEN RAISE EXCEPTION 'Verified claim required'; END IF;
 END IF;
 IF NEW.classification<>parent.classification OR NEW.purpose<>parent.purpose THEN RAISE EXCEPTION 'Provenance policy must be inherited'; END IF;
 RETURN NEW;
END $$;
