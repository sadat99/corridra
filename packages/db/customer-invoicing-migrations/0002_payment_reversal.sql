-- Optional additive change to the sample invoicing module (ADR-061, CRUD standard gap G2): a payment entered in error is
-- reversed. A reversal is a new append-only record that names the payment and gives a reason; the payment itself is never
-- edited or deleted and stays readable, marked as reversed. What was paid is derived from the payments that are not
-- reversed, so the invoice owes the amount again and can be paid, credited or reversed further. Sample money only: one staff
-- person records it, the reason is invented text, and nothing is collected. Installing it changes no other module.

CREATE TABLE customer_private.invoicing_payment_reversal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 payment_seq integer NOT NULL CHECK(payment_seq BETWEEN 1 AND 500),
 reason text NOT NULL CHECK(customer_private.billing_synthetic_ok(reason,500) AND length(reason)>=20),
 reversed_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,seq),
 UNIQUE(invoice_id,payment_seq),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.invoicing_invoice(tenant_id,id),
 FOREIGN KEY(invoice_id,payment_seq) REFERENCES customer_private.invoicing_payment(invoice_id,seq)
);
CREATE TRIGGER invoicing_payment_reversal_immutable BEFORE UPDATE OR DELETE ON customer_private.invoicing_payment_reversal FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.invoicing_payment_reversal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.invoicing_payment_reversal FROM PUBLIC,corridra_runtime,corridra_auth;

-- Database guard on reversals, for every writer: sample workspace and the next number in order. The payment must exist
-- and be reversed once (the two foreign keys and the unique key above).
CREATE FUNCTION customer_private.invoicing_payment_reversal_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.invoicing_invoice; v_prev integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.invoice:'||NEW.invoice_id::text,0));
 SELECT * INTO v_inv FROM customer_private.invoicing_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND t.synthetic) THEN RAISE EXCEPTION 'Invoices are synthetic only' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(r.seq),0) INTO v_prev FROM customer_private.invoicing_payment_reversal r WHERE r.invoice_id=NEW.invoice_id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Reversals must follow in order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoicing_payment_reversal_guard BEFORE INSERT ON customer_private.invoicing_payment_reversal FOR EACH ROW EXECUTE FUNCTION customer_private.invoicing_payment_reversal_guard();

-- The command log learns the new operation. Existing rows are untouched.
ALTER TABLE customer_private.invoicing_command DROP CONSTRAINT invoicing_command_operation_check;
ALTER TABLE customer_private.invoicing_command ADD CONSTRAINT invoicing_command_operation_check CHECK(operation IN ('issue','payment','credit','reverse'));

-- What is paid and the position of an invoice now count reversals. Replacing a function keeps its grants.
CREATE OR REPLACE FUNCTION customer_private.invoicing_paid(inv uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(p.amount_minor),0)::bigint FROM customer_private.invoicing_payment p WHERE p.invoice_id=inv
  AND NOT EXISTS(SELECT FROM customer_private.invoicing_payment_reversal r WHERE r.invoice_id=p.invoice_id AND r.payment_seq=p.seq)
$$;
CREATE OR REPLACE FUNCTION customer_private.invoicing_position(inv uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM customer_private.invoicing_payment p WHERE p.invoice_id=inv)::integer
  +(SELECT count(*) FROM customer_private.invoicing_credit c WHERE c.invoice_id=inv)::integer
  +(SELECT count(*) FROM customer_private.invoicing_payment_reversal r WHERE r.invoice_id=inv)::integer
$$;

-- Documents show whether a payment was reversed; only staff see why.
CREATE OR REPLACE FUNCTION customer_private.invoicing_invoice_json(v_id uuid,audience text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i customer_private.invoicing_invoice; p customer_private.billing_plan_version; v_paid bigint; v_cred bigint; v_pay jsonb; v_cn jsonb; v_status text;
BEGIN
 SELECT * INTO i FROM customer_private.invoicing_invoice x WHERE x.id=v_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.id=i.plan_id;
 v_paid:=customer_private.invoicing_paid(i.id);
 v_cred:=customer_private.invoicing_credited(i.id);
 v_status:=customer_private.invoicing_status(i.total_minor,v_paid,v_cred);
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',x.seq,'amountMinor',x.amount_minor::text,'receivedOn',x.received_on,'method',x.method,'reversed',r.id IS NOT NULL)
  || CASE WHEN audience='staff' THEN jsonb_build_object('reference',x.reference,'recordedAt',x.created_at)
   || CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('reversal',jsonb_build_object('seq',r.seq,'reason',r.reason,'reversedAt',r.created_at)) ELSE '{}'::jsonb END
   ELSE '{}'::jsonb END ORDER BY x.seq),'[]'::jsonb) INTO v_pay
 FROM customer_private.invoicing_payment x
 LEFT JOIN customer_private.invoicing_payment_reversal r ON r.invoice_id=x.invoice_id AND r.payment_seq=x.seq WHERE x.invoice_id=i.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',x.seq,'number',customer_private.invoicing_number('SAMPLE-CN-',x.credit_no),'amountMinor',x.amount_minor::text,
  'issuedOn',x.issued_on,'reason',x.reason) ORDER BY x.seq),'[]'::jsonb) INTO v_cn
 FROM customer_private.invoicing_credit x WHERE x.invoice_id=i.id;
 RETURN jsonb_build_object('id',i.id,'number',customer_private.invoicing_number('SAMPLE-INV-',i.invoice_no),'subscriptionId',i.subscription_id,'workspaceId',i.tenant_id,
  'planKey',p.plan_key,'planVersion',p.version,'planTitle',p.title,'interval',p.billing_interval,'periodStart',i.period_start,'periodEnd',i.period_end,
  'issueDate',i.issue_date,'dueDate',i.due_date,'currency',i.currency,'taxTreatment',i.tax_treatment,'planFeeMinor',i.plan_fee_minor::text,'taxMinor',i.tax_minor::text,
  'totalMinor',i.total_minor::text,'paidMinor',v_paid::text,'creditedMinor',v_cred::text,'outstandingMinor',(i.total_minor-v_paid-v_cred)::text,
  'status',v_status,'overdue',i.total_minor-v_paid-v_cred>0 AND i.due_date<customer_private.billing_today(),'payments',v_pay,'credits',v_cn,
  'moneyDomain','B','label','Sample record, not a tax invoice','synthetic',true)
  || CASE WHEN audience='staff' THEN jsonb_build_object('position',customer_private.invoicing_position(i.id),'issuedAt',i.created_at) ELSE '{}'::jsonb END;
END $$;

-- One event for a reversal too: ids and a sequence only, never an amount, a date or the reason.
CREATE OR REPLACE FUNCTION customer_private.invoicing_emit(inv uuid,kind text,item_seq integer,version integer,initiator uuid,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); v_tenant uuid; v_no integer;
BEGIN
 SELECT i.tenant_id,i.invoice_no INTO v_tenant,v_no FROM customer_private.invoicing_invoice i WHERE i.id=inv;
 IF v_tenant IS NULL OR kind NOT IN ('invoice.issued','payment.recorded','credit.issued','payment.reversed') THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,v_tenant,'customer.invoicing.'||kind,1,'customer_invoice',inv::text,version,initiator,clock_timestamp(),command,command,
  jsonb_build_object('invoiceId',inv,'number',customer_private.invoicing_number('SAMPLE-INV-',v_no),'seq',item_seq,'synthetic',true,'initiator_kind','staff','initiator_id',initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),v_tenant,eid,initiator,'customer.invoicing.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),v_tenant,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,v_tenant);
END $$;

-- Staff: a reversal is offered while an unreversed payment exists.
CREATE OR REPLACE FUNCTION app.invoicing_staff_view(invoice_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.billing_staff_actor(); i customer_private.invoicing_invoice; v_json jsonb;
BEGIN
 IF invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.invoicing_invoice x WHERE x.id=invoice_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.invoice:'||i.id::text,0));
 v_json:=customer_private.invoicing_invoice_json(i.id,'staff')||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=i.tenant_id));
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('invoice',v_json,'actions',CASE WHEN (v_json->>'outstandingMinor')::bigint>0 THEN '["payment","credit"]'::jsonb ELSE '[]'::jsonb END
   ||CASE WHEN EXISTS(SELECT FROM customer_private.invoicing_payment p WHERE p.invoice_id=i.id
    AND NOT EXISTS(SELECT FROM customer_private.invoicing_payment_reversal r WHERE r.invoice_id=p.invoice_id AND r.payment_seq=p.seq)) THEN '["reverse"]'::jsonb ELSE '[]'::jsonb END,
  'workspaceBalances',customer_private.invoicing_balances(i.tenant_id),'synthetic',true);
END $$;

-- Staff changes: issue an invoice, record a payment, issue a credit note or reverse a payment. Idempotent by (staff person, command id);
-- payments, credits and reversals name the position they saw.
CREATE OR REPLACE FUNCTION app.invoicing_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.billing_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.invoicing_command; s customer_private.billing_subscription; p customer_private.billing_plan_version; i customer_private.invoicing_invoice;
 v_end date; v_start date; v_fee bigint; v_tax bigint; v_due date; v_today date:=customer_private.billing_today(); v_no integer; v_id uuid; v_pos integer; v_amount bigint;
 v_outstanding bigint; v_seq integer; v_text text; v_ps integer; pay customer_private.invoicing_payment; result jsonb;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('issue','payment','credit','reverse') THEN RAISE EXCEPTION 'Invalid invoicing command' USING ERRCODE='23514'; END IF;
 IF operation='issue' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['subscriptionId','periodStart','planFeeMinor','taxMinor','dueOn'],ARRAY[]::text[])
   OR jsonb_typeof(input->'subscriptionId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'periodStart') IS DISTINCT FROM 'string'
   OR input->>'periodStart' !~ '^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(input->'planFeeMinor') IS DISTINCT FROM 'string'
   OR input->>'planFeeMinor' !~ '^[1-9][0-9]{0,10}$' OR jsonb_typeof(input->'taxMinor') NOT IN ('string','null')
   OR (jsonb_typeof(input->'taxMinor')='string' AND input->>'taxMinor' !~ '^(0|[1-9][0-9]{0,10})$')
   OR jsonb_typeof(input->'dueOn') IS DISTINCT FROM 'string' OR input->>'dueOn' !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'An invoice needs the period, the plan fee, the tax amount and a due date' USING ERRCODE='23514'; END IF;
 ELSIF operation='payment' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['invoiceId','expectedPosition','amountMinor','receivedOn','method','reference'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedPosition') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'amountMinor') IS DISTINCT FROM 'string' OR input->>'amountMinor' !~ '^[1-9][0-9]{0,11}$'
   OR jsonb_typeof(input->'receivedOn') IS DISTINCT FROM 'string' OR input->>'receivedOn' !~ '^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(input->'method') IS DISTINCT FROM 'string' OR input->>'method' NOT IN ('bank_transfer','cash','other')
   OR jsonb_typeof(input->'reference') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'A payment needs an amount, the date it was received, how and a reference' USING ERRCODE='23514'; END IF;
 ELSIF operation='reverse' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['invoiceId','expectedPosition','paymentSeq','reason'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedPosition') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'paymentSeq') IS DISTINCT FROM 'number' OR input->>'paymentSeq' !~ '^[1-9][0-9]{0,2}$'
   OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'A reversal needs the payment and a reason' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.billing_input_shape(input,ARRAY['invoiceId','expectedPosition','amountMinor','reason'],ARRAY[]::text[])
   OR jsonb_typeof(input->'invoiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedPosition') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'amountMinor') IS DISTINCT FROM 'string' OR input->>'amountMinor' !~ '^[1-9][0-9]{0,11}$'
   OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'A credit note needs an amount and a reason' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.staff.command:'||v_actor::text||':'||command::text,0));
 SELECT * INTO prior FROM customer_private.invoicing_command c WHERE c.actor_id=v_actor AND c.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 IF operation='issue' THEN
  v_id:=(input->>'subscriptionId')::uuid;
  v_start:=(input->>'periodStart')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.period:'||v_id::text||':'||v_start::text,0));
  SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.id=s.plan_id;
  SELECT e.period_end INTO v_end FROM customer_private.billing_subscription_event e WHERE e.subscription_id=s.id AND e.kind IN ('activated','renewed') AND e.period_start=v_start;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a period that the team activated or renewed can be invoiced' USING ERRCODE='23514'; END IF;
  IF p.price_minor=0 THEN RAISE EXCEPTION 'A free plan cannot be invoiced' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.invoicing_invoice x WHERE x.subscription_id=s.id AND x.period_start=v_start) THEN
   RAISE EXCEPTION 'This period is already invoiced' USING ERRCODE='23505'; END IF;
  v_fee:=(input->>'planFeeMinor')::bigint;
  IF v_fee<>p.price_minor THEN RAISE EXCEPTION 'The fee must equal the plan price; reload and check it' USING ERRCODE='23514'; END IF;
  IF p.tax_treatment='tax_to_be_confirmed' THEN
   IF jsonb_typeof(input->'taxMinor')<>'null' THEN RAISE EXCEPTION 'Tax is to be confirmed for this plan; leave the tax amount empty' USING ERRCODE='23514'; END IF;
   v_tax:=NULL;
  ELSE
   IF jsonb_typeof(input->'taxMinor')<>'string' THEN RAISE EXCEPTION 'State the tax amount in whole minor units, zero if there is none' USING ERRCODE='23514'; END IF;
   v_tax:=(input->>'taxMinor')::bigint;
   IF p.tax_treatment='price_includes_tax' AND v_tax>v_fee THEN RAISE EXCEPTION 'The tax inside the price cannot be more than the price' USING ERRCODE='23514'; END IF;
  END IF;
  v_due:=(input->>'dueOn')::date;
  IF v_due<v_today OR v_due>v_today+90 THEN RAISE EXCEPTION 'The due date must be within 90 days of today' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.numbering',0));
  SELECT coalesce(max(x.invoice_no),0)+1 INTO v_no FROM customer_private.invoicing_invoice x;
  INSERT INTO customer_private.invoicing_invoice(invoice_no,tenant_id,subscription_id,plan_id,period_start,period_end,issue_date,due_date,currency,tax_treatment,
   plan_fee_minor,tax_minor,total_minor,issued_by,staff_tenant_id)
  VALUES(v_no,s.tenant_id,s.id,p.id,v_start,v_end,v_today,v_due,p.currency,p.tax_treatment,v_fee,v_tax,
   v_fee+CASE WHEN p.tax_treatment='price_excludes_tax' THEN v_tax ELSE 0 END,v_actor,t) RETURNING id INTO v_id;
  PERFORM customer_private.invoicing_emit(v_id,'invoice.issued',1,1,v_actor,command);
 ELSE
  v_id:=(input->>'invoiceId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.invoice:'||v_id::text,0));
  SELECT * INTO i FROM customer_private.invoicing_invoice x WHERE x.id=v_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  v_pos:=customer_private.invoicing_position(i.id);
  IF v_pos<>(input->>'expectedPosition')::integer THEN RAISE EXCEPTION 'The invoice changed; reload and try again' USING ERRCODE='23514'; END IF;
  v_amount:=(input->>'amountMinor')::bigint;
  v_outstanding:=i.total_minor-customer_private.invoicing_paid(i.id)-customer_private.invoicing_credited(i.id);
  IF operation='payment' THEN
   IF NOT customer_private.billing_synthetic_ok(input->>'reference',120) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   IF v_amount>v_outstanding THEN RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
   SELECT coalesce(max(x.seq),0)+1 INTO v_seq FROM customer_private.invoicing_payment x WHERE x.invoice_id=i.id;
   INSERT INTO customer_private.invoicing_payment(invoice_id,tenant_id,seq,amount_minor,received_on,method,reference,recorded_by,staff_tenant_id)
   VALUES(i.id,i.tenant_id,v_seq,v_amount,(input->>'receivedOn')::date,input->>'method',input->>'reference',v_actor,t);
   PERFORM customer_private.invoicing_emit(i.id,'payment.recorded',v_seq,v_pos+2,v_actor,command);
  ELSIF operation='reverse' THEN
   v_text:=input->>'reason';
   IF NOT customer_private.billing_synthetic_ok(v_text,500) OR length(v_text)<20 THEN
    RAISE EXCEPTION 'Use invented text that starts with Synthetic and says why the payment is reversed' USING ERRCODE='23514'; END IF;
   v_ps:=(input->>'paymentSeq')::integer;
   SELECT * INTO pay FROM customer_private.invoicing_payment x WHERE x.invoice_id=i.id AND x.seq=v_ps;
   IF NOT FOUND THEN RAISE EXCEPTION 'There is no such payment on this invoice' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT FROM customer_private.invoicing_payment_reversal x WHERE x.invoice_id=i.id AND x.payment_seq=v_ps) THEN
    RAISE EXCEPTION 'That payment is already reversed' USING ERRCODE='23505'; END IF;
   SELECT coalesce(max(x.seq),0)+1 INTO v_seq FROM customer_private.invoicing_payment_reversal x WHERE x.invoice_id=i.id;
   INSERT INTO customer_private.invoicing_payment_reversal(invoice_id,tenant_id,seq,payment_seq,reason,reversed_by,staff_tenant_id)
   VALUES(i.id,i.tenant_id,v_seq,v_ps,v_text,v_actor,t);
   PERFORM customer_private.invoicing_emit(i.id,'payment.reversed',v_seq,v_pos+2,v_actor,command);
  ELSE
   v_text:=input->>'reason';
   IF NOT customer_private.billing_synthetic_ok(v_text,500) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   IF v_amount>v_outstanding THEN RAISE EXCEPTION 'A credit cannot be more than is still unpaid on this invoice' USING ERRCODE='23514'; END IF;
   SELECT coalesce(max(x.seq),0)+1 INTO v_seq FROM customer_private.invoicing_credit x WHERE x.invoice_id=i.id;
   PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.numbering',0));
   SELECT coalesce(max(x.credit_no),0)+1 INTO v_no FROM customer_private.invoicing_credit x;
   INSERT INTO customer_private.invoicing_credit(credit_no,invoice_id,tenant_id,seq,amount_minor,issued_on,reason,issued_by,staff_tenant_id)
   VALUES(v_no,i.id,i.tenant_id,v_seq,v_amount,v_today,v_text,v_actor,t);
   PERFORM customer_private.invoicing_emit(i.id,'credit.issued',v_seq,v_pos+2,v_actor,command);
  END IF;
 END IF;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.invoicing_invoice_json(v_id,'staff')||jsonb_build_object('commandId',command,'operation',operation,'synthetic',true);
 INSERT INTO customer_private.invoicing_command(actor_id,command_id,operation,request,result) VALUES(v_actor,command,operation,input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.invoicing_payment_reversal_guard() FROM PUBLIC,corridra_runtime,corridra_auth;
