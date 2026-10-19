-- Optional private, self-reported customer organisation profiles. app.organisation is untouched.
CREATE TABLE customer_private.organisation_profile_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
 reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]'),
 provenance text NOT NULL DEFAULT 'SELF_REPORTED' CHECK(provenance='SELF_REPORTED'),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,version),UNIQUE(tenant_id,id)
);
CREATE TABLE customer_private.organisation_profile_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 revision_id uuid NOT NULL UNIQUE,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id),
 FOREIGN KEY(tenant_id,revision_id) REFERENCES customer_private.organisation_profile_revision(tenant_id,id)
);
CREATE TRIGGER organisation_profile_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_profile_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER organisation_profile_command_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_profile_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.organisation_profile_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.organisation_profile_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.organisation_profile_revision,customer_private.organisation_profile_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Role of the current actor in a workspace, or NULL. Revoked or disabled access reads as no access.
CREATE FUNCTION customer_private.organisation_profile_role(target uuid,actor uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN m.role IN ('owner','admin') THEN 'writer' ELSE 'reader' END
 FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE m.tenant_id=target AND m.principal_id=actor AND t.synthetic
 UNION ALL
 SELECT 'reader' FROM customer_private.workspace_member wm JOIN customer.workspace w ON w.tenant_id=wm.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE wm.tenant_id=target AND wm.principal_id=actor AND t.synthetic
 AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)
 AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=wm.tenant_id AND original.principal_id=actor)
 ORDER BY 1 DESC LIMIT 1
$$;

CREATE FUNCTION customer_private.organisation_profile_valid(d jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE roles text[];sectors text[];
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR d-ARRAY['legalName','countryCode','website','commercialRoles','sectors','sizeBand','summary']<>'{}'::jsonb
  OR NOT(d ?& ARRAY['legalName','countryCode','website','commercialRoles','sectors','sizeBand','summary']) THEN RETURN false; END IF;
 IF jsonb_typeof(d->'legalName')<>'string' OR jsonb_typeof(d->'countryCode')<>'string' OR jsonb_typeof(d->'sizeBand')<>'string' OR jsonb_typeof(d->'summary')<>'string'
  OR jsonb_typeof(d->'commercialRoles')<>'array' OR jsonb_typeof(d->'sectors')<>'array' OR jsonb_typeof(d->'website') NOT IN ('string','null') THEN RETURN false; END IF;
 IF d->>'legalName'<>btrim(d->>'legalName') OR length(d->>'legalName') NOT BETWEEN 11 AND 200 OR d->>'legalName' NOT LIKE 'Synthetic %' OR d->>'legalName' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF d->>'summary'<>btrim(d->>'summary') OR length(d->>'summary') NOT BETWEEN 11 AND 1000 OR d->>'summary' NOT LIKE 'Synthetic %' OR d->>'summary' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT FROM app.market_scope WHERE key=d->>'countryCode' AND kind='COUNTRY') THEN RETURN false; END IF;
 IF d->>'sizeBand' NOT IN ('1-10','11-50','51-200','201-1000','1000+') THEN RETURN false; END IF;
 IF jsonb_typeof(d->'website')='string' AND (length(d->>'website')>200 OR d->>'website' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(/[A-Za-z0-9._~/-]*)?$') THEN RETURN false; END IF;
 IF jsonb_array_length(d->'commercialRoles') NOT BETWEEN 1 AND 6 OR EXISTS(SELECT FROM jsonb_array_elements(d->'commercialRoles') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
 SELECT array_agg(value) INTO roles FROM jsonb_array_elements_text(d->'commercialRoles');
 IF EXISTS(SELECT FROM unnest(roles) r WHERE r NOT IN ('BUYER','SELLER','SUPPLIER','MANUFACTURER','DISTRIBUTOR','ORGANISER')) OR (SELECT count(DISTINCT r) FROM unnest(roles) r)<>cardinality(roles) THEN RETURN false; END IF;
 IF jsonb_array_length(d->'sectors')>10 OR EXISTS(SELECT FROM jsonb_array_elements(d->'sectors') v WHERE jsonb_typeof(v)<>'string') THEN RETURN false; END IF;
 SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO sectors FROM jsonb_array_elements_text(d->'sectors');
 IF EXISTS(SELECT FROM unnest(sectors) s WHERE s<>btrim(s) OR length(s) NOT BETWEEN 2 AND 60 OR s ~ '[[:cntrl:]]') OR (SELECT count(DISTINCT lower(s)) FROM unnest(sectors) s)<>cardinality(sectors) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION customer_private.organisation_profile_event(target uuid,actor uuid,command uuid,revision uuid,revision_version integer) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.organisation_profile.revised',1,'customer_organisation_profile',target::text,revision_version,executor,clock_timestamp(),command,command,
 jsonb_build_object('revisionId',revision,'version',revision_version,'synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.organisation_profile.revised');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE FUNCTION customer_private.organisation_profile_expiry() RETURNS timestamptz
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT least(clock_timestamp()+interval '60 seconds',(SELECT expires_at FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)))
$$;

CREATE FUNCTION customer.organisation_profile_view(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();access text;head customer_private.organisation_profile_revision;result jsonb;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.organisation_profile_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 -- Wait behind an in-flight write so a reader never sees a half-recorded revision, then recheck access.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_profile:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.organisation_profile_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Profile access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM customer_private.organisation_profile_revision WHERE tenant_id=target ORDER BY version DESC LIMIT 1;
 result:=jsonb_build_object('workspaceId',target,'expiresAt',customer_private.organisation_profile_expiry(),'organisationId',NULL,'canonicalLinked',false,'provenance','SELF_REPORTED','verified',false,
 'canEdit',access='writer','currentVersion',coalesce(head.version,0),
 'profile',CASE WHEN head.id IS NULL THEN NULL ELSE head.details||jsonb_build_object('version',head.version,'updatedAt',head.created_at)||
 CASE WHEN access='writer' THEN jsonb_build_object('reason',head.reason) ELSE '{}'::jsonb END END);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Profile access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION customer.organisation_profile_command(command uuid,target uuid,expected integer,input jsonb,reason text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;prior customer_private.organisation_profile_command;revision customer_private.organisation_profile_revision;head integer;payload jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR reason IS NULL OR reason<>btrim(reason) OR length(reason) NOT BETWEEN 3 AND 1000 OR reason ~ '[[:cntrl:]]'
  OR NOT customer_private.organisation_profile_valid(input) THEN RAISE EXCEPTION 'Invalid organisation profile' USING ERRCODE='23514'; END IF;
 payload:=jsonb_build_object('workspaceId',target,'expectedVersion',expected,'details',input,'reason',reason);
 actor:=customer_private.lock_workspace_access(command,target);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_profile:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.organisation_profile_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(version),0) INTO head FROM customer_private.organisation_profile_revision WHERE tenant_id=target;
 SELECT * INTO prior FROM customer_private.organisation_profile_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM payload OR prior.tenant_id<>target THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  SELECT * INTO revision FROM customer_private.organisation_profile_revision WHERE id=prior.revision_id;
  RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.organisation_profile_expiry(),'organisationId',NULL,'canonicalLinked',false,'provenance','SELF_REPORTED','verified',false,'canEdit',true,
  'currentVersion',head,'commandId',command,'superseded',revision.version<>head,
  'profile',revision.details||jsonb_build_object('version',revision.version,'updatedAt',revision.created_at,'reason',revision.reason));
 END IF;
 IF expected<>head THEN RAISE EXCEPTION 'Profile changed; reload before saving' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.organisation_profile_revision(tenant_id,version,details,reason,created_by) VALUES(target,head+1,input,reason,actor) RETURNING * INTO revision;
 INSERT INTO customer_private.organisation_profile_command(actor_id,command_id,tenant_id,revision_id,request) VALUES(actor,command,target,revision.id,payload);
 PERFORM customer_private.organisation_profile_event(target,actor,command,revision.id,revision.version);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Profile access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.organisation_profile_expiry(),'organisationId',NULL,'canonicalLinked',false,'provenance','SELF_REPORTED','verified',false,'canEdit',true,
 'currentVersion',revision.version,'commandId',command,'superseded',false,
 'profile',revision.details||jsonb_build_object('version',revision.version,'updatedAt',revision.created_at,'reason',revision.reason));
END $$;

CREATE FUNCTION customer.organisation_profile_history(target uuid,before_version integer DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();items jsonb;next_before integer;
BEGIN
 IF actor IS NULL OR target IS NULL OR customer_private.organisation_profile_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR (before_version IS NOT NULL AND before_version<1) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_profile:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.organisation_profile_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Profile access expired' USING ERRCODE='42501'; END IF;
 WITH page AS(SELECT r.* FROM customer_private.organisation_profile_revision r WHERE r.tenant_id=target AND (before_version IS NULL OR r.version<before_version) ORDER BY r.version DESC LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY version DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('version',v.version,'reason',v.reason,'createdAt',v.created_at,'byYou',v.created_by=actor,'provenance',v.provenance) ORDER BY v.version DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT min(version) FROM visible) ELSE NULL END INTO items,next_before;
 RETURN jsonb_build_object('workspaceId',target,'expiresAt',customer_private.organisation_profile_expiry(),'revisions',items,'nextBefore',next_before);
END $$;

REVOKE ALL ON FUNCTION customer_private.organisation_profile_role(uuid,uuid),customer_private.organisation_profile_valid(jsonb),customer_private.organisation_profile_event(uuid,uuid,uuid,uuid,integer),customer_private.organisation_profile_expiry() FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.organisation_profile_view(uuid),customer.organisation_profile_command(uuid,uuid,integer,jsonb,text),customer.organisation_profile_history(uuid,integer,integer) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.organisation_profile_view(uuid),customer.organisation_profile_command(uuid,uuid,integer,jsonb,text),customer.organisation_profile_history(uuid,integer,integer) TO corridra_runtime;
