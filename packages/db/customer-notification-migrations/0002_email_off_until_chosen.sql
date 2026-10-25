-- Email is off until the person switches it on, and the address is read at send time (ADR-067, owner decision
-- of 25 October 2026: option A with opt-in). Nothing here stores an address and nothing here changes a table.
-- Written as a second file because 0001 is installed and its history is hash-checked.

-- No saved choice now means no email at all (an empty list of kinds). Saving a list with at least one kind is
-- the person's opt-in, and its version row and time are the record of it. Every function that decides whether
-- a message is worth sending already reads this one, so queueing, claiming and suppressing follow it.
CREATE OR REPLACE FUNCTION customer_private.notification_preference_of(person uuid) RETURNS customer_private.notification_preference
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p customer_private.notification_preference;
BEGIN
 SELECT * INTO p FROM customer_private.notification_preference WHERE principal_id=person ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN
  p.principal_id:=person;p.version:=0;p.kinds:=ARRAY[]::text[];p.digest:=false;
  p.quiet_start:=NULL;p.quiet_end:=NULL;p.time_zone:='UTC';p.language:=NULL;
 END IF;
 RETURN p;
END $$;

-- The verified address of the person a message is for, read while that message is leased to the sender and
-- never stored. It needs the secret-derived capability only the application can compute, a message that is
-- leased right now, an open control, and a person who has email switched on. It returns the address of the
-- one account that owns the request, only when the sign-in provider marks that address verified. Anything
-- else is refused or answers found=false, and the caller keeps nothing.
CREATE FUNCTION customer.notification_recipient(queue uuid, capability text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.notification_outbox%ROWTYPE;who record;
BEGIN
 IF queue IS NULL OR capability IS NULL OR length(capability) NOT BETWEEN 20 AND 200 THEN RAISE EXCEPTION 'Notification is not available' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM customer_private.notification_outbox WHERE id=queue;
 IF NOT FOUND OR q.capability_hash IS NULL OR q.capability_hash<>encode(sha256(convert_to(capability,'UTF8')),'hex')
  OR q.status<>'LEASED' OR q.lease_until IS NULL OR q.lease_until<=clock_timestamp() OR NOT customer_private.notification_open()
 THEN RAISE EXCEPTION 'Notification is not available' USING ERRCODE='42501'; END IF;
 IF cardinality((customer_private.notification_preference_of(q.principal_id)).kinds)=0 THEN RETURN jsonb_build_object('found',false); END IF;
 SELECT u.email AS address,u.name AS display INTO who
 FROM customer_private.principal p JOIN neon_auth."user" u ON u.id::text=p.subject
 WHERE p.id=q.principal_id AND p.disabled_at IS NULL AND u."emailVerified" IS TRUE
  AND EXISTS(SELECT FROM customer_private.configuration c WHERE c.issuer=p.issuer) AND length(u.email) BETWEEN 6 AND 320
  AND u.email ~ '^[^[:space:]@<>,;]{1,64}@[^[:space:]@<>,;]{1,255}$';
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
 RETURN jsonb_build_object('found',true,'address',who.address,'name',left(coalesce(who.display,''),80));
END $$;

-- Whether the sign-in provider's user table can be read by this database owner, with the columns the lookup
-- above needs. The install job asks before it opens email, so a missing grant stops the opening with a plain
-- message instead of leaving messages that can never be sent. It looks the schema and the table up by their
-- object ids, so a missing grant answers false and never raises. Owner only; no application role may call it.
CREATE FUNCTION customer.notification_recipient_ready() RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE schema_oid oid;table_oid oid;
BEGIN
 SELECT n.oid INTO schema_oid FROM pg_namespace n WHERE n.nspname='neon_auth';
 IF schema_oid IS NULL OR NOT has_schema_privilege(schema_oid,'USAGE') THEN RETURN false; END IF;
 SELECT c.oid INTO table_oid FROM pg_class c WHERE c.relnamespace=schema_oid AND c.relname='user' AND c.relkind IN ('r','p','v','m','f');
 IF table_oid IS NULL OR NOT has_table_privilege(table_oid,'SELECT') THEN RETURN false; END IF;
 RETURN (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=table_oid AND a.attnum>0 AND NOT a.attisdropped
  AND a.attname IN ('id','email','name','emailVerified'))=4;
END $$;

-- Withdrawing consent works whenever the person can reach the page. While the control is closed a person can still
-- save an empty list of kinds (email off), so a paused control can never trap a yes that was already given and
-- bring it back when the control reopens. Anything else is refused while closed, exactly as before.
CREATE OR REPLACE FUNCTION customer.set_notification_preferences(chosen text[], daily boolean, quiet_from text, quiet_to text, zone text, mail_language text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();old customer_private.notification_preference;next_version integer;
BEGIN
 IF NOT customer_private.notification_open() AND (chosen IS NULL OR cardinality(chosen)>0) THEN
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

REVOKE ALL ON FUNCTION customer.notification_recipient(uuid,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.notification_recipient(uuid,text) TO corridra_runtime;
REVOKE ALL ON FUNCTION customer.notification_recipient_ready() FROM PUBLIC,corridra_runtime,corridra_auth;
