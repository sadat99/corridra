-- Pulse notification records (ADR-067): email about what needs a person. Optional authority; installing
-- this schema alone sends nothing. The control starts closed and only an offline schema-owner operation
-- opens it. Additive only: no existing table, policy, trigger, grant or function is changed, and mission
-- mail (customer_mission_mail_migrations) is neither read nor written here.
-- No address is kept. The outbox holds ids, a plain title and a date; the application resolves the
-- recipient at send time from the verified account and the database never sees it.
-- History is exact: preferences and mutes are append only; an outbox row only moves forward.

DO $guard$ BEGIN
 IF to_regprocedure('customer_private.real_admission_open()') IS NULL
 OR to_regprocedure('customer_private.request_actor()') IS NULL
 OR to_regprocedure('customer_private.move_open()') IS NULL
 OR to_regprocedure('customer.actor_id()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.principal') IS NULL
 OR to_regclass('customer_private.request_revocation') IS NULL
 OR to_regclass('customer_private.configuration') IS NULL
 OR to_regclass('app.mission_move') IS NULL
 OR to_regclass('app.mission_move_close') IS NULL
 OR to_regclass('app.mission_move_command') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 OR to_regclass('app.audit_event') IS NULL
 THEN RAISE EXCEPTION 'Notification prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.notification_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.notification_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.notification_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER notification_control_immutable BEFORE UPDATE OR DELETE ON customer_private.notification_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless real admission is open AND the latest control row says enabled. No row means closed.
CREATE FUNCTION customer_private.notification_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.real_admission_open()
 AND coalesce((SELECT enabled FROM customer_private.notification_control ORDER BY version DESC LIMIT 1),false)
$$;

-- What a person chose. A new version replaces the old one; every version stays. No row means the
-- defaults: all four kinds, no digest, no quiet hours, English.
CREATE TABLE customer_private.notification_preference (
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 version integer NOT NULL CHECK(version>0),
 kinds text[] NOT NULL CHECK(kinds <@ ARRAY['your-move','update','countdown','complete']::text[] AND cardinality(kinds)<=4),
 digest boolean NOT NULL,
 quiet_start time,quiet_end time,
 time_zone text NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 64),
 language text CHECK(language IS NULL OR language IN ('en','bn','zh','es','ar')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(principal_id,version),
 CHECK((quiet_start IS NULL)=(quiet_end IS NULL)),
 CHECK(quiet_start IS NULL OR quiet_start<>quiet_end)
);
ALTER TABLE customer_private.notification_preference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.notification_preference FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER notification_preference_immutable BEFORE UPDATE OR DELETE ON customer_private.notification_preference
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- One row per request when muted. Ids only. Append only: unmuting is a later, separate change.
CREATE TABLE customer_private.notification_mute (
 request_id uuid PRIMARY KEY REFERENCES customer_private.owned_request(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.notification_mute ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.notification_mute FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER notification_mute_immutable BEFORE UPDATE OR DELETE ON customer_private.notification_mute
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Messages to send. Ids, a plain title (the Corridra team's validated Move words) and a real date. Never an
-- address, a name, a price or free text. A message is valid for 24 hours after it can first be sent, so
-- quiet hours and a daily digest only delay it; they never make it expire sooner.
CREATE TABLE customer_private.notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 kind text NOT NULL CHECK(kind IN ('your-move','update','countdown','complete')),
 ref_id uuid,
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 80),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 120 AND title !~ '[[:cntrl:]<>]'),
 ref_date date,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','LEASED','SENT','DEAD','SUPPRESSED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL,
 lease_until timestamptz,
 group_id uuid,
 capability_hash text CHECK(capability_hash ~ '^[a-f0-9]{64}$'),
 mute_token_hash text CHECK(mute_token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 finished_at timestamptz,
 UNIQUE(request_id,kind,dedupe_key),
 CHECK((status IN ('SENT','DEAD','SUPPRESSED'))=(finished_at IS NOT NULL)),
 CHECK(expires_at>available_at AND expires_at<=available_at+interval '24 hours 1 second'),
 CHECK(kind<>'your-move' OR ref_id IS NOT NULL)
);
CREATE INDEX notification_outbox_person_idx ON customer_private.notification_outbox(principal_id,created_at);
ALTER TABLE customer_private.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.notification_outbox FROM PUBLIC,corridra_runtime,corridra_auth;

-- Rows are never deleted, identity columns never change, a sealed digest never changes, finished rows never change again.
CREATE FUNCTION customer_private.notification_outbox_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history is append only' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.request_id,NEW.principal_id,NEW.kind,NEW.ref_id,NEW.dedupe_key,NEW.title,NEW.ref_date,NEW.created_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.request_id,OLD.principal_id,OLD.kind,OLD.ref_id,OLD.dedupe_key,OLD.title,OLD.ref_date,OLD.created_at,OLD.expires_at)
 THEN RAISE EXCEPTION 'Notification identity cannot change' USING ERRCODE='42501'; END IF;
 IF OLD.capability_hash IS NOT NULL AND NEW.capability_hash IS DISTINCT FROM OLD.capability_hash THEN RAISE EXCEPTION 'Notification seal cannot change' USING ERRCODE='42501'; END IF;
 IF OLD.mute_token_hash IS NOT NULL AND NEW.mute_token_hash IS DISTINCT FROM OLD.mute_token_hash THEN RAISE EXCEPTION 'Notification seal cannot change' USING ERRCODE='42501'; END IF;
 IF OLD.status IN ('SENT','DEAD','SUPPRESSED') THEN RAISE EXCEPTION 'Finished notification cannot change' USING ERRCODE='42501'; END IF;
 IF NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'Notification attempts cannot go back' USING ERRCODE='42501'; END IF;
 IF NOT ((OLD.status='PENDING' AND NEW.status IN ('PENDING','LEASED','DEAD','SUPPRESSED'))
 OR (OLD.status='LEASED' AND NEW.status IN ('PENDING','LEASED','SENT','DEAD','SUPPRESSED')))
 THEN RAISE EXCEPTION 'Notification state change is not allowed' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_outbox_guard BEFORE UPDATE OR DELETE ON customer_private.notification_outbox
 FOR EACH ROW EXECUTE FUNCTION customer_private.notification_outbox_guard();

-- When a message can first be sent, in the person's own time zone. A digest waits for the next 08:00 local;
-- quiet hours push a time that falls inside them to the end of the quiet window. Both only delay.
-- A time that needs no change is returned exactly as given.
CREATE FUNCTION customer_private.notification_due_at(at timestamptz, tz text, quiet_start time, quiet_end time, digest boolean) RETURNS timestamptz
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE local_now timestamp;due timestamp;t time;in_quiet boolean:=false;moved boolean:=false;
BEGIN
 local_now:=at AT TIME ZONE tz;due:=local_now;
 IF digest THEN
  due:=date_trunc('day',local_now)+time '08:00';
  IF due<=local_now THEN due:=due+interval '1 day'; END IF;
  moved:=true;
 END IF;
 IF quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND quiet_start<>quiet_end THEN
  t:=due::time;
  IF quiet_start<quiet_end THEN in_quiet:=t>=quiet_start AND t<quiet_end;
  ELSE in_quiet:=t>=quiet_start OR t<quiet_end; END IF;
  IF in_quiet THEN
   due:=date_trunc('day',due)+quiet_end;
   IF quiet_start>quiet_end AND t>=quiet_start THEN due:=due+interval '1 day'; END IF;
   moved:=true;
  END IF;
 END IF;
 IF NOT moved THEN RETURN at; END IF;
 RETURN due AT TIME ZONE tz;
END $$;

-- The latest choice, or the defaults when the person has made none.
CREATE FUNCTION customer_private.notification_preference_of(person uuid) RETURNS customer_private.notification_preference
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p customer_private.notification_preference;
BEGIN
 SELECT * INTO p FROM customer_private.notification_preference WHERE principal_id=person ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN
  p.principal_id:=person;p.version:=0;p.kinds:=ARRAY['your-move','update','countdown','complete'];p.digest:=false;
  p.quiet_start:=NULL;p.quiet_end:=NULL;p.time_zone:='UTC';p.language:=NULL;
 END IF;
 RETURN p;
END $$;

-- Whether a pending message is still worth sending: not muted, the kind still chosen, and for a Move that
-- the Move is still open. A stale message is suppressed, never sent.
CREATE FUNCTION customer_private.notification_valid(row_ customer_private.notification_outbox) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM customer_private.notification_mute WHERE request_id=row_.request_id) THEN RETURN false; END IF;
 IF EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=row_.request_id) THEN RETURN false; END IF;
 IF NOT (row_.kind = ANY ((customer_private.notification_preference_of(row_.principal_id)).kinds)) THEN RETURN false; END IF;
 IF row_.kind='your-move' AND (NOT EXISTS(SELECT FROM app.mission_move m WHERE m.id=row_.ref_id AND m.holder='customer')
  OR EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=row_.ref_id)) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION customer_private.notification_suppress(queue uuid) RETURNS void
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE customer_private.notification_outbox SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL
 WHERE id=queue AND status IN ('PENDING','LEASED')
$$;

-- Finishes what has expired. Cheap, bounded, called by the functions below.
CREATE FUNCTION customer_private.notification_expire() RETURNS void
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE customer_private.notification_outbox SET status='DEAD',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL
 WHERE id IN (SELECT id FROM customer_private.notification_outbox
  WHERE status IN ('PENDING','LEASED') AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)
$$;

-- Events hold ids and the kind only, never the words of a message.
CREATE FUNCTION customer_private.notification_record(tenant uuid, event_type text, aggregate text, aggregate_key text, payload_ jsonb, strict boolean) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();corr uuid:=gen_random_uuid();
BEGIN
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN
  IF strict THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,tenant,event_type,1,aggregate,aggregate_key,1,executor,clock_timestamp(),corr,corr,payload_);
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),tenant,eid,executor,event_type);
END $$;

-- The person's own choices. Signed-in customer only; the actor comes from the verified session.
CREATE FUNCTION customer.notification_preferences() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();p customer_private.notification_preference;
BEGIN
 p:=customer_private.notification_preference_of(actor);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('open',customer_private.notification_open(),'synthetic',customer_private.synthetic_context(),
  'version',p.version,'kinds',to_jsonb(p.kinds),'digest',p.digest,
  'quietStart',to_char(p.quiet_start,'HH24:MI'),'quietEnd',to_char(p.quiet_end,'HH24:MI'),
  'timeZone',p.time_zone,'language',p.language);
END $$;

CREATE FUNCTION customer.set_notification_preferences(chosen text[], daily boolean, quiet_from text, quiet_to text, zone text, mail_language text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();old customer_private.notification_preference;next_version integer;
BEGIN
 IF NOT customer_private.notification_open() THEN
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('saved',false,'reason','closed');
 END IF;
 IF chosen IS NULL OR daily IS NULL OR zone IS NULL OR cardinality(chosen)>4
  OR NOT (chosen <@ ARRAY['your-move','update','countdown','complete']::text[])
  OR (SELECT count(DISTINCT k) FROM unnest(chosen) k)<>cardinality(chosen)
  OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=zone)
  OR (quiet_from IS NULL)<>(quiet_to IS NULL)
  OR (quiet_from IS NOT NULL AND (quiet_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR quiet_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR quiet_from=quiet_to))
  OR (mail_language IS NOT NULL AND mail_language NOT IN ('en','bn','zh','es','ar'))
 THEN RAISE EXCEPTION 'Invalid notification preferences' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification_preference:'||actor::text,0));
 old:=customer_private.notification_preference_of(actor);
 next_version:=old.version+1;
 INSERT INTO customer_private.notification_preference(principal_id,version,kinds,digest,quiet_start,quiet_end,time_zone,language)
 VALUES(actor,next_version,chosen,daily,quiet_from::time,quiet_to::time,zone,mail_language);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('saved',true,'version',next_version);
END $$;

-- Corridra team side, inside the staff transaction that just set Moves. It reads only facts the database
-- already holds: the Moves of this one command that are held by the customer and still open. It never
-- fails the Move; a closed control, a sample workspace, a mute, a kind the person left out and the daily
-- caps give queued=0 and a reason. The text is the validated Move words and a real date, nothing else.
CREATE FUNCTION customer.enqueue_move_notifications(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cmd app.mission_move_command%ROWTYPE;mv record;owned customer_private.owned_request%ROWTYPE;pref customer_private.notification_preference;
 due timestamptz;qid uuid;jobs jsonb:='[]'::jsonb;queued integer:=0;skipped text:=NULL;
BEGIN
 IF command IS NULL OR app.actor_id() IS NULL THEN RAISE EXCEPTION 'Notification access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO cmd FROM app.mission_move_command WHERE id=command;
 IF NOT FOUND OR cmd.kind<>'SET' OR cmd.actor_id IS DISTINCT FROM app.actor_id()
  OR app.member_role(cmd.tenant_id) IS NULL OR app.member_role(cmd.tenant_id) NOT IN ('owner','admin','operator')
  OR NOT app.fresh_mfa() OR cmd.created_at<clock_timestamp()-interval '10 minutes'
 THEN RAISE EXCEPTION 'Notification access denied' USING ERRCODE='42501'; END IF;
 IF NOT customer_private.notification_open() THEN RETURN jsonb_build_object('queued',0,'jobs','[]'::jsonb,'reason','closed'); END IF;
 FOR mv IN SELECT m.id,m.verb,m.object,m.due_on FROM app.mission_move m
  WHERE m.command_id=command AND m.holder='customer'
  AND NOT EXISTS(SELECT FROM app.mission_move_close c WHERE c.move_id=m.id) ORDER BY m.position LOOP
  FOR owned IN SELECT * FROM customer_private.owned_request r WHERE r.mission_tenant_id=cmd.tenant_id AND r.mission_id=cmd.mission_id LOOP
   IF app.tenant_is_synthetic(owned.workspace_id) THEN skipped:='sample-workspace'; CONTINUE; END IF;
   IF EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=owned.id) THEN skipped:='revoked'; CONTINUE; END IF;
   IF NOT EXISTS(SELECT FROM app.mission_intake i WHERE i.id=owned.mission_id AND i.tenant_id=owned.mission_tenant_id AND i.retention_until>clock_timestamp())
   THEN skipped:='expired'; CONTINUE; END IF;
   IF EXISTS(SELECT FROM customer_private.notification_mute WHERE request_id=owned.id) THEN skipped:='muted'; CONTINUE; END IF;
   pref:=customer_private.notification_preference_of(owned.principal_id);
   IF NOT ('your-move' = ANY (pref.kinds)) THEN skipped:='kind-off'; CONTINUE; END IF;
   -- The ten a day cap counts every request of the person, so it is serialized by person first; the three a
   -- day cap counts one request and is serialized by request. Always in this order, so two calls cannot deadlock.
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification.person:'||owned.principal_id::text,0));
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification:'||owned.id::text,0));
   PERFORM customer_private.notification_expire();
   IF (SELECT count(*) FROM customer_private.notification_outbox WHERE request_id=owned.id AND created_at>clock_timestamp()-interval '24 hours')>=3
    OR (SELECT count(*) FROM customer_private.notification_outbox WHERE principal_id=owned.principal_id AND created_at>clock_timestamp()-interval '24 hours')>=10
   THEN skipped:='cap'; CONTINUE; END IF;
   due:=customer_private.notification_due_at(clock_timestamp(),pref.time_zone,pref.quiet_start,pref.quiet_end,pref.digest);
   INSERT INTO customer_private.notification_outbox(tenant_id,request_id,principal_id,kind,ref_id,dedupe_key,title,ref_date,available_at,expires_at)
   VALUES(cmd.tenant_id,owned.id,owned.principal_id,'your-move',mv.id,mv.id::text,mv.verb||' '||mv.object,mv.due_on,due,due+interval '24 hours')
   ON CONFLICT(request_id,kind,dedupe_key) DO NOTHING RETURNING id INTO qid;
   IF qid IS NULL THEN skipped:='duplicate'; CONTINUE; END IF;
   queued:=queued+1;
   jobs:=jobs||jsonb_build_array(jsonb_build_object('queueId',qid,'requestId',owned.id,'kind','your-move','key',mv.id::text,'availableAt',due));
   PERFORM customer_private.notification_record(cmd.tenant_id,'customer.notification.queued','customer_private_notification',qid::text,
    jsonb_build_object('id',qid,'request_id',owned.id,'kind','your-move'),true);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('queued',queued,'jobs',jobs,'reason',CASE WHEN queued=0 THEN coalesce(skipped,'none') END);
END $$;

-- The application seals a queued message in the same staff transaction, with digests of two secrets only the
-- application can compute: the send capability and the mute token. Once. A message that is never sealed
-- cannot be claimed and expires.
CREATE FUNCTION customer.seal_notification(queue uuid, capability_digest text, mute_digest text) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.notification_outbox%ROWTYPE;
BEGIN
 IF queue IS NULL OR app.actor_id() IS NULL OR NOT app.fresh_mfa() OR capability_digest IS NULL OR capability_digest !~ '^[a-f0-9]{64}$'
  OR mute_digest IS NULL OR mute_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Notification access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM customer_private.notification_outbox WHERE id=queue FOR UPDATE;
 IF NOT FOUND OR app.member_role(q.tenant_id) IS NULL OR app.member_role(q.tenant_id) NOT IN ('owner','admin','operator')
  OR q.capability_hash IS NOT NULL OR q.status<>'PENDING' THEN RAISE EXCEPTION 'Notification access denied' USING ERRCODE='42501'; END IF;
 UPDATE customer_private.notification_outbox SET capability_hash=capability_digest,mute_token_hash=mute_digest WHERE id=queue;
 RETURN true;
END $$;

-- Service side. Needs no customer session, but needs the secret-derived capability the app computes.
-- For a person on a daily digest, the other messages due for that person leave in the same email.
CREATE FUNCTION customer.claim_notification(queue uuid, capability text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.notification_outbox%ROWTYPE;o customer_private.notification_outbox%ROWTYPE;pref customer_private.notification_preference;
 gid uuid:=gen_random_uuid();items jsonb;
BEGIN
 IF queue IS NULL OR capability IS NULL OR length(capability) NOT BETWEEN 20 AND 200 THEN RAISE EXCEPTION 'Notification is not available' USING ERRCODE='42501'; END IF;
 -- Check the capability first, without a lock, so a caller without it can never make anyone wait.
 SELECT * INTO q FROM customer_private.notification_outbox WHERE id=queue;
 IF NOT FOUND OR q.capability_hash IS NULL OR q.capability_hash<>encode(sha256(convert_to(capability,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'Notification is not available' USING ERRCODE='42501'; END IF;
 -- One claim at a time for one person, taken before any queue row is locked. Without this, two claims for
 -- the same person on a daily digest could each lock their own row, each skip the other's row, and each
 -- send a separate email. The second claim now waits, then finds its message already leased in the
 -- first claim's group and returns LEASED.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification_claim:'||q.principal_id::text,0));
 SELECT * INTO q FROM customer_private.notification_outbox WHERE id=queue FOR UPDATE;
 PERFORM customer_private.notification_expire();
 SELECT * INTO q FROM customer_private.notification_outbox WHERE id=queue;
 IF q.status IN ('SENT','DEAD','SUPPRESSED') THEN RETURN jsonb_build_object('status',q.status); END IF;
 IF NOT customer_private.notification_open() THEN RETURN jsonb_build_object('status','CLOSED'); END IF;
 IF NOT customer_private.notification_valid(q) THEN
  PERFORM customer_private.notification_suppress(queue);
  RETURN jsonb_build_object('status','SUPPRESSED');
 END IF;
 IF q.status='LEASED' AND q.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('status','LEASED'); END IF;
 IF q.available_at>clock_timestamp() THEN RETURN jsonb_build_object('status','WAIT','retryAt',q.available_at); END IF;
 IF q.attempts>=3 THEN
  UPDATE customer_private.notification_outbox SET status='DEAD',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL WHERE id=queue;
  RETURN jsonb_build_object('status','DEAD');
 END IF;
 pref:=customer_private.notification_preference_of(q.principal_id);
 UPDATE customer_private.notification_outbox SET status='LEASED',attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds',group_id=gid WHERE id=queue;
 IF pref.digest THEN
  FOR o IN SELECT * FROM customer_private.notification_outbox WHERE principal_id=q.principal_id AND id<>queue AND status='PENDING'
   AND available_at<=clock_timestamp() AND expires_at>clock_timestamp() AND attempts<3 AND capability_hash IS NOT NULL
   ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
   IF NOT customer_private.notification_valid(o) THEN PERFORM customer_private.notification_suppress(o.id);
   ELSE UPDATE customer_private.notification_outbox SET status='LEASED',attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds',group_id=gid WHERE id=o.id;
   END IF;
  END LOOP;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('requestId',x.request_id,'kind',x.kind,'title',x.title,'date',x.ref_date) ORDER BY x.created_at) INTO items
 FROM customer_private.notification_outbox x WHERE x.group_id=gid AND x.status='LEASED';
 RETURN jsonb_build_object('status','CLAIMED','principalId',q.principal_id,'attempt',q.attempts+1,'language',pref.language,
  'digest',pref.digest,'items',items);
END $$;

CREATE FUNCTION customer.finish_notification(queue uuid, capability text, outcome text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.notification_outbox%ROWTYPE;
BEGIN
 IF queue IS NULL OR capability IS NULL OR length(capability) NOT BETWEEN 20 AND 200 OR outcome IS NULL OR outcome NOT IN ('SENT','TRANSIENT','PERMANENT')
 THEN RAISE EXCEPTION 'Notification is not available' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM customer_private.notification_outbox WHERE id=queue FOR UPDATE;
 IF NOT FOUND OR q.capability_hash IS NULL OR q.capability_hash<>encode(sha256(convert_to(capability,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'Notification is not available' USING ERRCODE='42501'; END IF;
 IF q.status IN ('SENT','DEAD','SUPPRESSED') THEN RETURN jsonb_build_object('status',q.status); END IF;
 IF q.status<>'LEASED' THEN RAISE EXCEPTION 'Notification was not claimed' USING ERRCODE='42501'; END IF;
 IF outcome='SENT' THEN
  UPDATE customer_private.notification_outbox SET status='SENT',finished_at=clock_timestamp(),lease_until=NULL
  WHERE status='LEASED' AND (id=queue OR (q.group_id IS NOT NULL AND group_id=q.group_id));
 ELSIF outcome='PERMANENT' OR q.attempts>=3 THEN
  UPDATE customer_private.notification_outbox SET status='DEAD',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL
  WHERE status='LEASED' AND (id=queue OR (q.group_id IS NOT NULL AND group_id=q.group_id));
 ELSE
  UPDATE customer_private.notification_outbox SET status='PENDING',lease_until=NULL,group_id=NULL,
   available_at=greatest(available_at,clock_timestamp()+make_interval(secs=>least(60,5*power(2,q.attempts-1)::integer)))
  WHERE status='LEASED' AND (id=queue OR (q.group_id IS NOT NULL AND group_id=q.group_id));
 END IF;
 RETURN jsonb_build_object('status',(SELECT status FROM customer_private.notification_outbox WHERE id=queue));
END $$;

-- No sign-in. The token is the one from the email link: bound to this request and to this one purpose.
-- A repeat returns the same answer. A wrong token and an unknown request get the same refusal.
CREATE FUNCTION customer.mute_notifications(request uuid, token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owned customer_private.owned_request%ROWTYPE;added integer;
BEGIN
 IF request IS NULL OR token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.notification_outbox WHERE request_id=request AND mute_token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'))
 THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.notification:'||request::text,0));
 INSERT INTO customer_private.notification_mute(request_id) VALUES(request) ON CONFLICT(request_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 UPDATE customer_private.notification_outbox SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL,group_id=NULL
 WHERE request_id=request AND status IN ('PENDING','LEASED');
 IF added=1 THEN
  SELECT * INTO owned FROM customer_private.owned_request WHERE id=request;
  PERFORM customer_private.notification_record(owned.workspace_id,'customer.notification.muted','customer_private_notification_mute',request::text,
   jsonb_build_object('request_id',request),false);
 END IF;
 RETURN jsonb_build_object('muted',true,'already',added=0);
END $$;

REVOKE ALL ON FUNCTION customer_private.notification_open(),customer_private.notification_outbox_guard(),customer_private.notification_due_at(timestamptz,text,time,time,boolean),
 customer_private.notification_preference_of(uuid),customer_private.notification_valid(customer_private.notification_outbox),customer_private.notification_suppress(uuid),
 customer_private.notification_expire(),customer_private.notification_record(uuid,text,text,text,jsonb,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.notification_preferences(),customer.set_notification_preferences(text[],boolean,text,text,text,text),
 customer.enqueue_move_notifications(uuid),customer.seal_notification(uuid,text,text),customer.claim_notification(uuid,text),
 customer.finish_notification(uuid,text,text),customer.mute_notifications(uuid,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.notification_preferences(),customer.set_notification_preferences(text[],boolean,text,text,text,text),
 customer.enqueue_move_notifications(uuid),customer.seal_notification(uuid,text,text),customer.claim_notification(uuid,text),
 customer.finish_notification(uuid,text,text),customer.mute_notifications(uuid,text) TO corridra_runtime;
