-- Optional additive module: sample invoices, payment records and credit notes (billing slice 2, ADR-061).
-- Needs the billing module (ADR-060). An invoice here is a record of what the Corridra team asks for one subscription
-- period of a sample workspace. Nothing is collected: there is no processor, card, bank detail, tax number or contact
-- detail in this module and none can be stored. Money here is Corridra service revenue only (domain B); no table
-- references a participant, programme, cost, trade-value or contributor ledger.
-- Every table is append-only. Status is derived from the three record kinds and never stored.
-- Existing tables, functions and policies are not replaced.

-- Invoice and credit-note numbers are sample numbers, gap-free, and never look like a legal sequence.
CREATE FUNCTION customer_private.invoicing_number(prefix text,n integer) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT prefix||lpad(n::text,6,'0')
$$;

-- The invoice: one immutable row per subscription period.
CREATE TABLE customer_private.invoicing_invoice (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_no integer NOT NULL UNIQUE CHECK(invoice_no BETWEEN 1 AND 99999999),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 subscription_id uuid NOT NULL,
 plan_id uuid NOT NULL REFERENCES customer_private.billing_plan_version(id),
 period_start date NOT NULL,
 period_end date NOT NULL,
 issue_date date NOT NULL,
 due_date date NOT NULL,
 currency text NOT NULL REFERENCES app.currency(code),
 tax_treatment text NOT NULL CHECK(tax_treatment IN ('price_excludes_tax','price_includes_tax','tax_to_be_confirmed')),
 plan_fee_minor bigint NOT NULL CHECK(plan_fee_minor BETWEEN 1 AND 99999999999),
 tax_minor bigint CHECK(tax_minor IS NULL OR tax_minor BETWEEN 0 AND 99999999999),
 total_minor bigint NOT NULL CHECK(total_minor BETWEEN 1 AND 199999999998),
 money_domain text NOT NULL DEFAULT 'B' CHECK(money_domain='B'),
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 issued_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(subscription_id,period_start),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES customer_private.billing_subscription(tenant_id,id),
 CHECK(period_end>period_start),
 CHECK(due_date BETWEEN issue_date AND issue_date+90),
 CHECK((tax_treatment='tax_to_be_confirmed') = (tax_minor IS NULL)),
 CHECK(tax_treatment<>'price_includes_tax' OR tax_minor<=plan_fee_minor),
 CHECK(total_minor=plan_fee_minor+CASE WHEN tax_treatment='price_excludes_tax' THEN tax_minor ELSE 0 END)
);
CREATE INDEX invoicing_invoice_workspace ON customer_private.invoicing_invoice(tenant_id,invoice_no DESC);

-- A payment observation: the team's statement that money was received. Not a bank confirmation.
CREATE TABLE customer_private.invoicing_payment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 199999999998),
 received_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('bank_transfer','cash','other')),
 reference text NOT NULL CHECK(customer_private.billing_synthetic_ok(reference,120)),
 recorded_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,seq),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.invoicing_invoice(tenant_id,id)
);

-- A credit note: reduces what is still unpaid. Corrections are credits, never edits.
CREATE TABLE customer_private.invoicing_credit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credit_no integer NOT NULL UNIQUE CHECK(credit_no BETWEEN 1 AND 99999999),
 invoice_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 199999999998),
 issued_on date NOT NULL,
 reason text NOT NULL CHECK(customer_private.billing_synthetic_ok(reason,500)),
 issued_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,seq),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.invoicing_invoice(tenant_id,id)
);

-- Staff commands are keyed by (staff person, command id).
CREATE TABLE customer_private.invoicing_command (
 actor_id uuid NOT NULL REFERENCES identity.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('issue','payment','credit')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

CREATE TRIGGER invoicing_invoice_immutable BEFORE UPDATE OR DELETE ON customer_private.invoicing_invoice FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER invoicing_payment_immutable BEFORE UPDATE OR DELETE ON customer_private.invoicing_payment FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER invoicing_credit_immutable BEFORE UPDATE OR DELETE ON customer_private.invoicing_credit FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER invoicing_command_immutable BEFORE UPDATE OR DELETE ON customer_private.invoicing_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.invoicing_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.invoicing_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.invoicing_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.invoicing_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.invoicing_invoice,customer_private.invoicing_payment,customer_private.invoicing_credit,
 customer_private.invoicing_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Totals read from the records. Nothing is cached.
CREATE FUNCTION customer_private.invoicing_paid(inv uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(p.amount_minor),0)::bigint FROM customer_private.invoicing_payment p WHERE p.invoice_id=inv
$$;
CREATE FUNCTION customer_private.invoicing_credited(inv uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(c.amount_minor),0)::bigint FROM customer_private.invoicing_credit c WHERE c.invoice_id=inv
$$;
-- The position of an invoice is how many payments and credits it holds. A staff change names the position it saw.
CREATE FUNCTION customer_private.invoicing_position(inv uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM customer_private.invoicing_payment p WHERE p.invoice_id=inv)::integer
  +(SELECT count(*) FROM customer_private.invoicing_credit c WHERE c.invoice_id=inv)::integer
$$;
-- Derived status: unpaid, partly_paid, paid, credited (nothing paid, all credited) or settled (paid and credited).
CREATE FUNCTION customer_private.invoicing_status(total bigint,paid bigint,credited bigint) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN total-paid-credited>0 THEN CASE WHEN paid>0 THEN 'partly_paid' ELSE 'unpaid' END
  WHEN paid>0 AND credited>0 THEN 'settled'
  WHEN paid>0 THEN 'paid'
  ELSE 'credited' END
$$;

-- Database guard on invoices, for every writer: sample workspace, the exact plan price, currency and tax treatment,
-- a period that staff activated or renewed, today's date as the issue date, and gap-free numbering.
CREATE FUNCTION customer_private.invoicing_invoice_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_sub customer_private.billing_subscription; v_plan customer_private.billing_plan_version; v_last integer; v_today date:=customer_private.billing_today();
BEGIN
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND t.synthetic) THEN RAISE EXCEPTION 'Invoices are synthetic only' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_sub FROM customer_private.billing_subscription s WHERE s.id=NEW.subscription_id;
 IF NOT FOUND OR v_sub.tenant_id<>NEW.tenant_id OR v_sub.plan_id<>NEW.plan_id THEN
  RAISE EXCEPTION 'The invoice must follow the subscription and its plan' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_plan FROM customer_private.billing_plan_version p WHERE p.id=NEW.plan_id;
 IF v_plan.price_minor<=0 OR NEW.plan_fee_minor<>v_plan.price_minor OR NEW.currency<>v_plan.currency OR NEW.tax_treatment<>v_plan.tax_treatment THEN
  RAISE EXCEPTION 'The invoice must match the plan price, currency and tax treatment' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.billing_subscription_event e WHERE e.subscription_id=NEW.subscription_id AND e.kind IN ('activated','renewed')
  AND e.period_start=NEW.period_start AND e.period_end=NEW.period_end) THEN
  RAISE EXCEPTION 'Only a period that the team activated or renewed can be invoiced' USING ERRCODE='23514'; END IF;
 IF NEW.issue_date NOT BETWEEN v_today-1 AND v_today THEN RAISE EXCEPTION 'An invoice is issued on the day it is recorded' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.numbering',0));
 SELECT coalesce(max(i.invoice_no),0) INTO v_last FROM customer_private.invoicing_invoice i;
 IF NEW.invoice_no<>v_last+1 THEN RAISE EXCEPTION 'Invoice numbers must follow in order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoicing_invoice_guard BEFORE INSERT ON customer_private.invoicing_invoice FOR EACH ROW EXECUTE FUNCTION customer_private.invoicing_invoice_guard();

-- Database guard on payments: order, sample workspace, dates, and never more than is outstanding.
CREATE FUNCTION customer_private.invoicing_payment_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.invoicing_invoice; v_prev integer; v_today date:=customer_private.billing_today();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.invoice:'||NEW.invoice_id::text,0));
 SELECT * INTO v_inv FROM customer_private.invoicing_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND t.synthetic) THEN RAISE EXCEPTION 'Invoices are synthetic only' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(p.seq),0) INTO v_prev FROM customer_private.invoicing_payment p WHERE p.invoice_id=NEW.invoice_id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Payments must follow in order' USING ERRCODE='23514'; END IF;
 IF NEW.received_on>v_today THEN RAISE EXCEPTION 'A payment cannot be dated in the future' USING ERRCODE='23514'; END IF;
 IF NEW.received_on<v_inv.issue_date THEN RAISE EXCEPTION 'A payment cannot be dated before the invoice' USING ERRCODE='23514'; END IF;
 IF NEW.amount_minor>v_inv.total_minor-customer_private.invoicing_paid(v_inv.id)-customer_private.invoicing_credited(v_inv.id) THEN
  RAISE EXCEPTION 'That is more than is still outstanding on this invoice' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoicing_payment_guard BEFORE INSERT ON customer_private.invoicing_payment FOR EACH ROW EXECUTE FUNCTION customer_private.invoicing_payment_guard();

-- Database guard on credit notes: order, sample workspace, gap-free numbering, and never more than is outstanding.
CREATE FUNCTION customer_private.invoicing_credit_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.invoicing_invoice; v_prev integer; v_last integer; v_today date:=customer_private.billing_today();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.invoice:'||NEW.invoice_id::text,0));
 SELECT * INTO v_inv FROM customer_private.invoicing_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND t.synthetic) THEN RAISE EXCEPTION 'Invoices are synthetic only' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(c.seq),0) INTO v_prev FROM customer_private.invoicing_credit c WHERE c.invoice_id=NEW.invoice_id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Credit notes must follow in order' USING ERRCODE='23514'; END IF;
 IF NEW.issued_on NOT BETWEEN v_today-1 AND v_today OR NEW.issued_on<v_inv.issue_date THEN
  RAISE EXCEPTION 'A credit note is issued on the day it is recorded' USING ERRCODE='23514'; END IF;
 IF NEW.amount_minor>v_inv.total_minor-customer_private.invoicing_paid(v_inv.id)-customer_private.invoicing_credited(v_inv.id) THEN
  RAISE EXCEPTION 'A credit cannot be more than is still unpaid on this invoice' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.numbering',0));
 SELECT coalesce(max(c.credit_no),0) INTO v_last FROM customer_private.invoicing_credit c;
 IF NEW.credit_no<>v_last+1 THEN RAISE EXCEPTION 'Credit note numbers must follow in order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoicing_credit_guard BEFORE INSERT ON customer_private.invoicing_credit FOR EACH ROW EXECUTE FUNCTION customer_private.invoicing_credit_guard();

-- One invoice as customers and staff see it. Customers never see references or who recorded a change.
CREATE FUNCTION customer_private.invoicing_invoice_json(v_id uuid,audience text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i customer_private.invoicing_invoice; p customer_private.billing_plan_version; v_paid bigint; v_cred bigint; v_pay jsonb; v_cn jsonb; v_status text;
BEGIN
 SELECT * INTO i FROM customer_private.invoicing_invoice x WHERE x.id=v_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.id=i.plan_id;
 v_paid:=customer_private.invoicing_paid(i.id);
 v_cred:=customer_private.invoicing_credited(i.id);
 v_status:=customer_private.invoicing_status(i.total_minor,v_paid,v_cred);
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',x.seq,'amountMinor',x.amount_minor::text,'receivedOn',x.received_on,'method',x.method)
  || CASE WHEN audience='staff' THEN jsonb_build_object('reference',x.reference,'recordedAt',x.created_at) ELSE '{}'::jsonb END ORDER BY x.seq),'[]'::jsonb) INTO v_pay
 FROM customer_private.invoicing_payment x WHERE x.invoice_id=i.id;
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

-- Per-currency totals for one workspace. Currencies are never added together.
CREATE FUNCTION customer_private.invoicing_balances(target uuid) RETURNS jsonb
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',b.currency,'invoicedMinor',b.invoiced::text,'paidMinor',b.paid::text,'creditedMinor',b.credited::text,
  'outstandingMinor',(b.invoiced-b.paid-b.credited)::text,'overdueMinor',b.overdue::text) ORDER BY b.currency COLLATE "C"),'[]'::jsonb)
 FROM (SELECT i.currency,sum(i.total_minor) AS invoiced,sum(customer_private.invoicing_paid(i.id)) AS paid,sum(customer_private.invoicing_credited(i.id)) AS credited,
   sum(CASE WHEN i.due_date<customer_private.billing_today() THEN i.total_minor-customer_private.invoicing_paid(i.id)-customer_private.invoicing_credited(i.id) ELSE 0 END) AS overdue
  FROM customer_private.invoicing_invoice i WHERE i.tenant_id=target GROUP BY i.currency) b
$$;

-- One domain event, audit event and outbox row per change. The payload carries ids, the sample number and a sequence only:
-- never an amount, a date, a reference or a reason.
CREATE FUNCTION customer_private.invoicing_emit(inv uuid,kind text,item_seq integer,version integer,initiator uuid,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid(); v_tenant uuid; v_no integer;
BEGIN
 SELECT i.tenant_id,i.invoice_no INTO v_tenant,v_no FROM customer_private.invoicing_invoice i WHERE i.id=inv;
 IF v_tenant IS NULL OR kind NOT IN ('invoice.issued','payment.recorded','credit.issued') THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,v_tenant,'customer.invoicing.'||kind,1,'customer_invoice',inv::text,version,initiator,clock_timestamp(),command,command,
  jsonb_build_object('invoiceId',inv,'number',customer_private.invoicing_number('SAMPLE-INV-',v_no),'seq',item_seq,'synthetic',true,'initiator_kind','staff','initiator_id',initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),v_tenant,eid,initiator,'customer.invoicing.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),v_tenant,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,v_tenant);
END $$;

-- Customers read. Owners and admins see invoices and per-currency balances; a member sees only that invoices exist.
CREATE FUNCTION customer.invoicing_overview(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer.actor_id(); v_access text; v_items jsonb:='[]'::jsonb; v_balances jsonb:='[]'::jsonb; v_exists boolean;
BEGIN
 IF v_actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 v_access:=customer_private.billing_role(target,v_actor);
 IF v_access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 v_exists:=EXISTS(SELECT FROM customer_private.invoicing_invoice i WHERE i.tenant_id=target);
 IF v_access='writer' THEN
  SELECT coalesce(jsonb_agg(customer_private.invoicing_invoice_json(q.id,'customer') ORDER BY q.invoice_no DESC),'[]'::jsonb) INTO v_items
  FROM (SELECT i.id,i.invoice_no FROM customer_private.invoicing_invoice i WHERE i.tenant_id=target ORDER BY i.invoice_no DESC LIMIT 100) q;
  v_balances:=customer_private.invoicing_balances(target);
 END IF;
 IF customer.actor_id() IS DISTINCT FROM v_actor OR customer_private.billing_role(target,v_actor) IS DISTINCT FROM v_access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canRead',v_access='writer','invoicesExist',v_exists,'invoices',v_items,'balances',v_balances,
  'paymentTaken',false,'synthetic',true,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

-- Staff: the periods that still need an invoice. A free plan never appears.
CREATE FUNCTION app.invoicing_staff_pending() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.billing_staff_actor(); v_items jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('subscriptionId',q.subscription_id,'workspaceId',q.tenant_id,'workspaceName',q.workspace_name,'planKey',q.plan_key,'planVersion',q.version,
  'planTitle',q.title,'interval',q.billing_interval,'periodStart',q.period_start,'periodEnd',q.period_end,'priceMinor',q.price_minor::text,'currency',q.currency,
  'taxTreatment',q.tax_treatment,'subscriptionStatus',customer_private.billing_status(q.subscription_id)) ORDER BY q.period_start,q.subscription_id),'[]'::jsonb) INTO v_items
 FROM (SELECT e.subscription_id,e.period_start,e.period_end,s.tenant_id,w.name AS workspace_name,p.plan_key,p.version,p.title,p.billing_interval,p.price_minor,p.currency,p.tax_treatment
  FROM customer_private.billing_subscription_event e
  JOIN customer_private.billing_subscription s ON s.id=e.subscription_id
  JOIN app.tenant w ON w.id=s.tenant_id AND w.synthetic
  JOIN customer_private.billing_plan_version p ON p.id=s.plan_id AND p.price_minor>0
  WHERE e.kind IN ('activated','renewed')
  AND NOT EXISTS(SELECT FROM customer_private.invoicing_invoice i WHERE i.subscription_id=e.subscription_id AND i.period_start=e.period_start)
  ORDER BY e.period_start,e.subscription_id LIMIT 50) q;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('periods',v_items,'synthetic',true);
END $$;

-- Staff: every invoice in a sample workspace, newest first.
CREATE FUNCTION app.invoicing_staff_list(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.billing_staff_actor(); v_items jsonb; v_next uuid; v_cursor customer_private.invoicing_invoice;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO v_cursor FROM customer_private.invoicing_invoice i WHERE i.id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT i.id,i.invoice_no FROM customer_private.invoicing_invoice i JOIN app.tenant w ON w.id=i.tenant_id AND w.synthetic
  WHERE (after_id IS NULL OR i.invoice_no<v_cursor.invoice_no) ORDER BY i.invoice_no DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY invoice_no DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.invoicing_invoice_json(v.id,'staff')||jsonb_build_object('workspaceName',
   (SELECT w.name FROM app.tenant w JOIN customer_private.invoicing_invoice x ON x.tenant_id=w.id WHERE x.id=v.id)) ORDER BY v.invoice_no DESC) FROM visible v),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY invoice_no ASC LIMIT 1) ELSE NULL END INTO v_items,v_next;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('invoices',v_items,'nextAfter',v_next,'synthetic',true);
END $$;

CREATE FUNCTION app.invoicing_staff_view(invoice_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.billing_staff_actor(); i customer_private.invoicing_invoice; v_json jsonb;
BEGIN
 IF invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.invoicing_invoice x WHERE x.id=invoice_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.invoicing.invoice:'||i.id::text,0));
 v_json:=customer_private.invoicing_invoice_json(i.id,'staff')||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=i.tenant_id));
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('invoice',v_json,'actions',CASE WHEN (v_json->>'outstandingMinor')::bigint>0 THEN '["payment","credit"]'::jsonb ELSE '[]'::jsonb END,
  'workspaceBalances',customer_private.invoicing_balances(i.tenant_id),'synthetic',true);
END $$;

-- Staff changes: issue an invoice, record a payment, issue a credit note. Idempotent by (staff person, command id);
-- payments and credits name the position they saw.
CREATE FUNCTION app.invoicing_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.billing_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.invoicing_command; s customer_private.billing_subscription; p customer_private.billing_plan_version; i customer_private.invoicing_invoice;
 v_end date; v_start date; v_fee bigint; v_tax bigint; v_due date; v_today date:=customer_private.billing_today(); v_no integer; v_id uuid; v_pos integer; v_amount bigint;
 v_outstanding bigint; v_seq integer; v_text text; result jsonb;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('issue','payment','credit') THEN RAISE EXCEPTION 'Invalid invoicing command' USING ERRCODE='23514'; END IF;
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

REVOKE ALL ON FUNCTION customer_private.invoicing_number(text,integer),customer_private.invoicing_paid(uuid),customer_private.invoicing_credited(uuid),
 customer_private.invoicing_position(uuid),customer_private.invoicing_status(bigint,bigint,bigint),customer_private.invoicing_invoice_guard(),
 customer_private.invoicing_payment_guard(),customer_private.invoicing_credit_guard(),customer_private.invoicing_invoice_json(uuid,text),
 customer_private.invoicing_balances(uuid),customer_private.invoicing_emit(uuid,text,integer,integer,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.invoicing_overview(uuid) FROM PUBLIC,corridra_auth;
REVOKE ALL ON FUNCTION app.invoicing_staff_pending(),app.invoicing_staff_list(uuid,integer),app.invoicing_staff_view(uuid),
 app.invoicing_staff_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.invoicing_overview(uuid),app.invoicing_staff_pending(),app.invoicing_staff_list(uuid,integer),
 app.invoicing_staff_view(uuid),app.invoicing_staff_command(uuid,text,jsonb) TO corridra_runtime;
