-- ADR-072. Metadata on existing reviewed delivery questions and responses, never a purchase authority.
CREATE TABLE app.delivery_specification_request (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,requirement_id uuid NOT NULL,requirement_version integer NOT NULL CHECK(requirement_version>0),
 requirement_digest text NOT NULL CHECK(requirement_digest ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,id) REFERENCES app.delivery_request(tenant_id,id),FOREIGN KEY(tenant_id,requirement_id) REFERENCES app.mission_requirements(tenant_id,id)
);
CREATE TABLE app.delivery_specification_confirmation (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,request_id uuid NOT NULL,resource_id uuid NOT NULL REFERENCES customer_private.saved_mission(id),
 confirmed_by uuid NOT NULL REFERENCES customer_private.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_id),FOREIGN KEY(tenant_id,id) REFERENCES app.delivery_response(tenant_id,id),FOREIGN KEY(tenant_id,request_id) REFERENCES app.delivery_specification_request(tenant_id,id)
);
ALTER TABLE app.delivery_specification_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.delivery_specification_confirmation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.delivery_specification_request,app.delivery_specification_confirmation FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.delivery_specification_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.delivery_specification_confirmation FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

CREATE FUNCTION app.specification_digest(r app.mission_requirements) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',r.id,'version',r.version,'schemaVersion',r.schema_version,'declaration',r.declaration,'fields',r.fields)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION app.specification_scope_valid(t uuid,pub uuid,req uuid,version integer,digest text) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.delivery_publication p JOIN app.delivery_experience_publication e ON e.tenant_id=p.tenant_id AND e.publication_id=p.id
 JOIN app.mission_requirements r ON r.tenant_id=e.tenant_id AND r.id=e.requirement_id
 JOIN app.mission m ON m.tenant_id=r.tenant_id AND m.id=r.mission_id
 JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id
 JOIN app.source_record s ON s.tenant_id=r.tenant_id AND s.id=r.source_id
 WHERE p.tenant_id=t AND p.id=pub AND r.id=req AND r.version=$4 AND app.specification_digest(r)=digest
 AND app.delivery_publication_valid(p.id) AND app.experience_publication_valid(e)
 AND app.experience_source_valid(t,r.source_id,r.claim_id,p.created_by) AND s.retention_until>clock_timestamp() AND i.retention_until>clock_timestamp()
 AND m.status NOT IN ('CLOSED','CANCELLED') AND r.version=(SELECT max(n.version) FROM app.mission_requirements n WHERE n.tenant_id=t AND n.mission_id=r.mission_id)
 AND r.assignment_id=(SELECT a.id FROM app.mission_route_assignment a WHERE a.tenant_id=t AND a.mission_id=r.mission_id ORDER BY a.version DESC LIMIT 1))
$$;
CREATE FUNCTION app.assert_specification_staff(t uuid,pub uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id();
BEGIN
 IF actor IS NULL OR t IS DISTINCT FROM NULLIF(current_setting('corridra.tenant_id',true),'')::uuid
 OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)),false)
 OR NOT app.fresh_mfa() OR NOT EXISTS(SELECT FROM app.delivery_publication p WHERE p.tenant_id=t AND p.id=pub AND p.created_by=actor AND app.delivery_publication_valid(p.id)) THEN
 RAISE EXCEPTION 'Own reviewed publication and fresh owner/admin authority required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=actor AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Specification request authority expired' USING ERRCODE='42501';END IF;
 RETURN actor;
END $$;
CREATE FUNCTION app.guard_specification_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pub uuid;
BEGIN
 SELECT publication_id INTO pub FROM app.delivery_request WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
 IF NEW.created_by IS DISTINCT FROM app.assert_specification_staff(NEW.tenant_id,pub) OR NEW.created_at IS DISTINCT FROM now()
 OR NOT app.specification_scope_valid(NEW.tenant_id,pub,NEW.requirement_id,NEW.requirement_version,NEW.requirement_digest) THEN
 RAISE EXCEPTION 'Current pinned specification required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE INSERT ON app.delivery_specification_request FOR EACH ROW EXECUTE FUNCTION app.guard_specification_request();
CREATE TRIGGER event AFTER INSERT ON app.delivery_specification_request FOR EACH ROW EXECUTE FUNCTION app.record_change();

CREATE FUNCTION app.request_specification_confirmation(command uuid,pub uuid,req uuid,version integer,digest text,owner_id uuid,due timestamptz) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;actor uuid;old app.delivery_specification_request;q app.delivery_request;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':corridor',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':commercial-missions',0));
 actor:=app.assert_specification_staff(t,pub);
 IF command IS NULL OR req IS NULL OR version IS NULL OR digest IS NULL OR owner_id IS NULL OR due IS NULL
 OR NOT app.specification_scope_valid(t,pub,req,version,digest) THEN RAISE EXCEPTION 'Current specification and future deadline required' USING ERRCODE='23514';END IF;
 SELECT * INTO old FROM app.delivery_specification_request WHERE id=command;
 IF old.id IS NOT NULL THEN
  SELECT * INTO q FROM app.delivery_request WHERE id=command;
  IF old.tenant_id<>t OR old.created_by<>actor OR old.requirement_id<>req OR old.requirement_version<>version OR old.requirement_digest<>digest OR q.publication_id<>pub OR q.owner_id<>owner_id OR q.due_at<>due THEN
   RAISE EXCEPTION 'Specification request command conflicts' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('id',command,'replayed',true);
 END IF;
 IF due<=clock_timestamp() THEN RAISE EXCEPTION 'A new specification request needs a future deadline' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM app.delivery_specification_request x JOIN app.delivery_request d ON d.tenant_id=x.tenant_id AND d.id=x.id WHERE d.tenant_id=t AND d.publication_id=pub)>=30 THEN
 RAISE EXCEPTION 'Use a new reviewed publication for further specification requests' USING ERRCODE='23514';END IF;
 INSERT INTO app.delivery_request(id,tenant_id,publication_id,title,instructions,owner_id,due_at,created_by)
 VALUES(command,t,pub,'Confirm the commercial requirements','Review the stated requirements before confirming. This confirmation does not authorise a purchase, contract or payment.',owner_id,due,actor);
 INSERT INTO app.delivery_specification_request(id,tenant_id,requirement_id,requirement_version,requirement_digest,created_by) VALUES(command,t,req,version,digest,actor);
 PERFORM app.assert_specification_staff(t,pub);
 IF NOT app.specification_scope_valid(t,pub,req,version,digest) THEN RAISE EXCEPTION 'Specification scope changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',command,'replayed',false);
END $$;
CREATE FUNCTION app.specification_confirmation_options(pub uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;r app.mission_requirements;requirement jsonb;items jsonb;
BEGIN
 PERFORM app.assert_specification_staff(t,pub);
 SELECT q.* INTO r FROM app.delivery_experience_publication e JOIN app.mission_requirements q ON q.tenant_id=e.tenant_id AND q.id=e.requirement_id WHERE e.tenant_id=t AND e.publication_id=pub;
 IF r.id IS NOT NULL AND app.specification_scope_valid(t,pub,r.id,r.version,app.specification_digest(r)) THEN
 requirement:=jsonb_build_object('requirementId',r.id,'requirementVersion',r.version,'requirementDigest',app.specification_digest(r),'declaration',r.declaration,'fields',r.fields);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',x.id,'requirementVersion',x.requirement_version,'confirmedAt',c.created_at) ORDER BY x.created_at,x.id),'[]'::jsonb) INTO items
 FROM app.delivery_specification_request x JOIN app.delivery_request d ON d.tenant_id=x.tenant_id AND d.id=x.id LEFT JOIN app.delivery_specification_confirmation c ON c.tenant_id=x.tenant_id AND c.request_id=x.id WHERE x.tenant_id=t AND d.publication_id=pub;
 PERFORM app.assert_specification_staff(t,pub);
 RETURN jsonb_build_object('publicationId',pub,'requirement',requirement,'requests',items);
END $$;

CREATE FUNCTION customer.specification_confirmation_requests(resource uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;l app.delivery_link;items jsonb;document jsonb;expiry timestamptz;
BEGIN
 document:=customer.saved_mission_action(resource)->'report';
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501';END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',x.id,'requirementId',x.requirement_id,'requirementVersion',x.requirement_version,'requirementDigest',x.requirement_digest,
 'state',CASE WHEN NOT app.specification_scope_valid(x.tenant_id,d.publication_id,x.requirement_id,x.requirement_version,x.requirement_digest) THEN 'REVIEW_REQUIRED' WHEN closed.status='CANCELLED' THEN 'CANCELLED' WHEN c.id IS NOT NULL THEN 'CONFIRMED' WHEN response.id IS NOT NULL OR closed.status='COMPLETED' THEN 'RESPONDED' ELSE 'OPEN' END,
 'declaration',CASE WHEN app.specification_scope_valid(x.tenant_id,d.publication_id,x.requirement_id,x.requirement_version,x.requirement_digest) THEN r.declaration END,
 'fields',CASE WHEN app.specification_scope_valid(x.tenant_id,d.publication_id,x.requirement_id,x.requirement_version,x.requirement_digest) THEN r.fields END,
 'confirmedAt',c.created_at,'dueAt',d.due_at) ORDER BY x.created_at,x.id),'[]'::jsonb) INTO items
 FROM app.delivery_specification_request x JOIN app.delivery_request d ON d.tenant_id=x.tenant_id AND d.id=x.id JOIN app.mission_requirements r ON r.tenant_id=x.tenant_id AND r.id=x.requirement_id
 LEFT JOIN app.delivery_specification_confirmation c ON c.tenant_id=x.tenant_id AND c.request_id=x.id
 LEFT JOIN app.delivery_response response ON response.tenant_id=x.tenant_id AND response.request_id=x.id
 LEFT JOIN app.delivery_request_close closed ON closed.tenant_id=x.tenant_id AND closed.request_id=x.id
 WHERE x.tenant_id=l.tenant_id AND d.publication_id=ANY(l.publication_ids);
 SELECT least(l.expires_at,min(s.retention_until),min(i.retention_until)) INTO expiry
 FROM app.delivery_specification_request x JOIN app.delivery_request d ON d.tenant_id=x.tenant_id AND d.id=x.id
 JOIN app.mission_requirements r ON r.tenant_id=x.tenant_id AND r.id=x.requirement_id JOIN app.source_record s ON s.tenant_id=r.tenant_id AND s.id=r.source_id
 JOIN app.mission_intake i ON i.tenant_id=r.tenant_id AND i.id=r.mission_id WHERE x.tenant_id=l.tenant_id AND d.publication_id=ANY(l.publication_ids);
 IF customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() OR (customer.saved_mission_action(resource)->'report') IS DISTINCT FROM document THEN RAISE EXCEPTION 'Specification access expired or changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('resourceId',resource,'reviews',items,'expiresAt',expiry,'synthetic',app.tenant_is_synthetic(l.tenant_id));
END $$;
CREATE FUNCTION app.guard_specification_confirmation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved customer_private.saved_mission;x app.delivery_specification_request;q app.delivery_request;l app.delivery_link;
BEGIN
 IF NEW.confirmed_by IS DISTINCT FROM customer_private.saved_mission_actor() OR NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Fresh customer confirmation required' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=NEW.resource_id AND principal_id=NEW.confirmed_by AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Own saved mission required' USING ERRCODE='42501';END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 SELECT * INTO x FROM app.delivery_specification_request WHERE tenant_id=NEW.tenant_id AND id=NEW.request_id;
 SELECT * INTO q FROM app.delivery_request WHERE tenant_id=NEW.tenant_id AND id=NEW.request_id;
 IF x.id IS NULL OR NEW.tenant_id<>l.tenant_id OR NOT(q.publication_id=ANY(l.publication_ids)) OR l.expires_at<=clock_timestamp()
 OR NOT app.specification_scope_valid(x.tenant_id,q.publication_id,x.requirement_id,x.requirement_version,x.requirement_digest)
 OR EXISTS(SELECT FROM app.delivery_request_close WHERE tenant_id=NEW.tenant_id AND request_id=NEW.request_id)
 OR NOT EXISTS(SELECT FROM app.delivery_response WHERE tenant_id=NEW.tenant_id AND id=NEW.id AND request_id=NEW.request_id AND link_id=l.id AND body='I confirm these commercial requirements. This does not authorise a purchase, contract or payment.') THEN
 RAISE EXCEPTION 'Current open specification response required' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE INSERT ON app.delivery_specification_confirmation FOR EACH ROW EXECUTE FUNCTION app.guard_specification_confirmation();
CREATE FUNCTION customer.confirm_specification(resource uuid,command uuid,request uuid,req uuid,version integer,digest text,acknowledged boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.saved_mission_actor();saved customer_private.saved_mission;l app.delivery_link;x app.delivery_specification_request;q app.delivery_request;old app.delivery_specification_confirmation;result jsonb;
BEGIN
 IF command IS NULL OR request IS NULL OR req IS NULL OR version IS NULL OR digest IS NULL OR acknowledged IS DISTINCT FROM true THEN RAISE EXCEPTION 'Explicit pinned confirmation required' USING ERRCODE='23514';END IF;
 PERFORM customer.saved_mission_action(resource);
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Own saved mission required' USING ERRCODE='42501';END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 PERFORM pg_advisory_xact_lock(hashtextextended(l.tenant_id::text||':corridor',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(l.tenant_id::text||':commercial-missions',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery-request:'||request::text,0));
 SELECT * INTO x FROM app.delivery_specification_request WHERE tenant_id=l.tenant_id AND id=request;
 SELECT * INTO q FROM app.delivery_request WHERE tenant_id=l.tenant_id AND id=request;
 IF x.id IS NULL OR NOT(q.publication_id=ANY(l.publication_ids)) OR x.requirement_id<>req OR x.requirement_version<>version OR x.requirement_digest<>digest
 OR NOT app.specification_scope_valid(l.tenant_id,q.publication_id,req,version,digest) THEN RAISE EXCEPTION 'Review the current specification before confirming' USING ERRCODE='23514';END IF;
 SELECT * INTO old FROM app.delivery_specification_confirmation WHERE id=command OR (tenant_id=l.tenant_id AND request_id=request);
 IF old.id IS NOT NULL THEN
  IF old.id<>command OR old.request_id<>request OR old.resource_id<>resource OR old.confirmed_by<>actor THEN RAISE EXCEPTION 'Confirmation command conflicts' USING ERRCODE='23514';END IF;
 ELSE
  result:=app.delivery_respond(saved.token_hash,command,request,'I confirm these commercial requirements. This does not authorise a purchase, contract or payment.');
  INSERT INTO app.delivery_specification_confirmation(id,tenant_id,request_id,resource_id,confirmed_by) VALUES(command,l.tenant_id,request,resource,actor);
  PERFORM app.delivery_external_event(l,'delivery.specification.confirmed',command,jsonb_build_object('requestId',request,'requirementId',req,'requirementVersion',version));
 END IF;
 -- Recheck the actual proof and wall-clock source/link rights after any trigger or lock wait.
 PERFORM customer.saved_mission_action(resource);
 IF customer.actor_id() IS DISTINCT FROM actor OR l.expires_at<=clock_timestamp() OR NOT app.specification_scope_valid(l.tenant_id,q.publication_id,req,version,digest) THEN RAISE EXCEPTION 'Specification access expired or changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',command,'confirmed',true,'replayed',old.id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION app.specification_digest(app.mission_requirements),app.specification_scope_valid(uuid,uuid,uuid,integer,text),app.assert_specification_staff(uuid,uuid),app.guard_specification_request(),app.guard_specification_confirmation(),app.request_specification_confirmation(uuid,uuid,uuid,integer,text,uuid,timestamptz),app.specification_confirmation_options(uuid),customer.specification_confirmation_requests(uuid),customer.confirm_specification(uuid,uuid,uuid,uuid,integer,text,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.request_specification_confirmation(uuid,uuid,uuid,integer,text,uuid,timestamptz),app.specification_confirmation_options(uuid),customer.specification_confirmation_requests(uuid),customer.confirm_specification(uuid,uuid,uuid,uuid,integer,text,boolean) TO corridra_runtime;
