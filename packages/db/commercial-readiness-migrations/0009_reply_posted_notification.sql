-- A staff reply can notify only the explicit private-request owner. Anonymous receipts stay anonymous.
CREATE FUNCTION app.record_reply_posted(resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id();tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 selected_mission uuid;owned record;item uuid;body jsonb;
BEGIN
 IF actor IS NULL OR coalesce(app.member_role(tenant),'') NOT IN ('owner','admin','operator') THEN
  RAISE EXCEPTION 'Reply notification access denied' USING ERRCODE='42501';END IF;
 SELECT r.mission_id INTO selected_mission FROM app.mission_reply r
 JOIN app.mission m ON m.tenant_id=r.tenant_id AND m.id=r.mission_id
 WHERE r.id=resource AND r.tenant_id=tenant AND r.created_by=actor
 AND app.can_access(m.tenant_id,m.classification,m.purpose) FOR SHARE OF r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reply notification access denied' USING ERRCODE='42501';END IF;
 SELECT o.id,o.principal_id INTO owned FROM customer_private.owned_request o
 JOIN customer_private.principal p ON p.id=o.principal_id AND p.disabled_at IS NULL
 JOIN customer_private.request_admission a ON a.principal_id=p.id AND a.disabled_at IS NULL
 JOIN app.mission_intake i ON i.tenant_id=o.mission_tenant_id AND i.id=o.mission_id AND i.retention_until>clock_timestamp()
 WHERE o.mission_tenant_id=tenant AND o.mission_id=selected_mission
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=o.id)
 FOR SHARE OF o,p,a,i;
 IF NOT FOUND THEN RETURN NULL;END IF;
 body:=jsonb_build_object('title','There is a new reply','href','/account/requests/'||owned.id::text);
 INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,event_key,payload)
 VALUES(tenant,'customer',owned.principal_id,'REPLY_POSTED','reply:'||resource::text,body)
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id INTO item;
 IF item IS NULL THEN SELECT id INTO item FROM app.inbox_notification WHERE recipient_kind='customer'
  AND recipient_account_id=owned.principal_id AND type='REPLY_POSTED' AND event_key='reply:'||resource::text;END IF;
 RETURN jsonb_build_object('id',item,'recipientAccountId',owned.principal_id,'tenantId',tenant,'payload',body);
END $$;
REVOKE ALL ON FUNCTION app.record_reply_posted(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.record_reply_posted(uuid) TO corridra_runtime;
