-- CRUD G10: a cancelled team invitation leaves an owner-attributed row in the security log, as resend and reset do.
-- Only identity.record_team_control is replaced, and only when its live text is exactly the text of file 0006; it is
-- skipped when the function is absent and refused when it differs. CREATE OR REPLACE keeps its owner, SECURITY DEFINER
-- and grants (EXECUTE for corridra_auth only). The resend and reset checks below are the 0006 lines unchanged.
-- The cancel branch runs while the cancelling transaction still holds the invitation row and has revoked the pending
-- membership on its own connection, so it reads the target membership without a lock and whether or not it is revoked.
-- An invitation id keeps the case its command id was sent in, so the cancel branch also matches it in lower case.
DO $guard$ BEGIN
 IF to_regprocedure('identity.record_team_control(text,uuid,uuid)') IS NULL THEN RETURN; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('identity.record_team_control(text,uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'6069fa9d552073f6e3c35cdd4d8afed367eb905991988aa056362f976048d4e3'
 THEN RAISE EXCEPTION 'Commercial readiness prerequisite differs: identity.record_team_control'; END IF;
 EXECUTE $replacement$
CREATE OR REPLACE FUNCTION identity.record_team_control(operation text,target uuid,reference uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id();tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;target_identity text;
BEGIN
 IF actor IS NULL OR app.member_role(tenant) IS DISTINCT FROM 'owner' OR NOT app.fresh_mfa() THEN
  RAISE EXCEPTION 'Fresh workspace owner required' USING ERRCODE='42501';
 END IF;
 -- Retain membership until this transaction commits; a revoked member is never an audit target.
 PERFORM 1 FROM app.membership WHERE tenant_id=tenant AND user_id=actor AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workspace owner unavailable' USING ERRCODE='42501';END IF;
 IF operation='team.invitation.cancelled' THEN
  SELECT p.identity_id INTO target_identity FROM identity.principal p JOIN app.membership m ON m.user_id=p.id
  WHERE p.id=target AND p.kind='person' AND m.tenant_id=tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace member unavailable' USING ERRCODE='42501';END IF;
  IF reference IS NULL OR NOT EXISTS(SELECT FROM identity.verification v WHERE (v.id=reference::text OR lower(v.id)=reference::text)
   AND v.identifier LIKE 'corridra-operator-setup:%' AND v.value::jsonb->>'principalId'=target::text
   AND v.value::jsonb->>'tenantId'=tenant::text AND v.value::jsonb->>'role'<>'contributor') THEN
   RAISE EXCEPTION 'Cancelled team invitation required' USING ERRCODE='42501';
  END IF;
 ELSE
 SELECT p.identity_id INTO target_identity FROM identity.principal p JOIN app.membership m ON m.user_id=p.id
 WHERE p.id=target AND p.kind='person' AND m.tenant_id=tenant AND m.revoked_at IS NULL FOR SHARE OF m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workspace member unavailable' USING ERRCODE='42501';END IF;
 IF operation='team.invitation.resent' THEN
  IF NOT EXISTS(SELECT FROM identity.verification v WHERE v.id=reference::text
   AND v.identifier LIKE 'corridra-operator-setup:%' AND v.value::jsonb->>'principalId'=target::text
   AND v.value::jsonb->>'tenantId'=tenant::text AND v.value::jsonb->>'role'<>'contributor'
   AND v."expiresAt">clock_timestamp()) THEN
   RAISE EXCEPTION 'Renewed team invitation required' USING ERRCODE='42501';
  END IF;
 ELSIF operation='team.authenticator.reset' THEN
  IF target=actor OR reference IS NOT NULL OR NOT EXISTS(SELECT FROM identity."user" WHERE id=target_identity AND "twoFactorEnabled"=false)
   OR EXISTS(SELECT FROM identity."twoFactor" WHERE "userId"=target_identity)
   OR EXISTS(SELECT FROM identity.session WHERE "userId"=target_identity) THEN
   RAISE EXCEPTION 'Completed member reset required' USING ERRCODE='42501';
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported team audit operation' USING ERRCODE='42501';END IF;
 END IF;
 INSERT INTO identity.security_event(identity_id,action,actor_id,tenant_id,target_principal_id,reference_id)
 VALUES(target_identity,operation,actor,tenant,target,reference);
END $$;
$replacement$;
END $guard$;
