-- CRUD G6: a person can undo a mute. 0001 is installed or about to be and its hash is checked, so it is not edited
-- and the mute table it made keeps its one row per request, written only by the first mute. Every later change of
-- mind is a row in a new append-only event table. "Muted" is then the newest of the two: the first mute row read as
-- a muted event at its time, and the events. Nothing is updated or deleted; the history stays exact.
-- Only the person the request belongs to can unmute it. Nothing here queues, re-queues or sends any mail: mail
-- that was suppressed while muted stays suppressed, and mail resumes only for messages made after an unmute.
-- Nothing here stores an address or message text; events hold ids and the way the change was made.
DO $guard$
BEGIN
 IF to_regclass('customer_private.mission_mail_mute') IS NULL
  OR to_regprocedure('customer_private.request_actor()') IS NULL
  OR to_regprocedure('customer.actor_id()') IS NULL
  OR to_regprocedure('customer_private.mission_mail_open()') IS NULL
  OR to_regprocedure('app.reject_rewrite()') IS NULL
 THEN RAISE EXCEPTION 'Mission mail mute events need the mission mail module'; END IF;
END $guard$;

CREATE TABLE customer_private.mission_mail_mute_event (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 state text NOT NULL CHECK(state IN ('muted','unmuted')),
 via text NOT NULL CHECK(via IN ('link','signed-in')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 command_id uuid NOT NULL UNIQUE
);
CREATE INDEX mission_mail_mute_event_request ON customer_private.mission_mail_mute_event(request_id,seq DESC);
ALTER TABLE customer_private.mission_mail_mute_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.mission_mail_mute_event FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER mission_mail_mute_event_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_mail_mute_event
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- The one place that says whether a request is muted right now. Every reader asks it.
CREATE FUNCTION customer_private.mission_mail_muted(request uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT s.state='muted' FROM (
   SELECT 'muted'::text AS state,m.created_at AS at,0::bigint AS n FROM customer_private.mission_mail_mute m WHERE m.request_id=request
   UNION ALL
   SELECT e.state,e.occurred_at,e.seq FROM customer_private.mission_mail_mute_event e WHERE e.request_id=request) s
  ORDER BY s.at DESC,s.n DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION customer_private.mission_mail_muted(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Ids and a type only, in the same events and audit trail the first mute already uses.
CREATE FUNCTION customer_private.mission_mail_record(tenant uuid, event_type text, request uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();corr uuid:=gen_random_uuid();
BEGIN
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RETURN; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,tenant,event_type,1,'customer_private_mission_mail_mute',request::text,1,executor,clock_timestamp(),corr,corr,jsonb_build_object('request_id',request));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),tenant,eid,executor,event_type);
END $$;
REVOKE ALL ON FUNCTION customer_private.mission_mail_record(uuid,text,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The two readers of the old mute row now ask the helper. Each is replaced only if its live text is exactly the
-- reviewed text of 0001, so a newer or different definition stops the install instead of being overwritten.
DO $readers$
DECLARE spec record;original text;updated text;reader_owner text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text)','88bc165f9048f61336cf7f340084ab363cf66d42e71280db60c8649d60f4211a',
   'EXISTS(SELECT FROM customer_private.mission_mail_mute WHERE request_id=request)','customer_private.mission_mail_muted(request)'),
  ('customer.claim_mission_mail(uuid,text)','f5f5cf67c05ec2b1d4c2e96195215b4a5c9321e273c4da63ee5d5d23a77cdeb5',
   'EXISTS(SELECT FROM customer_private.mission_mail_mute WHERE request_id=q.request_id)','customer_private.mission_mail_muted(q.request_id)')
 ) AS v(signature,fingerprint,old_text,new_text) LOOP
  original:=pg_get_functiondef(spec.signature::regprocedure);
  IF encode(sha256(convert_to(original,'UTF8')),'hex')<>spec.fingerprint THEN
   RAISE EXCEPTION 'Mute reader prerequisite differs: %',spec.signature;
  END IF;
  updated:=replace(original,spec.old_text,spec.new_text);
  IF updated=original OR position('customer_private.mission_mail_mute ' IN updated)>0 THEN
   RAISE EXCEPTION 'Mute reader replacement differs: %',spec.signature;
  END IF;
  SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=spec.signature::regprocedure;
  EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.mission_mail_muted(uuid) TO %I',reader_owner);
  EXECUTE updated;
 END LOOP;
END $readers$;

-- The mute link in an old email still works with no sign-in, and now also mutes again after an unmute. The first
-- mute still writes the old row; a later one writes an event. Same answers, same refusals, same suppression.
DO $mute$
BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('customer.mute_mission_mail(uuid,text)'::regprocedure),'UTF8')),'hex')
  <>'6de6de981ec933a1a9c8c3a3a4ac8aaf8da73c28e18c4000e27fc3b5b64bf487'
 THEN RAISE EXCEPTION 'Mute link prerequisite differs'; END IF;
END $mute$;
CREATE OR REPLACE FUNCTION customer.mute_mission_mail(request uuid, token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owned customer_private.owned_request%ROWTYPE;added integer;was boolean;again boolean:=false;
BEGIN
 IF request IS NULL OR token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.mission_mail_queue WHERE request_id=request AND mute_token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'))
 THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_mail:'||request::text,0));
 was:=customer_private.mission_mail_muted(request);
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request;
 INSERT INTO customer_private.mission_mail_mute(request_id) VALUES(request) ON CONFLICT(request_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 IF added=0 AND NOT was THEN
  INSERT INTO customer_private.mission_mail_mute_event(request_id,principal_id,state,via,command_id)
  VALUES(request,owned.principal_id,'muted','link',gen_random_uuid());
  again:=true;
 END IF;
 UPDATE customer_private.mission_mail_queue SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL
 WHERE request_id=request AND status IN ('PENDING','LEASED');
 DELETE FROM customer_private.mission_mail_recipient r USING customer_private.mission_mail_queue x
 WHERE x.id=r.queue_id AND x.request_id=request AND x.status IN ('SENT','DEAD','SUPPRESSED');
 IF added=1 OR again THEN PERFORM customer_private.mission_mail_record(owned.workspace_id,'customer.mission_mail.muted',request); END IF;
 RETURN jsonb_build_object('muted',true,'already',added=0 AND NOT again);
END $$;

-- Signed-in. The person's own requests that were ever muted, newest change first, with whether each is muted now.
-- Ids, a state and a time. Never an address.
CREATE FUNCTION customer.my_mission_mail_mutes() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',t.request_id,'muted',t.state='muted','at',t.at) ORDER BY t.at DESC,t.request_id),'[]'::jsonb) INTO result
 FROM (SELECT l.request_id,l.state,l.at FROM (
   SELECT DISTINCT ON (s.request_id) s.request_id,s.state,s.at FROM (
    SELECT m.request_id,'muted'::text AS state,m.created_at AS at,0::bigint AS n FROM customer_private.mission_mail_mute m
     JOIN customer_private.owned_request o ON o.id=m.request_id WHERE o.principal_id=actor
    UNION ALL
    SELECT e.request_id,e.state,e.occurred_at,e.seq FROM customer_private.mission_mail_mute_event e
     JOIN customer_private.owned_request o ON o.id=e.request_id WHERE o.principal_id=actor) s
   ORDER BY s.request_id,s.at DESC,s.n DESC) l
  ORDER BY l.at DESC,l.request_id LIMIT 100) t;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- Signed-in. Only the person the request belongs to. One command id per decision: a repeat of the same decision
-- returns the same answer and changes nothing, the same id for any other decision is refused. Turning mail back on
-- needs the control to be open (turning it off never does). Muting again also stops mail already waiting.
-- Unmuting never queues, re-queues or sends anything.
CREATE FUNCTION customer.set_mission_mail_mute(request uuid, command uuid, mute boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.mission_mail_mute_event%ROWTYPE;
 want text;was boolean;
BEGIN
 IF request IS NULL OR command IS NULL OR mute IS NULL THEN RAISE EXCEPTION 'Invalid mute choice' USING ERRCODE='23514'; END IF;
 want:=CASE WHEN mute THEN 'muted' ELSE 'unmuted' END;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_mail:'||request::text,0));
 SELECT * INTO prior FROM customer_private.mission_mail_mute_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>want THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('muted',want='muted','changed',false,'replayed',true);
 END IF;
 was:=customer_private.mission_mail_muted(request);
 IF NOT mute AND NOT customer_private.mission_mail_open() THEN
  RETURN jsonb_build_object('muted',was,'changed',false,'reason','closed');
 END IF;
 IF was=mute THEN RETURN jsonb_build_object('muted',was,'changed',false); END IF;
 INSERT INTO customer_private.mission_mail_mute_event(request_id,principal_id,state,via,command_id)
 VALUES(request,actor,want,'signed-in',command);
 IF mute THEN
  UPDATE customer_private.mission_mail_queue SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL
  WHERE request_id=request AND status IN ('PENDING','LEASED');
  DELETE FROM customer_private.mission_mail_recipient r USING customer_private.mission_mail_queue x
  WHERE x.id=r.queue_id AND x.request_id=request AND x.status IN ('SENT','DEAD','SUPPRESSED');
 END IF;
 PERFORM customer_private.mission_mail_record(owned.workspace_id,CASE WHEN mute THEN 'customer.mission_mail.muted' ELSE 'customer.mission_mail.unmuted' END,request);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('muted',mute,'changed',true);
END $$;

REVOKE ALL ON FUNCTION customer.my_mission_mail_mutes(),customer.set_mission_mail_mute(uuid,uuid,boolean) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.my_mission_mail_mutes(),customer.set_mission_mail_mute(uuid,uuid,boolean) TO corridra_runtime;
