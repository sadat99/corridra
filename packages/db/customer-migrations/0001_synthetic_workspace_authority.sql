-- Explicitly installed customer module. No existing function, policy or grant is replaced.
CREATE SCHEMA customer;
CREATE SCHEMA customer_private;
REVOKE ALL ON SCHEMA customer,customer_private FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT USAGE ON SCHEMA customer TO corridra_runtime;
GRANT USAGE ON SCHEMA customer_private TO corridra_auth;

CREATE TABLE customer_private.configuration (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 issuer text NOT NULL CHECK(issuer ~ '^https://[^/?#@]+\.neon\.tech/[^?#]+$'),
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER configuration_immutable BEFORE UPDATE OR DELETE ON customer_private.configuration
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Admission is an explicit offline allowlist, never email equality or auto-signup.
CREATE TABLE customer_private.principal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 issuer text NOT NULL,subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 admission_reason text NOT NULL CHECK(length(admission_reason) BETWEEN 10 AND 500),
 disabled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(issuer,subject)
);
CREATE TABLE customer_private.session_proof (
 hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),
 issuer text NOT NULL,subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 seconds')
);
-- Auth can attest a fresh provider response, but cannot grant admission, mutate
-- subjects, extend a proof or override the database's creation timestamp.
GRANT INSERT(hash,issuer,subject,expires_at),SELECT,DELETE ON customer_private.session_proof TO corridra_auth;

CREATE TABLE customer.workspace (
 tenant_id uuid PRIMARY KEY REFERENCES app.tenant(id),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer.membership (
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 role text NOT NULL CHECK(role IN ('owner','admin','member')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,principal_id)
);
CREATE INDEX customer_membership_principal ON customer.membership(principal_id,tenant_id);
CREATE TABLE customer.provision_request (
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(principal_id,command_id)
);
CREATE TRIGGER workspace_immutable BEFORE UPDATE OR DELETE ON customer.workspace FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER membership_immutable BEFORE UPDATE OR DELETE ON customer.membership FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER request_immutable BEFORE UPDATE OR DELETE ON customer.provision_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.provision_request ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION customer.actor_id() RETURNS uuid
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p.id FROM customer_private.session_proof s
 JOIN customer_private.configuration c ON c.issuer=s.issuer AND c.synthetic
 JOIN customer_private.principal p ON p.issuer=s.issuer AND p.subject=s.subject
 WHERE s.hash=current_setting('corridra.customer_proof_hash',true)
 AND s.expires_at>clock_timestamp() AND p.disabled_at IS NULL
$$;
CREATE POLICY workspace_read ON customer.workspace FOR SELECT TO corridra_runtime
 USING(created_by=customer.actor_id());
CREATE POLICY membership_read ON customer.membership FOR SELECT TO corridra_runtime
 USING(principal_id=customer.actor_id());
CREATE POLICY request_read ON customer.provision_request FOR SELECT TO corridra_runtime
 USING(principal_id=customer.actor_id());
GRANT SELECT ON customer.workspace,customer.membership,customer.provision_request TO corridra_runtime;

CREATE FUNCTION customer.workspaces() RETURNS TABLE(id uuid,name text,role text,synthetic boolean,organisation_id uuid)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.id,t.name,m.role,t.synthetic,NULL::uuid
 FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id
 JOIN app.tenant t ON t.id=w.tenant_id
 WHERE m.principal_id=actor AND t.synthetic ORDER BY w.created_at,w.tenant_id;
END $$;

CREATE FUNCTION customer.provision_workspace(command uuid,workspace_name text) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); existing customer.provision_request%ROWTYPE;
 target uuid:=gen_random_uuid(); executor uuid; eid uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 -- Lock the admitted principal against concurrent revocation during this command.
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR workspace_name IS NULL OR workspace_name<>btrim(workspace_name)
 OR length(workspace_name) NOT BETWEEN 11 AND 120 OR workspace_name NOT LIKE 'Synthetic %'
 OR workspace_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'A labelled synthetic workspace and command are required' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.provision:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM customer.provision_request WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF existing.name<>workspace_name THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM customer.membership WHERE tenant_id=existing.tenant_id AND principal_id=actor AND role='owner') THEN
   RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501';
  END IF;
  RETURN existing.tenant_id;
 END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c
 JOIN identity.principal p ON p.id=c.executor_id AND p.kind='service' AND p.disabled_at IS NULL
 WHERE c.synthetic;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.tenant(id,name,synthetic) VALUES(target,workspace_name,true);
 INSERT INTO customer.workspace(tenant_id,created_by) VALUES(target,actor);
 INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES(target,actor,'owner');
 INSERT INTO customer.provision_request(principal_id,command_id,tenant_id,name) VALUES(actor,command,target,workspace_name);
 -- Executor is accurately a service principal. The separate customer initiator
 -- is explicit; it is never represented as a staff person or given staff access.
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.workspace.provisioned',1,'customer_workspace',target::text,1,executor,clock_timestamp(),command,command,
 jsonb_build_object('id',target,'synthetic',true,'initiator_kind','customer','initiator_id',actor,'organisation_linked',false));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.workspace.provisioned');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
 RETURN target;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.actor_id(),customer.workspaces(),customer.provision_workspace(uuid,text) TO corridra_runtime;
