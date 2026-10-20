-- Optional additive module: owner-managed member roles and voluntary leaving for invited workspace members.
-- Roles are an append-only history; no history row means the original role 'member'. Only 'admin' and 'member'
-- exist for invited members, because every other customer module understands exactly owner, admin and member.
-- The three functions below that read an invited member's role are replaced with the same text except for the
-- role expression, so a workspace with no role history behaves exactly as before.
CREATE TABLE customer_private.workspace_member_role (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 member_id uuid NOT NULL REFERENCES customer_private.workspace_member(id),
 version integer NOT NULL CHECK(version>=1),
 role text NOT NULL CHECK(role IN ('admin','member')),
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(member_id,version),
 FOREIGN KEY(tenant_id,member_id) REFERENCES customer_private.workspace_member(tenant_id,id)
);
CREATE INDEX workspace_member_role_member ON customer_private.workspace_member_role(member_id,version DESC);
CREATE TABLE customer_private.workspace_member_request (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('set_role','leave')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER workspace_member_role_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_member_role FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER workspace_member_request_immutable BEFORE UPDATE OR DELETE ON customer_private.workspace_member_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.workspace_member_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.workspace_member_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.workspace_member_role,customer_private.workspace_member_request FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.workspace_member_role_now(member uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT r.role FROM customer_private.workspace_member_role r WHERE r.member_id=member ORDER BY r.version DESC LIMIT 1),'member')
$$;


CREATE OR REPLACE FUNCTION customer.collaborative_workspaces() RETURNS TABLE(id uuid,name text,role text,synthetic boolean,organisation_id uuid)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.id,t.name,access.role,t.synthetic,NULL::uuid FROM (
  SELECT m.tenant_id,m.role FROM customer.membership m WHERE m.principal_id=actor
  UNION ALL SELECT m.tenant_id,customer_private.workspace_member_role_now(m.id) FROM customer_private.workspace_member m
  WHERE m.principal_id=actor AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id)
  AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=m.tenant_id AND original.principal_id=actor)
 ) access JOIN customer.workspace w ON w.tenant_id=access.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE t.synthetic ORDER BY w.created_at,w.tenant_id;
END $$;

CREATE OR REPLACE FUNCTION customer.workspace_access_list(target uuid,invitation_after uuid DEFAULT NULL,member_after uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
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
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'label',i.label,'role',customer_private.workspace_member_role_now(m.id),'roleVersion',(SELECT coalesce(max(r.version),0) FROM customer_private.workspace_member_role r WHERE r.member_id=m.id),'createdAt',m.created_at,
 'status',CASE WHEN EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id) THEN 'revoked'
 WHEN EXISTS(SELECT FROM customer_private.principal p WHERE p.id=m.principal_id AND p.disabled_at IS NOT NULL) THEN 'account-disabled' ELSE 'active' END) ORDER BY m.id)
 FROM visible m JOIN customer_private.workspace_invitation i ON i.id=m.source_invitation_id),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END INTO members,next_member;
 RETURN jsonb_build_object('workspaceId',target,'ownerProtected',true,'invitations',invites,'memberships',members,'nextInvitationAfter',next_invite,'nextMemberAfter',next_member);
END $$;

CREATE OR REPLACE FUNCTION customer_private.organisation_profile_role(target uuid,actor uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN m.role IN ('owner','admin') THEN 'writer' ELSE 'reader' END
 FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE m.tenant_id=target AND m.principal_id=actor AND t.synthetic
 UNION ALL
 SELECT CASE WHEN customer_private.workspace_member_role_now(wm.id)='admin' THEN 'writer' ELSE 'reader' END FROM customer_private.workspace_member wm JOIN customer.workspace w ON w.tenant_id=wm.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE wm.tenant_id=target AND wm.principal_id=actor AND t.synthetic
 AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)
 AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=wm.tenant_id AND original.principal_id=actor)
 ORDER BY 1 DESC LIMIT 1
$$;

CREATE FUNCTION customer.workspace_member_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid; member customer_private.workspace_member%ROWTYPE; previous customer_private.workspace_member_request%ROWTYPE;
 existing_role text; next_role text; next_version integer; result jsonb; kind text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('set_role','leave') THEN
  RAISE EXCEPTION 'Invalid member command' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Invalid member command' USING ERRCODE='23514';
 END IF;
 IF operation='set_role' THEN
  IF input-ARRAY['workspaceId','memberId','role','expectedRole']<>'{}'::jsonb
   OR jsonb_typeof(input->'memberId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'role') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedRole') IS DISTINCT FROM 'string'
   OR input->>'role' NOT IN ('admin','member') OR input->>'expectedRole' NOT IN ('admin','member') THEN
   RAISE EXCEPTION 'Invalid member role change' USING ERRCODE='23514';
  END IF;
 ELSIF input-ARRAY['workspaceId']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid member command' USING ERRCODE='23514';
 END IF;
 target:=(input->>'workspaceId')::uuid;
 actor:=customer_private.lock_workspace_access(command,target);
 SELECT * INTO previous FROM customer_private.workspace_member_request q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND THEN
  IF previous.operation<>operation OR previous.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN previous.result;
 END IF;
 -- Leaving always acts on the caller's own membership; a set_role names the member it changes.
 IF operation='set_role' THEN
  SELECT * INTO member FROM customer_private.workspace_member m WHERE m.id=(input->>'memberId')::uuid AND m.tenant_id=target;
 ELSE
  SELECT * INTO member FROM customer_private.workspace_member m WHERE m.tenant_id=target AND m.principal_id=actor
  AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id);
 END IF;
 IF NOT FOUND
  OR EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=member.id)
  OR EXISTS(SELECT FROM customer_private.principal p WHERE p.id=member.principal_id AND p.disabled_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';
 END IF;
 IF operation='set_role' THEN
  IF NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=target AND m.principal_id=actor AND m.role='owner') THEN
   RAISE EXCEPTION 'Workspace owner required' USING ERRCODE='42501';
  END IF;
  existing_role:=customer_private.workspace_member_role_now(member.id);next_role:=input->>'role';
  IF existing_role<>input->>'expectedRole' THEN RAISE EXCEPTION 'Member role changed; reload and try again' USING ERRCODE='23514'; END IF;
  IF next_role=existing_role THEN RAISE EXCEPTION 'Member already has this role' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(r.version),0)+1 INTO next_version FROM customer_private.workspace_member_role r WHERE r.member_id=member.id;
  INSERT INTO customer_private.workspace_member_role(tenant_id,member_id,version,role,changed_by) VALUES(target,member.id,next_version,next_role,actor);
  result:=jsonb_build_object('workspaceId',target,'memberId',member.id,'role',next_role,'roleVersion',next_version);
  kind:='customer.workspace.member.role_changed';
 ELSE
  INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) VALUES(target,member.id,actor);
  result:=jsonb_build_object('workspaceId',target,'memberId',member.id,'status','left');
  kind:='customer.workspace.member.left';
 END IF;
 PERFORM customer_private.workspace_access_event(target,actor,command,kind,result);
 INSERT INTO customer_private.workspace_member_request(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.workspace_member_role_now(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.workspace_member_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.workspace_member_command(uuid,text,jsonb) TO corridra_runtime;
