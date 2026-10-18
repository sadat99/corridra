-- Optional synthetic request authority. Core/customer migration history stays intact.
CREATE TABLE customer_private.request_admission (
 principal_id uuid PRIMARY KEY REFERENCES customer_private.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),disabled_at timestamptz
);
CREATE TABLE customer_private.request_attestation (
 proof_hash text NOT NULL REFERENCES customer_private.session_proof(hash) ON DELETE CASCADE,
 command_id uuid NOT NULL,workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 brief_digest text NOT NULL CHECK(brief_digest ~ '^[a-f0-9]{64}$'),
 request_key uuid NOT NULL,payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),notice_version text NOT NULL,
 PRIMARY KEY(proof_hash,command_id)
);
CREATE TABLE customer_private.owned_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 command_id uuid NOT NULL,workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 mission_tenant_id uuid NOT NULL,mission_id uuid NOT NULL,
 request_key uuid NOT NULL UNIQUE,brief_digest text NOT NULL CHECK(brief_digest ~ '^[a-f0-9]{64}$'),
 receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,command_id),UNIQUE(mission_tenant_id,mission_id),
 FOREIGN KEY(mission_tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE TABLE customer_private.request_revocation (
 request_id uuid PRIMARY KEY REFERENCES customer_private.owned_request(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER owned_request_immutable BEFORE UPDATE OR DELETE ON customer_private.owned_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER request_revocation_immutable BEFORE UPDATE OR DELETE ON customer_private.request_revocation FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.request_admission ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.request_attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.owned_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.request_revocation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.request_admission,customer_private.request_attestation,customer_private.owned_request,customer_private.request_revocation FROM PUBLIC,corridra_runtime,corridra_auth;
-- Auth gets only this proof-bound port, no table writes, admission or resource grants.
CREATE FUNCTION customer_private.attest_request(proof text,command uuid,target uuid,b jsonb,k uuid,h text,r text,n text) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.session_proof s WHERE s.hash=proof AND s.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Fresh customer proof required' USING ERRCODE='42501';
 END IF;
 INSERT INTO customer_private.request_attestation(proof_hash,command_id,workspace_id,brief_digest,request_key,payload_hash,receipt_hash,notice_version)
 VALUES(proof,command,target,encode(sha256(convert_to(b::text,'UTF8')),'hex'),k,h,r,n);
END $$;
REVOKE ALL ON FUNCTION customer_private.attest_request(text,uuid,uuid,jsonb,uuid,text,text,text) FROM PUBLIC,corridra_runtime;
GRANT EXECUTE ON FUNCTION customer_private.attest_request(text,uuid,uuid,jsonb,uuid,text,text,text) TO corridra_auth;

CREATE FUNCTION customer_private.request_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer request access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer request access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.request_admission WHERE principal_id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION customer_private.request_result(resource uuid,actor uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owned customer_private.owned_request; progress jsonb;
BEGIN
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request o WHERE o.id=resource AND o.principal_id=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR EXISTS(SELECT FROM customer_private.request_revocation r WHERE r.request_id=owned.id) THEN
  RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM app.mission_intake i WHERE i.id=owned.mission_id AND i.tenant_id=owned.mission_tenant_id AND i.retention_until>clock_timestamp()) THEN
  progress:=app.mission_receipt(owned.receipt_hash);
 END IF;
 RETURN jsonb_build_object('id',owned.id,'workspaceId',owned.workspace_id,'createdAt',owned.created_at,
 'synthetic',true,'progress',progress,'available',progress IS NOT NULL);
END $$;

-- Lookup before deriving new HMAC material preserves old retry keys across rotation.
CREATE FUNCTION customer.request_retry(command uuid,target uuid,b jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); owned customer_private.owned_request;
BEGIN
 IF command IS NULL OR target IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Request context required' USING ERRCODE='23514'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE principal_id=actor AND command_id=command;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF owned.workspace_id<>target OR owned.brief_digest<>encode(sha256(convert_to(b::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514';
 END IF;
 RETURN customer_private.request_result(owned.id,actor);
END $$;

CREATE FUNCTION customer.submit_private_request(command uuid,target uuid,b jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); old jsonb; plan customer_private.request_attestation;
 result jsonb; intake app.mission_intake; resource uuid:=gen_random_uuid(); executor uuid; eid uuid:=gen_random_uuid();
BEGIN
 IF command IS NULL OR target IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Request context required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.request.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||target::text,0));
 PERFORM pg_advisory_xact_lock(hashtext('corridra:intake'));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 old:=customer.request_retry(command,target,b);
 IF old IS NOT NULL THEN RETURN old; END IF;
 IF NOT EXISTS(SELECT FROM customer.collaborative_workspaces() w WHERE w.id=target) THEN
  RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO plan FROM customer_private.request_attestation a
 WHERE a.proof_hash=current_setting('corridra.customer_proof_hash',true) AND a.command_id=command
 AND a.workspace_id=target AND a.brief_digest=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'Submission attestation required' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 -- No identity/session impersonation: the original intake service executes this command.
 result:=app.submit_mission(plan.request_key,plan.payload_hash,plan.receipt_hash,b,plan.notice_version);
 IF result->>'id' IS NULL THEN RAISE EXCEPTION 'Duplicate brief has no private ownership grant' USING ERRCODE='23514'; END IF;
 SELECT * INTO intake FROM app.mission_intake i WHERE i.id=(result->>'id')::uuid
 AND i.request_key=plan.request_key AND i.receipt_hash=plan.receipt_hash AND i.brief=b;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical request binding mismatch' USING ERRCODE='42501'; END IF;
 -- Never adopt a previously created anonymous/other request, even with a forged plan.
 IF (result->>'duplicate')::boolean THEN RAISE EXCEPTION 'Canonical request is already owned or external' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.owned_request(id,principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
 VALUES(resource,actor,command,target,intake.tenant_id,intake.id,plan.request_key,plan.brief_digest,plan.receipt_hash);
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.request.bound',1,'customer_private_request',resource::text,1,executor,clock_timestamp(),command,command,
 jsonb_build_object('id',resource,'synthetic',true,'initiator_kind','customer','initiator_id',actor,'scope','receipt_progress_only'));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.request.bound');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
 RETURN customer_private.request_result(resource,actor);
END $$;

CREATE FUNCTION customer.private_requests(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); items jsonb; next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.request_result(o.id,actor) ORDER BY o.id),'[]'::jsonb) INTO items
 FROM (SELECT r.id FROM customer_private.owned_request r WHERE r.principal_id=actor AND (after_id IS NULL OR r.id>after_id)
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id) ORDER BY r.id LIMIT page_size) o;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.principal_id=actor AND r.id>next_id
    AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requests',items,'nextAfter',next_id,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION customer_private.request_actor(),customer_private.request_result(uuid,uuid),customer.request_retry(uuid,uuid,jsonb),customer.submit_private_request(uuid,uuid,jsonb),customer.private_requests(uuid,integer) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.request_retry(uuid,uuid,jsonb),customer.submit_private_request(uuid,uuid,jsonb),customer.private_requests(uuid,integer) TO corridra_runtime;
