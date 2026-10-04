-- Tenant-private trust records use composite foreign keys to prevent cross-tenant links.
CREATE TABLE app.relationship (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 organisation_id uuid NOT NULL REFERENCES app.organisation(id), owner_id uuid NOT NULL REFERENCES identity.principal(id),
 note text NOT NULL DEFAULT '', classification text NOT NULL, purpose text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE app.source_record (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 kind text NOT NULL CHECK(kind IN ('self_declaration','document','observation','public_record')),
 locator text NOT NULL CHECK(length(locator) BETWEEN 1 AND 500), observed_at timestamptz NOT NULL,
 classification text NOT NULL, purpose text NOT NULL, retention_until timestamptz NOT NULL,
 ai_policy text NOT NULL CHECK(ai_policy IN ('DENY','PUBLIC_ONLY','REVIEW_REQUIRED')), created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), CHECK(retention_until>observed_at)
);
CREATE TABLE app.claim (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), source_id uuid NOT NULL,
 statement text NOT NULL CHECK(length(statement) BETWEEN 1 AND 2000), status text NOT NULL DEFAULT 'self_declared' CHECK(status='self_declared'),
 classification text NOT NULL, purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.evidence_object (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), claim_id uuid NOT NULL,
 object_key text NOT NULL UNIQUE, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 mime text NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg')), size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 classification text NOT NULL, purpose text NOT NULL, retention_until timestamptz NOT NULL,
 ai_policy text NOT NULL CHECK(ai_policy IN ('DENY','PUBLIC_ONLY','REVIEW_REQUIRED')), created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.evidence_state (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','UNDER_REVIEW','VERIFIED','REJECTED','EXPIRED','SUPERSEDED')),
 scan_status text NOT NULL DEFAULT 'PENDING' CHECK(scan_status IN ('PENDING','CLEAN','INFECTED','ERROR')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), classification text NOT NULL, purpose text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,id) REFERENCES app.evidence_object(tenant_id,id)
);
CREATE TABLE app.scan_report (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, evidence_id uuid NOT NULL,
 verdict text NOT NULL CHECK(verdict IN ('CLEAN','INFECTED','ERROR')), engine text NOT NULL, scanned_sha256 text NOT NULL,
 classification text NOT NULL, purpose text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES app.evidence_object(tenant_id,id)
);
CREATE TABLE app.verification (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, evidence_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('VERIFIED','REJECTED')), method text NOT NULL CHECK(length(method) BETWEEN 3 AND 300),
 scope text NOT NULL CHECK(length(scope) BETWEEN 3 AND 1000), valid_until timestamptz NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES identity.principal(id), classification text NOT NULL, purpose text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,id,decision),
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES app.evidence_object(tenant_id,id), CHECK(valid_until>created_at)
);
CREATE TABLE app.canonical_fact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, verification_id uuid NOT NULL,
 verification_decision text NOT NULL DEFAULT 'VERIFIED' CHECK(verification_decision='VERIFIED'),
 statement text NOT NULL CHECK(length(statement) BETWEEN 1 AND 2000), classification text NOT NULL, purpose text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,verification_id,verification_decision) REFERENCES app.verification(tenant_id,id,decision)
);
CREATE TABLE app.config_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_.]{2,80}$'),
 version integer NOT NULL CHECK(version>0), value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
 effective_from timestamptz NOT NULL, classification text NOT NULL DEFAULT 'INTERNAL', purpose text NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,key,version)
);
CREATE TABLE app.domain_event (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), type text NOT NULL, schema_version integer NOT NULL CHECK(schema_version=1),
 aggregate_type text NOT NULL, aggregate_id text NOT NULL, aggregate_version integer NOT NULL CHECK(aggregate_version>0),
 actor_id uuid NOT NULL REFERENCES identity.principal(id), occurred_at timestamptz NOT NULL, correlation_id uuid NOT NULL, causation_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), UNIQUE(tenant_id,id)
);
CREATE TABLE app.audit_event (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, domain_event_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES identity.principal(id),
 action text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,domain_event_id) REFERENCES app.domain_event(tenant_id,id)
);
CREATE TABLE app.outbox (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, event_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,event_id) REFERENCES app.domain_event(tenant_id,id)
);
CREATE TABLE app.outbox_delivery (
 event_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, lease_until timestamptz,
 FOREIGN KEY(tenant_id,event_id) REFERENCES app.domain_event(tenant_id,id)
);
CREATE INDEX outbox_pending_idx ON app.outbox_delivery(available_at) WHERE delivered_at IS NULL;
CREATE INDEX domain_event_tenant_time_idx ON app.domain_event(tenant_id,occurred_at);

CREATE FUNCTION app.reject_rewrite() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Immutable record; append a new record' USING ERRCODE='23514'; END $$;
CREATE FUNCTION app.record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); a uuid:=app.actor_id(); record jsonb:=to_jsonb(NEW); v integer:=1; aggregate text; operation text;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 aggregate:=COALESCE(record->>'id',record->>'user_id');
 v:=COALESCE((record->>'version')::integer,1);
 operation:=TG_TABLE_NAME || '.' || lower(TG_OP);
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,operation,1,TG_TABLE_NAME,aggregate,v,a,now(),
 current_setting('corridra.correlation_id')::uuid,current_setting('corridra.causation_id')::uuid,
 jsonb_strip_nulls(jsonb_build_object('id',aggregate,'version',v,'status',record->>'status','role',record->>'role','revoked',record->>'revoked_at' IS NOT NULL)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,operation);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.reject_rewrite(),app.record_change() FROM PUBLIC;
ALTER TABLE app.relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.relationship ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY relationship_read ON app.relationship FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND (owner_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','admin','reviewer')));
CREATE POLICY relationship_insert ON app.relationship FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer'));
GRANT SELECT,INSERT ON app.relationship TO corridra_runtime;
CREATE POLICY relationship_update ON app.relationship FOR UPDATE TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer') AND (owner_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','admin','reviewer'))) WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer') AND (owner_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','admin','reviewer')));
GRANT UPDATE ON app.relationship TO corridra_runtime;
CREATE TRIGGER relationship_event AFTER INSERT OR UPDATE ON app.relationship FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.source_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_record ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY source_record_read ON app.source_record FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY source_record_insert ON app.source_record FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer') AND created_by=app.actor_id());
GRANT SELECT,INSERT ON app.source_record TO corridra_runtime;
CREATE TRIGGER source_record_event AFTER INSERT OR UPDATE ON app.source_record FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.claim ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY claim_read ON app.claim FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY claim_insert ON app.claim FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer') AND created_by=app.actor_id());
GRANT SELECT,INSERT ON app.claim TO corridra_runtime;
CREATE TRIGGER claim_event AFTER INSERT OR UPDATE ON app.claim FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.evidence_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evidence_object ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY evidence_object_read ON app.evidence_object FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY evidence_object_insert ON app.evidence_object FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer') AND created_by=app.actor_id());
GRANT SELECT,INSERT ON app.evidence_object TO corridra_runtime;
CREATE TRIGGER evidence_object_event AFTER INSERT OR UPDATE ON app.evidence_object FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.evidence_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evidence_state ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY evidence_state_read ON app.evidence_state FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY evidence_state_insert ON app.evidence_state FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer'));
GRANT SELECT,INSERT ON app.evidence_state TO corridra_runtime;
CREATE POLICY evidence_state_update ON app.evidence_state FOR UPDATE TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer')) WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer'));
GRANT UPDATE ON app.evidence_state TO corridra_runtime;
CREATE TRIGGER evidence_state_event AFTER INSERT OR UPDATE ON app.evidence_state FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.scan_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scan_report ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY scan_report_read ON app.scan_report FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY scan_report_insert ON app.scan_report FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','operator','reviewer'));
GRANT SELECT,INSERT ON app.scan_report TO corridra_runtime;
CREATE TRIGGER scan_report_event AFTER INSERT OR UPDATE ON app.scan_report FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.verification ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY verification_read ON app.verification FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY verification_insert ON app.verification FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','reviewer') AND app.fresh_mfa() AND reviewer_id=app.actor_id());
GRANT SELECT,INSERT ON app.verification TO corridra_runtime;
CREATE TRIGGER verification_event AFTER INSERT OR UPDATE ON app.verification FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.canonical_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.canonical_fact ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY canonical_fact_read ON app.canonical_fact FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY canonical_fact_insert ON app.canonical_fact FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner','admin','reviewer') AND app.fresh_mfa());
GRANT SELECT,INSERT ON app.canonical_fact TO corridra_runtime;
CREATE TRIGGER canonical_fact_event AFTER INSERT OR UPDATE ON app.canonical_fact FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.config_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.config_version ADD CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED'));
CREATE POLICY config_version_read ON app.config_version FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose));
CREATE POLICY config_version_insert ON app.config_version FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.member_role(tenant_id) IN ('owner') AND app.fresh_mfa() AND created_by=app.actor_id());
GRANT SELECT,INSERT ON app.config_version TO corridra_runtime;
CREATE TRIGGER config_version_event AFTER INSERT OR UPDATE ON app.config_version FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.domain_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY domain_event_read ON app.domain_event FOR SELECT TO corridra_runtime USING(app.member_role(tenant_id) IN ('owner','admin'));
GRANT SELECT ON app.domain_event TO corridra_runtime;
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_event_read ON app.audit_event FOR SELECT TO corridra_runtime USING(app.member_role(tenant_id) IN ('owner','admin'));
GRANT SELECT ON app.audit_event TO corridra_runtime;
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_read ON app.outbox FOR SELECT TO corridra_runtime USING(app.member_role(tenant_id) IN ('owner','admin'));
GRANT SELECT ON app.outbox TO corridra_runtime;
ALTER TABLE app.outbox_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_delivery_read ON app.outbox_delivery FOR SELECT TO corridra_runtime USING(app.member_role(tenant_id) IN ('owner','admin'));
GRANT SELECT ON app.outbox_delivery TO corridra_runtime;
CREATE TRIGGER source_record_immutable BEFORE UPDATE OR DELETE ON app.source_record FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER claim_immutable BEFORE UPDATE OR DELETE ON app.claim FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER evidence_object_immutable BEFORE UPDATE OR DELETE ON app.evidence_object FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER scan_report_immutable BEFORE UPDATE OR DELETE ON app.scan_report FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER verification_immutable BEFORE UPDATE OR DELETE ON app.verification FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER canonical_fact_immutable BEFORE UPDATE OR DELETE ON app.canonical_fact FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER config_version_immutable BEFORE UPDATE OR DELETE ON app.config_version FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER domain_event_immutable BEFORE UPDATE OR DELETE ON app.domain_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON app.audit_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER outbox_immutable BEFORE UPDATE OR DELETE ON app.outbox FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER membership_event AFTER INSERT OR UPDATE ON app.membership FOR EACH ROW EXECUTE FUNCTION app.record_change();
