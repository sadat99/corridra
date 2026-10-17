-- Additive, synthetic customer-shell collaboration. Core and initial owner authority stay unchanged.
CREATE TABLE customer_private.workspace_invitation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 label text NOT NULL CHECK(label=btrim(label) AND length(label) BETWEEN 11 AND 120 AND label LIKE 'Synthetic %' AND label !~ '[[:cntrl:]]'),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours 1 second'),UNIQUE(tenant_id,id)
);
CREATE INDEX workspace_invitation_page ON customer_private.workspace_invitation(tenant_id,id);
CREATE TABLE customer_private.workspace_member (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 source_invitation_id uuid NOT NULL UNIQUE REFERENCES customer_private.workspace_invitation(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(tenant_id,id),UNIQUE(principal_id,id),
 FOREIGN KEY(tenant_id,source_invitation_id) REFERENCES customer_private.workspace_invitation(tenant_id,id)
);
CREATE INDEX workspace_member_page ON customer_private.workspace_member(tenant_id,id);
CREATE INDEX workspace_member_actor ON customer_private.workspace_member(principal_id,tenant_id);
CREATE TABLE customer_private.workspace_invitation_acceptance (
 invitation_id uuid PRIMARY KEY REFERENCES customer_private.workspace_invitation(id),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 member_id uuid NOT NULL REFERENCES customer_private.workspace_member(id),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES customer_private.workspace_invitation(tenant_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES customer_private.workspace_member(tenant_id,id),
 FOREIGN KEY(principal_id,member_id) REFERENCES customer_private.workspace_member(principal_id,id)
);
CREATE TABLE customer_private.workspace_access_revocation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 invitation_id uuid UNIQUE REFERENCES customer_private.workspace_invitation(id),
 member_id uuid UNIQUE REFERENCES customer_private.workspace_member(id),
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(invitation_id,member_id)=1),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES customer_private.workspace_invitation(tenant_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES customer_private.workspace_member(tenant_id,id)
);
CREATE TABLE customer_private.workspace_access_request (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('invite','accept','revoke')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER workspace_invitation_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_invitation FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_member_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_member FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_acceptance_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_invitation_acceptance FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_revocation_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_access_revocation FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_access_request_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_access_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.workspace_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_invitation_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_access_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_access_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.workspace_invitation,customer_private.workspace_member,
 customer_private.workspace_invitation_acceptance,customer_private.workspace_access_revocation,
 customer_private.workspace_access_request FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.lock_workspace_access(command uuid,target uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL THEN RAISE EXCEPTION 'Command required' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id WHERE w.tenant_id=target AND t.synthetic) THEN
  RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION customer_private.workspace_access_event(target uuid,actor uuid,command uuid,kind text,payload jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid; eid uuid:=gen_random_uuid(); version integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO version FROM app.domain_event e
 WHERE e.tenant_id=target AND e.aggregate_type='customer_workspace_access' AND e.aggregate_id=target::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,kind,1,'customer_workspace_access',target::text,version,executor,clock_timestamp(),command,command,
 payload||jsonb_build_object('synthetic',true,'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE FUNCTION customer.collaborative_workspaces() RETURNS TABLE(id uuid,name text,role text,synthetic boolean,organisation_id uuid)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.id,t.name,access.role,t.synthetic,NULL::uuid FROM (
  SELECT m.tenant_id,m.role FROM customer.membership m WHERE m.principal_id=actor
  UNION ALL SELECT m.tenant_id,'member'::text FROM customer_private.workspace_member m
  WHERE m.principal_id=actor AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id)
  AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=m.tenant_id AND original.principal_id=actor)
 ) access JOIN customer.workspace w ON w.tenant_id=access.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE t.synthetic ORDER BY w.created_at,w.tenant_id;
END $$;

CREATE FUNCTION customer.workspace_access_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid; invitation customer_private.workspace_invitation%ROWTYPE;
 previous customer_private.workspace_access_request%ROWTYPE; accepted customer_private.workspace_invitation_acceptance%ROWTYPE;
 member customer_private.workspace_member%ROWTYPE; request jsonb; result jsonb; kind text; changed boolean:=false; resource uuid;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('invite','accept','revoke') THEN
  RAISE EXCEPTION 'Invalid access command' USING ERRCODE='23514';
 END IF;
 IF operation='invite' THEN
  IF input-ARRAY['workspaceId','label','tokenHash']<>'{}'::jsonb OR jsonb_typeof(input->'label') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'tokenHash') IS DISTINCT FROM 'string'
   OR input->>'tokenHash' !~ '^[a-f0-9]{64}$' OR length(input->>'label') NOT BETWEEN 11 AND 120
   OR input->>'label'<>btrim(input->>'label') OR input->>'label' NOT LIKE 'Synthetic %' OR input->>'label' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid; request:=input-'tokenHash';
 ELSIF operation='accept' THEN
  IF input-ARRAY['tokenHash']<>'{}'::jsonb OR jsonb_typeof(input->'tokenHash') IS DISTINCT FROM 'string' OR input->>'tokenHash' !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='23514';
  END IF;
  SELECT * INTO invitation FROM customer_private.workspace_invitation i WHERE i.token_hash=input->>'tokenHash';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  target:=invitation.tenant_id;request:=input;
 ELSE
  IF input-ARRAY['workspaceId','kind','targetId']<>'{}'::jsonb OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'targetId') IS DISTINCT FROM 'string' OR input->>'kind' IS NULL OR input->>'kind' NOT IN ('invitation','membership') THEN
   RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;resource:=(input->>'targetId')::uuid;request:=input;
 END IF;
 actor:=customer_private.lock_workspace_access(command,target);
 IF operation<>'accept' AND NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner') THEN
  RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO previous FROM customer_private.workspace_access_request q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF previous.operation<>operation OR previous.request<>request THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  IF operation='accept' AND EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=(previous.result->>'memberId')::uuid) THEN
   RAISE EXCEPTION 'Membership revoked' USING ERRCODE='42501';
  END IF;
  RETURN previous.result||jsonb_build_object('issued',false);
 END IF;
 IF operation='invite' THEN
  INSERT INTO customer_private.workspace_invitation(tenant_id,created_by,label,token_hash)
  VALUES(target,actor,input->>'label',input->>'tokenHash') RETURNING * INTO invitation;
  result:=jsonb_build_object('workspaceId',target,'invitationId',invitation.id,'expiresAt',invitation.expires_at,'issued',true);
  kind:='customer.workspace.invitation.issued';changed:=true;
 ELSIF operation='accept' THEN
  IF EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor) THEN
   RAISE EXCEPTION 'Existing owner access does not need an invitation' USING ERRCODE='23514';
  END IF;
  SELECT * INTO accepted FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=invitation.id;
  IF FOUND THEN
   IF accepted.principal_id<>actor OR EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=accepted.member_id) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
   END IF;
   result:=jsonb_build_object('workspaceId',target,'memberId',accepted.member_id,'invitationId',invitation.id);
  ELSE
   IF invitation.expires_at<=clock_timestamp() OR EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.invitation_id=invitation.id) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
   END IF;
   SELECT * INTO member FROM customer_private.workspace_member m WHERE m.tenant_id=target AND m.principal_id=actor
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id);
   IF NOT FOUND THEN
    INSERT INTO customer_private.workspace_member(tenant_id,principal_id,source_invitation_id) VALUES(target,actor,invitation.id) RETURNING * INTO member;
   END IF;
   INSERT INTO customer_private.workspace_invitation_acceptance(invitation_id,tenant_id,principal_id,member_id) VALUES(invitation.id,target,actor,member.id);
   result:=jsonb_build_object('workspaceId',target,'memberId',member.id,'invitationId',invitation.id);
   kind:='customer.workspace.invitation.accepted';changed:=true;
  END IF;
 ELSE
  IF input->>'kind'='invitation' THEN
   SELECT * INTO invitation FROM customer_private.workspace_invitation i WHERE i.id=resource AND i.tenant_id=target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=resource) THEN
    RAISE EXCEPTION 'Revoke the accepted membership instead' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.invitation_id=resource) THEN
    INSERT INTO customer_private.workspace_access_revocation(tenant_id,invitation_id,actor_id) VALUES(target,resource,actor);changed:=true;
   END IF;
   result:=jsonb_build_object('workspaceId',target,'invitationId',resource,'status','cancelled');kind:='customer.workspace.invitation.cancelled';
  ELSE
   IF NOT EXISTS(SELECT FROM customer_private.workspace_member m WHERE m.id=resource AND m.tenant_id=target) THEN
    RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';
   END IF;
   IF NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=resource) THEN
    INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) VALUES(target,resource,actor);changed:=true;
   END IF;
   result:=jsonb_build_object('workspaceId',target,'memberId',resource,'status','revoked');kind:='customer.workspace.member.revoked';
  END IF;
 END IF;
 IF changed THEN PERFORM customer_private.workspace_access_event(target,actor,command,kind,result-'issued'); END IF;
 INSERT INTO customer_private.workspace_access_request(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,request,result-'issued');
 RETURN result;
END $$;

CREATE FUNCTION customer.workspace_access_list(target uuid,invitation_after uuid DEFAULT NULL,member_after uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); invites jsonb; members jsonb; next_invite uuid; next_member uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT FROM customer.membership m JOIN app.tenant t ON t.id=m.tenant_id WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner' AND t.synthetic) THEN
  RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
 END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 WITH page AS(SELECT i.* FROM customer_private.workspace_invitation i WHERE i.tenant_id=target AND (invitation_after IS NULL OR i.id>invitation_after) ORDER BY i.id LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY id LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'expiresAt',i.expires_at,
 'memberId',(SELECT a.member_id FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=i.id),
 'status',CASE WHEN EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.invitation_id=i.id) THEN 'cancelled'
 WHEN EXISTS(SELECT FROM customer_private.workspace_invitation_acceptance a WHERE a.invitation_id=i.id) THEN 'accepted'
 WHEN i.expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END) ORDER BY i.id) FROM visible i),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END INTO invites,next_invite;
 WITH page AS(SELECT m.* FROM customer_private.workspace_member m WHERE m.tenant_id=target AND (member_after IS NULL OR m.id>member_after) ORDER BY m.id LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY id LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'label',i.label,'role','member','createdAt',m.created_at,
 'status',CASE WHEN EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id) THEN 'revoked'
 WHEN EXISTS(SELECT FROM customer_private.principal p WHERE p.id=m.principal_id AND p.disabled_at IS NOT NULL) THEN 'account-disabled' ELSE 'active' END) ORDER BY m.id)
 FROM visible m JOIN customer_private.workspace_invitation i ON i.id=m.source_invitation_id),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END INTO members,next_member;
 RETURN jsonb_build_object('workspaceId',target,'ownerProtected',true,'invitations',invites,'memberships',members,'nextInvitationAfter',next_invite,'nextMemberAfter',next_member);
END $$;

REVOKE ALL ON FUNCTION customer_private.lock_workspace_access(uuid,uuid),customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.collaborative_workspaces(),customer.workspace_access_command(uuid,text,jsonb),customer.workspace_access_list(uuid,uuid,uuid,integer) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.collaborative_workspaces(),customer.workspace_access_command(uuid,text,jsonb),customer.workspace_access_list(uuid,uuid,uuid,integer) TO corridra_runtime;
