-- Short request reference (owner, 23 Nov 2026: "short request references (RQ-000001)"). Every customer request gets one
-- short, unique reference that never changes, in the same shape as the problem report reference (RP-000001).
-- Purely additive. customer_private.owned_request is not altered and no existing row of any table is rewritten: the
-- reference lives in one new side table, filled once for the requests that already exist (oldest first) and, from then
-- on, by a trigger in the same transaction that creates the request. The side table is append-only.
-- The reference is a label, not an authority: nothing is ever authorised by it, and it is read only through
-- customer.request_references, which answers for the caller's own, unrevoked requests in a workspace they are a
-- current member of (the rule of customer.private_requests after the removed-member change).
-- Numbers past 999999 keep every digit (RQ-1000000), so the reference stays unique and a request is never refused.
DO $guard$ BEGIN
 IF to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.request_revocation') IS NULL
 OR to_regprocedure('customer_private.request_actor()') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL THEN
  RAISE EXCEPTION 'Request reference prerequisite is missing';
 END IF;
END $guard$;

CREATE TABLE customer_private.request_reference (
 request_id uuid PRIMARY KEY REFERENCES customer_private.owned_request(id),
 number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 reference text GENERATED ALWAYS AS ('RQ-'||lpad(number::text,greatest(6,length(number::text)),'0')) STORED UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.request_reference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.request_reference FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER request_reference_immutable BEFORE UPDATE OR DELETE ON customer_private.request_reference
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
COMMENT ON TABLE customer_private.request_reference IS
 'One short reference (RQ-000001) per customer request. Append-only; a label, never an authority.';

-- Gives a new request its reference in the transaction that creates it. A repeat for the same request changes nothing.
CREATE FUNCTION customer_private.assign_request_reference() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO customer_private.request_reference(request_id) VALUES(NEW.id) ON CONFLICT (request_id) DO NOTHING;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION customer_private.assign_request_reference() FROM PUBLIC,corridra_runtime,corridra_auth;

-- The trigger is made first: making it holds a lock that keeps new requests out until this file commits, so no
-- request can fall between the trigger and the one-time fill below.
CREATE TRIGGER owned_request_reference AFTER INSERT ON customer_private.owned_request
 FOR EACH ROW EXECUTE FUNCTION customer_private.assign_request_reference();
INSERT INTO customer_private.request_reference(request_id)
 SELECT r.id FROM customer_private.owned_request r ORDER BY r.created_at,r.id
 ON CONFLICT (request_id) DO NOTHING;

-- The references of the caller's own requests, as an object keyed by request id. Ids that are unknown, another
-- person's, revoked, or in a workspace the caller has left are simply absent: the answer never tells them apart.
CREATE FUNCTION customer.request_references(requests uuid[]) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); found jsonb;
BEGIN
 IF requests IS NULL OR cardinality(requests)>100 THEN RAISE EXCEPTION 'Invalid request list' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_object_agg(r.id::text,x.reference),'{}'::jsonb) INTO found
 FROM customer_private.owned_request r JOIN customer_private.request_reference x ON x.request_id=r.id
 WHERE r.id=ANY(requests) AND r.principal_id=actor
 AND customer_private.workspace_member_current(r.workspace_id,actor)
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN found;
END $$;
REVOKE ALL ON FUNCTION customer.request_references(uuid[]) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.request_references(uuid[]) TO corridra_runtime;

-- The definer is owned by whoever installs it. It calls three helpers, so its owner must be able to.
DO $owner$
DECLARE holder text; helper text;
BEGIN
 SELECT pg_get_userbyid(p.proowner) INTO holder FROM pg_proc p WHERE p.oid='customer.request_references(uuid[])'::regprocedure;
 FOREACH helper IN ARRAY ARRAY['customer_private.request_actor()','customer.actor_id()','customer_private.workspace_member_current(uuid,uuid)'] LOOP
  IF NOT has_function_privilege(holder,helper,'EXECUTE') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
  END IF;
 END LOOP;
END
$owner$;
