-- GAP-017: the committed ASSIGN event determines its contributor; creating an unassigned task sends nothing.
CREATE FUNCTION app.record_task_assigned(command uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;recipient uuid;item uuid;body jsonb;
BEGIN
 SELECT p.principal_id INTO recipient FROM app.network_event e
 JOIN app.network_profile p ON p.tenant_id=e.tenant_id AND p.id=(e.details->>'profileId')::uuid
 JOIN identity.principal person ON person.id=p.principal_id AND person.disabled_at IS NULL
 WHERE e.id=command AND e.tenant_id=tenant AND e.action='ASSIGN' AND e.created_by=app.actor_id()
 AND app.member_role(tenant) IN ('owner','admin') AND app.fresh_mfa()
 AND app.can_access(tenant,'INTERNAL',current_setting('corridra.purpose',true))
 FOR SHARE OF e,p,person;
 IF NOT FOUND THEN RAISE EXCEPTION 'Task assignment recipient unavailable' USING ERRCODE='42501';END IF;
 body:=jsonb_build_object('title','A task was assigned to you','href','/contributor?workspace='||tenant::text);
 INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,event_key,payload)
 VALUES(tenant,'staff',recipient,'TASK_ASSIGNED','assignment:'||command::text,body)
 ON CONFLICT(recipient_kind,recipient_account_id,type,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id INTO item;
 IF item IS NULL THEN SELECT id INTO item FROM app.inbox_notification WHERE recipient_kind='staff' AND recipient_account_id=recipient
  AND type='TASK_ASSIGNED' AND event_key='assignment:'||command::text;END IF;
 RETURN jsonb_build_object('id',item,'recipientAccountId',recipient,'tenantId',tenant,'payload',body);
END $$;
REVOKE ALL ON FUNCTION app.record_task_assigned(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.record_task_assigned(uuid) TO corridra_runtime;
