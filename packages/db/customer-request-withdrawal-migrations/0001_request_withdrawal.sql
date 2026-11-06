-- CRUD G1: a person can withdraw a request they sent, and take the withdrawal back. Optional module: installing it
-- changes nothing anyone can see, because its control starts closed and only an offline schema-owner operation opens
-- it. Additive only: no existing table, policy, trigger or grant is changed, and it needs no mail module.
-- A withdrawal is a record, never a delete. Offline revocation (customer_private.request_revocation) stays separate
-- and stronger: a revoked request can be neither withdrawn nor restored. A customer function never writes the
-- team's mission; the team's own tools decide what to do about a withdrawal.
-- The reason a person gives is private to that person (only the owner's own list returns it); events and the audit
-- trail hold ids and a type, never the reason.
DO $guard$ BEGIN
 IF to_regprocedure('customer_private.real_admission_open()') IS NULL
 OR to_regprocedure('customer_private.request_actor()') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.request_revocation') IS NULL
 OR to_regclass('customer_private.real_use_configuration') IS NULL
 OR to_regclass('customer_private.configuration') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 OR to_regclass('app.mission') IS NULL
 THEN RAISE EXCEPTION 'Request withdrawal prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.request_withdrawal_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.request_withdrawal_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.request_withdrawal_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER request_withdrawal_control_immutable BEFORE UPDATE OR DELETE ON customer_private.request_withdrawal_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless real admission is open AND the latest control row says enabled. No row means closed.
CREATE FUNCTION customer_private.request_withdrawal_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.real_admission_open()
 AND coalesce((SELECT enabled FROM customer_private.request_withdrawal_control ORDER BY version DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION customer_private.request_withdrawal_open() FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE TABLE customer_private.request_withdrawal_event (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 state text NOT NULL CHECK(state IN ('withdrawn','restored')),
 reason text,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 command_id uuid NOT NULL UNIQUE,
 CHECK((state='withdrawn' AND reason IS NOT NULL AND length(reason) BETWEEN 10 AND 500) OR (state='restored' AND reason IS NULL))
);
CREATE INDEX request_withdrawal_event_request ON customer_private.request_withdrawal_event(request_id,seq DESC);
ALTER TABLE customer_private.request_withdrawal_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.request_withdrawal_event FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER request_withdrawal_event_immutable BEFORE UPDATE OR DELETE ON customer_private.request_withdrawal_event
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Withdrawn right now: the newest event decides, by its sequence number (never by a clock).
CREATE FUNCTION customer_private.request_withdrawn(request uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT e.state='withdrawn' FROM customer_private.request_withdrawal_event e WHERE e.request_id=request ORDER BY e.seq DESC LIMIT 1),false)
$$;
-- Whether any withdrawn period overlaps the time from a moment until now: it was withdrawn at that moment (the newest
-- event at or before it), or a withdrawal was recorded at or after it, or it is withdrawn now. A message or Move made
-- before or during a withdrawal must never go out because a restore came before it was sent.
CREATE FUNCTION customer_private.request_withdrawn_since(request uuid, since timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT e.state='withdrawn' FROM customer_private.request_withdrawal_event e
   WHERE e.request_id=request AND e.occurred_at<=since ORDER BY e.seq DESC LIMIT 1),false)
  OR EXISTS(SELECT FROM customer_private.request_withdrawal_event e WHERE e.request_id=request AND e.state='withdrawn' AND e.occurred_at>=since)
$$;
REVOKE ALL ON FUNCTION customer_private.request_withdrawn(uuid),customer_private.request_withdrawn_since(uuid,timestamptz) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The one existing reader that describes a request to its owner now says whether it is withdrawn, so a list can show
-- it under Withdrawn. The change is one key. It is made only if the live text is exactly the reviewed text of the
-- real-use module, so a newer or different definition stops the install instead of being overwritten.
DO $result$
DECLARE original text;updated text;reader_owner text;
BEGIN
 original:=pg_get_functiondef('customer_private.request_result(uuid,uuid)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'1e7c739fa0333a968d3b1318e15e27b3f99905798be393b0ff71ac0241bd36e2'
 THEN RAISE EXCEPTION 'Request withdrawal prerequisite differs: customer_private.request_result'; END IF;
 updated:=replace(original,'''available'',progress IS NOT NULL);','''available'',progress IS NOT NULL,''withdrawn'',customer_private.request_withdrawn(owned.id));');
 IF updated=original THEN RAISE EXCEPTION 'Request withdrawal replacement differs: customer_private.request_result'; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid='customer_private.request_result(uuid,uuid)'::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.request_withdrawn(uuid) TO %I',reader_owner);
 EXECUTE updated;
END $result$;

-- Ids and a type only, in the same events and audit trail the other customer records use.
CREATE FUNCTION customer_private.request_withdrawal_record(tenant uuid, event_type text, request uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();corr uuid:=gen_random_uuid();
BEGIN
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,tenant,event_type,1,'customer_private_request_withdrawal',request::text,1,executor,clock_timestamp(),corr,corr,jsonb_build_object('request_id',request));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),tenant,eid,executor,event_type);
END $$;
REVOKE ALL ON FUNCTION customer_private.request_withdrawal_record(uuid,text,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Signed-in. The person's own requests that are withdrawn now, newest first, each with the reason the person gave
-- (returned to the owner only) and whether withdrawing is open. Ids, a time and the person's own words.
CREATE FUNCTION customer.my_request_withdrawals() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();items jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',l.request_id,'at',l.occurred_at,'reason',l.reason) ORDER BY l.occurred_at DESC,l.request_id),'[]'::jsonb) INTO items
 FROM (SELECT DISTINCT ON (e.request_id) e.request_id,e.state,e.occurred_at,e.reason
   FROM customer_private.request_withdrawal_event e
   JOIN customer_private.owned_request o ON o.id=e.request_id
   WHERE o.principal_id=actor AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=e.request_id)
   ORDER BY e.request_id,e.seq DESC) l
 WHERE l.state='withdrawn';
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('open',customer_private.request_withdrawal_open(),'items',items);
END $$;

-- Signed-in. Only the person the request belongs to, never staff, never another member. One command id per decision:
-- a repeat answers with how things stand now and changes nothing; the same id for any other decision or request is
-- refused the same way. Withdrawing needs the control open and a reason; it is refused once the team has closed or
-- cancelled the mission (nothing is left to withdraw). Withdrawing deletes nothing and writes nothing of the team's.
CREATE FUNCTION customer.withdraw_request(request uuid, command uuid, why text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.request_withdrawal_event%ROWTYPE;
 was boolean;current_status text;note text:=btrim(why);
BEGIN
 IF request IS NULL OR command IS NULL OR note IS NULL OR length(note) NOT BETWEEN 10 AND 500
 THEN RAISE EXCEPTION 'Invalid withdrawal' USING ERRCODE='23514'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.request_withdrawal:'||request::text,0));
 was:=customer_private.request_withdrawn(request);
 SELECT * INTO prior FROM customer_private.request_withdrawal_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>'withdrawn' THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('withdrawn',was,'changed',false,'replayed',true);
 END IF;
 IF was THEN RETURN jsonb_build_object('withdrawn',true,'changed',false); END IF;
 IF NOT customer_private.request_withdrawal_open() THEN
  RETURN jsonb_build_object('withdrawn',false,'changed',false,'reason','closed');
 END IF;
 SELECT m.status INTO current_status FROM app.mission m WHERE m.tenant_id=owned.mission_tenant_id AND m.id=owned.mission_id;
 IF current_status IN ('CLOSED','CANCELLED') THEN
  RETURN jsonb_build_object('withdrawn',false,'changed',false,'reason','not-withdrawable');
 END IF;
 BEGIN
  INSERT INTO customer_private.request_withdrawal_event(request_id,principal_id,state,reason,command_id)
  VALUES(request,actor,'withdrawn',note,command);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501';
 END;
 PERFORM customer_private.request_withdrawal_record(owned.workspace_id,'customer.request.withdrawn',request);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('withdrawn',true,'changed',true);
END $$;

-- Signed-in. Takes a withdrawal back. Never needs the control open, so a paused control can never trap a withdrawal.
-- Restoring never sends or queues anything: anything made during the withdrawal stays blocked.
CREATE FUNCTION customer.restore_request(request uuid, command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.request_withdrawal_event%ROWTYPE;
 was boolean;
BEGIN
 IF request IS NULL OR command IS NULL THEN RAISE EXCEPTION 'Invalid withdrawal' USING ERRCODE='23514'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.request_withdrawal:'||request::text,0));
 was:=customer_private.request_withdrawn(request);
 SELECT * INTO prior FROM customer_private.request_withdrawal_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>'restored' THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('withdrawn',was,'changed',false,'replayed',true);
 END IF;
 IF NOT was THEN RETURN jsonb_build_object('withdrawn',false,'changed',false); END IF;
 BEGIN
  INSERT INTO customer_private.request_withdrawal_event(request_id,principal_id,state,reason,command_id)
  VALUES(request,actor,'restored',NULL,command);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501';
 END;
 PERFORM customer_private.request_withdrawal_record(owned.workspace_id,'customer.request.restored',request);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('withdrawn',false,'changed',true);
END $$;

REVOKE ALL ON FUNCTION customer.my_request_withdrawals(),customer.withdraw_request(uuid,uuid,text),customer.restore_request(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.my_request_withdrawals(),customer.withdraw_request(uuid,uuid,text),customer.restore_request(uuid,uuid) TO corridra_runtime;
