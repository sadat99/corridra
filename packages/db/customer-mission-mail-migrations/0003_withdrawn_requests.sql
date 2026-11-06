-- CRUD G1: a withdrawn request sends no more mission mail. 0001 and 0002 are installed or about to be and their
-- hashes are checked, so neither is edited. This file adds one combined guard and makes the two readers ask it, so
-- each reader changes once: a message is blocked if the request is withdrawn (now, or at any time since the message
-- was made) or muted. It needs the request withdrawal module (customer-request-withdrawal-migrations), which needs
-- no mail module; installing this file without it stops with a clear message. Nothing here queues or sends anything.
DO $guard$
BEGIN
 IF to_regprocedure('customer_private.request_withdrawn_since(uuid,timestamptz)') IS NULL
 THEN RAISE EXCEPTION 'Install the request withdrawal module (customer-request-withdrawal-migrations) before mission mail 0003'; END IF;
 IF to_regprocedure('customer_private.mission_mail_muted(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Mission mail 0002 must be installed before mission mail 0003'; END IF;
END $guard$;

-- Why a message to this request is blocked, or null if it is not. A withdrawal wins over a mute in the answer only.
CREATE FUNCTION customer_private.mission_mail_block_reason(request uuid, since timestamptz) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN customer_private.request_withdrawn_since(request,since) THEN 'withdrawn'
  WHEN customer_private.mission_mail_muted(request) THEN 'muted' END
$$;
REVOKE ALL ON FUNCTION customer_private.mission_mail_block_reason(uuid,timestamptz) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Each reader is replaced only if its live text is exactly the text 0002 left, so a newer or different definition
-- stops the install instead of being overwritten.
DO $readers$
DECLARE signature text;original text;updated text;reader_owner text;
BEGIN
 signature:='customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text)';
 original:=pg_get_functiondef(signature::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'9e76e0c447e6f196e608953fc5b261ae23f2ee9cd83575c7bc27ac2db2f6930d'
 THEN RAISE EXCEPTION 'Withdrawal reader prerequisite differs: %',signature; END IF;
 updated:=replace(original,'IF customer_private.mission_mail_muted(request) THEN RETURN jsonb_build_object(''queued'',false,''reason'',''muted''); END IF;',
  'IF customer_private.mission_mail_block_reason(request,clock_timestamp()) IS NOT NULL THEN RETURN jsonb_build_object(''queued'',false,''reason'',customer_private.mission_mail_block_reason(request,clock_timestamp())); END IF;');
 IF updated=original OR position('customer_private.mission_mail_muted(' IN updated)>0
 THEN RAISE EXCEPTION 'Withdrawal reader replacement differs: %',signature; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=signature::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.mission_mail_block_reason(uuid,timestamptz) TO %I',reader_owner);
 EXECUTE updated;

 signature:='customer.claim_mission_mail(uuid,text)';
 original:=pg_get_functiondef(signature::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'1bb6992e5b0eb364ec7988c3beefbbd8c53d99c7a3ba49c82b3471a6bdd43f6a'
 THEN RAISE EXCEPTION 'Withdrawal reader prerequisite differs: %',signature; END IF;
 updated:=replace(original,'IF customer_private.mission_mail_muted(q.request_id) THEN','IF customer_private.mission_mail_block_reason(q.request_id,q.created_at) IS NOT NULL THEN');
 IF updated=original OR position('customer_private.mission_mail_muted(' IN updated)>0
 THEN RAISE EXCEPTION 'Withdrawal reader replacement differs: %',signature; END IF;
 SELECT pg_get_userbyid(proowner) INTO reader_owner FROM pg_proc WHERE oid=signature::regprocedure;
 EXECUTE format('GRANT EXECUTE ON FUNCTION customer_private.mission_mail_block_reason(uuid,timestamptz) TO %I',reader_owner);
 EXECUTE updated;
END $readers$;
