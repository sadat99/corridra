-- A permissioned summary references the original private request/canonical mission.
-- It is not a new mission,legacy import or original private source disclosure.
CREATE TABLE customer_private.programme_mission_link (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 request_id uuid NOT NULL REFERENCES customer_private.owned_request(id),principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(registration_id,request_id)
);
CREATE TABLE customer_private.programme_mission_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),link_id uuid NOT NULL REFERENCES customer_private.programme_mission_link(id),
 version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN ('SHARED','WITHDRAWN')),
 summary text,reason text,created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(link_id,version),
 CHECK((status='SHARED' AND summary IS NOT NULL AND summary !~ '[[:cntrl:]]' AND summary LIKE 'Synthetic %' AND length(summary) BETWEEN 11 AND 500 AND summary=btrim(summary) AND reason IS NULL)
 OR(status='WITHDRAWN' AND summary IS NULL AND reason IS NOT NULL AND length(reason) BETWEEN 10 AND 500))
);
CREATE TABLE customer_private.programme_mission_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,link_id uuid NOT NULL REFERENCES customer_private.programme_mission_link(id),
 operation text NOT NULL CHECK(operation IN ('share','withdraw')),input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['programme_mission_link','programme_mission_revision','programme_mission_command'] LOOP
  EXECUTE format('ALTER TABLE customer_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON customer_private.%I FROM PUBLIC,corridra_runtime,corridra_auth',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON customer_private.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
 END LOOP;
END $$;
CREATE INDEX programme_mission_registration_page ON customer_private.programme_mission_link(registration_id,id);

CREATE FUNCTION customer_private.programme_mission_scope(command uuid,registration uuid,request uuid,active_required boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;reg customer_private.programme_registration;source customer_private.owned_request;work uuid;detail jsonb;
BEGIN
 actor:=CASE WHEN active_required THEN customer_private.request_actor() ELSE customer.actor_id() END;
 IF actor IS NULL THEN RAISE EXCEPTION 'Participant mission access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant mission access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM customer_private.owned_request WHERE id=request AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 -- Reuse original locks in one global order across the two customer workspaces.
 -- The canonical mission's tenant is deliberately not treated as a customer workspace.
 FOR work IN SELECT DISTINCT value FROM unnest(ARRAY[reg.workspace_id,source.workspace_id]) value ORDER BY value LOOP
  PERFORM customer_private.lock_workspace_access(command,work);
 END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 IF active_required THEN
  IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=reg.id) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
  detail:=customer.private_request_detail(source.id);
  IF detail->'available' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Private source unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant proof expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actor',actor,'workspace',reg.workspace_id,'programme',reg.programme_id);
END $$;
CREATE FUNCTION customer_private.programme_mission_source(selected uuid) RETURNS timestamptz
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retained timestamptz;
BEGIN
 -- Explicit stored consent is checked by the caller. No creator proof is minted.
 -- Only availability is inspected;original receipt progress/source is never returned.
 SELECT i.retention_until INTO retained FROM customer_private.programme_mission_link l
 JOIN customer_private.owned_request r ON r.id=l.request_id AND r.principal_id=l.principal_id
 JOIN customer_private.principal p ON p.id=r.principal_id AND p.disabled_at IS NULL
 JOIN customer_private.request_admission a ON a.principal_id=p.id AND a.disabled_at IS NULL
 JOIN customer_private.configuration c ON c.issuer=p.issuer AND c.synthetic
 JOIN app.mission_intake i ON i.tenant_id=r.mission_tenant_id AND i.id=r.mission_id AND i.receipt_hash=r.receipt_hash AND i.request_key=r.request_key
 JOIN app.tenant t ON t.id=i.tenant_id AND t.synthetic
 WHERE l.id=selected AND i.retention_until>clock_timestamp()
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=r.id)
 AND app.mission_receipt(r.receipt_hash) IS NOT NULL;
 IF retained IS NULL OR retained<=clock_timestamp() THEN RETURN NULL; END IF;
 RETURN retained;
END $$;
CREATE FUNCTION customer.programme_mission_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();context jsonb;link customer_private.programme_mission_link;head customer_private.programme_mission_revision;
 prior customer_private.programme_mission_command;registration uuid;request uuid;fingerprint text;result jsonb;changed boolean:=false;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR operation IS NULL OR operation NOT IN ('share','withdraw') OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid objective command' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR input->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,9})$' OR (input->>'expectedVersion')::bigint>2147483646 THEN RAISE EXCEPTION 'Current objective version required' USING ERRCODE='23514'; END IF;
 IF operation='share' THEN
  IF input-ARRAY['registrationId','requestId','summary','consented','expectedVersion']<>'{}'::jsonb OR input->'consented' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'summary') IS DISTINCT FROM 'string'
   OR length(input->>'summary') NOT BETWEEN 11 AND 500 OR input->>'summary' NOT LIKE 'Synthetic %' OR input->>'summary'<>btrim(input->>'summary') OR input->>'summary' ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Explicit fictional objective sharing consent required' USING ERRCODE='23514';
  END IF;
  registration:=(input->>'registrationId')::uuid;request:=(input->>'requestId')::uuid;
 ELSE
  IF input-ARRAY['linkId','reason','acknowledged','expectedVersion']<>'{}'::jsonb OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(input->>'reason') NOT BETWEEN 10 AND 500 THEN
   RAISE EXCEPTION 'Explicit objective withdrawal required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO link FROM customer_private.programme_mission_link WHERE id=(input->>'linkId')::uuid AND principal_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objective link unavailable' USING ERRCODE='42501'; END IF;
  registration:=link.registration_id;request:=link.request_id;
 END IF;
 IF registration IS NULL OR request IS NULL THEN RAISE EXCEPTION 'Objective references required' USING ERRCODE='23514'; END IF;
 context:=customer_private.programme_mission_scope(command,registration,request,operation='share');
 fingerprint:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO prior FROM customer_private.programme_mission_command q WHERE q.actor_id=actor AND q.command_id=command;
 IF FOUND AND (prior.operation<>operation OR prior.input_hash<>fingerprint) THEN RAISE EXCEPTION 'Objective command conflicts' USING ERRCODE='23514'; END IF;
 SELECT * INTO link FROM customer_private.programme_mission_link WHERE registration_id=registration AND request_id=request AND principal_id=actor;
 IF link.id IS NULL THEN
  IF (SELECT count(*) FROM customer_private.programme_mission_link WHERE registration_id=registration)>=100 THEN RAISE EXCEPTION 'Programme objective limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_mission_link(registration_id,request_id,principal_id) VALUES(registration,request,actor) RETURNING * INTO link;
 END IF;
 SELECT * INTO head FROM customer_private.programme_mission_revision WHERE link_id=link.id ORDER BY version DESC LIMIT 1;
 IF prior.command_id IS NOT NULL THEN
  IF prior.link_id<>link.id OR head.version IS DISTINCT FROM (prior.result->>'version')::integer OR head.status IS DISTINCT FROM prior.result->>'status' THEN RAISE EXCEPTION 'Objective command was superseded' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.programme_mission_scope(command,registration,request,operation='share');
  RETURN prior.result;
 END IF;
 IF (input->>'expectedVersion')::integer<>coalesce(head.version,0) THEN RAISE EXCEPTION 'Objective version conflict' USING ERRCODE='23514'; END IF;
 IF head.id IS NULL OR (operation='share' AND (head.status<>'SHARED' OR head.summary IS DISTINCT FROM input->>'summary')) OR (operation='withdraw' AND head.status<>'WITHDRAWN') THEN
  INSERT INTO customer_private.programme_mission_revision(link_id,version,status,summary,reason,created_by)
  VALUES(link.id,coalesce(head.version,0)+1,CASE WHEN operation='share' THEN 'SHARED' ELSE 'WITHDRAWN' END,
   CASE WHEN operation='share' THEN input->>'summary' END,CASE WHEN operation='withdraw' THEN input->>'reason' END,actor) RETURNING * INTO head;
  changed:=true;
 END IF;
 IF changed THEN PERFORM customer_private.workspace_access_event((context->>'workspace')::uuid,actor,command,'customer.programme.objective.'||operation,
  jsonb_build_object('programme_id',context->>'programme','objective_link_id',link.id)); END IF;
 PERFORM customer_private.programme_mission_scope(command,registration,request,operation='share');
 result:=jsonb_build_object('id',link.id,'registrationId',registration,'version',head.version,'status',head.status,'synthetic',true,'changed',changed)||CASE WHEN operation='share' THEN jsonb_build_object('requestId',request) ELSE '{}'::jsonb END;
 INSERT INTO customer_private.programme_mission_command(actor_id,command_id,link_id,operation,input_hash,result) VALUES(actor,command,link.id,operation,fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION customer.programme_mission_choices(registration uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();reg customer_private.programme_registration;r customer_private.owned_request;
 detail jsonb;items jsonb:='[]'::jsonb;next_id uuid;expiry timestamptz:=clock_timestamp()+interval '60 seconds';retained timestamptz;work uuid;command uuid:=gen_random_uuid();selected uuid[];
BEGIN
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration AND principal_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT id FROM customer_private.owned_request o WHERE o.principal_id=actor AND (after_id IS NULL OR o.id>after_id) AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=o.id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT workspace_id FROM (SELECT reg.workspace_id AS workspace_id UNION SELECT o.workspace_id FROM customer_private.owned_request o WHERE o.id=ANY(selected)) w ORDER BY workspace_id LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,false);
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT * FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.id=ANY(selected) ORDER BY o.id LOOP
  detail:=customer.private_request_detail(r.id);next_id:=r.id;
  IF detail->'available'='true'::jsonb THEN
   SELECT retention_until INTO retained FROM app.mission_intake WHERE tenant_id=r.mission_tenant_id AND id=r.mission_id;
   expiry:=least(expiry,retained);
   items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'available',true,'label',concat_ws(' · ',detail->'original'->>'company',detail->'original'->>'objective',detail->'original'->>'market')));
  ELSE items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'available',false,'label','Original request unavailable')); END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM customer_private.owned_request o WHERE o.principal_id=actor AND o.id>next_id AND NOT EXISTS(SELECT FROM customer_private.request_revocation WHERE request_id=o.id)) THEN next_id:=NULL; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration) OR customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Private source expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',registration,'requests',items,'nextAfter',next_id,'viewExpiresAt',expiry,'synthetic',true);
END $$;
CREATE FUNCTION customer.programme_mission_summaries(registration uuid,manage boolean DEFAULT false,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();reg customer_private.programme_registration;l customer_private.programme_mission_link;head customer_private.programme_mission_revision;
 items jsonb:='[]'::jsonb;item jsonb;next_id uuid;retained timestamptz;expiry timestamptz:=clock_timestamp()+interval '60 seconds';active boolean;own_source boolean:=false;details jsonb;n integer;work uuid;command uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF manage IS NULL THEN RAISE EXCEPTION 'Explicit objective view required' USING ERRCODE='23514'; END IF;
 IF NOT manage AND EXISTS(SELECT FROM customer_private.request_admission WHERE principal_id=actor AND disabled_at IS NULL) THEN PERFORM customer_private.request_actor();own_source:=true; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration WHERE id=registration;
 IF NOT FOUND OR (NOT manage AND reg.principal_id<>actor) THEN RAISE EXCEPTION 'Programme registration unavailable' USING ERRCODE='42501'; END IF;
 FOR work IN SELECT workspace_id FROM (SELECT reg.workspace_id AS workspace_id UNION SELECT r.workspace_id FROM customer_private.programme_mission_link b JOIN customer_private.owned_request r ON r.id=b.request_id WHERE b.registration_id=registration) w ORDER BY workspace_id LOOP PERFORM customer_private.lock_workspace_access(command,work);END LOOP;
 PERFORM customer_private.participant_scope(command,reg.workspace_id,reg.programme_id,manage);
 active:=NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation WHERE registration_id=registration);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid objective page size' USING ERRCODE='23514'; END IF;
 IF active OR NOT manage THEN
  FOR l IN SELECT * FROM customer_private.programme_mission_link WHERE registration_id=registration AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size LOOP
   next_id:=l.id;SELECT * INTO head FROM customer_private.programme_mission_revision WHERE link_id=l.id ORDER BY version DESC LIMIT 1;
   retained:=CASE WHEN manage OR own_source THEN customer_private.programme_mission_source(l.id) END;
   IF NOT manage AND retained IS NOT NULL THEN details:=customer.private_request_detail(l.request_id);IF details->'available' IS DISTINCT FROM 'true'::jsonb THEN retained:=NULL;END IF;END IF;
   item:=jsonb_build_object('id',l.id,'version',head.version,'status',CASE WHEN NOT active OR retained IS NULL THEN 'UNAVAILABLE' ELSE head.status END);
   IF retained IS NOT NULL THEN
    expiry:=least(expiry,retained);
    IF NOT manage THEN item:=item||jsonb_build_object('requestId',l.request_id); END IF;
    IF active AND head.status='SHARED' THEN item:=item||jsonb_build_object('summary',head.summary,'claimStatus','Self-declared','sharedAt',head.created_at); END IF;
   END IF;
   -- A late source revocation/expiry never exposes the previously projected text.
   IF customer_private.programme_mission_source(l.id) IS NULL THEN item:=jsonb_build_object('id',l.id,'version',head.version,'status','UNAVAILABLE'); END IF;
   items:=items||jsonb_build_array(item);
  END LOOP;
  IF NOT EXISTS(SELECT FROM customer_private.programme_mission_link WHERE registration_id=registration AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 FOR n IN 0..jsonb_array_length(items)-1 LOOP
  item:=items->n;
  IF customer_private.programme_mission_source((item->>'id')::uuid) IS NULL THEN items:=jsonb_set(items,ARRAY[n::text],jsonb_build_object('id',item->>'id','version',(item->>'version')::integer,'status','UNAVAILABLE')); END IF;
 END LOOP;
 IF customer.actor_id() IS DISTINCT FROM actor OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Participant source access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',registration,'active',active,'objectives',items,'nextAfter',next_id,'viewExpiresAt',expiry,'synthetic',true);
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_mission_scope(uuid,uuid,uuid,boolean),customer_private.programme_mission_source(uuid),
 customer.programme_mission_command(uuid,text,jsonb),customer.programme_mission_choices(uuid,uuid,integer),customer.programme_mission_summaries(uuid,boolean,uuid,integer)
 FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_mission_command(uuid,text,jsonb),customer.programme_mission_choices(uuid,uuid,integer),customer.programme_mission_summaries(uuid,boolean,uuid,integer) TO corridra_runtime;
