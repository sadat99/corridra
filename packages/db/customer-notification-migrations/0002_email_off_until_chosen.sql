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
 WHERE p.id=q.principal_id AND p.disabled_at IS NULL AND u."emailVerified" IS TRUE AND length(u.email) BETWEEN 6 AND 320
  AND u.email ~ '^[^[:space:]@<>,;]{1,64}@[^[:space:]@<>,;]{1,255}$';
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
 RETURN jsonb_build_object('found',true,'address',who.address,'name',left(coalesce(who.display,''),80));
END $$;

-- Whether the sign-in provider's user table can be read by this database owner, with the columns the lookup
-- above needs. The install job asks before it opens email, so a missing grant stops the opening with a plain
-- message instead of leaving messages that can never be sent. Owner only; no application role may call it.
CREATE FUNCTION customer.notification_recipient_ready() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT to_regclass('neon_auth."user"') IS NOT NULL
  AND has_table_privilege('neon_auth."user"','SELECT')
  AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=to_regclass('neon_auth."user"')
   AND a.attname IN ('id','email','name','emailVerified') AND NOT a.attisdropped)=4
$$;

REVOKE ALL ON FUNCTION customer.notification_recipient(uuid,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.notification_recipient(uuid,text) TO corridra_runtime;
REVOKE ALL ON FUNCTION customer.notification_recipient_ready() FROM PUBLIC,corridra_runtime,corridra_auth;
