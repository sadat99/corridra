-- CRUD G5 follow-up: which staff see an erasure request is no longer fixed by the workspace of the person's first event
-- alone. A person whose first workspace was a sample one may later hold a real workspace, and real staff must see that
-- request in time for the legal deadline. The rule, for the staff workspace named in the session:
--  * real staff see a request when its first workspace is real, or the person has any real workspace now;
--  * sample staff see a request only when its first workspace is a sample one and the person has no real workspace now.
-- "Has a workspace" counts an owner or admin membership and an invited member who has not been removed. Nothing is
-- rewritten: only the one function is replaced, and only when its live text is exactly the text of file 0003.
DO $scope$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('customer_private.erasure_in_scope(uuid)'::regprocedure),'UTF8')),'hex')<>'094348f85285fb5bfd91bdc06005c23b28250b976b089922d4e3b1ae8bccd8df'
 THEN RAISE EXCEPTION 'Account lifecycle prerequisite differs: customer_private.erasure_in_scope'; END IF;
END $scope$;
CREATE OR REPLACE FUNCTION customer_private.erasure_in_scope(person uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH staff AS (SELECT s.synthetic FROM app.tenant s WHERE s.id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid),
 first_side AS (SELECT t.synthetic FROM customer_private.account_chain c JOIN app.tenant t ON t.id=c.tenant_id WHERE c.principal_id=person),
 real_now AS (SELECT EXISTS(
   SELECT FROM customer.membership m JOIN app.tenant t ON t.id=m.tenant_id WHERE m.principal_id=person AND NOT t.synthetic
   UNION ALL SELECT FROM customer_private.workspace_member wm JOIN app.tenant t ON t.id=wm.tenant_id
    WHERE wm.principal_id=person AND NOT t.synthetic AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)) AS yes)
 SELECT coalesce((SELECT CASE WHEN NOT staff.synthetic THEN NOT first_side.synthetic OR real_now.yes
   ELSE first_side.synthetic AND NOT real_now.yes END FROM staff,first_side,real_now),false)
$$;
