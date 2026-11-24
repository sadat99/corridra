-- Optional additive change to the real invoicing module (ADR-092 addendum of 24 Nov 2026, unit B8b).
-- Defect: the Invoice issuer screen did not ask for the tax rate, so its made-up mark survived every owner save and the
-- real-invoice refusal (D3) never lifted. From here the rate follows the GST answer the owner already gives: a Singapore
-- GST registered issuer charges the standard rate (9%, in force since 1 January 2024, IRAS "Current GST rates"), and an
-- issuer that is not GST registered charges 0. The save writes it in the same ONE new supplier version and clears the
-- mark, so one complete owner save completes the details. For an issuer that is not a Singapore GST issuer the rate is
-- carried and its mark is kept, as before. The request, its digest, the event shape and every authority check are
-- unchanged; the event and audit line still carry field names only, never a value.
-- Installing this opens nothing and touches no saved version, issued document, payment or credit note.

DO $guard$ BEGIN
 IF to_regprocedure('app.real_invoicing_issuer_save(uuid,jsonb)') IS NULL
 OR to_regprocedure('app.real_invoicing_issuer_view()') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_issuer_owner(boolean)') IS NULL
 OR to_regprocedure('customer_private.real_invoicing_issuer_madeup(customer_private.real_invoicing_entity)') IS NULL
 THEN RAISE EXCEPTION 'Invoice issuer tax rate prerequisites are missing'; END IF;
END $guard$;

-- The rate this screen sets for a GST answer, in basis points, or NULL when it does not set one. The one place the
-- Singapore standard rate lives: a change of the rate is a new reviewed migration, never an input.
CREATE FUNCTION customer_private.real_invoicing_issuer_rate(e customer_private.real_invoicing_entity,registered boolean) RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN e.country='SG' AND e.tax_label='GST' AND registered IS NOT NULL THEN CASE WHEN registered THEN 900 ELSE 0 END END
$$;
REVOKE ALL ON FUNCTION customer_private.real_invoicing_issuer_rate(customer_private.real_invoicing_entity,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The same view, with the rate each GST answer would write, so the Check And Save step shows it before the save.
CREATE OR REPLACE FUNCTION app.real_invoicing_issuer_view() RETURNS jsonb
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
  'fixed',jsonb_build_object('country',e.country,'taxLabel',e.tax_label,'gstRateBps',e.gst_rate_bps,'paymentTermsDays',e.payment_terms_days,
   -- The rate a save writes for each GST answer; NULL when this screen does not set the rate (not a Singapore GST issuer).
   'rateWhenRegisteredBps',customer_private.real_invoicing_issuer_rate(e,true),'rateWhenNotRegisteredBps',customer_private.real_invoicing_issuer_rate(e,false)),
  'realInvoicesOpen',customer_private.real_invoicing_open(),'synthetic',false);
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- The same save, with the tax rate derived from the GST answer and written in the same new version.
CREATE OR REPLACE FUNCTION app.real_invoicing_issuer_save(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_issuer_owner(true); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 e customer_private.real_invoicing_entity; prior customer_private.real_invoicing_issuer_command; v_hash text; v_reg boolean; v_no text;
 v_keep text[]; v_changed text[]; v_rate integer; v_version integer; v_complete boolean; eid uuid:=gen_random_uuid(); result jsonb;
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
 -- The tax rate follows the GST answer for a Singapore GST issuer, so one save completes the details. For any other
 -- issuer the rate is carried and a made-up mark on it survives, as before.
 v_rate:=customer_private.real_invoicing_issuer_rate(e,v_reg);
 v_keep:=ARRAY(SELECT f FROM unnest(e.placeholder_fields) f WHERE f='gst_rate_bps' AND v_rate IS NULL);
 v_rate:=coalesce(v_rate,e.gst_rate_bps);
 -- A field counts as changed when its value differs or when it was marked made up and the owner has now confirmed it.
 v_changed:=ARRAY(SELECT x.f FROM (VALUES(1,'legalName',e.legal_name IS DISTINCT FROM input->>'legalName'),(2,'address',e.address IS DISTINCT FROM input->>'address'),
  (3,'uen',e.uen IS DISTINCT FROM input->>'uen' OR 'uen'=ANY(e.placeholder_fields)),
  (4,'gstRegistered',e.gst_registered IS DISTINCT FROM v_reg OR 'gst_registered'=ANY(e.placeholder_fields)),
  (5,'gstRegistrationNo',e.gst_registration_no IS DISTINCT FROM v_no OR 'gst_registration_no'=ANY(e.placeholder_fields)),
  (6,'paymentInstructions',e.payment_instructions IS DISTINCT FROM input->>'paymentInstructions' OR 'payment_instructions'=ANY(e.placeholder_fields)),
  (7,'financeLabel',e.finance_label IS DISTINCT FROM input->>'financeLabel' OR 'finance_label'=ANY(e.placeholder_fields)),
  (8,'gstRateBps',e.gst_rate_bps IS DISTINCT FROM v_rate OR ('gst_rate_bps'=ANY(e.placeholder_fields) AND cardinality(v_keep)=0))) x(n,f,differs) WHERE x.differs ORDER BY x.n);
 IF cardinality(v_changed)=0 AND e.owner_entered_by IS NOT NULL AND e.placeholder_fields=v_keep THEN
  v_version:=e.version;
  result:=jsonb_build_object('state','unchanged');
 ELSE
  v_version:=e.version+1;
  INSERT INTO customer_private.real_invoicing_entity(version,legal_name,address,country,uen,gst_registered,gst_registration_no,tax_label,gst_rate_bps,
   payment_terms_days,payment_instructions,finance_label,approver_principal_id,placeholder_fields,executor_id,reason,owner_entered_by)
  VALUES(v_version,input->>'legalName',input->>'address',e.country,input->>'uen',v_reg,v_no,e.tax_label,v_rate,e.payment_terms_days,
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

-- CREATE OR REPLACE keeps the grants of 0003. Repeated so the access is explicit in this file too.
REVOKE ALL ON FUNCTION app.real_invoicing_issuer_view(),app.real_invoicing_issuer_save(uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.real_invoicing_issuer_view(),app.real_invoicing_issuer_save(uuid,jsonb) TO corridra_runtime;
