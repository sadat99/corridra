-- CRUD G1: a withdrawn request gets no more Pulse messages. 0001 to 0004 are installed or about to be and their
-- hashes are checked, so none is edited. This file adds one combined guard and makes the two readers ask it, so each
-- reader changes once: a message is blocked if the request is withdrawn or muted at any time since the message (or the
-- Move it is for) was made, or is now. The Move enqueue still asks AFTER both advisory locks, so a withdrawal that
-- commits while it waits is seen. It needs the request withdrawal module (customer-request-withdrawal-migrations),
-- which needs no mail module; installing this file without it stops with a clear message. Nothing here queues or
-- sends anything.
DO $guard$
BEGIN
 IF to_regprocedure('customer_private.request_withdrawn_since(uuid,timestamptz)') IS NULL
 THEN RAISE EXCEPTION 'Install the request withdrawal module (customer-request-withdrawal-migrations) before notifications 0005'; END IF;
 IF to_regprocedure('customer_private.notification_muted_since(uuid,timestamptz)') IS NULL
 THEN RAISE EXCEPTION 'Notifications 0004 must be installed before notifications 0005'; END IF;
END $guard$;

-- Why a message for this request is blocked, or null if it is not. A withdrawal wins over a mute in the answer only.
CREATE FUNCTION customer_private.notification_block_reason(request uuid, since timestamptz) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN customer_private.request_withdrawn_since(request,since) THEN 'withdrawn'
  WHEN customer_private.notification_muted_since(request,since) THEN 'muted' END
$$;
REVOKE ALL ON FUNCTION customer_private.notification_block_reason(uuid,timestamptz) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Each reader is replaced only if its live text is exactly the text 0004 left, so a newer or different definition
-- stops the install instead of being overwritten.
DO $readers$
DECLARE signature text;original text;updated text;reader_owner text;
BEGIN
 signature:='customer_private.notification_valid(customer_private.notification_outbox)';
 original:=pg_get_functiondef(signature::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'abe6878e58a82b7c29e9147d41676492a48b3ff99f480c5c35851627ba11d1a2'
 THEN RAISE EXCEPTION 'Withdrawal reader prerequisite differs: %',signature; END IF;
 updated:=replace(original,'IF customer_private.notification_muted_since(row_.request_id,row_.created_at) THEN RETURN false; END IF;',
  'IF customer_private.notification_block_reason(row_.request_id,row_.created_at) IS NOT NULL THEN RETURN false; END IF;');
 IF updated=original OR position('customer_private.notification_muted_since(' IN updated)>0
 THEN RAISE EXCEPTION 'Withdrawal reader replacement differs: %',signature; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=signature::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.notification_block_reason(uuid,timestamptz) TO %I',reader_owner);
 EXECUTE updated;

 signature:='customer.enqueue_move_notifications(uuid)';
 original:=pg_get_functiondef(signature::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'dc62c45f6a3099c2d109baf7e965defb4643ace004e8d201622c3db3204cd9e8'
 THEN RAISE EXCEPTION 'Withdrawal reader prerequisite differs: %',signature; END IF;
 updated:=replace(original,'IF customer_private.notification_muted_since(owned.id,cmd.created_at) THEN skipped:=''muted''; CONTINUE; END IF;',
  'IF customer_private.notification_block_reason(owned.id,cmd.created_at) IS NOT NULL THEN skipped:=customer_private.notification_block_reason(owned.id,cmd.created_at); CONTINUE; END IF;');
 IF updated=original OR position('customer_private.notification_muted_since(' IN updated)>0
  OR position('notification_block_reason(owned.id,cmd.created_at)' IN updated)<position('customer.notification:''||owned.id' IN updated)
 THEN RAISE EXCEPTION 'Withdrawal reader replacement differs: %',signature; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=signature::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.notification_block_reason(uuid,timestamptz) TO %I',reader_owner);
 EXECUTE updated;
END $readers$;
