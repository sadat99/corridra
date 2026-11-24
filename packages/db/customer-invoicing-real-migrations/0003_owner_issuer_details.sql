-- Optional additive change to the real invoicing module (ADR-092, unit B8; owner decision of 23 Nov 2026: "Invoice issuer
-- details typed by the owner in a new Owner-only staff screen with an authenticator check").
-- The owner of the real staff workspace types the issuer details (legal name, UEN, address, GST status and number,
-- payment instructions, finance contact label). A save writes ONE new append-only version of the existing supplier
-- record: no earlier version, issued document, payment or credit note is touched, and a document keeps the version it
-- was issued under. The fields the owner typed are no longer marked made up; a made-up field the screen does not ask for
-- (the tax rate) stays marked, so the details stay incomplete until the install step corrects it.
-- Authority is repeated here for every caller: the owner role only (never an admin), a real staff workspace, the live
-- session, and an authenticator check made in the last five minutes for a save. Reading needs the owner, not the check.
-- Installing this opens nothing: the real invoicing control stays as it is (closed after install) and no money moves.

DO $guard$ BEGIN
 IF to_regclass('customer_private.real_invoicing_entity') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_entity_current()') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_open()') IS NULL
 OR to_regprocedure('customer_private.billing_plain_ok(text,integer,integer)') IS NULL
 OR to_regprocedure('customer_private.billing_input_shape(jsonb,text[],text[])') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regclass('customer_private.real_use_configuration') IS NULL
 THEN RAISE EXCEPTION 'Invoice issuer prerequisites are missing'; END IF;
END $guard$;

-- Who typed a version on the screen. NULL for the install seed and for a version written from the protected secret.
ALTER TABLE customer_private.real_invoicing_entity ADD COLUMN owner_entered_by uuid REFERENCES identity.principal(id);

-- Saves are keyed by (owner, command id). The request is kept as a digest only, so the details live in one table.
CREATE TABLE customer_private.real_invoicing_issuer_command (
 actor_id uuid NOT NULL REFERENCES identity.principal(id),command_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER real_invoicing_issuer_command_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoicing_issuer_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.real_invoicing_issuer_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.real_invoicing_issuer_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- The fields of a version that are made up: listed as such, or carrying the text "(madeup)".
CREATE FUNCTION customer_private.real_invoicing_issuer_madeup(e customer_private.real_invoicing_entity) RETURNS text[]
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(array_agg(DISTINCT f ORDER BY f),'{}'::text[]) FROM (
  SELECT unnest(e.placeholder_fields) f
  UNION ALL SELECT x.f FROM (VALUES('legal_name',e.legal_name),('address',e.address),('uen',e.uen),('gst_registration_no',e.gst_registration_no),
   ('payment_instructions',e.payment_instructions),('finance_label',e.finance_label)) x(f,v) WHERE x.v ~* '\(madeup\)') s
$$;

-- The owner of the real staff workspace, on the live session. need_fresh adds the authenticator check of the last five
-- minutes and answers CR401 without it, so the screen can ask for a code instead of saying "denied".
CREATE FUNCTION customer_private.real_invoicing_issuer_owner(need_fresh boolean) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)),false)
  OR coalesce(app.member_role(t),'')<>'owner'
  OR NOT EXISTS(SELECT FROM app.tenant x WHERE x.id=t AND NOT x.synthetic AND app.real_use_allowed(x.id))
  -- The supplier record is one for the whole platform, so only the one Corridra staff workspace may write it: the
  -- real intake workspace that the real-use configuration names. The owner of any other real workspace is refused.
  OR NOT EXISTS(SELECT FROM customer_private.real_use_configuration c WHERE c.intake_tenant_id=t AND c.enabled) THEN
  RAISE EXCEPTION 'Issuer details are for the owner of the real staff workspace' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM identity.session s JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=actor AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role='owner'
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours'
 FOR SHARE OF s,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 IF need_fresh THEN
  PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id
  WHERE encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
  AND a.verified_at>clock_timestamp()-interval '5 minutes' FOR SHARE OF s,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'A fresh authenticator check is needed' USING ERRCODE='CR401'; END IF;
 END IF;
 RETURN actor;
END $$;

-- What the owner sees: the version in force, with every made-up value left out so it is typed, never copied.
CREATE FUNCTION app.real_invoicing_issuer_view() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_issuer_owner(false); e customer_private.real_invoicing_entity; m text[]; result jsonb;
BEGIN
 e:=customer_private.real_invoicing_entity_current();
 IF e.version IS NULL THEN RAISE EXCEPTION 'The issuer details are not installed' USING ERRCODE='55000'; END IF;
 m:=customer_private.real_invoicing_issuer_madeup(e);
 result:=jsonb_build_object('version',e.version,'complete',e.uen IS NOT NULL AND cardinality(m)=0,
  'enteredByOwner',e.owner_entered_by IS NOT NULL,'savedAt',e.created_at,'madeupFields',to_jsonb(m),
  'details',jsonb_build_object(
   'legalName',CASE WHEN 'legal_name'=ANY(m) THEN NULL ELSE e.legal_name END,
   'address',CASE WHEN 'address'=ANY(m) THEN NULL ELSE e.address END,
   'uen',CASE WHEN 'uen'=ANY(m) THEN NULL ELSE e.uen END,
   'gstRegistered',CASE WHEN 'gst_registered'=ANY(m) THEN NULL ELSE e.gst_registered END,
   'gstRegistrationNo',CASE WHEN 'gst_registration_no'=ANY(m) OR 'gst_registered'=ANY(m) THEN NULL ELSE e.gst_registration_no END,
   'paymentInstructions',CASE WHEN 'payment_instructions'=ANY(m) THEN NULL ELSE e.payment_instructions END,
   'financeLabel',CASE WHEN 'finance_label'=ANY(m) THEN NULL ELSE e.finance_label END),
  'fixed',jsonb_build_object('country',e.country,'taxLabel',e.tax_label,'gstRateBps',e.gst_rate_bps,'paymentTermsDays',e.payment_terms_days),
  'realInvoicesOpen',customer_private.real_invoicing_open(),'synthetic',false);
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- The save. One new version, or nothing when the same details are already saved by an owner. 23514 = a detail is not
-- acceptable; CR409 = the details changed since the owner opened them; 55000 = the module has no supplier record yet.
CREATE FUNCTION app.real_invoicing_issuer_save(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_issuer_owner(true); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 e customer_private.real_invoicing_entity; prior customer_private.real_invoicing_issuer_command; v_hash text; v_reg boolean; v_no text;
 v_keep text[]; v_changed text[]; v_version integer; v_complete boolean; eid uuid:=gen_random_uuid(); result jsonb;
BEGIN
 IF command IS NULL OR input IS NULL OR NOT customer_private.billing_input_shape(input,
  ARRAY['expectedVersion','legalName','address','uen','gstRegistered','gstRegistrationNo','paymentInstructions','financeLabel'],ARRAY[]::text[])
  OR jsonb_typeof(input->'expectedVersion')<>'number' OR (input->>'expectedVersion') !~ '^[1-9][0-9]{0,8}$'
  OR jsonb_typeof(input->'gstRegistered')<>'boolean'
  OR jsonb_typeof(input->'legalName')<>'string' OR jsonb_typeof(input->'address')<>'string' OR jsonb_typeof(input->'uen')<>'string'
  OR jsonb_typeof(input->'paymentInstructions')<>'string' OR jsonb_typeof(input->'financeLabel')<>'string'
  OR jsonb_typeof(input->'gstRegistrationNo') NOT IN ('string','null') THEN
  RAISE EXCEPTION 'Invalid issuer details' USING ERRCODE='23514'; END IF;
 v_reg:=(input->>'gstRegistered')::boolean; v_no:=input->>'gstRegistrationNo';
 IF NOT customer_private.billing_plain_ok(input->>'legalName',2,120) OR NOT customer_private.billing_plain_ok(input->>'address',5,300)
  OR NOT customer_private.billing_plain_ok(input->>'uen',3,60) OR NOT customer_private.billing_plain_ok(input->>'paymentInstructions',5,400)
  OR NOT customer_private.billing_plain_ok(input->>'financeLabel',2,120)
  OR (v_reg AND (v_no IS NULL OR NOT customer_private.billing_plain_ok(v_no,3,60))) OR (NOT v_reg AND v_no IS NOT NULL)
  OR concat_ws(' ',input->>'legalName',input->>'address',input->>'uen',v_no,input->>'paymentInstructions',input->>'financeLabel') ~* '\(madeup\)'
  -- The values the install step seeds are refused even with the "(madeup)" text taken off.
  OR upper(btrim(input->>'uen'))='202600000A' OR upper(btrim(coalesce(v_no,'')))='M9-0000000-0'
  OR lower(btrim(input->>'financeLabel'))='sadat fpa' OR position('000-000000-0' IN input->>'paymentInstructions')>0 THEN
  RAISE EXCEPTION 'Give every issuer detail in plain words, with no made-up value, link or address' USING ERRCODE='23514'; END IF;
 -- The same lock as the offline configuration, so two writers never take the same version number.
 PERFORM pg_advisory_xact_lock(hashtext('corridra:real-invoicing-configuration'));
 v_hash:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO prior FROM customer_private.real_invoicing_issuer_command c WHERE c.actor_id=v_actor AND c.command_id=command;
 IF FOUND THEN
  IF prior.request_sha256<>v_hash THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 e:=customer_private.real_invoicing_entity_current();
 IF e.version IS NULL THEN RAISE EXCEPTION 'The issuer details are not installed' USING ERRCODE='55000'; END IF;
 IF e.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'The issuer details changed; reload and try again' USING ERRCODE='CR409'; END IF;
 -- Only a made-up mark on a field this screen does not ask for survives the save.
 v_keep:=ARRAY(SELECT f FROM unnest(e.placeholder_fields) f WHERE f='gst_rate_bps');
 -- A field counts as changed when its value differs or when it was marked made up and the owner has now confirmed it.
 v_changed:=ARRAY(SELECT x.f FROM (VALUES(1,'legalName',e.legal_name IS DISTINCT FROM input->>'legalName'),(2,'address',e.address IS DISTINCT FROM input->>'address'),
  (3,'uen',e.uen IS DISTINCT FROM input->>'uen' OR 'uen'=ANY(e.placeholder_fields)),
  (4,'gstRegistered',e.gst_registered IS DISTINCT FROM v_reg OR 'gst_registered'=ANY(e.placeholder_fields)),
  (5,'gstRegistrationNo',e.gst_registration_no IS DISTINCT FROM v_no OR 'gst_registration_no'=ANY(e.placeholder_fields)),
  (6,'paymentInstructions',e.payment_instructions IS DISTINCT FROM input->>'paymentInstructions' OR 'payment_instructions'=ANY(e.placeholder_fields)),
  (7,'financeLabel',e.finance_label IS DISTINCT FROM input->>'financeLabel' OR 'finance_label'=ANY(e.placeholder_fields))) x(n,f,differs) WHERE x.differs ORDER BY x.n);
 IF cardinality(v_changed)=0 AND e.owner_entered_by IS NOT NULL AND e.placeholder_fields=v_keep THEN
  v_version:=e.version;
  result:=jsonb_build_object('state','unchanged');
 ELSE
  v_version:=e.version+1;
  INSERT INTO customer_private.real_invoicing_entity(version,legal_name,address,country,uen,gst_registered,gst_registration_no,tax_label,gst_rate_bps,
   payment_terms_days,payment_instructions,finance_label,approver_principal_id,placeholder_fields,executor_id,reason,owner_entered_by)
  VALUES(v_version,input->>'legalName',input->>'address',e.country,input->>'uen',v_reg,v_no,e.tax_label,e.gst_rate_bps,e.payment_terms_days,
   input->>'paymentInstructions',input->>'financeLabel',e.approver_principal_id,v_keep,v_actor,
   'Issuer details typed by the owner on the Invoice issuer screen',v_actor);
  -- One domain event, audit event and outbox row: the version and the names of the changed fields. Never a value.
  INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
  VALUES(eid,t,'customer.real_invoicing.issuer_saved',1,'customer_real_invoicing_issuer','issuer',v_version,v_actor,clock_timestamp(),command,command,
   jsonb_build_object('version',v_version,'changedFields',to_jsonb(v_changed),'madeupFieldsLeft',cardinality(v_keep),'synthetic',false,
    'initiator_kind','staff','initiator_id',v_actor));
  INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),t,eid,v_actor,'customer.real_invoicing.issuer_saved');
  INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),t,eid);
  INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,t);
  result:=jsonb_build_object('state','saved');
 END IF;
 v_complete:=cardinality(v_keep)=0;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=result||jsonb_build_object('version',v_version,'complete',v_complete,'changedFields',to_jsonb(v_changed),'madeupFields',to_jsonb(v_keep),
  'commandId',command,'synthetic',false);
 INSERT INTO customer_private.real_invoicing_issuer_command(actor_id,command_id,request_sha256,result) VALUES(v_actor,command,v_hash,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.real_invoicing_issuer_madeup(customer_private.real_invoicing_entity),
 customer_private.real_invoicing_issuer_owner(boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION app.real_invoicing_issuer_view(),app.real_invoicing_issuer_save(uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.real_invoicing_issuer_view(),app.real_invoicing_issuer_save(uuid,jsonb) TO corridra_runtime;
