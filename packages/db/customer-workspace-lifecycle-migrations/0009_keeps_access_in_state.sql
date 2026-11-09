-- CRUD G4 follow-up: the workspace state also says whether the signed-in person holds an owner or admin membership in the
-- workspace (keepsAccess). Leaving removes only an invited membership, and a person with a membership row keeps their access
-- whatever is written, so the screens use this to offer no Leave to them. Changed only when the live text is exactly the
-- text of file 0005.
DO $state$
DECLARE original text;updated text;
 anchor text:=E'\n  ''protectedMembers'',coalesce(';
BEGIN
 original:=pg_get_functiondef('customer.workspace_lifecycle_state(uuid)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'0ecd78ead799eb59bc3709d85ac7cf395c7536e965cb83136ab3e265a8b9df44'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer.workspace_lifecycle_state'; END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer.workspace_lifecycle_state'; END IF;
 updated:=replace(original,anchor,E'\n  ''keepsAccess'',EXISTS(SELECT FROM customer.membership km WHERE km.tenant_id=target AND km.principal_id=actor),'||anchor);
 EXECUTE updated;
END $state$;
