-- ADR-0085. The helper interest register: someone who has not been invited can say they would like to become a Corridra
-- field helper. It is a note of interest and nothing else: it is not an invitation, a job or a reward, it creates no
-- account, session or membership, it sends no email and it opens nothing in the Network.
-- Optional module: installing it changes nothing anyone can see. The application shows the form only while two switches
-- are on (CORRIDRA_HELPER_INTEREST and CORRIDRA_NETWORK_ENABLED); with this module not installed the application hides it.
-- Additive only: one table and new functions. No existing function, policy, constraint, grant, trigger or row is replaced
-- or changed (no CREATE OR REPLACE).
--
-- Where the rows live. A visitor has no workspace and no actor, but every event needs both. The rows and their events are
-- anchored to the Corridra staff workspace that already receives real intake (customer_private.real_use_configuration:
-- intake_tenant_id) and the events name the service principal that configuration already records as executor
-- (executor_id). While real admission is not open (never enabled, or paused by the owner), or that workspace is not a real one,
-- the register is closed and nothing is stored. Retention keeps running while it is paused.
--
-- What is stored: a name, an email address (trimmed and lower case), a country and a short reason in the person's own
-- words. No IP address, no user agent, no session and no raw email in any rate limit key.
-- Who can read it: only an owner or admin of the anchor workspace, with a fresh authenticator check (RLS below).
-- How long: 180 days. Older rows are invisible to every read at once (the policy and the functions test the age) and are
-- physically deleted, one delete event each, whenever someone submits or an owner or admin opens the list. There is no job.
-- Events: one per create and one per delete (by an owner or admin, or by retention). They carry ids only, never a name,
-- an email address or the words of the reason.
DO $guard$ BEGIN
 IF to_regclass('app.tenant') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 OR to_regclass('app.audit_event') IS NULL
 OR to_regclass('app.outbox') IS NULL
 OR to_regclass('app.outbox_delivery') IS NULL
 OR to_regclass('identity.principal') IS NULL
 OR to_regclass('customer_private.real_use_configuration') IS NULL
 OR to_regprocedure('customer_private.real_admission_open()') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('app.intake_budget(text,integer)') IS NULL THEN
  RAISE EXCEPTION 'Helper interest prerequisite is missing';
 END IF;
END $guard$;

-- Limits live here and nowhere else in the database. Hours, not days: a day interval follows the session time zone.
CREATE FUNCTION app.helper_interest_retention() RETURNS interval
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT interval '4320 hours' $$;
CREATE FUNCTION app.helper_interest_cap() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 5000 $$;

CREATE TABLE app.helper_interest (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 email text NOT NULL CHECK(length(email) BETWEEN 5 AND 254 AND email=lower(btrim(email)) AND email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'),
 country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,email)
);
CREATE INDEX helper_interest_page ON app.helper_interest(tenant_id,created_at DESC,id DESC);
-- A row is only ever created or deleted, never edited.
CREATE TRIGGER helper_interest_no_edit BEFORE UPDATE ON app.helper_interest
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE app.helper_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.helper_interest FROM PUBLIC,corridra_runtime,corridra_auth;
-- Read only for an owner or admin of the anchor workspace with a fresh authenticator check, and only while the row is within
-- its 180 days. No other role, no other workspace, no visitor and no helper. Nothing is granted to write: creating goes
-- through helper_interest_submit and deleting through helper_interest_remove or the retention purge.
CREATE POLICY read ON app.helper_interest FOR SELECT TO corridra_runtime
 USING(created_at>clock_timestamp()-app.helper_interest_retention()
 AND app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id))
 AND coalesce(app.member_role(tenant_id),'') IN ('owner','admin')
 AND app.fresh_mfa());
GRANT SELECT ON app.helper_interest TO corridra_runtime;

-- Private: the workspace and the executor the register is anchored to. Empty while real use is closed.
CREATE FUNCTION app.helper_interest_anchor(OUT anchor_tenant uuid,OUT anchor_executor uuid) RETURNS record
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 SELECT c.intake_tenant_id,c.executor_id INTO anchor_tenant,anchor_executor
 FROM customer_private.real_use_configuration c
 JOIN identity.principal p ON p.id=c.executor_id AND p.kind='service' AND p.disabled_at IS NULL
 WHERE c.enabled AND customer_private.real_admission_open() AND app.real_use_allowed(c.intake_tenant_id);
END $$;

-- Private: one event, with its audit entry and outbox rows, in the same transaction as the change. Ids only.
CREATE FUNCTION app.helper_interest_event(t uuid,actor uuid,kind text,rid uuid,version integer,payload jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); corr uuid:=gen_random_uuid();
BEGIN
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,t,kind,1,'helper_interest',rid::text,version,actor,clock_timestamp(),corr,corr,payload);
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),t,eid,actor,kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),t,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,t);
END $$;

-- Whether the register can take a submission right now. The application asks this before it shows the form.
CREATE FUNCTION app.helper_interest_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT anchor_tenant IS NOT NULL FROM app.helper_interest_anchor()),false)
$$;

-- Retention: every row past its 180 days is deleted with one delete event, in batches. Safe to call at any time and by anyone:
-- it removes nothing else. The executor comes from the configuration even while real use is paused, so retention keeps running.
CREATE FUNCTION app.helper_interest_purge() RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record; n integer:=0; executor uuid;
BEGIN
 SELECT c.executor_id INTO executor FROM customer_private.real_use_configuration c
 JOIN identity.principal p ON p.id=c.executor_id AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RETURN 0; END IF;
 FOR r IN SELECT h.id,h.tenant_id FROM app.helper_interest h
  WHERE h.created_at<=clock_timestamp()-app.helper_interest_retention() ORDER BY h.created_at,h.id LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
  DELETE FROM app.helper_interest WHERE id=r.id;
  PERFORM app.helper_interest_event(r.tenant_id,executor,'helper_interest.deleted',r.id,2,
   jsonb_build_object('id',r.id,'reason','retention','initiator_kind','retention'));
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

-- The one way a visitor writes. A repeat of an address that is already in the register changes nothing and returns exactly what
-- a first sign-up returns, so the answer says nothing about who has signed up before. Bad input is refused (22023); a closed
-- register is refused (55000); a full register is refused (54000).
CREATE FUNCTION app.helper_interest_submit(p_name text,p_email text,p_country text,p_reason text) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record; e text; n text; c text; r text; rid uuid;
BEGIN
 SELECT * INTO a FROM app.helper_interest_anchor();
 IF a.anchor_tenant IS NULL THEN RAISE EXCEPTION 'The helper interest register is not open' USING ERRCODE='55000'; END IF;
 n:=btrim(p_name); e:=lower(btrim(p_email)); c:=upper(btrim(p_country)); r:=btrim(p_reason);
 IF n IS NULL OR e IS NULL OR c IS NULL OR r IS NULL
 OR length(n) NOT BETWEEN 2 AND 120 OR n ~ '[[:cntrl:]]'
 OR length(e) NOT BETWEEN 5 AND 254 OR e !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
 OR c !~ '^[A-Z]{2}$'
 OR length(r) NOT BETWEEN 10 AND 500 OR r ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Check the submitted values' USING ERRCODE='22023';
 END IF;
 -- One writer at a time: the duplicate rule, the cap and the purge all see the same rows.
 PERFORM pg_advisory_xact_lock(hashtext('corridra:helper_interest'));
 PERFORM app.helper_interest_purge();
 IF (SELECT count(*) FROM app.helper_interest)>=app.helper_interest_cap() THEN
  RAISE EXCEPTION 'The helper interest register is full' USING ERRCODE='54000';
 END IF;
 INSERT INTO app.helper_interest(tenant_id,name,email,country,reason) VALUES(a.anchor_tenant,n,e,c,r)
 ON CONFLICT(tenant_id,email) DO NOTHING RETURNING id INTO rid;
 IF rid IS NOT NULL THEN
  PERFORM app.helper_interest_event(a.anchor_tenant,a.anchor_executor,'helper_interest.created',rid,1,
   jsonb_build_object('id',rid,'initiator_kind','visitor'));
 END IF;
END $$;

-- Deleting on request: an owner or admin of the row's workspace, with a fresh authenticator check, deletes one entry and one
-- delete event records it. False when there is no such entry (already deleted or never existed).
CREATE FUNCTION app.helper_interest_remove(p_id uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid; who uuid:=app.actor_id();
BEGIN
 SELECT tenant_id INTO t FROM app.helper_interest WHERE id=p_id FOR UPDATE;
 IF t IS NULL THEN RETURN false; END IF;
 IF who IS NULL OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
 OR NOT app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)) THEN
  RAISE EXCEPTION 'You cannot delete helper interest entries from this account' USING ERRCODE='42501';
 END IF;
 DELETE FROM app.helper_interest WHERE id=p_id;
 PERFORM app.helper_interest_event(t,who,'helper_interest.deleted',p_id,2,
  jsonb_build_object('id',p_id,'reason','request','initiator_kind','staff'));
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.helper_interest_retention(),app.helper_interest_cap(),app.helper_interest_anchor(),
 app.helper_interest_event(uuid,uuid,text,uuid,integer,jsonb),app.helper_interest_open(),app.helper_interest_purge(),
 app.helper_interest_submit(text,text,text,text),app.helper_interest_remove(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.helper_interest_retention(),app.helper_interest_open(),app.helper_interest_purge(),
 app.helper_interest_submit(text,text,text,text),app.helper_interest_remove(uuid) TO corridra_runtime;
