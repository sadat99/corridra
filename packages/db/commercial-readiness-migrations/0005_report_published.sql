-- Reviewed delivery resolves only its authorized customer recipient, never ownership/contact records.
CREATE FUNCTION app.record_report_published(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid; recipient uuid; item uuid; body jsonb;
BEGIN
 SELECT a.tenant_id,p.id INTO tenant,recipient
 FROM app.customer_delivery_assignment a
 JOIN customer_private.owned_request r ON r.id=a.request_id
 JOIN customer_private.principal p ON p.id=r.principal_id AND p.disabled_at IS NULL
 WHERE a.id=command AND a.tenant_id=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid
 AND a.created_by=app.actor_id() FOR SHARE OF a,r,p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account delivery unavailable' USING ERRCODE='42501'; END IF;
 PERFORM app.assert_customer_delivery(a) FROM app.customer_delivery_assignment a WHERE a.id=command;
 body:=jsonb_build_object('title','A report is ready','href','/account?view=results');
 INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,event_key,payload)
 VALUES(tenant,'customer',recipient,'REPORT_PUBLISHED','assignment:'||command::text,body)
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL DO NOTHING
 RETURNING id INTO item;
 IF item IS NULL THEN
  SELECT id INTO item FROM app.inbox_notification WHERE recipient_kind='customer' AND recipient_account_id=recipient
   AND type='REPORT_PUBLISHED' AND event_key='assignment:'||command::text;
 END IF;
 RETURN jsonb_build_object('id',item,'recipientAccountId',recipient,'tenantId',tenant,'payload',body);
END $$;
REVOKE ALL ON FUNCTION app.record_report_published(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.record_report_published(uuid) TO corridra_runtime;
