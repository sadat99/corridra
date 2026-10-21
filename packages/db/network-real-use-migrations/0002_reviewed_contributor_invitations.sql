-- ADR057. Pending work identities grant no membership and reuse verified-account/password/MFA setup.
CREATE TABLE app.network_invitation (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), principal_id uuid NOT NULL REFERENCES identity.principal(id),
 setup_required boolean NOT NULL, input_hash text NOT NULL, expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE app.network_invitation_revocation (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, invitation_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500), created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,invitation_id),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES app.network_invitation(tenant_id,id)
);
CREATE INDEX network_invitation_page ON app.network_invitation(tenant_id,created_at DESC,id DESC);
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['network_invitation','network_invitation_revocation'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)) AND app.member_role(tenant_id) IN (''owner'',''admin''))',relation_name);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',relation_name);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',relation_name);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',relation_name);
 END LOOP;
END $$;

CREATE FUNCTION identity.network_invitation_current(command_id uuid,principal uuid,lock_row boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invitation app.network_invitation;
BEGIN
 IF lock_row THEN
  SELECT * INTO invitation FROM app.network_invitation WHERE id=command_id AND principal_id=principal FOR UPDATE;
 ELSE
  SELECT * INTO invitation FROM app.network_invitation WHERE id=command_id AND principal_id=principal;
 END IF;
 RETURN coalesce(invitation.id IS NOT NULL AND invitation.setup_required AND invitation.expires_at>now()
 AND NOT EXISTS(SELECT FROM app.network_invitation_revocation WHERE invitation_id=invitation.id AND tenant_id=invitation.tenant_id)
 AND EXISTS(SELECT FROM app.tenant t WHERE t.id=invitation.tenant_id AND (t.synthetic OR app.real_use_allowed(t.id)))
 AND (SELECT value->>'enabled'='true' FROM app.config_version WHERE tenant_id=invitation.tenant_id AND key='network.enabled' AND effective_from<=now() ORDER BY version DESC LIMIT 1)
 AND EXISTS(SELECT FROM app.membership m JOIN identity.principal actor ON actor.id=m.user_id JOIN identity.principal target ON target.id=invitation.principal_id
  WHERE m.tenant_id=invitation.tenant_id AND m.user_id=invitation.created_by AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
  AND actor.disabled_at IS NULL AND actor.operating_country=ANY(m.allowed_countries) AND target.operating_country=ANY(m.allowed_countries)
  AND app.tenant_processing_purpose(m.tenant_id)=ANY(m.allowed_purposes) AND 'INTERNAL'=ANY(m.allowed_classifications)),false);
END $$;

CREATE FUNCTION identity.network_invitation_command(session_hash text,t uuid,payload jsonb,password_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; command_id uuid; action text:=payload->>'action'; current_purpose text;
 invitation app.network_invitation; v_principal uuid; user_id uuid; existing_user record;
 normalized_email text; identifier text; input_digest text; setup_required boolean:=false; approved boolean; items jsonb;
BEGIN
 IF NOT coalesce(session_hash~'^[0-9a-f]{64}$' AND jsonb_typeof(payload)='object' AND length(payload::text)<=4096 AND action IN ('list','invite','revoke'),false) THEN
  RAISE EXCEPTION 'Reviewed invitation request required' USING ERRCODE='42501';
 END IF;
 command_id:=(payload->>'commandId')::uuid;
 current_purpose:=app.tenant_processing_purpose(t);
 PERFORM set_config('corridra.session_hash',session_hash,true),set_config('corridra.tenant_id',t::text,true),
  set_config('corridra.purpose',current_purpose,true),set_config('corridra.correlation_id',command_id::text,true),set_config('corridra.causation_id',command_id::text,true);
 actor:=app.actor_id();
 approved:=coalesce(app.can_access(t,'INTERNAL',current_purpose) AND app.member_role(t) IN ('owner','admin') AND app.fresh_mfa() AND app.network_scope_allowed(t),false);
 IF NOT approved THEN RAISE EXCEPTION 'Owner or admin with current authenticator required' USING ERRCODE='42501'; END IF;
 IF action='list' THEN
  items:=coalesce((
   SELECT jsonb_agg(jsonb_build_object('id',i.id,'principalId',i.principal_id,'name',u.name,'email',u.email,'createdAt',i.created_at,'expiresAt',i.expires_at,
    'state',CASE WHEN EXISTS(SELECT FROM app.network_invitation_revocation r WHERE r.invitation_id=i.id AND r.tenant_id=t) THEN 'REVOKED'
     WHEN EXISTS(SELECT FROM identity.verification v WHERE v.id=i.id::text) THEN CASE WHEN i.expires_at<=now() THEN 'EXPIRED' ELSE 'AWAITING_SETUP' END
     WHEN p.disabled_at IS NULL AND u."emailVerified" AND u."twoFactorEnabled" THEN 'READY_FOR_PROFILE'
     WHEN p.disabled_at IS NULL AND u."emailVerified" THEN 'AUTHENTICATOR_REQUIRED' ELSE 'UNAVAILABLE' END) ORDER BY i.created_at DESC,i.id DESC)
   FROM (SELECT * FROM app.network_invitation WHERE tenant_id=t AND
    (NOT payload ? 'after' OR (created_at,id)<((payload->'after'->>'createdAt')::timestamptz,(payload->'after'->>'id')::uuid))
    ORDER BY created_at DESC,id DESC LIMIT 101) i
   JOIN identity.principal p ON p.id=i.principal_id JOIN identity."user" u ON u.id=p.identity_id),'[]'::jsonb);
  RETURN jsonb_build_object('enabled',app.part4_enabled(t,'network.enabled'),
   'countries',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name) ORDER BY c.name,c.code),'[]'::jsonb) FROM app.country c JOIN app.membership m ON m.tenant_id=t AND m.user_id=actor WHERE c.code=ANY(m.allowed_countries)),
   'invitations',CASE WHEN jsonb_array_length(items)>100 THEN items-100 ELSE items END,
   'next',CASE WHEN jsonb_array_length(items)>100 THEN jsonb_build_object('createdAt',items->99->>'createdAt','id',items->99->>'id') ELSE NULL END);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':network-invitation:'||command_id::text,0));
 IF action='revoke' THEN
  SELECT * INTO invitation FROM app.network_invitation WHERE tenant_id=t AND id=(payload->>'invitationId')::uuid;
  IF invitation.id IS NULL OR length(payload->>'reason') NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Current invitation and reason required'; END IF;
  SELECT email INTO normalized_email FROM identity."user" WHERE id=(SELECT identity_id FROM identity.principal WHERE id=invitation.principal_id);
  identifier:='corridra-operator-setup:'||encode(sha256(convert_to(lower(btrim(normalized_email)),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(identifier,0));
  PERFORM 1 FROM app.network_invitation WHERE id=invitation.id FOR UPDATE;
  IF EXISTS(SELECT FROM app.network_invitation_revocation WHERE tenant_id=t AND invitation_id=invitation.id) THEN
   IF NOT EXISTS(SELECT FROM app.network_invitation_revocation r WHERE r.tenant_id=t AND r.invitation_id=invitation.id AND r.id=command_id AND r.created_by=actor AND r.reason=payload->>'reason') THEN
    RAISE EXCEPTION 'This invitation was already revoked by a different command';
   END IF;
   RETURN jsonb_build_object('revoked',true,'duplicate',true);
  END IF;
  IF invitation.setup_required AND NOT EXISTS(SELECT FROM identity.verification WHERE id=invitation.id::text) THEN
   RAISE EXCEPTION 'Setup already accepted; suspend the work profile to remove task access';
  END IF;
  INSERT INTO app.network_invitation_revocation(id,tenant_id,invitation_id,reason,created_by)
   VALUES(command_id,t,invitation.id,payload->>'reason',actor);
  DELETE FROM identity.verification WHERE id=invitation.id::text;
  INSERT INTO identity.security_event(identity_id,action) VALUES((SELECT identity_id FROM identity.principal WHERE id=invitation.principal_id),'network.invitation.revoked');
  RETURN jsonb_build_object('revoked',true,'duplicate',false);
 END IF;
 IF NOT app.part4_enabled(t,'network.enabled') THEN RAISE EXCEPTION 'Network is not enabled for this workspace' USING ERRCODE='42501'; END IF;
 normalized_email:=lower(btrim(payload->>'email'));
 IF normalized_email IS NULL OR length(normalized_email)>254 OR normalized_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  OR length(btrim(payload->>'name')) NOT BETWEEN 1 AND 80 OR NOT EXISTS(SELECT FROM app.country WHERE code=payload->>'operatingCountry')
  OR NOT EXISTS(SELECT FROM app.membership m WHERE m.tenant_id=t AND m.user_id=actor AND (payload->>'operatingCountry')=ANY(m.allowed_countries))
  OR (app.tenant_is_synthetic(t) IS DISTINCT FROM (normalized_email LIKE '%@example.invalid'))
 THEN RAISE EXCEPTION 'Name, contact email and authorized operating country required'; END IF;
 input_digest:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 SELECT * INTO invitation FROM app.network_invitation WHERE id=command_id;
 IF invitation.id IS NOT NULL THEN
  IF invitation.tenant_id<>t OR invitation.created_by<>actor OR invitation.input_hash<>input_digest THEN RAISE EXCEPTION 'Invitation command key reused'; END IF;
  RETURN jsonb_build_object('id',invitation.id,'principalId',invitation.principal_id,'setupRequired',invitation.setup_required,'expiresAt',invitation.expires_at,'duplicate',true);
 END IF;
 identifier:='corridra-operator-setup:'||encode(sha256(convert_to(normalized_email,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(identifier,0));
 SELECT u.id,u."emailVerified" verified,u."twoFactorEnabled" mfa,p.id principal_id,p.disabled_at,p.operating_country INTO existing_user
  FROM identity."user" u LEFT JOIN identity.principal p ON p.identity_id=u.id WHERE lower(u.email)=normalized_email FOR UPDATE OF u;
 IF existing_user.id IS NOT NULL THEN
  IF NOT existing_user.verified OR NOT existing_user.mfa OR existing_user.principal_id IS NULL OR existing_user.disabled_at IS NOT NULL
   OR existing_user.operating_country IS DISTINCT FROM payload->>'operatingCountry'
  THEN RAISE EXCEPTION 'Finish the existing identity invitation or audited recovery; credentials cannot be replaced'; END IF;
  v_principal:=existing_user.principal_id;
 ELSE
  IF password_hash IS NULL OR length(password_hash)<80 OR length(password_hash)>512 THEN RAISE EXCEPTION 'Server-generated pending credential required'; END IF;
  user_id:=gen_random_uuid(); v_principal:=gen_random_uuid(); setup_required:=true;
  INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES(user_id,btrim(payload->>'name'),normalized_email,false,false);
  INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES(gen_random_uuid(),user_id,user_id,'credential',password_hash);
  INSERT INTO identity.principal(id,identity_id,operating_country,disabled_at) VALUES(v_principal,user_id,payload->>'operatingCountry',now());
 END IF;
 INSERT INTO app.network_invitation(id,tenant_id,principal_id,setup_required,input_hash,expires_at,created_by)
  VALUES(command_id,t,v_principal,setup_required,input_digest,now()+interval '7 days',actor) RETURNING * INTO invitation;
 IF setup_required THEN
  INSERT INTO identity.verification(id,identifier,value,"expiresAt") VALUES(command_id,identifier,
   jsonb_build_object('userId',user_id,'principalId',v_principal,'tenantId',t,'role','contributor','commandId',command_id,'approvedBy',actor)::text,invitation.expires_at);
 END IF;
 INSERT INTO identity.security_event(identity_id,action) VALUES((SELECT identity_id FROM identity.principal WHERE id=v_principal),'network.invitation.approved');
 RETURN jsonb_build_object('id',invitation.id,'principalId',v_principal,'setupRequired',setup_required,'expiresAt',invitation.expires_at,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION identity.network_invitation_current(uuid,uuid,boolean),identity.network_invitation_command(text,uuid,jsonb,text) FROM PUBLIC,corridra_runtime;
GRANT EXECUTE ON FUNCTION identity.network_invitation_current(uuid,uuid,boolean),identity.network_invitation_command(text,uuid,jsonb,text) TO corridra_auth;
