CREATE FUNCTION app.guard_evidence_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
 IF NEW.status IN ('UNDER_REVIEW','VERIFIED') AND NEW.scan_status<>'CLEAN' THEN RAISE EXCEPTION 'Evidence remains quarantined'; END IF;
 IF NEW.status='VERIFIED' AND NOT EXISTS(SELECT 1 FROM app.verification v JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id WHERE v.tenant_id=NEW.tenant_id AND v.evidence_id=NEW.id AND v.decision='VERIFIED' AND v.valid_until>now() AND v.reviewer_id<>e.created_by) THEN RAISE EXCEPTION 'Independent verification required'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_evidence_state() FROM PUBLIC;
CREATE TRIGGER evidence_state_guard BEFORE INSERT OR UPDATE ON app.evidence_state FOR EACH ROW EXECUTE FUNCTION app.guard_evidence_state();
CREATE FUNCTION app.my_tenants() RETURNS TABLE(id uuid,name text,role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.id,t.name,m.role FROM app.tenant t JOIN app.membership m ON m.tenant_id=t.id JOIN identity.principal p ON p.id=m.user_id
 WHERE m.user_id=app.actor_id() AND m.revoked_at IS NULL AND p.operating_country=ANY(m.allowed_countries)
 AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
$$;
REVOKE ALL ON FUNCTION app.my_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.my_tenants() TO corridra_runtime;
