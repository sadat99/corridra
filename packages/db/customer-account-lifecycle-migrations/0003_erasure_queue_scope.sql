-- CRUD G5 follow-up: the erasure queue is split between sample and real customers, as real billing splits its staff views.
-- A person is a sample customer when the workspace that carries their account events is a sample workspace, otherwise real.
-- Staff of a sample workspace read and move only the requests of sample customers; staff of a real workspace only those of
-- real customers. A request outside the staff workspace's side is not listed and answers as not found, so nothing about it
-- leaks. Both functions are changed under a fingerprint of the exact live text; nothing is rewritten.
CREATE FUNCTION customer_private.erasure_in_scope(person uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT t.synthetic=(SELECT s.synthetic FROM app.tenant s WHERE s.id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid)
  FROM customer_private.account_chain c JOIN app.tenant t ON t.id=c.tenant_id WHERE c.principal_id=person),false)
$$;
REVOKE ALL ON FUNCTION customer_private.erasure_in_scope(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;

DO $queue$
DECLARE original text;updated text;
 anchor text:='WHERE (after_number IS NULL OR r.number>after_number) AND (state_filter IS NULL OR s.state=state_filter)';
BEGIN
 original:=pg_get_functiondef('customer.erasure_queue(bigint,integer,text)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'6f50dbcf6132b0ee6b4f5e3e9ade7ed62c44b95c136bf83441037becaf68790e'
 THEN RAISE EXCEPTION 'Account lifecycle prerequisite differs: customer.erasure_queue'; END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Account lifecycle replacement differs: customer.erasure_queue'; END IF;
 updated:=replace(original,anchor,anchor||' AND customer_private.erasure_in_scope(r.principal_id)');
 EXECUTE updated;
END $queue$;

DO $transition$
DECLARE original text;updated text;
 anchor text:='IF NOT FOUND THEN RAISE EXCEPTION ''Erasure request not found'' USING ERRCODE=''23514''; END IF;';
BEGIN
 original:=pg_get_functiondef('customer.erasure_transition(uuid,uuid,text,text,text)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'dc1c5cc2e4e3ad58ef99c1402e5db7a3cb8ca5b94b8f76ac5cc0113d188fe88d'
 THEN RAISE EXCEPTION 'Account lifecycle prerequisite differs: customer.erasure_transition'; END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Account lifecycle replacement differs: customer.erasure_transition'; END IF;
 updated:=replace(original,anchor,'IF NOT FOUND OR NOT customer_private.erasure_in_scope(filed.principal_id) THEN RAISE EXCEPTION ''Erasure request not found'' USING ERRCODE=''23514''; END IF;');
 EXECUTE updated;
END $transition$;
