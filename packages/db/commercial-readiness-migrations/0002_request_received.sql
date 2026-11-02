-- Request receipts share the submitting transaction and contain no submitted personal data.
-- Nullable event keys preserve existing inbox writers; the unique index makes retries safe.
ALTER TABLE app.inbox_notification ADD COLUMN event_key text;
CREATE UNIQUE INDEX inbox_notification_event_idx
 ON app.inbox_notification(recipient_kind,recipient_account_id,type,event_key)
 WHERE event_key IS NOT NULL;

CREATE FUNCTION customer.record_request_received(resource uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid := customer_private.request_actor(); receipt jsonb; item uuid;
BEGIN
 receipt := customer_private.request_result(resource,actor);
 IF receipt->>'available' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO app.inbox_notification(recipient_kind,recipient_account_id,type,event_key,payload)
 VALUES('customer',actor,'REQUEST_RECEIVED','request:'||resource::text,
  jsonb_build_object('title','Request received','href','/account/requests/'||resource::text))
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL
 DO NOTHING RETURNING id INTO item;
 IF item IS NULL THEN
  SELECT id INTO item FROM app.inbox_notification
   WHERE recipient_kind='customer' AND recipient_account_id=actor
   AND type='REQUEST_RECEIVED' AND event_key='request:'||resource::text;
 END IF;
 RETURN item;
END $$;
REVOKE ALL ON FUNCTION customer.record_request_received(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.record_request_received(uuid) TO corridra_runtime;
