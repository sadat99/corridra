-- Optional additive change to the real invoicing module (ADR-064 amendment: payments and reversals; CRUD standard gap G3).
-- Owner decision of 5 Nov 2026: recording a real payment and reversing one both need a second staff person, and every
-- reversal carries a reason, the same rule as invoices and credit notes. A payment or a reversal is PREPARED by one person
-- as a proposal and APPROVED or rejected by another, in the existing proposal and decision tables, so the existing guard
-- (a second person unless the owner recorded otherwise with a reason, and the named finance approver when one is named)
-- applies unchanged. A reversal is a new append-only record that names the payment; the payment is never edited or
-- deleted and stays readable. What is paid is derived from the payments that are not reversed. The one-person payment
-- command works only while the control says a second person is not required. Installing this changes no other module.

ALTER TABLE customer_private.real_invoicing_proposal DROP CONSTRAINT real_invoicing_proposal_kind_check;
ALTER TABLE customer_private.real_invoicing_proposal ADD CONSTRAINT real_invoicing_proposal_kind_check CHECK(kind IN ('invoice','credit','payment','payment_reversal'));
ALTER TABLE customer_private.real_invoicing_proposal
 ADD COLUMN received_on date,ADD COLUMN method text,ADD COLUMN reference text,ADD COLUMN payment_seq integer;
ALTER TABLE customer_private.real_invoicing_proposal ADD CONSTRAINT real_invoicing_proposal_payment_fields CHECK(
 (kind IN ('payment','payment_reversal')) OR (received_on IS NULL AND method IS NULL AND reference IS NULL AND payment_seq IS NULL));
ALTER TABLE customer_private.real_invoicing_proposal ADD CONSTRAINT real_invoicing_proposal_payment_check CHECK(kind<>'payment' OR (
 invoice_id IS NOT NULL AND expected_position BETWEEN 0 AND 1000 AND amount_minor IS NOT NULL AND received_on IS NOT NULL
 AND method IN ('bank_transfer','cash','other') AND customer_private.billing_plain_ok(reference,2,120)
 AND payment_seq IS NULL AND reason IS NULL AND subscription_id IS NULL));
ALTER TABLE customer_private.real_invoicing_proposal ADD CONSTRAINT real_invoicing_proposal_reversal_check CHECK(kind<>'payment_reversal' OR (
 invoice_id IS NOT NULL AND expected_position BETWEEN 0 AND 1000 AND payment_seq BETWEEN 1 AND 500
 AND customer_private.billing_plain_ok(reason,10,500) AND amount_minor IS NULL AND received_on IS NULL AND method IS NULL AND reference IS NULL
 AND subscription_id IS NULL));

-- A payment now records which approved proposal it came from. Payments recorded before this change have none.
ALTER TABLE customer_private.real_invoice_payment
 ADD COLUMN proposal_id uuid UNIQUE REFERENCES customer_private.real_invoicing_proposal(id),
 ADD COLUMN approved_by uuid REFERENCES identity.principal(id),
 ADD COLUMN self_approved boolean NOT NULL DEFAULT false;

CREATE TABLE customer_private.real_invoice_payment_reversal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 payment_seq integer NOT NULL CHECK(payment_seq BETWEEN 1 AND 500),
 proposal_id uuid UNIQUE REFERENCES customer_private.real_invoicing_proposal(id),
 reason text NOT NULL CHECK(customer_private.billing_plain_ok(reason,10,500)),
 prepared_by uuid NOT NULL REFERENCES identity.principal(id),
 approved_by uuid NOT NULL REFERENCES identity.principal(id),
 self_approved boolean NOT NULL DEFAULT false,
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,seq),
 UNIQUE(invoice_id,payment_seq),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.real_invoice(tenant_id,id),
 FOREIGN KEY(invoice_id,payment_seq) REFERENCES customer_private.real_invoice_payment(invoice_id,seq)
);
CREATE TRIGGER real_invoice_payment_reversal_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoice_payment_reversal FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.real_invoice_payment_reversal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.real_invoice_payment_reversal FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database guard on reversals, for every writer: real workspace, the next number in order, and a second person's approval
-- of this very reversal while the control requires one.
CREATE FUNCTION customer_private.real_invoice_payment_reversal_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.real_invoice; v_prev integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||NEW.invoice_id::text,0));
 SELECT * INTO v_inv FROM customer_private.real_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND NOT t.synthetic) THEN RAISE EXCEPTION 'Real invoices are for real workspaces only' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(r.seq),0) INTO v_prev FROM customer_private.real_invoice_payment_reversal r WHERE r.invoice_id=NEW.invoice_id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Reversals must follow in order' USING ERRCODE='23514'; END IF;
 IF customer_private.real_invoicing_second_required() AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_proposal pr
  JOIN customer_private.real_invoicing_decision d ON d.proposal_id=pr.id AND d.decision='approved'
  WHERE pr.id=NEW.proposal_id AND pr.kind='payment_reversal' AND pr.invoice_id=NEW.invoice_id AND pr.payment_seq=NEW.payment_seq) THEN
  RAISE EXCEPTION 'A reversal needs a second person' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER real_invoice_payment_reversal_guard BEFORE INSERT ON customer_private.real_invoice_payment_reversal FOR EACH ROW EXECUTE FUNCTION customer_private.real_invoice_payment_reversal_guard();

-- The command log learns the new operations. Existing rows are untouched.
ALTER TABLE customer_private.real_invoicing_command DROP CONSTRAINT real_invoicing_command_operation_check;
ALTER TABLE customer_private.real_invoicing_command ADD CONSTRAINT real_invoicing_command_operation_check
 CHECK(operation IN ('prepare_invoice','prepare_credit','decide','payment','prepare_payment','prepare_payment_reversal'));

-- What is paid, the position, the payment guard, the document, the events, the staff lists and the staff command now know
-- about payments that are prepared and reversed. Replacing a function keeps its grants.


CREATE OR REPLACE FUNCTION customer_private.real_invoicing_paid(inv uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(p.amount_minor),0)::bigint FROM customer_private.real_invoice_payment p WHERE p.invoice_id=inv
  AND NOT EXISTS(SELECT FROM customer_private.real_invoice_payment_reversal r WHERE r.invoice_id=p.invoice_id AND r.payment_seq=p.seq)
$$;

CREATE OR REPLACE FUNCTION customer_private.real_invoicing_position(inv uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM customer_private.real_invoice_payment p WHERE p.invoice_id=inv)::integer
  +(SELECT count(*) FROM customer_private.real_invoice_credit c WHERE c.invoice_id=inv)::integer
  +(SELECT count(*) FROM customer_private.real_invoice_payment_reversal r WHERE r.invoice_id=inv)::integer
$$;

CREATE OR REPLACE FUNCTION customer_private.real_invoice_payment_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.real_invoice; v_prev integer; v_today date:=customer_private.real_invoicing_today();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||NEW.invoice_id::text,0));
 SELECT * INTO v_inv FROM customer_private.real_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(p.seq),0) INTO v_prev FROM customer_private.real_invoice_payment p WHERE p.invoice_id=NEW.invoice_id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Payments must follow in order' USING ERRCODE='23514'; END IF;
 IF NEW.received_on>v_today THEN RAISE EXCEPTION 'A payment cannot be dated in the future' USING ERRCODE='23514'; END IF;
 IF NEW.received_on<v_inv.issue_date THEN RAISE EXCEPTION 'A payment cannot be dated before the invoice' USING ERRCODE='23514'; END IF;
 IF NEW.amount_minor>v_inv.total_minor-customer_private.real_invoicing_paid(v_inv.id)-customer_private.real_invoicing_credited(v_inv.id) THEN
  RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
 IF customer_private.real_invoicing_second_required() AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_proposal pr
  JOIN customer_private.real_invoicing_decision d ON d.proposal_id=pr.id AND d.decision='approved'
  WHERE pr.id=NEW.proposal_id AND pr.kind='payment' AND pr.invoice_id=NEW.invoice_id AND pr.amount_minor=NEW.amount_minor) THEN
  RAISE EXCEPTION 'A payment needs a second person' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION customer_private.real_invoicing_invoice_json(v_id uuid,audience text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i customer_private.real_invoice; p customer_private.billing_plan_version; e customer_private.real_invoicing_entity; v_paid bigint; v_cred bigint;
 v_pay jsonb; v_cn jsonb; v_status text; v_title text; v_label text;
BEGIN
 SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=v_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.id=i.plan_id;
 SELECT * INTO e FROM customer_private.real_invoicing_entity x WHERE x.version=i.entity_version;
 v_paid:=customer_private.real_invoicing_paid(i.id);
 v_cred:=customer_private.real_invoicing_credited(i.id);
 v_status:=CASE
  WHEN i.total_minor-v_paid-v_cred>0 THEN CASE WHEN v_paid>0 THEN 'partly_paid' ELSE 'unpaid' END
  WHEN v_paid>0 AND v_cred>0 THEN 'settled' WHEN v_paid>0 THEN 'paid' ELSE 'credited' END;
 v_title:=CASE WHEN i.gst_registered THEN 'Tax Invoice' ELSE 'Invoice' END;
 v_label:=CASE WHEN cardinality(e.placeholder_fields)>0 THEN 'Contains made-up organisation data (madeup): '||array_to_string(e.placeholder_fields,', ')||'. Not a valid tax invoice.' ELSE NULL END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',x.seq,'amountMinor',x.amount_minor::text,'receivedOn',x.received_on,'method',x.method,'reversed',r.id IS NOT NULL)
  || CASE WHEN audience='staff' THEN jsonb_build_object('reference',x.reference,'recordedAt',x.created_at)
   || CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('reversal',jsonb_build_object('seq',r.seq,'reason',r.reason,'reversedAt',r.created_at)) ELSE '{}'::jsonb END
   ELSE '{}'::jsonb END ORDER BY x.seq),'[]'::jsonb) INTO v_pay
 FROM customer_private.real_invoice_payment x
 LEFT JOIN customer_private.real_invoice_payment_reversal r ON r.invoice_id=x.invoice_id AND r.payment_seq=x.seq WHERE x.invoice_id=i.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',x.seq,'number',customer_private.real_invoicing_number('CN',x.credit_year,x.credit_seq),'amountMinor',x.amount_minor::text,
  'issuedOn',x.issued_on,'reason',x.reason) ORDER BY x.seq),'[]'::jsonb) INTO v_cn
 FROM customer_private.real_invoice_credit x WHERE x.invoice_id=i.id;
 RETURN jsonb_build_object('id',i.id,'number',customer_private.real_invoicing_number('INV',i.invoice_year,i.invoice_seq),'title',v_title,
  'subscriptionId',i.subscription_id,'workspaceId',i.tenant_id,'planKey',p.plan_key,'planVersion',p.version,'planTitle',p.title,'interval',p.billing_interval,
  'periodStart',i.period_start,'periodEnd',i.period_end,'issueDate',i.issue_date,'dueDate',i.due_date,'currency',i.currency,'taxTreatment',i.tax_treatment,
  'gstRegistered',i.gst_registered,'taxLabel',e.tax_label,'taxRateBps',i.tax_rate_bps,'planFeeMinor',i.plan_fee_minor::text,'taxMinor',i.tax_minor::text,
  'amountExcludingTaxMinor',CASE WHEN i.tax_treatment='price_includes_tax' AND i.gst_registered THEN (i.plan_fee_minor-i.tax_minor)::text ELSE i.plan_fee_minor::text END,
  'totalMinor',i.total_minor::text,'paidMinor',v_paid::text,'creditedMinor',v_cred::text,'outstandingMinor',(i.total_minor-v_paid-v_cred)::text,
  'status',v_status,'overdue',i.total_minor-v_paid-v_cred>0 AND i.due_date<customer_private.real_invoicing_today(),'payments',v_pay,'credits',v_cn,
  'supplier',jsonb_build_object('legalName',e.legal_name,'address',e.address,'country',e.country,'uen',e.uen,'gstRegistrationNo',e.gst_registration_no),
  'billTo',jsonb_build_object('name',i.bill_to_name,'address',i.bill_to_address),'paymentInstructions',e.payment_instructions,
  'madeupFields',to_jsonb(e.placeholder_fields),'label',v_label,'moneyDomain','B','synthetic',false)
  || CASE WHEN audience='staff' THEN jsonb_build_object('position',customer_private.real_invoicing_position(i.id),'issuedAt',i.created_at,
   'selfApproved',i.self_approved,'entityVersion',i.entity_version) ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION customer_private.real_invoicing_emit(target uuid,aggregate uuid,kind text,number text,item_seq integer,version integer,initiator uuid,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid();
BEGIN
 IF target IS NULL OR kind NOT IN ('invoice.prepared','invoice.issued','invoice.rejected','credit.prepared','credit.issued','credit.rejected','payment.recorded',
  'payment.prepared','payment.rejected','payment_reversal.prepared','payment_reversal.rejected','payment.reversed') THEN
  RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.real_invoicing.'||kind,1,'customer_real_invoice',aggregate::text,version,initiator,clock_timestamp(),command,command,
  jsonb_build_object('documentId',aggregate,'number',number,'seq',item_seq,'synthetic',false,'initiator_kind','staff','initiator_id',initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,initiator,'customer.real_invoicing.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

CREATE OR REPLACE FUNCTION app.real_invoicing_staff_pending() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_staff_actor(); v_periods jsonb; v_props jsonb; e customer_private.real_invoicing_entity;
BEGIN
 e:=customer_private.real_invoicing_entity_current();
 SELECT coalesce(jsonb_agg(jsonb_build_object('subscriptionId',q.subscription_id,'workspaceId',q.tenant_id,'workspaceName',q.workspace_name,'planKey',q.plan_key,'planVersion',q.version,
  'planTitle',q.title,'interval',q.billing_interval,'periodStart',q.period_start,'periodEnd',q.period_end,'priceMinor',q.price_minor::text,'currency',q.currency,
  'taxTreatment',q.tax_treatment) ORDER BY q.period_start,q.subscription_id),'[]'::jsonb) INTO v_periods
 FROM (SELECT e2.subscription_id,e2.period_start,e2.period_end,s.tenant_id,w.name AS workspace_name,p.plan_key,p.version,p.title,p.billing_interval,p.price_minor,p.currency,p.tax_treatment
  FROM customer_private.billing_subscription_event e2
  JOIN customer_private.billing_subscription s ON s.id=e2.subscription_id
  JOIN app.tenant w ON w.id=s.tenant_id AND NOT w.synthetic
  JOIN customer_private.billing_plan_version p ON p.id=s.plan_id AND p.price_minor>0 AND NOT p.synthetic
  WHERE e2.kind IN ('activated','renewed')
  AND NOT EXISTS(SELECT FROM customer_private.real_invoice i WHERE i.subscription_id=e2.subscription_id AND i.period_start=e2.period_start)
  AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_proposal pr WHERE pr.kind='invoice' AND pr.subscription_id=e2.subscription_id AND pr.period_start=e2.period_start
   AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=pr.id AND d.decision='rejected'))
  ORDER BY e2.period_start,e2.subscription_id LIMIT 50) q;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'kind',pr.kind,'workspaceId',pr.tenant_id,'workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=pr.tenant_id),
  'subscriptionId',pr.subscription_id,'periodStart',pr.period_start,'periodEnd',pr.period_end,'dueDate',pr.due_date,'billToName',pr.bill_to_name,'billToAddress',pr.bill_to_address,
  'invoiceId',pr.invoice_id,'invoiceNumber',(SELECT customer_private.real_invoicing_number('INV',i.invoice_year,i.invoice_seq) FROM customer_private.real_invoice i WHERE i.id=pr.invoice_id),
  'amountMinor',pr.amount_minor::text,'reason',pr.reason,'receivedOn',pr.received_on,'method',pr.method,'reference',pr.reference,'paymentSeq',pr.payment_seq,
  'paymentAmountMinor',(SELECT pay.amount_minor::text FROM customer_private.real_invoice_payment pay WHERE pay.invoice_id=pr.invoice_id AND pay.seq=pr.payment_seq),
  'paymentReceivedOn',(SELECT pay.received_on FROM customer_private.real_invoice_payment pay WHERE pay.invoice_id=pr.invoice_id AND pay.seq=pr.payment_seq),'preparedByYou',pr.prepared_by=v_actor,'preparedAt',pr.created_at,
  'preview',CASE WHEN pr.kind='invoice' THEN (SELECT jsonb_build_object('currency',p.currency,'planTitle',p.title,'taxTreatment',p.tax_treatment,'feeMinor',p.price_minor::text,
    'taxMinor',CASE WHEN e.gst_registered THEN customer_private.real_invoicing_tax(p.price_minor,p.tax_treatment,e.gst_rate_bps)::text ELSE '0' END,
    'totalMinor',(p.price_minor+CASE WHEN e.gst_registered AND p.tax_treatment='price_excludes_tax' THEN customer_private.real_invoicing_tax(p.price_minor,p.tax_treatment,e.gst_rate_bps) ELSE 0 END)::text)
    FROM customer_private.billing_plan_version p WHERE p.id=pr.plan_id) ELSE NULL END) ORDER BY pr.created_at),'[]'::jsonb) INTO v_props
 FROM customer_private.real_invoicing_proposal pr WHERE NOT EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=pr.id);
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('periods',v_periods,'proposals',v_props,
  'secondApproverRequired',customer_private.real_invoicing_second_required(),
  'supplier',jsonb_build_object('version',e.version,'legalName',e.legal_name,'address',e.address,'country',e.country,'uen',e.uen,'gstRegistered',e.gst_registered,
   'gstRegistrationNo',e.gst_registration_no,'taxLabel',e.tax_label,'gstRateBps',e.gst_rate_bps,'paymentTermsDays',e.payment_terms_days,'financeLabel',e.finance_label,
   'approverNamed',e.approver_principal_id IS NOT NULL,'madeupFields',to_jsonb(e.placeholder_fields)),
  'synthetic',false);
END $$;

CREATE OR REPLACE FUNCTION app.real_invoicing_staff_view(invoice_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_staff_actor(); i customer_private.real_invoice; v_json jsonb;
BEGIN
 IF invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=invoice_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||i.id::text,0));
 v_json:=customer_private.real_invoicing_invoice_json(i.id,'staff')||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=i.tenant_id));
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('invoice',v_json,'actions',CASE WHEN (v_json->>'outstandingMinor')::bigint>0 THEN '["payment","credit"]'::jsonb ELSE '[]'::jsonb END
   ||CASE WHEN EXISTS(SELECT FROM customer_private.real_invoice_payment p WHERE p.invoice_id=i.id
    AND NOT EXISTS(SELECT FROM customer_private.real_invoice_payment_reversal r WHERE r.invoice_id=p.invoice_id AND r.payment_seq=p.seq)) THEN '["reverse"]'::jsonb ELSE '[]'::jsonb END,
  'workspaceBalances',customer_private.real_invoicing_balances(i.tenant_id),'synthetic',false);
END $$;

CREATE OR REPLACE FUNCTION app.real_invoicing_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.real_invoicing_command; s customer_private.billing_subscription; p customer_private.billing_plan_version; i customer_private.real_invoice;
 e customer_private.real_invoicing_entity; pr customer_private.real_invoicing_proposal; v_end date; v_start date; v_due date; v_today date:=customer_private.real_invoicing_today();
 v_year integer:=extract(year FROM customer_private.real_invoicing_today())::integer; v_seq integer; v_item integer; v_pos integer; v_amount bigint; v_outstanding bigint;
 v_tax bigint; v_fee bigint; v_id uuid; v_doc uuid; v_self boolean; v_rate integer; v_decision text; result jsonb; v_aggregate uuid; v_number text; v_kind text; v_ps integer; pay customer_private.real_invoice_payment;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('prepare_invoice','prepare_credit','decide','payment','prepare_payment','prepare_payment_reversal') THEN
  RAISE EXCEPTION 'Invalid invoicing command' USING ERRCODE='23514'; END IF;
 IF operation='prepare_invoice' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['subscriptionId','periodStart','dueOn','billToName','billToAddress'],ARRAY[]::text[])
   OR jsonb_typeof(input->'subscriptionId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'periodStart') IS DISTINCT FROM 'string'
   OR input->>'periodStart' !~ '^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(input->'dueOn') IS DISTINCT FROM 'string' OR input->>'dueOn' !~ '^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(input->'billToName') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'billToAddress') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'An invoice needs the period, a due date and who it is billed to' USING ERRCODE='23514'; END IF;
 ELSIF operation='prepare_credit' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['invoiceId','expectedPosition','amountMinor','reason'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedPosition') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'amountMinor') IS DISTINCT FROM 'string' OR input->>'amountMinor' !~ '^[1-9][0-9]{0,11}$'
   OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'A credit note needs an amount and a reason' USING ERRCODE='23514'; END IF;
 ELSIF operation='prepare_payment_reversal' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['invoiceId','expectedPosition','paymentSeq','reason'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedPosition') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'paymentSeq') IS DISTINCT FROM 'number' OR input->>'paymentSeq' !~ '^[1-9][0-9]{0,2}$'
   OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'A reversal needs the payment and a reason' USING ERRCODE='23514'; END IF;
 ELSIF operation='decide' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['proposalId','decision'],ARRAY['reason'])
   OR jsonb_typeof(input->'proposalId') IS DISTINCT FROM 'string' OR input->>'decision' NOT IN ('approve','reject')
   OR (input ? 'reason' AND jsonb_typeof(input->'reason') IS DISTINCT FROM 'string')
   OR (input->>'decision'='reject' AND NOT input ? 'reason') THEN
   RAISE EXCEPTION 'A decision needs the proposal and approve or reject; a rejection needs a reason' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.billing_input_shape(input,ARRAY['invoiceId','expectedPosition','amountMinor','receivedOn','method','reference'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedPosition') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'amountMinor') IS DISTINCT FROM 'string' OR input->>'amountMinor' !~ '^[1-9][0-9]{0,11}$'
   OR jsonb_typeof(input->'receivedOn') IS DISTINCT FROM 'string' OR input->>'receivedOn' !~ '^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(input->'method') IS DISTINCT FROM 'string' OR input->>'method' NOT IN ('bank_transfer','cash','other')
   OR jsonb_typeof(input->'reference') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'A payment needs an amount, the date it was received, how and a reference' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.staff.command:'||v_actor::text||':'||command::text,0));
 SELECT * INTO prior FROM customer_private.real_invoicing_command c WHERE c.actor_id=v_actor AND c.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 e:=customer_private.real_invoicing_entity_current();
 IF e.version IS NULL THEN RAISE EXCEPTION 'The supplier details are not set' USING ERRCODE='55000'; END IF;

 IF operation='prepare_invoice' THEN
  v_id:=(input->>'subscriptionId')::uuid; v_start:=(input->>'periodStart')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.period:'||v_id::text||':'||v_start::text,0));
  SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.id=s.plan_id;
  IF p.synthetic THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
  SELECT e2.period_end INTO v_end FROM customer_private.billing_subscription_event e2 WHERE e2.subscription_id=s.id AND e2.kind IN ('activated','renewed') AND e2.period_start=v_start;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a period that the team activated or renewed can be invoiced' USING ERRCODE='23514'; END IF;
  IF p.price_minor=0 THEN RAISE EXCEPTION 'A free plan cannot be invoiced' USING ERRCODE='23514'; END IF;
  IF e.gst_registered AND p.currency<>'SGD' THEN RAISE EXCEPTION 'GST invoices are in Singapore dollars until currency conversion is built' USING ERRCODE='23514'; END IF;
  IF e.gst_registered AND p.tax_treatment='tax_to_be_confirmed' THEN RAISE EXCEPTION 'Set the plan''s tax treatment before invoicing; this supplier is GST registered' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.real_invoice x WHERE x.subscription_id=s.id AND x.period_start=v_start)
   OR EXISTS(SELECT FROM customer_private.real_invoicing_proposal x WHERE x.kind='invoice' AND x.subscription_id=s.id AND x.period_start=v_start
    AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=x.id AND d.decision='rejected')) THEN
   RAISE EXCEPTION 'This period is already invoiced or waiting for approval' USING ERRCODE='23505'; END IF;
  v_due:=(input->>'dueOn')::date;
  IF v_due<v_today OR v_due>v_today+90 THEN RAISE EXCEPTION 'The due date must be within 90 days of today' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,subscription_id,plan_id,period_start,period_end,due_date,bill_to_name,bill_to_address,prepared_by,staff_tenant_id)
  VALUES('invoice',s.tenant_id,s.id,p.id,v_start,v_end,v_due,input->>'billToName',input->>'billToAddress',v_actor,t) RETURNING id INTO v_id;
  PERFORM customer_private.real_invoicing_emit(s.tenant_id,v_id,'invoice.prepared',NULL,1,1,v_actor,command);
  v_aggregate:=v_id;
  result:=jsonb_build_object('proposalId',v_id,'kind','invoice','state','waiting_for_approval','secondApproverRequired',customer_private.real_invoicing_second_required());
 ELSIF operation='prepare_credit' THEN
  v_id:=(input->>'invoiceId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||v_id::text,0));
  SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  v_pos:=customer_private.real_invoicing_position(i.id);
  IF v_pos<>(input->>'expectedPosition')::integer THEN RAISE EXCEPTION 'The invoice changed; reload and try again' USING ERRCODE='23514'; END IF;
  v_amount:=(input->>'amountMinor')::bigint;
  IF NOT customer_private.billing_plain_ok(input->>'reason',10,500) THEN RAISE EXCEPTION 'Give the reason in plain words, at least 10 characters, with no links or addresses' USING ERRCODE='23514'; END IF;
  IF v_amount>i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id) THEN
   RAISE EXCEPTION 'A credit cannot be more than is still unpaid on this invoice' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.real_invoicing_proposal x WHERE x.kind='credit' AND x.invoice_id=i.id
   AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=x.id)) THEN
   RAISE EXCEPTION 'A credit note for this invoice is already waiting for approval' USING ERRCODE='23505'; END IF;
  INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,amount_minor,reason,prepared_by,staff_tenant_id)
  VALUES('credit',i.tenant_id,i.id,v_pos,v_amount,input->>'reason',v_actor,t) RETURNING id INTO v_id;
  PERFORM customer_private.real_invoicing_emit(i.tenant_id,v_id,'credit.prepared',NULL,1,1,v_actor,command);
  v_aggregate:=v_id;
  result:=jsonb_build_object('proposalId',v_id,'kind','credit','state','waiting_for_approval','secondApproverRequired',customer_private.real_invoicing_second_required());
 ELSIF operation='prepare_payment' THEN
  v_id:=(input->>'invoiceId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||v_id::text,0));
  SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  v_pos:=customer_private.real_invoicing_position(i.id);
  IF v_pos<>(input->>'expectedPosition')::integer THEN RAISE EXCEPTION 'The invoice changed; reload and try again' USING ERRCODE='23514'; END IF;
  v_amount:=(input->>'amountMinor')::bigint;
  v_outstanding:=i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id);
  IF NOT customer_private.billing_plain_ok(input->>'reference',2,120) THEN RAISE EXCEPTION 'Give the reference in plain words, with no links or addresses' USING ERRCODE='23514'; END IF;
  IF (input->>'receivedOn')::date>v_today THEN RAISE EXCEPTION 'A payment cannot be dated in the future' USING ERRCODE='23514'; END IF;
  IF (input->>'receivedOn')::date<i.issue_date THEN RAISE EXCEPTION 'A payment cannot be dated before the invoice' USING ERRCODE='23514'; END IF;
  IF v_amount>v_outstanding THEN RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.real_invoicing_proposal x WHERE x.kind='payment' AND x.invoice_id=i.id
   AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=x.id)) THEN
   RAISE EXCEPTION 'A payment for this invoice is already waiting for approval' USING ERRCODE='23505'; END IF;
  INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,amount_minor,received_on,method,reference,prepared_by,staff_tenant_id)
  VALUES('payment',i.tenant_id,i.id,v_pos,v_amount,(input->>'receivedOn')::date,input->>'method',input->>'reference',v_actor,t) RETURNING id INTO v_id;
  PERFORM customer_private.real_invoicing_emit(i.tenant_id,v_id,'payment.prepared',NULL,1,1,v_actor,command);
  v_aggregate:=v_id;
  result:=jsonb_build_object('proposalId',v_id,'kind','payment','state','waiting_for_approval','secondApproverRequired',customer_private.real_invoicing_second_required());
 ELSIF operation='prepare_payment_reversal' THEN
  v_id:=(input->>'invoiceId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||v_id::text,0));
  SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  v_pos:=customer_private.real_invoicing_position(i.id);
  IF v_pos<>(input->>'expectedPosition')::integer THEN RAISE EXCEPTION 'The invoice changed; reload and try again' USING ERRCODE='23514'; END IF;
  IF NOT customer_private.billing_plain_ok(input->>'reason',10,500) THEN RAISE EXCEPTION 'Give the reason in plain words, at least 10 characters, with no links or addresses' USING ERRCODE='23514'; END IF;
  v_ps:=(input->>'paymentSeq')::integer;
  SELECT * INTO pay FROM customer_private.real_invoice_payment x WHERE x.invoice_id=i.id AND x.seq=v_ps;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no such payment on this invoice' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.real_invoice_payment_reversal x WHERE x.invoice_id=i.id AND x.payment_seq=v_ps) THEN
   RAISE EXCEPTION 'That payment is already reversed' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT FROM customer_private.real_invoicing_proposal x WHERE x.kind='payment_reversal' AND x.invoice_id=i.id AND x.payment_seq=v_ps
   AND NOT EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=x.id)) THEN
   RAISE EXCEPTION 'A reversal of this payment is already waiting for approval' USING ERRCODE='23505'; END IF;
  INSERT INTO customer_private.real_invoicing_proposal(kind,tenant_id,invoice_id,expected_position,payment_seq,reason,prepared_by,staff_tenant_id)
  VALUES('payment_reversal',i.tenant_id,i.id,v_pos,v_ps,input->>'reason',v_actor,t) RETURNING id INTO v_id;
  PERFORM customer_private.real_invoicing_emit(i.tenant_id,v_id,'payment_reversal.prepared',NULL,1,1,v_actor,command);
  v_aggregate:=v_id;
  result:=jsonb_build_object('proposalId',v_id,'kind','payment_reversal','state','waiting_for_approval','secondApproverRequired',customer_private.real_invoicing_second_required());
 ELSIF operation='decide' THEN
  v_id:=(input->>'proposalId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.proposal:'||v_id::text,0));
  SELECT * INTO pr FROM customer_private.real_invoicing_proposal x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal unavailable' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM customer_private.real_invoicing_decision d WHERE d.proposal_id=pr.id) THEN RAISE EXCEPTION 'This proposal has already been decided' USING ERRCODE='23505'; END IF;
  v_decision:=CASE WHEN input->>'decision'='approve' THEN 'approved' ELSE 'rejected' END;
  v_self:=pr.prepared_by=v_actor;
  IF v_decision='rejected' AND NOT customer_private.billing_plain_ok(input->>'reason',3,500) THEN
   RAISE EXCEPTION 'Give the reason in plain words, with no links or addresses' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.real_invoicing_decision(proposal_id,decision,decided_by,self_approved,reason,staff_tenant_id)
  VALUES(pr.id,v_decision,v_actor,v_self AND v_decision='approved',CASE WHEN v_decision='rejected' THEN input->>'reason' ELSE NULL END,t);
  IF v_decision='rejected' THEN
   PERFORM customer_private.real_invoicing_emit(pr.tenant_id,pr.id,pr.kind||'.rejected',NULL,1,2,v_actor,command);
   v_aggregate:=pr.id;
   result:=jsonb_build_object('proposalId',pr.id,'kind',pr.kind,'state','rejected');
  ELSIF pr.kind='invoice' THEN
   SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=pr.subscription_id;
   SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.id=pr.plan_id;
   IF p.id IS NULL OR s.plan_id<>p.id THEN RAISE EXCEPTION 'The subscription changed after this invoice was prepared; prepare it again' USING ERRCODE='23514'; END IF;
   v_fee:=p.price_minor;
   IF e.gst_registered THEN
    IF p.currency<>'SGD' THEN RAISE EXCEPTION 'GST invoices are in Singapore dollars until currency conversion is built' USING ERRCODE='23514'; END IF;
    IF p.tax_treatment='tax_to_be_confirmed' THEN RAISE EXCEPTION 'Set the plan''s tax treatment before invoicing; this supplier is GST registered' USING ERRCODE='23514'; END IF;
    v_rate:=e.gst_rate_bps; v_tax:=customer_private.real_invoicing_tax(v_fee,p.tax_treatment,v_rate);
   ELSE v_rate:=NULL; v_tax:=0; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice-number:'||v_year::text,0));
   SELECT coalesce(max(x.invoice_seq),0)+1 INTO v_seq FROM customer_private.real_invoice x WHERE x.invoice_year=v_year;
   INSERT INTO customer_private.real_invoice(invoice_year,invoice_seq,tenant_id,subscription_id,plan_id,proposal_id,entity_version,period_start,period_end,issue_date,due_date,currency,
    tax_treatment,gst_registered,tax_rate_bps,plan_fee_minor,tax_minor,total_minor,bill_to_name,bill_to_address,prepared_by,issued_by,self_approved,staff_tenant_id)
   VALUES(v_year,v_seq,pr.tenant_id,pr.subscription_id,p.id,pr.id,e.version,pr.period_start,pr.period_end,v_today,GREATEST(pr.due_date,v_today),p.currency,
    p.tax_treatment,e.gst_registered,v_rate,v_fee,v_tax,v_fee+CASE WHEN e.gst_registered AND p.tax_treatment='price_excludes_tax' THEN v_tax ELSE 0 END,
    pr.bill_to_name,pr.bill_to_address,pr.prepared_by,v_actor,v_self,t) RETURNING id INTO v_doc;
   PERFORM customer_private.real_invoicing_emit(pr.tenant_id,v_doc,'invoice.issued',customer_private.real_invoicing_number('INV',v_year,v_seq),1,2,v_actor,command);
   v_aggregate:=v_doc;
   result:=jsonb_build_object('proposalId',pr.id,'kind','invoice','state','issued')||jsonb_build_object('invoice',customer_private.real_invoicing_invoice_json(v_doc,'staff'));
  ELSIF pr.kind='payment' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||pr.invoice_id::text,0));
   SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=pr.invoice_id;
   v_pos:=customer_private.real_invoicing_position(i.id);
   IF v_pos<>pr.expected_position THEN RAISE EXCEPTION 'The invoice changed after this payment was prepared; prepare it again' USING ERRCODE='23514'; END IF;
   IF pr.amount_minor>i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id) THEN
    RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
   SELECT coalesce(max(x.seq),0)+1 INTO v_item FROM customer_private.real_invoice_payment x WHERE x.invoice_id=i.id;
   INSERT INTO customer_private.real_invoice_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id,proposal_id,approved_by,self_approved)
   VALUES(i.id,i.tenant_id,v_item,pr.amount_minor,pr.received_on,pr.method,pr.reference,pr.prepared_by,t,pr.id,v_actor,v_self);
   PERFORM customer_private.real_invoicing_emit(i.tenant_id,i.id,'payment.recorded',customer_private.real_invoicing_number('INV',i.invoice_year,i.invoice_seq),v_item,v_pos+2,v_actor,command);
   v_aggregate:=i.id;
   result:=jsonb_build_object('proposalId',pr.id,'kind','payment','state','recorded')||jsonb_build_object('invoice',customer_private.real_invoicing_invoice_json(i.id,'staff'));
  ELSIF pr.kind='payment_reversal' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||pr.invoice_id::text,0));
   SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=pr.invoice_id;
   v_pos:=customer_private.real_invoicing_position(i.id);
   IF v_pos<>pr.expected_position THEN RAISE EXCEPTION 'The invoice changed after this reversal was prepared; prepare it again' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT FROM customer_private.real_invoice_payment_reversal x WHERE x.invoice_id=i.id AND x.payment_seq=pr.payment_seq) THEN
    RAISE EXCEPTION 'That payment is already reversed' USING ERRCODE='23505'; END IF;
   SELECT coalesce(max(x.seq),0)+1 INTO v_item FROM customer_private.real_invoice_payment_reversal x WHERE x.invoice_id=i.id;
   INSERT INTO customer_private.real_invoice_payment_reversal(invoice_id,tenant_id,seq,payment_seq,proposal_id,reason,prepared_by,approved_by,self_approved,staff_tenant_id)
   VALUES(i.id,i.tenant_id,v_item,pr.payment_seq,pr.id,pr.reason,pr.prepared_by,v_actor,v_self,t);
   PERFORM customer_private.real_invoicing_emit(i.tenant_id,i.id,'payment.reversed',customer_private.real_invoicing_number('INV',i.invoice_year,i.invoice_seq),v_item,v_pos+2,v_actor,command);
   v_aggregate:=i.id;
   result:=jsonb_build_object('proposalId',pr.id,'kind','payment_reversal','state','recorded')||jsonb_build_object('invoice',customer_private.real_invoicing_invoice_json(i.id,'staff'));
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||pr.invoice_id::text,0));
   SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=pr.invoice_id;
   v_pos:=customer_private.real_invoicing_position(i.id);
   IF v_pos<>pr.expected_position THEN RAISE EXCEPTION 'The invoice changed after this credit note was prepared; prepare it again' USING ERRCODE='23514'; END IF;
   IF pr.amount_minor>i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id) THEN
    RAISE EXCEPTION 'A credit cannot be more than is still unpaid on this invoice' USING ERRCODE='23514'; END IF;
   SELECT coalesce(max(x.seq),0)+1 INTO v_item FROM customer_private.real_invoice_credit x WHERE x.invoice_id=i.id;
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.credit-number:'||v_year::text,0));
   SELECT coalesce(max(x.credit_seq),0)+1 INTO v_seq FROM customer_private.real_invoice_credit x WHERE x.credit_year=v_year;
   INSERT INTO customer_private.real_invoice_credit(credit_year,credit_seq,invoice_id,tenant_id,proposal_id,seq,amount_minor,issued_on,reason,prepared_by,issued_by,self_approved,staff_tenant_id)
   VALUES(v_year,v_seq,i.id,i.tenant_id,pr.id,v_item,pr.amount_minor,v_today,pr.reason,pr.prepared_by,v_actor,v_self,t);
   PERFORM customer_private.real_invoicing_emit(i.tenant_id,i.id,'credit.issued',customer_private.real_invoicing_number('CN',v_year,v_seq),v_item,v_pos+2,v_actor,command);
   v_aggregate:=i.id;
   result:=jsonb_build_object('proposalId',pr.id,'kind','credit','state','issued')||jsonb_build_object('invoice',customer_private.real_invoicing_invoice_json(i.id,'staff'));
  END IF;
 ELSE
  IF customer_private.real_invoicing_second_required() THEN
   RAISE EXCEPTION 'A payment needs a second person: prepare it for approval' USING ERRCODE='23514'; END IF;
  v_id:=(input->>'invoiceId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||v_id::text,0));
  SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  v_pos:=customer_private.real_invoicing_position(i.id);
  IF v_pos<>(input->>'expectedPosition')::integer THEN RAISE EXCEPTION 'The invoice changed; reload and try again' USING ERRCODE='23514'; END IF;
  v_amount:=(input->>'amountMinor')::bigint;
  v_outstanding:=i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id);
  IF NOT customer_private.billing_plain_ok(input->>'reference',2,120) THEN RAISE EXCEPTION 'Give the reference in plain words, with no links or addresses' USING ERRCODE='23514'; END IF;
  IF v_amount>v_outstanding THEN RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(x.seq),0)+1 INTO v_item FROM customer_private.real_invoice_payment x WHERE x.invoice_id=i.id;
  INSERT INTO customer_private.real_invoice_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id)
  VALUES(i.id,i.tenant_id,v_item,v_amount,(input->>'receivedOn')::date,input->>'method',input->>'reference',v_actor,t);
  PERFORM customer_private.real_invoicing_emit(i.tenant_id,i.id,'payment.recorded',customer_private.real_invoicing_number('INV',i.invoice_year,i.invoice_seq),v_item,v_pos+2,v_actor,command);
  v_aggregate:=i.id;
  result:=jsonb_build_object('state','recorded')||jsonb_build_object('invoice',customer_private.real_invoicing_invoice_json(i.id,'staff'));
 END IF;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=result||jsonb_build_object('commandId',command,'operation',operation,'synthetic',false);
 INSERT INTO customer_private.real_invoicing_command(actor_id,command_id,operation,request,result) VALUES(v_actor,command,operation,input,result);
 RETURN result;
END $$;


REVOKE ALL ON FUNCTION customer_private.real_invoice_payment_reversal_guard() FROM PUBLIC,corridra_runtime,corridra_auth;
