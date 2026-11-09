-- CRUD G5 follow-up. Additive only: new table, then two functions changed under a fingerprint of the exact live text.
-- (1) The workspace that carries a person's account events is fixed by the first event, not looked up again each time.
-- Before, every event looked for the person's earliest reachable workspace, so a person who closed the account and was then
-- removed from their only workspace could no longer undo, and staff could no longer move their erasure request, inside the
-- 30 days. Now the first close or erasure request records the workspace once (an append-only row); every later event of that
-- person, including undo and the staff status changes, uses it. Closing or filing for the first time still needs a workspace
-- the person can reach. Rows are added for the people who already have events, from the workspace their first event used.
-- (2) The refusal for a final account says what is true in both cases. Before, it said the request was with our team even
-- when no erasure request had been filed.
CREATE TABLE customer_private.account_chain (
 principal_id uuid PRIMARY KEY REFERENCES customer_private.principal(id),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER account_chain_immutable BEFORE UPDATE OR DELETE ON customer_private.account_chain FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.account_chain ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.account_chain FROM PUBLIC,corridra_runtime,corridra_auth;

INSERT INTO customer_private.account_chain(principal_id,tenant_id)
SELECT DISTINCT ON (e.aggregate_id) e.aggregate_id::uuid,e.tenant_id FROM app.domain_event e
WHERE e.aggregate_type='customer_account_lifecycle' ORDER BY e.aggregate_id,e.occurred_at,e.id;

DO $chain$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('customer_private.account_chain_tenant(uuid)'::regprocedure),'UTF8')),'hex')<>'cf424bb6fdbfa283d65f805117ee3f1188ad41ea787f58f3a8905c6abf8b9e81'
 THEN RAISE EXCEPTION 'Account lifecycle prerequisite differs: customer_private.account_chain_tenant'; END IF;
END $chain$;
CREATE OR REPLACE FUNCTION customer_private.account_chain_tenant(person uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen uuid;
BEGIN
 SELECT c.tenant_id INTO chosen FROM customer_private.account_chain c WHERE c.principal_id=person;
 IF chosen IS NOT NULL THEN RETURN chosen; END IF;
 SELECT w.tenant_id INTO chosen FROM customer.workspace w WHERE
  EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=w.tenant_id AND m.principal_id=person)
  OR EXISTS(SELECT FROM customer_private.workspace_member m WHERE m.tenant_id=w.tenant_id AND m.principal_id=person
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id))
 ORDER BY w.created_at,w.tenant_id LIMIT 1;
 IF chosen IS NULL THEN
  RAISE EXCEPTION 'There is no workspace on this account. Write to the privacy contact on the privacy page.' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.account_chain(principal_id,tenant_id) VALUES(person,chosen);
 RETURN chosen;
END $$;

DO $command$
DECLARE original text;updated text;
 none text:='''This request is with our team. Write to the privacy contact on the privacy page.''';
 filed text:='''This request is with our team (reference ''||eref||'').';
BEGIN
 original:=pg_get_functiondef('customer.account_lifecycle_command(uuid,text,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'d38c58e20109ed208a591752f6a2b3bd2c1070efe4987cbcd2a96563da7d6c48'
 THEN RAISE EXCEPTION 'Account lifecycle prerequisite differs: customer.account_lifecycle_command'; END IF;
 IF length(original)-length(replace(original,none,''))<>length(none) OR length(original)-length(replace(original,filed,''))<>length(filed)
 THEN RAISE EXCEPTION 'Account lifecycle replacement differs: customer.account_lifecycle_command'; END IF;
 updated:=replace(original,none,'''The 30 days to undo have ended. Write to the privacy contact on the privacy page.''');
 updated:=replace(updated,filed,'''The 30 days to undo have ended. Your erasure request has the reference ''||eref||''.');
 EXECUTE updated;
END $command$;
