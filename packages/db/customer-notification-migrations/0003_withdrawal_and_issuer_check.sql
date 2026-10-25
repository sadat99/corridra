-- Two corrections found in the privacy review of 25 October 2026 (Pulse, ADR-067). 0001 and 0002 are installed or
-- about to be, and their hashes are checked, so neither is edited; this third file replaces two functions. Both
-- keep their signature, so their owner and their access lists stay exactly as 0001 and 0002 set them. Nothing here
-- stores an address and nothing here changes a table.

-- This replaces the lookup of 0002 and adds one check: the account must belong to an issuer the customer area is
-- pinned to, so an account from any other sign-in source can never be emailed.
-- The verified address of the person a message is for, read while that message is leased to the sender and
-- never stored. It needs the secret-derived capability only the application can compute, a message that is
-- leased right now, an open control, and a person who has email switched on. It returns the address of the
-- one account that owns the request, only when the sign-in provider marks that address verified. Anything
-- else is refused or answers found=false, and the caller keeps nothing.
CREATE OR REPLACE FUNCTION customer.notification_recipient(queue uuid, capability text) RETURNS jsonb
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
