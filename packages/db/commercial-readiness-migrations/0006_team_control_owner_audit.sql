-- GAP-016: append initiating-owner metadata without rewriting existing security events.
-- Auth may invoke this narrow writer; it still cannot insert/update/delete security_event directly.
ALTER TABLE identity.security_event
 ADD COLUMN actor_id uuid REFERENCES identity.principal(id),
 ADD COLUMN tenant_id uuid REFERENCES app.tenant(id),
 ADD COLUMN target_principal_id uuid REFERENCES identity.principal(id),
 ADD COLUMN reference_id uuid;

CREATE FUNCTION identity.record_team_control(operation text,target uuid,reference uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id();tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;target_identity text;
BEGIN
 IF actor IS NULL OR app.member_role(tenant) IS DISTINCT FROM 'owner' OR NOT app.fresh_mfa() THEN
  RAISE EXCEPTION 'Fresh workspace owner required' USING ERRCODE='42501';
 END IF;
 -- Retain membership until this transaction commits; a revoked member is never an audit target.
 PERFORM 1 FROM app.membership WHERE tenant_id=tenant AND user_id=actor AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workspace owner unavailable' USING ERRCODE='42501';END IF;
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
 INSERT INTO identity.security_event(identity_id,action,actor_id,tenant_id,target_principal_id,reference_id)
 VALUES(target_identity,operation,actor,tenant,target,reference);
END $$;
REVOKE ALL ON FUNCTION identity.record_team_control(text,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION identity.record_team_control(text,uuid,uuid) TO corridra_auth;
