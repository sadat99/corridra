ALTER TABLE identity.principal ALTER COLUMN identity_id DROP NOT NULL;
ALTER TABLE identity.principal ADD COLUMN kind text NOT NULL DEFAULT 'person' CHECK(kind IN ('person','service'));
ALTER TABLE identity.principal ADD CONSTRAINT principal_identity_kind CHECK((kind='person' AND identity_id IS NOT NULL) OR (kind='service' AND identity_id IS NULL));
CREATE TABLE identity.security_event(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identity_id text NOT NULL,action text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION identity.record_security() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO identity.security_event(identity_id,action) VALUES(COALESCE(NEW."userId",OLD."userId"),'session.'||lower(TG_OP));
 RETURN COALESCE(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION identity.record_security() FROM PUBLIC;
CREATE TRIGGER session_audit AFTER INSERT OR DELETE ON identity.session FOR EACH ROW EXECUTE FUNCTION identity.record_security();
CREATE TRIGGER security_event_immutable BEFORE UPDATE OR DELETE ON identity.security_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Only a schema-owning migration identity can attribute offline provisioning to a service actor.
-- This does not grant web/runtime identities an alternate authentication path.
CREATE OR REPLACE FUNCTION app.record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); a uuid:=app.actor_id(); record jsonb:=to_jsonb(NEW); v integer:=1; aggregate text; operation text;
BEGIN
 IF a IS NULL AND pg_has_role(session_user,(SELECT relowner FROM pg_class WHERE oid='app.membership'::regclass),'MEMBER') THEN
  SELECT id INTO a FROM identity.principal WHERE id=NULLIF(current_setting('corridra.bootstrap_actor',true),'')::uuid AND kind='service' AND disabled_at IS NULL;
 END IF;
 IF a IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 aggregate:=COALESCE(record->>'id',record->>'user_id');v:=COALESCE((record->>'version')::integer,1);operation:=TG_TABLE_NAME||'.'||lower(TG_OP);
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,operation,1,TG_TABLE_NAME,aggregate,v,a,now(),current_setting('corridra.correlation_id')::uuid,current_setting('corridra.causation_id')::uuid,
 jsonb_strip_nulls(jsonb_build_object('id',aggregate,'version',v,'status',record->>'status','role',record->>'role','revoked',record->>'revoked_at' IS NOT NULL)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,operation);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;
ALTER TABLE app.evidence_object DROP CONSTRAINT evidence_object_size_bytes_check;
ALTER TABLE app.evidence_object ADD CHECK(size_bytes BETWEEN 1 AND 4194304);
