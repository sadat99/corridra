-- CRUD G4 follow-up: a person who is, or was, an owner of a workspace holds a customer.membership row (owner or admin) that
-- is never revoked: that table is append only and every module reads it. Removing such a person from the team list used to
-- write a revocation row and report success while the membership row still gave full access. From now on the database
-- refuses it, in one place that every writer passes through: a revocation of an invited member, or a role change of one,
-- is refused when that person holds a membership row in the same workspace. Nothing is deleted or rewritten, a revocation
-- that already exists stays as it is, and the refusal says what to do. The state read also names every such member with the
-- access the person really has, so the team list can show the true state.
-- The state function is changed only when its live text is exactly the reviewed text shipped in file 0001.
CREATE FUNCTION customer_private.workspace_member_keeps_access(member uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.workspace_member m JOIN customer.membership o ON o.tenant_id=m.tenant_id AND o.principal_id=m.principal_id WHERE m.id=member)
$$;
REVOKE ALL ON FUNCTION customer_private.workspace_member_keeps_access(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.revocation_keeps_access_guard() RETURNS trigger
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.member_id IS NOT NULL AND customer_private.workspace_member_keeps_access(NEW.member_id) THEN
  RAISE EXCEPTION 'This person is or was an owner of this workspace and keeps admin access. Ask support to remove it.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION customer_private.revocation_keeps_access_guard() FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER workspace_revocation_keeps_access BEFORE INSERT ON customer_private.workspace_access_revocation
 FOR EACH ROW EXECUTE FUNCTION customer_private.revocation_keeps_access_guard();

DO $state$
DECLARE original text;updated text;
 anchor text:=E'''ownerMemberId'',owner_member);';
BEGIN
 original:=pg_get_functiondef('customer.workspace_lifecycle_state(uuid)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'f09e69bc1d1a8c8e21cca3c0e30280816de70143ffb4113db3d6ff2417a9e854'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer.workspace_lifecycle_state'; END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer.workspace_lifecycle_state'; END IF;
 -- Every invited member who also holds a membership row, with the role that row gives. Member ids only, no principal id.
 updated:=replace(original,anchor,E'''ownerMemberId'',owner_member,\n  ''protectedMembers'',coalesce((SELECT jsonb_agg(jsonb_build_object(''memberId'',wm.id,''role'',o.role) ORDER BY wm.id)\n   FROM customer_private.workspace_member wm JOIN customer.membership o ON o.tenant_id=wm.tenant_id AND o.principal_id=wm.principal_id\n   WHERE wm.tenant_id=target),''[]''::jsonb));');
 EXECUTE updated;
END $state$;
