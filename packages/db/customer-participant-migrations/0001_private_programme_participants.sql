-- Independent customer registration,not a fabricated legacy confirmed import.
CREATE TABLE customer_private.programme_invitation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),label text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id),
 CHECK(label LIKE 'Synthetic %' AND length(label) BETWEEN 11 AND 120 AND label=btrim(label) AND label !~ '[[:cntrl:]]'),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days')
);
CREATE TABLE customer_private.programme_registration (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 invitation_id uuid NOT NULL UNIQUE REFERENCES customer_private.programme_invitation(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),display_label text NOT NULL,
 consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(programme_id,principal_id),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id),
 CHECK(display_label LIKE 'Synthetic %' AND length(display_label) BETWEEN 11 AND 120 AND display_label=btrim(display_label) AND display_label !~ '[[:cntrl:]]')
);
CREATE TABLE customer_private.programme_participant_revocation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 invitation_id uuid UNIQUE REFERENCES customer_private.programme_invitation(id),
 registration_id uuid UNIQUE REFERENCES customer_private.programme_registration(id),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 withdrawn boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(invitation_id,registration_id)=1),CHECK(NOT withdrawn OR registration_id IS NOT NULL),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_participant_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),programme_id uuid NOT NULL REFERENCES customer_private.programme_creation(programme_id),
 operation text NOT NULL CHECK(operation IN ('invite','accept','revoke','withdraw')),request jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['programme_invitation','programme_registration','programme_participant_revocation','programme_participant_command'] LOOP
  EXECUTE format('ALTER TABLE customer_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON customer_private.%I FROM PUBLIC,corridra_runtime,corridra_auth',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
 END LOOP;
END $$;
CREATE INDEX programme_invitation_page ON customer_private.programme_invitation(workspace_id,programme_id,id);
CREATE INDEX programme_registration_page ON customer_private.programme_registration(workspace_id,programme_id,id);
CREATE INDEX programme_registration_own ON customer_private.programme_registration(principal_id,id);

CREATE FUNCTION customer_private.participant_scope(command uuid,target uuid,programme uuid,manage boolean) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.lock_workspace_access(command,target);
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.programme_creation WHERE workspace_id=target AND programme_id=programme) OR
 (manage AND NOT EXISTS(SELECT FROM customer.collaborative_workspaces() WHERE id=target AND role IN ('owner','admin'))) THEN
  RAISE EXCEPTION 'Programme access denied' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL FOR SHARE OF p;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme authority unavailable' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION customer_private.participant_invitation_active(selected uuid) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.programme_invitation i WHERE i.id=selected AND i.expires_at>clock_timestamp()
 AND NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation r WHERE r.invitation_id=i.id))
$$;
CREATE FUNCTION customer.programme_participant_preview(digest text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i customer_private.programme_invitation;actor uuid;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.programme_invitation WHERE token_hash=digest;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),i.workspace_id,i.programme_id,false);
 IF NOT customer_private.participant_invitation_active(i.id) OR EXISTS(SELECT FROM customer_private.programme_registration WHERE invitation_id=i.id) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('programmeId',p.id,'name',p.name,'reportingPurpose',p.reporting_purpose,'expiresAt',i.expires_at,'synthetic',true)
 INTO result FROM app.delivery_programme p WHERE p.tenant_id=i.workspace_id AND p.id=i.programme_id;
 IF customer.actor_id() IS DISTINCT FROM actor OR NOT customer_private.participant_invitation_active(i.id) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION customer.programme_participant_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;target uuid;programme uuid;invitation customer_private.programme_invitation;
 registration customer_private.programme_registration;prior customer_private.programme_participant_command;
 request jsonb;result jsonb;resource uuid;kind text;changed boolean:=false;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR operation IS NULL OR operation NOT IN ('invite','accept','revoke','withdraw') THEN
  RAISE EXCEPTION 'Invalid participant command' USING ERRCODE='23514';
 END IF;
 IF operation<>'accept' AND input->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Explicit acknowledgement required' USING ERRCODE='23514'; END IF;
 IF operation='invite' THEN
  IF input-ARRAY['workspaceId','programmeId','label','tokenHash','acknowledged']<>'{}'::jsonb OR input->>'tokenHash' IS NULL OR input->>'tokenHash' !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(input->'label') IS DISTINCT FROM 'string' OR length(input->>'label') NOT BETWEEN 11 AND 120
   OR input->>'label' NOT LIKE 'Synthetic %' OR input->>'label'<>btrim(input->>'label') OR input->>'label' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid synthetic invitation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;request:=input-'tokenHash';
 ELSIF operation='accept' THEN
  IF input-ARRAY['tokenHash','programmeId','displayLabel','consented']<>'{}'::jsonb OR input->>'tokenHash' IS NULL OR input->>'tokenHash' !~ '^[a-f0-9]{64}$'
   OR input->'consented' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'displayLabel') IS DISTINCT FROM 'string'
   OR length(input->>'displayLabel') NOT BETWEEN 11 AND 120 OR input->>'displayLabel' NOT LIKE 'Synthetic %'
   OR input->>'displayLabel'<>btrim(input->>'displayLabel') OR input->>'displayLabel' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Explicit synthetic registration consent required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO invitation FROM customer_private.programme_invitation WHERE token_hash=input->>'tokenHash';
  IF NOT FOUND OR invitation.programme_id IS DISTINCT FROM (input->>'programmeId')::uuid THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  target:=invitation.workspace_id;programme:=invitation.programme_id;request:=input;
 ELSIF operation='withdraw' THEN
  IF input-ARRAY['registrationId','reason','acknowledged']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid withdrawal' USING ERRCODE='23514'; END IF;
  SELECT * INTO registration FROM customer_private.programme_registration WHERE id=(input->>'registrationId')::uuid AND principal_id=customer.actor_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
  target:=registration.workspace_id;programme:=registration.programme_id;resource:=registration.id;kind:='registration';request:=input;
 ELSE
  IF input-ARRAY['workspaceId','programmeId','kind','targetId','reason','acknowledged']<>'{}'::jsonb OR input->>'kind' IS NULL OR input->>'kind' NOT IN ('invitation','registration') THEN
   RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='23514';
  END IF;
  target:=(input->>'workspaceId')::uuid;programme:=(input->>'programmeId')::uuid;resource:=(input->>'targetId')::uuid;kind:=input->>'kind';request:=input;
 END IF;
 actor:=customer_private.participant_scope(command,target,programme,operation IN ('invite','revoke'));
 IF operation IN ('revoke','withdraw') AND (jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(input->>'reason') NOT BETWEEN 10 AND 500) THEN
  RAISE EXCEPTION 'Revocation reason required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM customer_private.programme_participant_command q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND AND (prior.operation<>operation OR prior.request<>request) THEN RAISE EXCEPTION 'Participant command conflicts' USING ERRCODE='23514'; END IF;
 IF operation='accept' THEN
  IF NOT customer_private.participant_invitation_active(invitation.id) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO registration FROM customer_private.programme_registration r WHERE r.invitation_id=invitation.id;
  IF FOUND AND registration.principal_id<>actor THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  IF NOT FOUND THEN SELECT * INTO registration FROM customer_private.programme_registration r WHERE r.programme_id=programme AND r.principal_id=actor; END IF;
  IF FOUND THEN
   IF registration.principal_id<>actor OR EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration.id) THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
   IF registration.display_label<>input->>'displayLabel' THEN RAISE EXCEPTION 'Registration conflicts' USING ERRCODE='23514'; END IF;
  ELSE
   INSERT INTO customer_private.programme_registration(workspace_id,programme_id,invitation_id,principal_id,display_label)
   VALUES(target,programme,invitation.id,actor,input->>'displayLabel') RETURNING * INTO registration;changed:=true;
  END IF;
  resource:=registration.id;result:=jsonb_build_object('id',resource,'programmeId',programme,'status','REGISTERED','synthetic',true);
 ELSIF FOUND THEN
  -- Rechecks above always precede retry receipts;issuance never recovers a secret.
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  RETURN CASE WHEN operation='invite' THEN prior.result||jsonb_build_object('issued',false) ELSE prior.result END;
 ELSIF operation='invite' THEN
  IF (SELECT count(*) FROM customer_private.programme_invitation WHERE programme_id=programme)>=1000 THEN RAISE EXCEPTION 'Programme invitation limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_invitation(workspace_id,programme_id,created_by,label,token_hash,expires_at)
  VALUES(target,programme,actor,input->>'label',input->>'tokenHash',clock_timestamp()+interval '7 days'-interval '1 second') RETURNING * INTO invitation;
  resource:=invitation.id;changed:=true;result:=jsonb_build_object('id',resource,'programmeId',programme,'expiresAt',invitation.expires_at,'issued',true,'synthetic',true);
 ELSE
  IF kind='invitation' AND NOT EXISTS(SELECT FROM customer_private.programme_invitation WHERE id=resource AND workspace_id=target AND programme_id=programme) OR
   kind='registration' AND NOT EXISTS(SELECT FROM customer_private.programme_registration WHERE id=resource AND workspace_id=target AND programme_id=programme AND (operation<>'withdraw' OR principal_id=actor)) THEN
   RAISE EXCEPTION 'Programme access record unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE (kind='invitation' AND invitation_id=resource) OR (kind='registration' AND registration_id=resource)) THEN
   INSERT INTO customer_private.programme_participant_revocation(workspace_id,programme_id,invitation_id,registration_id,created_by,reason,withdrawn)
   VALUES(target,programme,CASE WHEN kind='invitation' THEN resource END,CASE WHEN kind='registration' THEN resource END,actor,input->>'reason',operation='withdraw');changed:=true;
  END IF;
  result:=jsonb_build_object('id',resource,'programmeId',programme,'status',CASE WHEN kind='invitation' THEN 'REVOKED' ELSE (SELECT CASE WHEN withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END FROM customer_private.programme_participant_revocation WHERE registration_id=resource) END,'synthetic',true);
 END IF;
 IF changed THEN
  PERFORM customer_private.workspace_access_event(target,actor,command,'customer.programme.'||operation,
   jsonb_build_object('programme_id',programme,'resource_id',resource));
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR (operation='accept' AND NOT customer_private.participant_invitation_active(invitation.id)) THEN
  RAISE EXCEPTION 'Participant access expired' USING ERRCODE='42501';
 END IF;
 IF prior.command_id IS NULL THEN
  INSERT INTO customer_private.programme_participant_command(actor_id,command_id,workspace_id,programme_id,operation,request,result)
  VALUES(actor,command,target,programme,operation,request,result);
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION customer.programme_participants(target uuid,programme uuid,invitation_after uuid DEFAULT NULL,registration_after uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);invitations jsonb;registrations jsonb;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid participant page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'expiresAt',i.expires_at,'status',CASE
 WHEN EXISTS(SELECT FROM customer_private.programme_registration WHERE invitation_id=i.id) THEN 'USED'
 WHEN NOT customer_private.participant_invitation_active(i.id) THEN 'UNAVAILABLE' ELSE 'ISSUED' END) ORDER BY i.id),'[]'::jsonb) INTO invitations
 FROM (SELECT * FROM customer_private.programme_invitation WHERE workspace_id=target AND programme_id=programme AND (invitation_after IS NULL OR id>invitation_after) ORDER BY id LIMIT page_size) i;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'displayLabel',r.display_label,'consentedAt',r.consented_at,'status',
 coalesce((SELECT CASE WHEN v.withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END FROM customer_private.programme_participant_revocation v WHERE v.registration_id=r.id),'REGISTERED')) ORDER BY r.id),'[]'::jsonb) INTO registrations
 FROM (SELECT * FROM customer_private.programme_registration WHERE workspace_id=target AND programme_id=programme AND (registration_after IS NULL OR id>registration_after) ORDER BY id LIMIT page_size) r;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'workspaceId',target,'invitations',invitations,'registrations',registrations,'synthetic',true,
 'nextInvitationAfter',CASE WHEN jsonb_array_length(invitations)=page_size AND EXISTS(SELECT FROM customer_private.programme_invitation WHERE programme_id=programme AND id>(invitations->(page_size-1)->>'id')::uuid) THEN invitations->(page_size-1)->>'id' END,
 'nextRegistrationAfter',CASE WHEN jsonb_array_length(registrations)=page_size AND EXISTS(SELECT FROM customer_private.programme_registration WHERE programme_id=programme AND id>(registrations->(page_size-1)->>'id')::uuid) THEN registrations->(page_size-1)->>'id' END);
END $$;
CREATE FUNCTION customer.own_programme_registrations(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();items jsonb;next_id uuid;selected uuid[];work uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid participant page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO selected FROM (SELECT id FROM customer_private.programme_registration WHERE principal_id=actor AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT DISTINCT workspace_id FROM customer_private.programme_registration WHERE id=ANY(selected) ORDER BY workspace_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||work::text,0));
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'programmeId',r.programme_id,'status',coalesce(v.status,'REGISTERED'),'synthetic',true)||
 CASE WHEN v.status IS NULL THEN jsonb_build_object('name',p.name,'reportingPurpose',p.reporting_purpose,'displayLabel',r.display_label,'consentedAt',r.consented_at) ELSE '{}'::jsonb END ORDER BY r.id),'[]'::jsonb)
 INTO items FROM (SELECT * FROM customer_private.programme_registration WHERE principal_id=actor AND id=ANY(selected)) r
 JOIN app.delivery_programme p ON p.tenant_id=r.workspace_id AND p.id=r.programme_id
 JOIN app.tenant t ON t.id=r.workspace_id AND t.synthetic
 LEFT JOIN LATERAL(SELECT CASE WHEN withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END status FROM customer_private.programme_participant_revocation WHERE registration_id=r.id) v ON true;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_registration WHERE principal_id=actor AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrations',items,'nextAfter',next_id,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION customer_private.participant_scope(uuid,uuid,uuid,boolean),customer_private.participant_invitation_active(uuid),
 customer.programme_participant_preview(text),customer.programme_participant_command(uuid,text,jsonb),customer.programme_participants(uuid,uuid,uuid,uuid,integer),customer.own_programme_registrations(uuid,integer)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_participant_preview(text),customer.programme_participant_command(uuid,text,jsonb),customer.programme_participants(uuid,uuid,uuid,uuid,integer),customer.own_programme_registrations(uuid,integer) TO corridra_runtime;
