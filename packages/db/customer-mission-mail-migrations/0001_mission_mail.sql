-- Phase 0 mission mail. Optional authority; installing this schema alone sends nothing.
-- The control starts closed and only an offline schema-owner operation opens it.
-- Additive only: no existing table, policy, trigger, grant or function is changed.
-- Deliberate difference from the append-only history rules: customer_private.mission_mail_recipient
-- holds a person's address for at most 24 hours and is deleted by these functions once the message is
-- sent, muted, dead or expired. The queue rows, mute records and events keep ids and states only.

DO $guard$ BEGIN
 IF to_regprocedure('customer_private.real_admission_open()') IS NULL
 OR to_regprocedure('customer_private.real_session()') IS NULL
 OR to_regprocedure('customer_private.request_actor()') IS NULL
 OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL
 OR to_regclass('customer_private.owned_request') IS NULL
 OR to_regclass('customer_private.session_proof') IS NULL
 OR to_regclass('customer_private.configuration') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 THEN RAISE EXCEPTION 'Mission mail prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE customer_private.mission_mail_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.mission_mail_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.mission_mail_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER mission_mail_control_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_mail_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless real admission is open AND the latest control row says enabled. No row means closed.
CREATE FUNCTION customer_private.mission_mail_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.real_admission_open()
 AND coalesce((SELECT enabled FROM customer_private.mission_mail_control ORDER BY version DESC LIMIT 1),false)
$$;

-- One row per request when muted. Ids only. Append-only: unmuting is a later, separate change.
CREATE TABLE customer_private.mission_mail_mute (
 request_id uuid PRIMARY KEY REFERENCES customer_private.owned_request(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.mission_mail_mute ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.mission_mail_mute FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER mission_mail_mute_immutable BEFORE UPDATE OR DELETE ON customer_private.mission_mail_mute
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- The queue holds ids, states and hashes. Never an address, a name or message text.
CREATE TABLE customer_private.mission_mail_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),
 kind text NOT NULL CHECK(kind IN ('request-received','your-move')),
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 80),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','LEASED','SENT','DEAD','SUPPRESSED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz,
 capability_hash text NOT NULL CHECK(capability_hash ~ '^[a-f0-9]{64}$'),
 mute_token_hash text NOT NULL CHECK(mute_token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 finished_at timestamptz,
 UNIQUE(request_id,kind,dedupe_key),
 CHECK((status IN ('SENT','DEAD','SUPPRESSED'))=(finished_at IS NOT NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours 1 second')
);
ALTER TABLE customer_private.mission_mail_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.mission_mail_queue FROM PUBLIC,corridra_runtime,corridra_auth;

-- Rows are never deleted, identity columns never change, finished rows never change again.
CREATE FUNCTION customer_private.mission_mail_queue_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mission mail history is append only' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.request_id,NEW.kind,NEW.dedupe_key,NEW.capability_hash,NEW.mute_token_hash,NEW.created_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.id,OLD.request_id,OLD.kind,OLD.dedupe_key,OLD.capability_hash,OLD.mute_token_hash,OLD.created_at,OLD.expires_at)
 THEN RAISE EXCEPTION 'Mission mail identity cannot change' USING ERRCODE='42501'; END IF;
 IF OLD.status IN ('SENT','DEAD','SUPPRESSED') THEN RAISE EXCEPTION 'Finished mission mail cannot change' USING ERRCODE='42501'; END IF;
 IF NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'Mission mail attempts cannot go back' USING ERRCODE='42501'; END IF;
 IF NOT ((OLD.status='PENDING' AND NEW.status IN ('PENDING','LEASED','DEAD','SUPPRESSED'))
 OR (OLD.status='LEASED' AND NEW.status IN ('PENDING','LEASED','SENT','DEAD','SUPPRESSED')))
 THEN RAISE EXCEPTION 'Mission mail state change is not allowed' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mission_mail_queue_guard BEFORE UPDATE OR DELETE ON customer_private.mission_mail_queue
 FOR EACH ROW EXECUTE FUNCTION customer_private.mission_mail_queue_guard();

-- The only place an address is kept, for sending. Deleted by the functions below; never read by a role.
CREATE TABLE customer_private.mission_mail_recipient (
 queue_id uuid PRIMARY KEY REFERENCES customer_private.mission_mail_queue(id),
 address text NOT NULL CHECK(length(address)<=254 AND address ~ '^[A-Za-z0-9._%+''-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'),
 recipient_name text NOT NULL CHECK(length(recipient_name)<=80),
 job text NOT NULL CHECK(length(job)<=120),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.mission_mail_recipient ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.mission_mail_recipient FROM PUBLIC,corridra_runtime,corridra_auth;

-- Finishes what has expired and removes its address. Cheap, bounded, called by the functions below.
CREATE FUNCTION customer_private.mission_mail_expire() RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE customer_private.mission_mail_queue SET status='DEAD',finished_at=clock_timestamp(),lease_until=NULL
 WHERE id IN (SELECT id FROM customer_private.mission_mail_queue
  WHERE status IN ('PENDING','LEASED') AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 DELETE FROM customer_private.mission_mail_recipient r USING customer_private.mission_mail_queue q
 WHERE q.id=r.queue_id AND q.status IN ('SENT','DEAD','SUPPRESSED');
END $$;

-- Called inside the customer's own request transaction, after the request is stored.
-- It never fails the request for a closed or unsuitable case: it returns queued=false and a reason.
-- It does fail for a caller who does not own the request or whose recipient is not the verified email.
CREATE FUNCTION customer.enqueue_mission_mail(request uuid, mail_kind text, mail_key text, recipient text, person_name text, job_text text, capability_digest text, mute_digest text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;owned customer_private.owned_request%ROWTYPE;proof customer_private.session_proof%ROWTYPE;
 clean text;qid uuid;executor uuid;eid uuid:=gen_random_uuid();corr uuid:=gen_random_uuid();
BEGIN
 IF mail_kind IS DISTINCT FROM 'request-received' THEN RAISE EXCEPTION 'Message kind is not available' USING ERRCODE='23514'; END IF;
 IF NOT customer_private.mission_mail_open() THEN RETURN jsonb_build_object('queued',false,'reason','closed'); END IF;
 actor:=customer_private.request_actor();
 IF NOT customer_private.real_session() THEN RETURN jsonb_build_object('queued',false,'reason','not-real'); END IF;
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501'; END IF;
 IF app.tenant_is_synthetic(owned.workspace_id) THEN RETURN jsonb_build_object('queued',false,'reason','sample-workspace'); END IF;
 IF mail_key IS NULL OR length(mail_key) NOT BETWEEN 1 AND 80 OR capability_digest IS NULL OR capability_digest !~ '^[a-f0-9]{64}$'
 OR mute_digest IS NULL OR mute_digest !~ '^[a-f0-9]{64}$' OR recipient IS NULL OR length(recipient)>254
 THEN RAISE EXCEPTION 'Invalid mission mail command' USING ERRCODE='23514'; END IF;
 clean:=lower(btrim(recipient));
 SELECT * INTO proof FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true)
 AND expires_at>clock_timestamp() AND data_mode='real';
 IF NOT FOUND OR proof.verified_email_hash IS DISTINCT FROM encode(sha256(convert_to(clean,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'Recipient is not the verified account email' USING ERRCODE='42501'; END IF;
 IF clean !~ '^[A-Za-z0-9._%+''-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' OR clean ~ '\.(invalid|example|test|localhost)$' OR clean ~ '@example\.(com|net|org)$'
 THEN RETURN jsonb_build_object('queued',false,'reason','address-not-usable'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_mail:'||request::text,0));
 PERFORM customer_private.mission_mail_expire();
 IF EXISTS(SELECT FROM customer_private.mission_mail_mute WHERE request_id=request) THEN RETURN jsonb_build_object('queued',false,'reason','muted'); END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.mission_mail_queue(request_id,kind,dedupe_key,capability_hash,mute_token_hash)
 VALUES(request,mail_kind,mail_key,capability_digest,mute_digest) ON CONFLICT(request_id,kind,dedupe_key) DO NOTHING RETURNING id INTO qid;
 IF qid IS NULL THEN RETURN jsonb_build_object('queued',false,'reason','duplicate'); END IF;
 INSERT INTO customer_private.mission_mail_recipient(queue_id,address,recipient_name,job)
 VALUES(qid,clean,left(btrim(coalesce(person_name,'')),80),left(btrim(coalesce(job_text,'')),120));
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,owned.workspace_id,'customer.mission_mail.queued',1,'customer_private_mission_mail',qid::text,1,executor,clock_timestamp(),corr,corr,
 jsonb_build_object('id',qid,'request_id',request,'kind',mail_kind));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),owned.workspace_id,eid,executor,'customer.mission_mail.queued');
 RETURN jsonb_build_object('queued',true,'id',qid);
END $$;

-- Service side. Needs no customer session, but needs the secret-derived capability the app computes.
CREATE FUNCTION customer.claim_mission_mail(queue uuid, capability text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.mission_mail_queue%ROWTYPE;r customer_private.mission_mail_recipient%ROWTYPE;
BEGIN
 IF queue IS NULL OR capability IS NULL OR length(capability) NOT BETWEEN 20 AND 200 THEN RAISE EXCEPTION 'Mission mail is not available' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM customer_private.mission_mail_queue WHERE id=queue FOR UPDATE;
 IF NOT FOUND OR q.capability_hash<>encode(sha256(convert_to(capability,'UTF8')),'hex') THEN RAISE EXCEPTION 'Mission mail is not available' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.mission_mail_expire();
 SELECT * INTO q FROM customer_private.mission_mail_queue WHERE id=queue;
 IF q.status IN ('SENT','DEAD','SUPPRESSED') THEN RETURN jsonb_build_object('status',q.status); END IF;
 IF NOT customer_private.mission_mail_open() THEN RETURN jsonb_build_object('status','CLOSED'); END IF;
 IF EXISTS(SELECT FROM customer_private.mission_mail_mute WHERE request_id=q.request_id) THEN
  UPDATE customer_private.mission_mail_queue SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL WHERE id=queue;
  DELETE FROM customer_private.mission_mail_recipient WHERE queue_id=queue;
  RETURN jsonb_build_object('status','SUPPRESSED');
 END IF;
 IF q.status='LEASED' AND q.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('status','LEASED'); END IF;
 IF q.available_at>clock_timestamp() THEN RETURN jsonb_build_object('status','WAIT','retryAt',q.available_at); END IF;
 IF q.attempts>=3 THEN
  UPDATE customer_private.mission_mail_queue SET status='DEAD',finished_at=clock_timestamp(),lease_until=NULL WHERE id=queue;
  DELETE FROM customer_private.mission_mail_recipient WHERE queue_id=queue;
  RETURN jsonb_build_object('status','DEAD');
 END IF;
 SELECT * INTO r FROM customer_private.mission_mail_recipient WHERE queue_id=queue;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mission mail is not available' USING ERRCODE='42501'; END IF;
 UPDATE customer_private.mission_mail_queue SET status='LEASED',attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=queue;
 RETURN jsonb_build_object('status','CLAIMED','requestId',q.request_id,'kind',q.kind,'attempt',q.attempts+1,
 'address',r.address,'name',r.recipient_name,'job',r.job);
END $$;

CREATE FUNCTION customer.finish_mission_mail(queue uuid, capability text, outcome text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.mission_mail_queue%ROWTYPE;
BEGIN
 IF queue IS NULL OR capability IS NULL OR length(capability) NOT BETWEEN 20 AND 200 OR outcome NOT IN ('SENT','TRANSIENT','PERMANENT')
 THEN RAISE EXCEPTION 'Mission mail is not available' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM customer_private.mission_mail_queue WHERE id=queue FOR UPDATE;
 IF NOT FOUND OR q.capability_hash<>encode(sha256(convert_to(capability,'UTF8')),'hex') THEN RAISE EXCEPTION 'Mission mail is not available' USING ERRCODE='42501'; END IF;
 IF q.status IN ('SENT','DEAD','SUPPRESSED') THEN RETURN jsonb_build_object('status',q.status); END IF;
 IF q.status<>'LEASED' THEN RAISE EXCEPTION 'Mission mail was not claimed' USING ERRCODE='42501'; END IF;
 IF outcome='SENT' THEN
  UPDATE customer_private.mission_mail_queue SET status='SENT',finished_at=clock_timestamp(),lease_until=NULL WHERE id=queue;
 ELSIF outcome='PERMANENT' OR q.attempts>=3 THEN
  UPDATE customer_private.mission_mail_queue SET status='DEAD',finished_at=clock_timestamp(),lease_until=NULL WHERE id=queue;
 ELSE
  UPDATE customer_private.mission_mail_queue SET status='PENDING',lease_until=NULL,
  available_at=clock_timestamp()+make_interval(secs=>least(60,5*power(2,q.attempts-1)::integer)) WHERE id=queue;
 END IF;
 DELETE FROM customer_private.mission_mail_recipient r USING customer_private.mission_mail_queue x
 WHERE x.id=r.queue_id AND x.id=queue AND x.status IN ('SENT','DEAD','SUPPRESSED');
 RETURN jsonb_build_object('status',(SELECT status FROM customer_private.mission_mail_queue WHERE id=queue));
END $$;

-- No sign-in. The token is the one from the email link: bound to this request and to this one purpose.
-- A repeat returns the same answer. A wrong token or an unknown request gets the same refusal.
CREATE FUNCTION customer.mute_mission_mail(request uuid, token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owned customer_private.owned_request%ROWTYPE;added integer;executor uuid;eid uuid:=gen_random_uuid();corr uuid:=gen_random_uuid();
BEGIN
 IF request IS NULL OR token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.mission_mail_queue WHERE request_id=request AND mute_token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'))
 THEN RAISE EXCEPTION 'This link is not valid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.mission_mail:'||request::text,0));
 INSERT INTO customer_private.mission_mail_mute(request_id) VALUES(request) ON CONFLICT(request_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 UPDATE customer_private.mission_mail_queue SET status='SUPPRESSED',finished_at=clock_timestamp(),lease_until=NULL
 WHERE request_id=request AND status IN ('PENDING','LEASED');
 DELETE FROM customer_private.mission_mail_recipient r USING customer_private.mission_mail_queue x
 WHERE x.id=r.queue_id AND x.request_id=request AND x.status IN ('SENT','DEAD','SUPPRESSED');
 IF added=1 THEN
  SELECT * INTO owned FROM customer_private.owned_request WHERE id=request;
  SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
  WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
  IF executor IS NOT NULL THEN
   INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
   VALUES(eid,owned.workspace_id,'customer.mission_mail.muted',1,'customer_private_mission_mail_mute',request::text,1,executor,clock_timestamp(),corr,corr,
   jsonb_build_object('request_id',request));
   INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),owned.workspace_id,eid,executor,'customer.mission_mail.muted');
  END IF;
 END IF;
 RETURN jsonb_build_object('muted',true,'already',added=0);
END $$;

REVOKE ALL ON FUNCTION customer_private.mission_mail_open(),customer_private.mission_mail_queue_guard(),customer_private.mission_mail_expire() FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text),customer.claim_mission_mail(uuid,text),customer.finish_mission_mail(uuid,text,text),customer.mute_mission_mail(uuid,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text),customer.claim_mission_mail(uuid,text),customer.finish_mission_mail(uuid,text,text),customer.mute_mission_mail(uuid,text) TO corridra_runtime;
