-- Optional quote extension. No financial ledger, payment transport or principal-sale authority.
CREATE TABLE customer_private.service_quote_arrangement (
 quote_id uuid PRIMARY KEY REFERENCES customer_private.service_quote(id),
 staff_actor uuid NOT NULL,
 command_id uuid NOT NULL,
 public_terms jsonb NOT NULL CHECK(jsonb_typeof(public_terms)='object'),
 internal_economics jsonb CHECK(internal_economics IS NULL OR jsonb_typeof(internal_economics)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(staff_actor,command_id),
 FOREIGN KEY(staff_actor,command_id) REFERENCES customer_private.service_request_staff_command(actor_id,command_id)
);
ALTER TABLE customer_private.service_quote_arrangement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.service_quote_arrangement FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER service_quote_arrangement_immutable BEFORE UPDATE OR DELETE ON customer_private.service_quote_arrangement
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

CREATE FUNCTION customer_private.check_arrangement(terms jsonb,internal_cost jsonb,components jsonb,quote_currency text) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role text; item jsonb; commission jsonb; supply jsonb; positions integer[]; expected integer[];
BEGIN
 IF NOT customer_private.service_input_shape(terms,ARRAY['version','mode','parties','supplyPrice','fixedFeePositions','commission','sourceTerms','principalStatus'],ARRAY[]::text[])
  OR terms->'version' IS DISTINCT FROM '1'::jsonb
  OR coalesce(terms->>'mode','') NOT IN ('BUNDLED_SUPPLY','SEPARATE_FEE','SUCCESS_COMMISSION','HYBRID')
  OR jsonb_typeof(terms->'sourceTerms') IS DISTINCT FROM 'string'
  OR terms->>'principalStatus' IS DISTINCT FROM 'CORRIDRA_SERVICE_PROVIDER'
  OR NOT customer_private.service_synthetic_ok(terms->>'sourceTerms',1000)
  OR NOT customer_private.service_input_shape(terms->'parties',ARRAY['buyer','seller','supplier','serviceProvider','serviceFeePayer','serviceInvoiceIssuer','servicePaymentRecipient','invoiceIssuer','paymentRecipient','deliveryResponsible','warrantyResponsible','importerOfRecord','operatingPartner'],ARRAY[]::text[])
  OR jsonb_typeof(terms->'fixedFeePositions') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Complete commercial terms required; principal sales need separate legal and accounting approval' USING ERRCODE='23514'; END IF;
 FOR role IN SELECT unnest(ARRAY['buyer','seller','supplier','serviceProvider','serviceFeePayer','serviceInvoiceIssuer','servicePaymentRecipient','invoiceIssuer','paymentRecipient','deliveryResponsible','warrantyResponsible']) LOOP
  IF jsonb_typeof(terms->'parties'->role) IS DISTINCT FROM 'string' OR NOT customer_private.service_synthetic_ok(terms->'parties'->>role,160) THEN
   RAISE EXCEPTION 'Name each contracting party and responsibility' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR role IN SELECT unnest(ARRAY['importerOfRecord','operatingPartner']) LOOP
  IF terms->'parties'->role IS DISTINCT FROM 'null'::jsonb AND
   (jsonb_typeof(terms->'parties'->role) IS DISTINCT FROM 'string' OR NOT customer_private.service_synthetic_ok(terms->'parties'->>role,160)) THEN
   RAISE EXCEPTION 'State the importer or partner, or leave the role explicitly unagreed' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF jsonb_array_length(terms->'fixedFeePositions')>12 OR EXISTS(SELECT FROM jsonb_array_elements(terms->'fixedFeePositions') x WHERE jsonb_typeof(x)<>'number' OR x::text !~ '^([1-9]|1[0-2])$') THEN
  RAISE EXCEPTION 'Invalid fixed-fee references' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(x::text::integer ORDER BY x::text::integer),'{}'::integer[]) INTO positions FROM jsonb_array_elements(terms->'fixedFeePositions') x;
 SELECT coalesce(array_agg(ord::integer ORDER BY ord),'{}'::integer[]) INTO expected FROM jsonb_array_elements(components) WITH ORDINALITY x(value,ord)
  WHERE value->>'kind'='service_fee' AND value->>'amountMinor' ~ '^[1-9][0-9]{0,10}$';
 IF positions<>expected THEN RAISE EXCEPTION 'Reference every priced service fee exactly once' USING ERRCODE='23514'; END IF;
 supply:=terms->'supplyPrice'; commission:=terms->'commission';
 IF supply IS DISTINCT FROM 'null'::jsonb THEN
  IF NOT customer_private.service_input_shape(supply,ARRAY['currency','amountMinor','includedServices','exclusions'],ARRAY[]::text[])
   OR NOT EXISTS(SELECT FROM app.currency WHERE code=supply->>'currency')
   OR jsonb_typeof(supply->'amountMinor') IS DISTINCT FROM 'string' OR supply->>'amountMinor' !~ '^[1-9][0-9]{0,10}$'
   OR jsonb_typeof(supply->'includedServices') IS DISTINCT FROM 'string' OR jsonb_typeof(supply->'exclusions') IS DISTINCT FROM 'string'
   OR NOT customer_private.service_synthetic_ok(supply->>'includedServices',500) OR NOT customer_private.service_synthetic_ok(supply->>'exclusions',500) THEN
   RAISE EXCEPTION 'Supply price needs an exact original amount, currency, inclusions and exclusions' USING ERRCODE='23514'; END IF;
 END IF;
 IF commission IS DISTINCT FROM 'null'::jsonb THEN
  IF NOT customer_private.service_input_shape(commission,ARRAY['payer','recipient','trigger','baseDescription','baseMinor','currency','rateBasisPoints','evidenceRequired','rounding','fixedFeeTreatment'],ARRAY[]::text[])
   OR NOT EXISTS(SELECT FROM app.currency WHERE code=commission->>'currency')
   OR jsonb_typeof(commission->'baseMinor') IS DISTINCT FROM 'string' OR commission->>'baseMinor' !~ '^[1-9][0-9]{0,10}$'
   OR jsonb_typeof(commission->'rateBasisPoints') IS DISTINCT FROM 'number' OR commission->>'rateBasisPoints' !~ '^[1-9][0-9]{0,4}$'
   OR (commission->>'rateBasisPoints')::integer>10000 OR commission->>'rounding' IS DISTINCT FROM 'HALF_UP'
   OR coalesce(commission->>'fixedFeeTreatment','') NOT IN ('NO_FIXED_FEE','ADDITIONAL','CREDIT_FIXED_FEE') THEN
   RAISE EXCEPTION 'A commission needs its exact base, rate, trigger, evidence and fixed-fee treatment' USING ERRCODE='23514'; END IF;
  FOR role IN SELECT unnest(ARRAY['payer','recipient','trigger','baseDescription','evidenceRequired']) LOOP
   IF jsonb_typeof(commission->role) IS DISTINCT FROM 'string' OR NOT customer_private.service_synthetic_ok(commission->>role,CASE WHEN role IN ('payer','recipient') THEN 160 WHEN role='baseDescription' THEN 300 ELSE 500 END) THEN
    RAISE EXCEPTION 'Complete commission responsibilities and evidence required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (cardinality(positions)>0) IS DISTINCT FROM (commission->>'fixedFeeTreatment'<>'NO_FIXED_FEE') THEN
   RAISE EXCEPTION 'State whether commission adds to or credits the fixed fee' USING ERRCODE='23514'; END IF;
  IF commission->>'fixedFeeTreatment'='CREDIT_FIXED_FEE' AND commission->>'currency' IS DISTINCT FROM quote_currency THEN
   RAISE EXCEPTION 'A commission and fixed-fee credit need the same original currency' USING ERRCODE='23514'; END IF;
 END IF;
 IF terms->>'mode'='BUNDLED_SUPPLY' AND (supply='null'::jsonb OR commission<>'null'::jsonb OR cardinality(positions)>0)
  OR terms->>'mode'='SEPARATE_FEE' AND (cardinality(positions)=0 OR commission<>'null'::jsonb)
  OR terms->>'mode'='SUCCESS_COMMISSION' AND (commission='null'::jsonb OR cardinality(positions)>0)
  OR terms->>'mode'='HYBRID' AND (cardinality(positions)=0 OR (commission='null'::jsonb AND supply='null'::jsonb)) THEN
  RAISE EXCEPTION 'Commercial arrangement contradicts its fees or supply terms' USING ERRCODE='23514'; END IF;
 IF internal_cost IS NOT NULL THEN
  IF NOT customer_private.service_input_shape(internal_cost,ARRAY['acquisitionCostMinor','currency','markupBasisPoints','relationshipNote'],ARRAY[]::text[])
   OR NOT EXISTS(SELECT FROM app.currency WHERE code=internal_cost->>'currency')
   OR jsonb_typeof(internal_cost->'acquisitionCostMinor') IS DISTINCT FROM 'string' OR internal_cost->>'acquisitionCostMinor' !~ '^[1-9][0-9]{0,10}$'
   OR jsonb_typeof(internal_cost->'markupBasisPoints') IS DISTINCT FROM 'number' OR internal_cost->>'markupBasisPoints' !~ '^(0|[1-9][0-9]{0,5})$'
   OR (internal_cost->>'markupBasisPoints')::integer>100000 OR jsonb_typeof(internal_cost->'relationshipNote') IS DISTINCT FROM 'string' OR NOT customer_private.service_synthetic_ok(internal_cost->>'relationshipNote',500) THEN
   RAISE EXCEPTION 'Invalid private supply economics' USING ERRCODE='23514'; END IF;
 END IF;
END $$;

CREATE FUNCTION customer_private.guard_quote_arrangement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor(); q customer_private.service_quote; c customer_private.service_request_staff_command;
BEGIN
 SELECT * INTO q FROM customer_private.service_quote WHERE id=NEW.quote_id;
 SELECT * INTO c FROM customer_private.service_request_staff_command WHERE actor_id=NEW.staff_actor AND command_id=NEW.command_id;
 IF NEW.staff_actor<>actor OR NEW.created_at IS DISTINCT FROM now() OR q.id IS NULL OR c.command_id IS NULL
  OR q.prepared_by<>actor OR q.staff_tenant_id IS DISTINCT FROM NULLIF(current_setting('corridra.tenant_id',true),'')::uuid
  OR q.created_at<now() OR q.created_at>clock_timestamp() OR c.operation<>'quote' OR c.request->>'requestId' IS DISTINCT FROM q.request_id::text
  OR EXISTS(SELECT FROM customer_private.service_quote_view WHERE quote_id=q.id)
  OR EXISTS(SELECT FROM customer_private.service_order_intent WHERE quote_id=q.id)
  OR q.version<>(SELECT max(version) FROM customer_private.service_quote WHERE request_id=q.request_id) THEN
  RAISE EXCEPTION 'Commercial terms must be attached atomically to the new quote by its authorised staff team' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.check_arrangement(NEW.public_terms,NEW.internal_economics,c.request->'components',q.currency);
 RETURN NEW;
END $$;
CREATE TRIGGER service_quote_arrangement_guard BEFORE INSERT ON customer_private.service_quote_arrangement FOR EACH ROW EXECUTE FUNCTION customer_private.guard_quote_arrangement();

-- Same source content and digest for every legacy quote; only new public terms extend it.
CREATE OR REPLACE FUNCTION customer_private.service_quote_digest(quote uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to((jsonb_build_object('id',q.id,'version',q.version,'currency',q.currency,'scope',q.scope,
  'exclusions',to_jsonb(q.exclusions),'assumptions',to_jsonb(q.assumptions),'deliveryTerms',q.delivery_terms,'paymentTerms',q.payment_terms,
  'validUntil',to_char(q.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'components',(SELECT coalesce(jsonb_agg(jsonb_build_object('position',c.position,'kind',c.kind,'label',c.label,'treatment',c.treatment,'amountMinor',c.amount_minor::text) ORDER BY c.position),'[]'::jsonb)
   FROM customer_private.service_quote_component c WHERE c.quote_id=q.id)) ||
  coalesce((SELECT jsonb_build_object('commercialArrangement',a.public_terms) FROM customer_private.service_quote_arrangement a WHERE a.quote_id=q.id),'{}'::jsonb))::text,'UTF8')),'hex')
 FROM customer_private.service_quote q WHERE q.id=quote
$$;
CREATE OR REPLACE FUNCTION customer_private.service_quote_json(quote uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',q.id,'version',q.version,'currency',q.currency,'scope',q.scope,
  'components',(SELECT coalesce(jsonb_agg(jsonb_build_object('position',c.position,'kind',c.kind,'label',c.label,'treatment',c.treatment,'amountMinor',c.amount_minor::text) ORDER BY c.position),'[]'::jsonb)
   FROM customer_private.service_quote_component c WHERE c.quote_id=q.id),
  'fixedTotalMinor',t.fixed::text,'estimatedTotalMinor',t.estimated::text,
  'exclusions',to_jsonb(q.exclusions),'assumptions',to_jsonb(q.assumptions),'deliveryTerms',q.delivery_terms,'paymentTerms',q.payment_terms,
  'validUntil',to_char(q.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'preparedAt',to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expired',q.valid_until<=clock_timestamp(),'digest',customer_private.service_quote_digest(q.id),'synthetic',customer_private.synthetic_context(),
  'billing','billing_not_enabled','paymentTaken',false) ||
  coalesce((SELECT jsonb_build_object('commercialArrangement',a.public_terms) FROM customer_private.service_quote_arrangement a WHERE a.quote_id=q.id),'{}'::jsonb)
 FROM customer_private.service_quote q CROSS JOIN LATERAL customer_private.service_quote_totals(q.id) t WHERE q.id=quote
$$;

CREATE FUNCTION app.service_request_arrangement_quote(command uuid,input jsonb,terms jsonb,internal_cost jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor(); prior customer_private.service_request_staff_command;
 a customer_private.service_quote_arrangement; q uuid; result jsonb;
BEGIN
 IF command IS NULL OR input IS NULL THEN RAISE EXCEPTION 'Quote command required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_staff.command:'||actor::text||':'||command::text,0));
 PERFORM app.service_request_staff_view((input->>'requestId')::uuid);
 SELECT * INTO prior FROM customer_private.service_request_staff_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  SELECT * INTO a FROM customer_private.service_quote_arrangement WHERE staff_actor=actor AND command_id=command;
  IF (a.public_terms IS DISTINCT FROM terms) OR (a.internal_economics IS DISTINCT FROM internal_cost) THEN
   RAISE EXCEPTION 'Commercial terms conflict with the original command' USING ERRCODE='23514'; END IF;
  result:=app.service_request_staff_command(command,'quote',input);
  IF customer_private.service_staff_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
  RETURN result;
 END IF;
 IF terms IS NOT NULL THEN PERFORM customer_private.check_arrangement(terms,internal_cost,input->'components',input->>'currency');
 ELSIF internal_cost IS NOT NULL THEN RAISE EXCEPTION 'Private economics need commercial terms' USING ERRCODE='23514'; END IF;
 result:=app.service_request_staff_command(command,'quote',input);
 IF terms IS NOT NULL THEN
  SELECT e.quote_id INTO STRICT q FROM customer_private.service_request_event e WHERE e.request_id=(input->>'requestId')::uuid AND e.seq=(input->>'expectedSeq')::integer+1 AND e.kind='quoted';
  INSERT INTO customer_private.service_quote_arrangement(quote_id,staff_actor,command_id,public_terms,internal_economics) VALUES(q,actor,command,terms,internal_cost);
 END IF;
 IF customer_private.service_staff_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- Private procurement information is available only to the current handling staff team with fresh MFA.
CREATE FUNCTION app.service_quote_internal_economics(target_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE page jsonb; actor uuid:=customer_private.service_staff_actor(); result jsonb;
BEGIN
 page:=app.service_request_staff_view(target_request);
 SELECT coalesce((SELECT jsonb_object_agg(q.version::text,a.internal_economics) FROM customer_private.service_quote q
  JOIN customer_private.service_quote_arrangement a ON a.quote_id=q.id WHERE q.request_id=target_request),'{}'::jsonb) INTO result;
 IF customer_private.service_staff_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer_private.check_arrangement(jsonb,jsonb,jsonb,text),customer_private.guard_quote_arrangement(),app.service_request_arrangement_quote(uuid,jsonb,jsonb,jsonb),app.service_quote_internal_economics(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.service_request_arrangement_quote(uuid,jsonb,jsonb,jsonb),app.service_quote_internal_economics(uuid) TO corridra_runtime;
