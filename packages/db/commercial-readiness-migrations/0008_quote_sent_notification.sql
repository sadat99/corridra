-- GAP-018: a committed quote command identifies its customer; never trust a browser recipient.
CREATE FUNCTION app.record_quote_sent(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor();tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 selected record;item uuid;body jsonb;
BEGIN
 SELECT r.id request_id,r.tenant_id workspace_id,r.created_by recipient,q.id quote_id INTO selected
 FROM customer_private.service_request_staff_command c
 JOIN customer_private.service_request r ON r.id=(c.request->>'requestId')::uuid
 JOIN customer_private.service_request_event e ON e.request_id=r.id AND e.seq=(c.request->>'expectedSeq')::integer+1 AND e.kind='quoted' AND e.staff_actor=c.actor_id
 JOIN customer_private.service_quote q ON q.id=e.quote_id AND q.request_id=r.id AND q.staff_tenant_id=tenant
 JOIN customer_private.principal p ON p.id=r.created_by AND p.disabled_at IS NULL
 JOIN customer_private.service_request_claim claim ON claim.request_id=r.id AND claim.staff_tenant_id=tenant
 WHERE c.command_id=command AND c.actor_id=actor AND c.operation='quote'
 AND customer_private.service_request_role(r.tenant_id,r.created_by)='writer'
 FOR SHARE OF c,r,e,q,p,claim;
 IF NOT FOUND THEN RAISE EXCEPTION 'Quote recipient unavailable' USING ERRCODE='42501';END IF;
 body:=jsonb_build_object('title','You have a new quote','href','/account/service-requests/'||selected.workspace_id::text||'/'||selected.request_id::text);
 INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,event_key,payload)
 VALUES(tenant,'customer',selected.recipient,'QUOTE_SENT','quote:'||selected.quote_id::text,body)
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id INTO item;
 IF item IS NULL THEN SELECT id INTO item FROM app.inbox_notification WHERE recipient_kind='customer' AND recipient_account_id=selected.recipient
  AND type='QUOTE_SENT' AND event_key='quote:'||selected.quote_id::text;END IF;
 RETURN jsonb_build_object('id',item,'recipientAccountId',selected.recipient,'tenantId',tenant,'payload',body);
END $$;
REVOKE ALL ON FUNCTION app.record_quote_sent(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.record_quote_sent(uuid) TO corridra_runtime;
