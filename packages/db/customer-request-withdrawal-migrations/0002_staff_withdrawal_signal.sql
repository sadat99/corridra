-- CRUD G1 follow-up: the Corridra team can see that the customer withdrew a request. Additive only: one new read-only
-- function, nothing existing is changed. It answers two facts about one mission, whether its request is withdrawn right
-- now and when that withdrawal was recorded. It never returns the reason the customer gave, writes nothing, and the
-- team's own tools still decide what to do. A request the schema owner revoked offline shows no signal.
-- Who may read it: a signed-in member of the mission's own workspace with a role that can read missions, in the
-- processing purpose of that session. A person from another workspace, or a customer session, is refused; a mission id
-- that belongs to another workspace answers exactly like a mission with no withdrawal.
DO $guard$ BEGIN
 IF to_regclass('customer_private.request_withdrawal_event') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.request_revocation') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Staff withdrawal signal prerequisites are missing'; END IF;
END $guard$;

CREATE FUNCTION app.mission_request_withdrawal(mission uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id();t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;hit timestamptz;
BEGIN
 IF actor IS NULL OR t IS NULL OR mission IS NULL
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin','operator','reviewer','viewer')
 THEN RAISE EXCEPTION 'Mission access denied' USING ERRCODE='42501'; END IF;
 -- The newest event of each request decides, by its sequence number (never by a clock).
 SELECT max(l.occurred_at) INTO hit
 FROM (SELECT DISTINCT ON (e.request_id) e.state,e.occurred_at
   FROM customer_private.request_withdrawal_event e
   JOIN customer_private.owned_request o ON o.id=e.request_id
   WHERE o.mission_tenant_id=t AND o.mission_id=mission
   AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=e.request_id)
   ORDER BY e.request_id,e.seq DESC) l
 WHERE l.state='withdrawn';
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Mission access denied' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('withdrawn',hit IS NOT NULL,'at',hit);
END $$;
REVOKE ALL ON FUNCTION app.mission_request_withdrawal(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.mission_request_withdrawal(uuid) TO corridra_runtime;
