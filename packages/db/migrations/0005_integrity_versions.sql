-- Database enforcement complements service checks, including direct restricted-role SQL.
ALTER TABLE app.membership ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE app.relationship ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE FUNCTION app.advance_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'Tenant identity is immutable'; END IF;
 NEW.version:=OLD.version+1;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.advance_version() FROM PUBLIC;
CREATE TRIGGER membership_version BEFORE UPDATE ON app.membership FOR EACH ROW EXECUTE FUNCTION app.advance_version();
CREATE TRIGGER relationship_version BEFORE UPDATE ON app.relationship FOR EACH ROW EXECUTE FUNCTION app.advance_version();

CREATE FUNCTION app.guard_provenance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
   IF NEW.reviewer_id=parent.created_by OR parent.retention_until<=now() OR NOT EXISTS(SELECT 1 FROM app.evidence_state WHERE tenant_id=NEW.tenant_id AND id=NEW.evidence_id AND status='UNDER_REVIEW' AND scan_status='CLEAN') THEN RAISE EXCEPTION 'Independent review of clean evidence required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='canonical_fact' THEN
  SELECT c.classification,c.purpose,c.statement INTO parent FROM app.verification v JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id JOIN app.claim c ON c.tenant_id=e.tenant_id AND c.id=e.claim_id JOIN app.evidence_state s ON s.tenant_id=e.tenant_id AND s.id=e.id WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.verification_id AND v.decision='VERIFIED' AND v.valid_until>now() AND s.status='VERIFIED' AND e.retention_until>now();
  IF NOT FOUND OR NEW.statement<>parent.statement THEN RAISE EXCEPTION 'Verified claim required'; END IF;
 END IF;
 IF NEW.classification<>parent.classification OR NEW.purpose<>parent.purpose THEN RAISE EXCEPTION 'Provenance policy must be inherited'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_provenance() FROM PUBLIC;
CREATE TRIGGER claim_provenance BEFORE INSERT ON app.claim FOR EACH ROW EXECUTE FUNCTION app.guard_provenance();
CREATE TRIGGER evidence_provenance BEFORE INSERT ON app.evidence_object FOR EACH ROW EXECUTE FUNCTION app.guard_provenance();
CREATE TRIGGER state_provenance BEFORE INSERT ON app.evidence_state FOR EACH ROW EXECUTE FUNCTION app.guard_provenance();
CREATE TRIGGER scan_provenance BEFORE INSERT ON app.scan_report FOR EACH ROW EXECUTE FUNCTION app.guard_provenance();
CREATE TRIGGER verification_provenance BEFORE INSERT ON app.verification FOR EACH ROW EXECUTE FUNCTION app.guard_provenance();
CREATE TRIGGER fact_provenance BEFORE INSERT ON app.canonical_fact FOR EACH ROW EXECUTE FUNCTION app.guard_provenance();
CREATE UNIQUE INDEX canonical_fact_verification_unique ON app.canonical_fact(tenant_id,verification_id);
CREATE INDEX membership_actor_idx ON app.membership(user_id,tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX source_tenant_idx ON app.source_record(tenant_id,created_at DESC);
CREATE INDEX claim_tenant_idx ON app.claim(tenant_id,created_at DESC);
CREATE INDEX evidence_tenant_idx ON app.evidence_object(tenant_id,created_at DESC);
CREATE FUNCTION identity.record_mfa_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW."twoFactorEnabled" IS DISTINCT FROM OLD."twoFactorEnabled" THEN
  INSERT INTO identity.security_event(identity_id,action) VALUES(NEW.id,CASE WHEN NEW."twoFactorEnabled" THEN 'mfa.enabled' ELSE 'mfa.disabled' END);
  IF NOT NEW."twoFactorEnabled" THEN DELETE FROM identity.assurance WHERE session_id IN (SELECT id FROM identity.session WHERE "userId"=NEW.id); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity.record_mfa_change() FROM PUBLIC;
CREATE TRIGGER mfa_audit AFTER UPDATE ON identity."user" FOR EACH ROW EXECUTE FUNCTION identity.record_mfa_change();

CREATE OR REPLACE FUNCTION app.record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); a uuid:=app.actor_id(); record jsonb:=to_jsonb(NEW); v integer:=1; aggregate text; operation text;
BEGIN
 IF a IS NULL AND pg_has_role(session_user,(SELECT relowner FROM pg_class WHERE oid='app.membership'::regclass),'MEMBER') THEN
  SELECT id INTO a FROM identity.principal WHERE id=NULLIF(current_setting('corridra.bootstrap_actor',true),'')::uuid AND kind='service' AND disabled_at IS NULL;
 END IF;
 IF a IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 aggregate:=CASE WHEN TG_TABLE_NAME='config_version' THEN record->>'key' ELSE COALESCE(record->>'id',record->>'user_id') END;v:=COALESCE((record->>'version')::integer,1);operation:=TG_TABLE_NAME||'.'||lower(TG_OP);
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,operation,1,TG_TABLE_NAME,aggregate,v,a,now(),current_setting('corridra.correlation_id')::uuid,current_setting('corridra.causation_id')::uuid,
 jsonb_strip_nulls(jsonb_build_object('id',aggregate,'version',v,'status',record->>'status','role',record->>'role','revoked',record->>'revoked_at' IS NOT NULL)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,operation);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;
