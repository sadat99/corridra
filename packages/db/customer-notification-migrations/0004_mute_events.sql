-- CRUD G6, Pulse side: a person can undo a mute. 0001 to 0003 are installed or about to be and their hashes are
-- checked, so none is edited and the mute table 0001 made keeps its one row per request, written only by the first
-- mute. Every later change of mind is a row in a new append-only event table. "Muted" is the newest event by its sequence number, or the first
-- mute row when there is no event. Nothing is updated or deleted.
-- Only the person the request belongs to can unmute it. Nothing here queues, re-queues or sends any message:
-- messages suppressed while muted stay suppressed, and messages resume only when made after an unmute.
-- Nothing here stores an address or message text; events hold ids and the way the change was made.
DO $guard$
BEGIN
 IF to_regclass('customer_private.notification_mute') IS NULL
  OR to_regprocedure('customer_private.request_actor()') IS NULL
  OR to_regprocedure('customer.actor_id()') IS NULL
  OR to_regprocedure('customer_private.notification_open()') IS NULL
  OR to_regprocedure('customer_private.notification_record(uuid,text,text,text,jsonb,boolean)') IS NULL
  OR to_regprocedure('app.reject_rewrite()') IS NULL
 THEN RAISE EXCEPTION 'Notification mute events need the notification module'; END IF;
END $guard$;

CREATE TABLE customer_private.notification_mute_event (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 state text NOT NULL CHECK(state IN ('muted','unmuted')),
 via text NOT NULL CHECK(via IN ('link','signed-in')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 command_id uuid NOT NULL UNIQUE
);
CREATE INDEX notification_mute_event_request ON customer_private.notification_mute_event(request_id,seq DESC);
ALTER TABLE customer_private.notification_mute_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.notification_mute_event FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER notification_mute_event_immutable BEFORE UPDATE OR DELETE ON customer_private.notification_mute_event
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- The one place that says whether a request is muted right now. The newest event decides, by its sequence number
-- (never by a clock); with no event, the first mute row decides. A mute link or a signed-in change always records
-- an event when it changes the answer, so the old row is never needed once an event exists.
CREATE FUNCTION customer_private.notification_muted(request uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT e.state='muted' FROM customer_private.notification_mute_event e WHERE e.request_id=request ORDER BY e.seq DESC LIMIT 1),
  EXISTS(SELECT FROM customer_private.notification_mute m WHERE m.request_id=request))
$$;
REVOKE ALL ON FUNCTION customer_private.notification_muted(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Whether any muted period overlaps the time from a moment until now: it was muted at that moment, or a mute was
-- recorded at or after it (the first mute row, or a muted event), or it is muted now. A Move is set in one
-- transaction and enqueued in another up to ten minutes later; a Move set before or during a muted period must
-- never send just because the enqueue ran after an unmute. The state at the moment is the newest event at or before
-- it, by sequence number; with no such event, the first mute row if it was made by then.
CREATE FUNCTION customer_private.notification_muted_since(request uuid, since timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT e.state='muted' FROM customer_private.notification_mute_event e
   WHERE e.request_id=request AND e.occurred_at<=since ORDER BY e.seq DESC LIMIT 1),
   EXISTS(SELECT FROM customer_private.notification_mute m WHERE m.request_id=request AND m.created_at<=since))
  OR EXISTS(SELECT FROM customer_private.notification_mute_event e WHERE e.request_id=request AND e.state='muted' AND e.occurred_at>=since)
  OR EXISTS(SELECT FROM customer_private.notification_mute m WHERE m.request_id=request AND m.created_at>=since)
$$;
REVOKE ALL ON FUNCTION customer_private.notification_muted_since(uuid,timestamptz) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The two readers of the old mute row now ask the helpers. Each is replaced only if its live text is exactly the
-- reviewed text of 0001, so a newer or different definition stops the install instead of being overwritten.
-- A pending message is valid only if no muted period overlaps the time since it was made. The Move enqueue asks the
-- same question about the Move's own creation time, and asks it AFTER both advisory locks, the ones a mute takes, so
-- a mute that commits while the enqueue waits is always seen.
DO $readers$
DECLARE signature text;original text;updated text;reader_owner text;
BEGIN
 signature:='customer_private.notification_valid(customer_private.notification_outbox)';
 original:=pg_get_functiondef(signature::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'4a82adb8dd0e951b26661b5705b0525c5af2bb5f682eaa6c9fb4166de3f28f6f'
 THEN RAISE EXCEPTION 'Mute reader prerequisite differs: %',signature; END IF;
 updated:=replace(original,'EXISTS(SELECT FROM customer_private.notification_mute WHERE request_id=row_.request_id)','customer_private.notification_muted_since(row_.request_id,row_.created_at)');
 IF updated=original OR position('customer_private.notification_mute ' IN updated)>0
 THEN RAISE EXCEPTION 'Mute reader replacement differs: %',signature; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=signature::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.notification_muted(uuid),customer_private.notification_muted_since(uuid,timestamptz) TO %I',reader_owner);
 EXECUTE updated;

 signature:='customer.enqueue_move_notifications(uuid)';
 original:=pg_get_functiondef(signature::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'42e46a4420378d40c40eb2c3f982c5947606ab3121d65398773c26e036b35076'
 THEN RAISE EXCEPTION 'Mute reader prerequisite differs: %',signature; END IF;
 updated:=replace(original,'IF EXISTS(SELECT FROM customer_private.notification_mute WHERE request_id=owned.id) THEN skipped:=''muted''; CONTINUE; END IF;','NULL;');
 updated:=replace(updated,'PERFORM pg_advisory_xact_lock(hashtextextended(''customer.notification:''||owned.id::text,0));','PERFORM pg_advisory_xact_lock(hashtextextended(''customer.notification:''||owned.id::text,0));'
  ||chr(10)||'   IF customer_private.notification_muted_since(owned.id,cmd.created_at) THEN skipped:=''muted''; CONTINUE; END IF;');
 IF updated=original OR position('customer_private.notification_mute ' IN updated)>0
  OR position('notification_muted_since(owned.id,cmd.created_at)' IN updated)=0
  OR position('notification_muted_since(owned.id,cmd.created_at)' IN updated)<position('customer.notification:''||owned.id' IN updated)
 THEN RAISE EXCEPTION 'Mute reader replacement differs: %',signature; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=signature::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.notification_muted(uuid),customer_private.notification_muted_since(uuid,timestamptz) TO %I',reader_owner);
 EXECUTE updated;
END $readers$;

-- The mute link in an old email still works with no sign-in, and now also mutes again after an unmute. The first
-- mute still writes the old row; a later one writes an event. Same answers, same refusals, same suppression.
DO $mute$
BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('customer.mute_notifications(uuid,text)'::regprocedure),'UTF8')),'hex')
  <>'6b5598505229af7ecb92fe28c63f43340a70ca337bbcc948c6d30c58b225c426'
 THEN RAISE EXCEPTION 'Mute link prerequisite differs'; END IF;
END $mute$;
CREATE OR REPLACE FUNCTION customer.mute_notifications(request uuid, token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owned customer_private.owned_request%ROWTYPE;was boolean;
BEGIN
 IF request IS NULL OR token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.notification_outbox WHERE request_id=request AND mute_token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'))
 THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification:'||request::text,0));
 was:=customer_private.notification_muted(request);
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request;
 -- Already muted, by either route: nothing is written. A change from not muted to muted writes the old row if it
 -- was never written (as before) and always records an event, so the answer never depends on which came first.
 IF NOT was THEN
  INSERT INTO customer_private.notification_mute(request_id) VALUES(request) ON CONFLICT(request_id) DO NOTHING;
  INSERT INTO customer_private.notification_mute_event(request_id,principal_id,state,via,command_id)
  VALUES(request,owned.principal_id,'muted','link',gen_random_uuid());
 END IF;
 UPDATE customer_private.notification_outbox SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL
 WHERE request_id=request AND status IN ('PENDING','LEASED');
 IF NOT was THEN
  PERFORM customer_private.notification_record(owned.workspace_id,'customer.notification.muted','customer_private_notification_mute',request::text,
   jsonb_build_object('request_id',request),false);
 END IF;
 RETURN jsonb_build_object('muted',true,'already',was);
END $$;

-- Signed-in. The person's own requests that were ever muted, newest change first, with whether each is muted now.
-- Ids, a state and a time. Never an address.
CREATE FUNCTION customer.my_notification_mutes() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',t.request_id,'muted',t.state='muted','at',t.at) ORDER BY t.at DESC,t.request_id),'[]'::jsonb) INTO result
 FROM (SELECT l.request_id,l.state,l.at FROM (
   SELECT DISTINCT ON (s.request_id) s.request_id,s.state,s.at FROM (
    SELECT m.request_id,'muted'::text AS state,m.created_at AS at,0::bigint AS n FROM customer_private.notification_mute m
     JOIN customer_private.owned_request o ON o.id=m.request_id WHERE o.principal_id=actor
    UNION ALL
    SELECT e.request_id,e.state,e.occurred_at,e.seq FROM customer_private.notification_mute_event e
     JOIN customer_private.owned_request o ON o.id=e.request_id WHERE o.principal_id=actor) s
   WHERE NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=s.request_id)
   ORDER BY s.request_id,s.n DESC) l
  ORDER BY l.at DESC,l.request_id LIMIT 100) t;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- Signed-in. Only the person the request belongs to. One command id per decision: a repeat of the same decision
-- returns the same answer and changes nothing, the same id for any other decision is refused. Turning messages back
-- on needs the control to be open (turning them off never does). Muting again also stops messages already waiting.
-- Unmuting never queues, re-queues or sends anything.
CREATE FUNCTION customer.set_notification_mute(request uuid, command uuid, mute boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();owned customer_private.owned_request%ROWTYPE;prior customer_private.notification_mute_event%ROWTYPE;
 want text;was boolean;
BEGIN
 IF request IS NULL OR command IS NULL OR mute IS NULL THEN RAISE EXCEPTION 'Invalid mute choice' USING ERRCODE='23514'; END IF;
 want:=CASE WHEN mute THEN 'muted' ELSE 'unmuted' END;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND OR EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=request)
 THEN RAISE EXCEPTION 'Request is not available' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification:'||request::text,0));
 was:=customer_private.notification_muted(request);
 SELECT * INTO prior FROM customer_private.notification_mute_event WHERE command_id=command;
 IF FOUND THEN
  IF prior.request_id<>request OR prior.principal_id<>actor OR prior.state<>want THEN RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501'; END IF;
  -- A repeat answers with how things stand now, never with what that command once asked for.
  RETURN jsonb_build_object('muted',was,'changed',false,'replayed',true);
 END IF;
 IF NOT mute AND NOT customer_private.notification_open() THEN
  RETURN jsonb_build_object('muted',was,'changed',false,'reason','closed');
 END IF;
 IF was=mute THEN RETURN jsonb_build_object('muted',was,'changed',false); END IF;
 BEGIN
  INSERT INTO customer_private.notification_mute_event(request_id,principal_id,state,via,command_id)
  VALUES(request,actor,want,'signed-in',command);
 EXCEPTION WHEN unique_violation THEN
  -- The same command id used for another request at the same moment: the same refusal as any reused id.
  RAISE EXCEPTION 'Command is not valid' USING ERRCODE='42501';
 END;
 IF mute THEN
  UPDATE customer_private.notification_outbox SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL
  WHERE request_id=request AND status IN ('PENDING','LEASED');
 END IF;
 -- Turning messages on again is the choice that matters most, so its record is never skipped.
 PERFORM customer_private.notification_record(owned.workspace_id,CASE WHEN mute THEN 'customer.notification.muted' ELSE 'customer.notification.unmuted' END,
  'customer_private_notification_mute',request::text,jsonb_build_object('request_id',request),NOT mute);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('muted',mute,'changed',true);
END $$;

REVOKE ALL ON FUNCTION customer.my_notification_mutes(),customer.set_notification_mute(uuid,uuid,boolean) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.my_notification_mutes(),customer.set_notification_mute(uuid,uuid,boolean) TO corridra_runtime;
