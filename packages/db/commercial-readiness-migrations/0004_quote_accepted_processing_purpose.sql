-- Real staff use commercial_qualification; synthetic staff retain synthetic_validation.
-- Preserve installed migration0003 and every recipient/command authorization check.
-- Recipient lookup is restricted to the current customer's own committed acceptance command.
-- No browser-supplied account or address can become a notification recipient.
CREATE OR REPLACE FUNCTION customer.record_quote_accepted(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid := customer.actor_id(); accepted record; item uuid; body jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 SELECT e.request_id,q.id quote_id,q.prepared_by recipient,q.staff_tenant_id tenant,u.email,
  u."emailVerified" verified
 INTO accepted
 FROM customer_private.service_request_command c
 JOIN customer_private.service_request_event e ON e.request_id=(c.result->>'id')::uuid AND e.customer_actor=c.actor_id AND e.kind='accepted'
 JOIN customer_private.service_request r ON r.id=e.request_id
 JOIN customer_private.service_quote q ON q.id=e.quote_id AND q.request_id=r.id AND q.version=(c.request->>'quoteVersion')::integer
 JOIN app.tenant t ON t.id=q.staff_tenant_id
 JOIN identity.principal p ON p.id=q.prepared_by AND p.disabled_at IS NULL
 JOIN identity."user" u ON u.id=p.identity_id
 JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=q.staff_tenant_id AND m.revoked_at IS NULL
 WHERE c.actor_id=actor AND c.command_id=command AND c.operation='accept'
 AND customer_private.service_request_role(r.tenant_id,actor)='writer'
 AND m.role IN ('owner','admin') AND p.operating_country=ANY(m.allowed_countries)
 AND 'INTERNAL'=ANY(m.allowed_classifications) AND (CASE WHEN t.synthetic THEN 'synthetic_validation' ELSE 'commercial_qualification' END)=ANY(m.allowed_purposes)
 FOR SHARE OF p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accepted quote recipient unavailable' USING ERRCODE='42501'; END IF;
 body:=jsonb_build_object('title','Your quote was accepted','href','/operator?workspace='||accepted.tenant::text);
 INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,event_key,payload)
 VALUES(accepted.tenant,'staff',accepted.recipient,'QUOTE_ACCEPTED','quote:'||accepted.quote_id::text,body)
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL DO NOTHING
 RETURNING id INTO item;
 IF item IS NULL THEN
  SELECT id INTO item FROM app.inbox_notification WHERE recipient_kind='staff' AND recipient_account_id=accepted.recipient
   AND type='QUOTE_ACCEPTED' AND event_key='quote:'||accepted.quote_id::text;
 END IF;
 RETURN jsonb_build_object('id',item,'recipientAccountId',accepted.recipient,'tenantId',accepted.tenant,
  'recipientEmail',CASE WHEN accepted.verified THEN accepted.email END,'payload',body);
END $$;
REVOKE ALL ON FUNCTION customer.record_quote_accepted(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.record_quote_accepted(uuid) TO corridra_runtime;
