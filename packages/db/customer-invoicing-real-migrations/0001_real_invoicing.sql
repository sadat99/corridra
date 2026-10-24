-- Optional additive module: real invoices, payment records and credit notes for real workspaces (billing stage 2, ADR-064).
-- Needs the billing, real billing, invoicing and real-use modules. An invoice here is a record that Corridra asks a real
-- workspace for one subscription period. Nothing is collected: no processor, card or bank account is touched. Money here
-- is Corridra service revenue only (domain B); no table references a participant, programme, cost, trade-value or
-- contributor ledger. Every table is append-only and status is derived, never stored.
-- Installing this module alone changes nothing for anyone: the control below starts closed, and only the offline
-- schema-owner operation opens it. The sample invoicing module is not touched and keeps serving sample workspaces only.
-- A legal invoice number sequence is kept per calendar year (Singapore time) and per kind, gap free, and it is not shared
-- with the sample sequence. An invoice or credit note is prepared by one staff person and approved by a second, unless
-- the owner has recorded, with a reason, that a single person may do both.

DO $guard$ BEGIN
 IF to_regprocedure('customer_private.real_billing_open()') IS NULL
 OR to_regprocedure('customer_private.billing_staff_actor_scoped()') IS NULL
 OR to_regprocedure('customer_private.billing_workspace_role(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.billing_plain_ok(text,integer,integer)') IS NULL
 OR to_regprocedure('customer_private.billing_input_shape(jsonb,text[],text[])') IS NULL
 OR to_regprocedure('customer_private.organisation_profile_expiry()') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regclass('customer_private.invoicing_invoice') IS NULL
 OR to_regclass('customer_private.billing_subscription_event') IS NULL
 OR to_regclass('customer_private.billing_plan_version') IS NULL
 THEN RAISE EXCEPTION 'Real invoicing prerequisites are missing'; END IF;
END $guard$;

-- The control. Closed unless real billing is open AND the latest control row says enabled. No row means closed.
-- It also records whether a second person must approve; the default is yes.
CREATE TABLE customer_private.real_invoicing_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 require_second_approver boolean NOT NULL DEFAULT true,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- The supplier details printed on every document, versioned. A document keeps the version it was issued under.
-- placeholder_fields lists any field whose value is made up; a document issued with any says so on its face.
CREATE TABLE customer_private.real_invoicing_entity (
 version integer PRIMARY KEY CHECK(version>0),
 legal_name text NOT NULL CHECK(customer_private.billing_plain_ok(legal_name,2,120)),
 address text NOT NULL CHECK(customer_private.billing_plain_ok(address,5,300)),
 country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 uen text CHECK(uen IS NULL OR customer_private.billing_plain_ok(uen,3,60)),
 gst_registered boolean NOT NULL,
 gst_registration_no text CHECK(gst_registration_no IS NULL OR customer_private.billing_plain_ok(gst_registration_no,3,60)),
 tax_label text NOT NULL CHECK(customer_private.billing_plain_ok(tax_label,2,20)),
 gst_rate_bps integer NOT NULL CHECK(gst_rate_bps BETWEEN 0 AND 3000),
 payment_terms_days integer NOT NULL CHECK(payment_terms_days BETWEEN 0 AND 90),
 payment_instructions text NOT NULL CHECK(customer_private.billing_plain_ok(payment_instructions,5,400)),
 finance_label text NOT NULL CHECK(customer_private.billing_plain_ok(finance_label,2,120)),
 approver_principal_id uuid REFERENCES identity.principal(id),
 placeholder_fields text[] NOT NULL DEFAULT '{}' CHECK(placeholder_fields <@ ARRAY['uen','gst_registration_no','payment_instructions','finance_label','gst_registered','gst_rate_bps']::text[]),
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT gst_registered OR gst_registration_no IS NOT NULL)
);
-- A proposal: one staff person prepares an invoice or credit note; a decision turns it into a document or rejects it.
CREATE TABLE customer_private.real_invoicing_proposal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('invoice','credit')),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 -- invoice proposals
 subscription_id uuid,plan_id uuid REFERENCES customer_private.billing_plan_version(id),
 period_start date,period_end date,due_date date,
 bill_to_name text,bill_to_address text,
 -- credit proposals
 invoice_id uuid,expected_position integer,
 amount_minor bigint CHECK(amount_minor IS NULL OR amount_minor BETWEEN 1 AND 199999999998),
 reason text,
 prepared_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES customer_private.billing_subscription(tenant_id,id),
 CHECK((kind='invoice') = (subscription_id IS NOT NULL)),
 CHECK(kind<>'invoice' OR (plan_id IS NOT NULL AND period_start IS NOT NULL AND period_end>period_start AND due_date IS NOT NULL
  AND customer_private.billing_plain_ok(bill_to_name,2,120) AND customer_private.billing_plain_ok(bill_to_address,5,300)
  AND invoice_id IS NULL AND amount_minor IS NULL AND reason IS NULL)),
 CHECK(kind<>'credit' OR (invoice_id IS NOT NULL AND expected_position BETWEEN 0 AND 1000 AND amount_minor IS NOT NULL
  AND customer_private.billing_plain_ok(reason,10,500) AND subscription_id IS NULL))
);
CREATE TABLE customer_private.real_invoicing_decision (
 proposal_id uuid PRIMARY KEY REFERENCES customer_private.real_invoicing_proposal(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 decided_by uuid NOT NULL REFERENCES identity.principal(id),
 self_approved boolean NOT NULL DEFAULT false,
 reason text CHECK(reason IS NULL OR customer_private.billing_plain_ok(reason,3,500)),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(decision='approved' OR reason IS NOT NULL),
 CHECK(NOT self_approved OR decision='approved')
);
-- The issued invoice: one immutable row per subscription period, numbered per calendar year, gap free.
CREATE TABLE customer_private.real_invoice (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_year integer NOT NULL CHECK(invoice_year BETWEEN 2026 AND 2100),
 invoice_seq integer NOT NULL CHECK(invoice_seq BETWEEN 1 AND 99999999),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 subscription_id uuid NOT NULL,
 plan_id uuid NOT NULL REFERENCES customer_private.billing_plan_version(id),
 proposal_id uuid NOT NULL UNIQUE REFERENCES customer_private.real_invoicing_proposal(id),
 entity_version integer NOT NULL REFERENCES customer_private.real_invoicing_entity(version),
 period_start date NOT NULL,period_end date NOT NULL,issue_date date NOT NULL,due_date date NOT NULL,
 currency text NOT NULL REFERENCES app.currency(code),
 tax_treatment text NOT NULL CHECK(tax_treatment IN ('price_excludes_tax','price_includes_tax','tax_to_be_confirmed')),
 gst_registered boolean NOT NULL,
 tax_rate_bps integer CHECK(tax_rate_bps IS NULL OR tax_rate_bps BETWEEN 0 AND 3000),
 plan_fee_minor bigint NOT NULL CHECK(plan_fee_minor BETWEEN 1 AND 99999999999),
 tax_minor bigint NOT NULL CHECK(tax_minor BETWEEN 0 AND 99999999999),
 total_minor bigint NOT NULL CHECK(total_minor BETWEEN 1 AND 199999999998),
 bill_to_name text NOT NULL,bill_to_address text NOT NULL,
 prepared_by uuid NOT NULL REFERENCES identity.principal(id),
 issued_by uuid NOT NULL REFERENCES identity.principal(id),
 self_approved boolean NOT NULL,
 money_domain text NOT NULL DEFAULT 'B' CHECK(money_domain='B'),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_year,invoice_seq),UNIQUE(subscription_id,period_start),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES customer_private.billing_subscription(tenant_id,id),
 CHECK(period_end>period_start),
 CHECK(due_date BETWEEN issue_date AND issue_date+90),
 CHECK(gst_registered = (tax_rate_bps IS NOT NULL)),
 CHECK(gst_registered OR tax_minor=0),
 CHECK(NOT gst_registered OR tax_treatment<>'tax_to_be_confirmed'),
 CHECK(tax_treatment<>'price_includes_tax' OR tax_minor<=plan_fee_minor),
 CHECK(total_minor=plan_fee_minor+CASE WHEN gst_registered AND tax_treatment='price_excludes_tax' THEN tax_minor ELSE 0 END)
);
CREATE INDEX real_invoice_workspace ON customer_private.real_invoice(tenant_id,invoice_year DESC,invoice_seq DESC);
CREATE TABLE customer_private.real_invoice_payment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL,tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 199999999998),
 received_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('bank_transfer','cash','other')),
 reference text NOT NULL CHECK(customer_private.billing_plain_ok(reference,2,120)),
 recorded_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,seq),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.real_invoice(tenant_id,id)
);
CREATE TABLE customer_private.real_invoice_credit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credit_year integer NOT NULL CHECK(credit_year BETWEEN 2026 AND 2100),
 credit_seq integer NOT NULL CHECK(credit_seq BETWEEN 1 AND 99999999),
 invoice_id uuid NOT NULL,tenant_id uuid NOT NULL,
 proposal_id uuid NOT NULL UNIQUE REFERENCES customer_private.real_invoicing_proposal(id),
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 199999999998),
 issued_on date NOT NULL,
 reason text NOT NULL CHECK(customer_private.billing_plain_ok(reason,10,500)),
 prepared_by uuid NOT NULL REFERENCES identity.principal(id),
 issued_by uuid NOT NULL REFERENCES identity.principal(id),
 self_approved boolean NOT NULL,
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(credit_year,credit_seq),UNIQUE(invoice_id,seq),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES customer_private.real_invoice(tenant_id,id)
);
-- Staff commands are keyed by (staff person, command id).
CREATE TABLE customer_private.real_invoicing_command (
 actor_id uuid NOT NULL REFERENCES identity.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('prepare_invoice','prepare_credit','decide','payment')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER real_invoicing_control_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoicing_control FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoicing_entity_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoicing_entity FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoicing_proposal_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoicing_proposal FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoicing_decision_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoicing_decision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoice_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoice FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoice_payment_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoice_payment FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoice_credit_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoice_credit FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER real_invoicing_command_immutable BEFORE UPDATE OR DELETE ON customer_private.real_invoicing_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.real_invoicing_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoicing_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoicing_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoicing_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoice_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoice_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.real_invoicing_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.real_invoicing_control,customer_private.real_invoicing_entity,customer_private.real_invoicing_proposal,
 customer_private.real_invoicing_decision,customer_private.real_invoice,customer_private.real_invoice_payment,
 customer_private.real_invoice_credit,customer_private.real_invoicing_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Open means real billing is open and the latest control row says enabled. A second approver is required unless the
-- latest control row says otherwise.
CREATE FUNCTION customer_private.real_invoicing_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.real_billing_open()
 AND coalesce((SELECT enabled FROM customer_private.real_invoicing_control ORDER BY version DESC LIMIT 1),false)
$$;
CREATE FUNCTION customer_private.real_invoicing_second_required() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT require_second_approver FROM customer_private.real_invoicing_control ORDER BY version DESC LIMIT 1),true)
$$;
-- Dates are Singapore dates: the invoice year and the issue date follow the supplier's calendar.
CREATE FUNCTION customer_private.real_invoicing_today() RETURNS date
 LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date
$$;
CREATE FUNCTION customer_private.real_invoicing_number(prefix text,year integer,n integer) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT prefix||'-'||year::text||'-'||lpad(n::text,6,'0')
$$;
-- GST in whole minor units, rounded half up: on top of the fee when the price excludes tax, inside the fee when it includes tax.
CREATE FUNCTION customer_private.real_invoicing_tax(fee bigint,treatment text,rate_bps integer) RETURNS bigint
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE treatment
  WHEN 'price_excludes_tax' THEN (fee*rate_bps*2+10000)/20000
  WHEN 'price_includes_tax' THEN (fee*rate_bps*2+(10000+rate_bps))/(2*(10000+rate_bps))
  ELSE 0 END
$$;
CREATE FUNCTION customer_private.real_invoicing_entity_current() RETURNS customer_private.real_invoicing_entity
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e FROM customer_private.real_invoicing_entity e ORDER BY e.version DESC LIMIT 1
$$;
CREATE FUNCTION customer_private.real_invoicing_paid(inv uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(p.amount_minor),0)::bigint FROM customer_private.real_invoice_payment p WHERE p.invoice_id=inv
$$;
CREATE FUNCTION customer_private.real_invoicing_credited(inv uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(c.amount_minor),0)::bigint FROM customer_private.real_invoice_credit c WHERE c.invoice_id=inv
$$;
CREATE FUNCTION customer_private.real_invoicing_position(inv uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM customer_private.real_invoice_payment p WHERE p.invoice_id=inv)::integer
  +(SELECT count(*) FROM customer_private.real_invoice_credit c WHERE c.invoice_id=inv)::integer
$$;

-- Staff authority for real invoicing: the protected staff authority of real billing, in a real operator workspace, while
-- real invoicing is open. A sample operator workspace is refused.
CREATE FUNCTION customer_private.real_invoicing_staff_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF t IS NULL OR NOT EXISTS(SELECT FROM app.tenant x WHERE x.id=t AND NOT x.synthetic AND app.real_use_allowed(x.id)) THEN
  RAISE EXCEPTION 'Real invoicing needs a real operator workspace' USING ERRCODE='42501'; END IF;
 -- A closed control is not a permission problem: say so, so the screen can answer "switched off" (55000).
 IF NOT customer_private.real_invoicing_open() THEN
  RAISE EXCEPTION 'Real invoices are switched off' USING ERRCODE='55000'; END IF;
 actor:=customer_private.billing_staff_actor_scoped();
 RETURN actor;
END $$;

-- Database guards, for every writer. Invoice: real workspace, the exact plan price, currency and tax treatment, a period
-- that staff activated or renewed, the supplier's calendar date, and gap-free numbering within the year.
CREATE FUNCTION customer_private.real_invoice_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_sub customer_private.billing_subscription; v_plan customer_private.billing_plan_version; v_last integer; v_today date:=customer_private.real_invoicing_today();
BEGIN
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=NEW.tenant_id AND NOT t.synthetic) THEN RAISE EXCEPTION 'Real invoices are for real workspaces only' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_sub FROM customer_private.billing_subscription s WHERE s.id=NEW.subscription_id;
 IF NOT FOUND OR v_sub.tenant_id<>NEW.tenant_id OR v_sub.plan_id<>NEW.plan_id THEN
  RAISE EXCEPTION 'The invoice must follow the subscription and its plan' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_plan FROM customer_private.billing_plan_version p WHERE p.id=NEW.plan_id;
 IF v_plan.synthetic OR v_plan.price_minor<=0 OR NEW.plan_fee_minor<>v_plan.price_minor OR NEW.currency<>v_plan.currency OR NEW.tax_treatment<>v_plan.tax_treatment THEN
  RAISE EXCEPTION 'The invoice must match the real plan price, currency and tax treatment' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.billing_subscription_event e WHERE e.subscription_id=NEW.subscription_id AND e.kind IN ('activated','renewed')
  AND e.period_start=NEW.period_start AND e.period_end=NEW.period_end) THEN
  RAISE EXCEPTION 'Only a period that the team activated or renewed can be invoiced' USING ERRCODE='23514'; END IF;
 IF NEW.issue_date<>v_today OR NEW.invoice_year<>extract(year FROM NEW.issue_date)::integer THEN
  RAISE EXCEPTION 'An invoice is issued on the day it is recorded, in its own year' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice-number:'||NEW.invoice_year::text,0));
 SELECT coalesce(max(i.invoice_seq),0) INTO v_last FROM customer_private.real_invoice i WHERE i.invoice_year=NEW.invoice_year;
 IF NEW.invoice_seq<>v_last+1 THEN RAISE EXCEPTION 'Invoice numbers must follow in order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER real_invoice_guard BEFORE INSERT ON customer_private.real_invoice FOR EACH ROW EXECUTE FUNCTION customer_private.real_invoice_guard();

CREATE FUNCTION customer_private.real_invoice_payment_guard() RETURNS trigger
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
 RETURN NEW;
END $$;
CREATE TRIGGER real_invoice_payment_guard BEFORE INSERT ON customer_private.real_invoice_payment FOR EACH ROW EXECUTE FUNCTION customer_private.real_invoice_payment_guard();

CREATE FUNCTION customer_private.real_invoice_credit_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv customer_private.real_invoice; v_prev integer; v_last integer; v_today date:=customer_private.real_invoicing_today();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||NEW.invoice_id::text,0));
 SELECT * INTO v_inv FROM customer_private.real_invoice i WHERE i.id=NEW.invoice_id;
 IF NOT FOUND OR v_inv.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(c.seq),0) INTO v_prev FROM customer_private.real_invoice_credit c WHERE c.invoice_id=NEW.invoice_id;
 IF NEW.seq<>v_prev+1 THEN RAISE EXCEPTION 'Credit notes must follow in order' USING ERRCODE='23514'; END IF;
 IF NEW.issued_on<>v_today OR NEW.credit_year<>extract(year FROM NEW.issued_on)::integer OR NEW.issued_on<v_inv.issue_date THEN
  RAISE EXCEPTION 'A credit note is issued on the day it is recorded, in its own year' USING ERRCODE='23514'; END IF;
 IF NEW.amount_minor>v_inv.total_minor-customer_private.real_invoicing_paid(v_inv.id)-customer_private.real_invoicing_credited(v_inv.id) THEN
  RAISE EXCEPTION 'A credit cannot be more than is still unpaid on this invoice' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.credit-number:'||NEW.credit_year::text,0));
 SELECT coalesce(max(c.credit_seq),0) INTO v_last FROM customer_private.real_invoice_credit c WHERE c.credit_year=NEW.credit_year;
 IF NEW.credit_seq<>v_last+1 THEN RAISE EXCEPTION 'Credit note numbers must follow in order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER real_invoice_credit_guard BEFORE INSERT ON customer_private.real_invoice_credit FOR EACH ROW EXECUTE FUNCTION customer_private.real_invoice_credit_guard();

-- A decision: the approver is a real operator person, never the preparer unless the control allows it, and the one
-- named finance approver when the supplier details name one.
CREATE FUNCTION customer_private.real_invoicing_decision_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_p customer_private.real_invoicing_proposal; v_named uuid;
BEGIN
 SELECT * INTO v_p FROM customer_private.real_invoicing_proposal x WHERE x.id=NEW.proposal_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposal unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=v_p.tenant_id AND NOT t.synthetic) THEN RAISE EXCEPTION 'Real invoices are for real workspaces only' USING ERRCODE='42501'; END IF;
 IF NEW.decided_by=v_p.prepared_by THEN
  IF customer_private.real_invoicing_second_required() AND NEW.decision='approved' THEN RAISE EXCEPTION 'A second person must approve' USING ERRCODE='42501'; END IF;
  IF NEW.decision='approved' AND NOT NEW.self_approved THEN RAISE EXCEPTION 'Approval by the preparer must be recorded as self approval' USING ERRCODE='23514'; END IF;
 ELSIF NEW.self_approved THEN RAISE EXCEPTION 'Self approval is for the preparer only' USING ERRCODE='23514'; END IF;
 SELECT approver_principal_id INTO v_named FROM customer_private.real_invoicing_entity_current();
 IF NEW.decision='approved' AND v_named IS NOT NULL AND NEW.decided_by<>v_named THEN
  RAISE EXCEPTION 'Only the named finance approver can approve' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER real_invoicing_decision_guard BEFORE INSERT ON customer_private.real_invoicing_decision FOR EACH ROW EXECUTE FUNCTION customer_private.real_invoicing_decision_guard();

-- One document as customers and staff see it. A document issued with any made-up supplier field says so on its face.
CREATE FUNCTION customer_private.real_invoicing_invoice_json(v_id uuid,audience text) RETURNS jsonb
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',x.seq,'amountMinor',x.amount_minor::text,'receivedOn',x.received_on,'method',x.method)
  || CASE WHEN audience='staff' THEN jsonb_build_object('reference',x.reference,'recordedAt',x.created_at) ELSE '{}'::jsonb END ORDER BY x.seq),'[]'::jsonb) INTO v_pay
 FROM customer_private.real_invoice_payment x WHERE x.invoice_id=i.id;
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

CREATE FUNCTION customer_private.real_invoicing_balances(target uuid) RETURNS jsonb
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',b.currency,'invoicedMinor',b.invoiced::text,'paidMinor',b.paid::text,'creditedMinor',b.credited::text,
  'outstandingMinor',(b.invoiced-b.paid-b.credited)::text,'overdueMinor',b.overdue::text) ORDER BY b.currency COLLATE "C"),'[]'::jsonb)
 FROM (SELECT i.currency,sum(i.total_minor) AS invoiced,sum(customer_private.real_invoicing_paid(i.id)) AS paid,sum(customer_private.real_invoicing_credited(i.id)) AS credited,
   sum(CASE WHEN i.due_date<customer_private.real_invoicing_today() THEN i.total_minor-customer_private.real_invoicing_paid(i.id)-customer_private.real_invoicing_credited(i.id) ELSE 0 END) AS overdue
  FROM customer_private.real_invoice i WHERE i.tenant_id=target GROUP BY i.currency) b
$$;

-- One domain event, audit event and outbox row per change: ids, the document number and a sequence only. Never an
-- amount, a date, a name, an address, a reference or a reason.
CREATE FUNCTION customer_private.real_invoicing_emit(target uuid,aggregate uuid,kind text,number text,item_seq integer,version integer,initiator uuid,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid:=gen_random_uuid();
BEGIN
 IF target IS NULL OR kind NOT IN ('invoice.prepared','invoice.issued','invoice.rejected','credit.prepared','credit.issued','credit.rejected','payment.recorded') THEN
  RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.real_invoicing.'||kind,1,'customer_real_invoice',aggregate::text,version,initiator,clock_timestamp(),command,command,
  jsonb_build_object('documentId',aggregate,'number',number,'seq',item_seq,'synthetic',false,'initiator_kind','staff','initiator_id',initiator));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,initiator,'customer.real_invoicing.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- Customers read. A real owner or admin sees documents and per-currency balances; a member sees only that documents
-- exist. A real workspace whose invoicing is closed is told so (55000), never "denied".
CREATE FUNCTION customer.real_invoicing_overview(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer.actor_id(); v_access text; v_items jsonb:='[]'::jsonb; v_balances jsonb:='[]'::jsonb; v_exists boolean;
BEGIN
 IF v_actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 v_access:=customer_private.billing_workspace_role(target,v_actor);
 IF v_access IS NULL OR EXISTS(SELECT FROM app.tenant t WHERE t.id=target AND t.synthetic) THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF NOT customer_private.real_invoicing_open() THEN RAISE EXCEPTION 'Real invoices are switched off' USING ERRCODE='55000'; END IF;
 v_exists:=EXISTS(SELECT FROM customer_private.real_invoice i WHERE i.tenant_id=target);
 IF v_access='writer' THEN
  SELECT coalesce(jsonb_agg(customer_private.real_invoicing_invoice_json(q.id,'customer') ORDER BY q.invoice_year DESC,q.invoice_seq DESC),'[]'::jsonb) INTO v_items
  FROM (SELECT i.id,i.invoice_year,i.invoice_seq FROM customer_private.real_invoice i WHERE i.tenant_id=target ORDER BY i.invoice_year DESC,i.invoice_seq DESC LIMIT 100) q;
  v_balances:=customer_private.real_invoicing_balances(target);
 END IF;
 IF customer.actor_id() IS DISTINCT FROM v_actor OR customer_private.billing_workspace_role(target,v_actor) IS DISTINCT FROM v_access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canRead',v_access='writer','invoicesExist',v_exists,'invoices',v_items,'balances',v_balances,
  'paymentTaken',false,'synthetic',false,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

-- Staff: the periods that still need an invoice, the proposals waiting for a decision, and the supplier details in force.
-- "preparedByYou" lets the screen hide the approve button from the preparer without exposing staff identities.
CREATE FUNCTION app.real_invoicing_staff_pending() RETURNS jsonb
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
  'amountMinor',pr.amount_minor::text,'reason',pr.reason,'preparedByYou',pr.prepared_by=v_actor,'preparedAt',pr.created_at,
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

CREATE FUNCTION app.real_invoicing_staff_list(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_staff_actor(); v_items jsonb; v_next uuid; v_cursor customer_private.real_invoice;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO v_cursor FROM customer_private.real_invoice i WHERE i.id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT i.id,i.invoice_year,i.invoice_seq FROM customer_private.real_invoice i JOIN app.tenant w ON w.id=i.tenant_id AND NOT w.synthetic
  WHERE (after_id IS NULL OR (i.invoice_year,i.invoice_seq)<(v_cursor.invoice_year,v_cursor.invoice_seq)) ORDER BY i.invoice_year DESC,i.invoice_seq DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY invoice_year DESC,invoice_seq DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.real_invoicing_invoice_json(v.id,'staff')||jsonb_build_object('workspaceName',
   (SELECT w.name FROM app.tenant w JOIN customer_private.real_invoice x ON x.tenant_id=w.id WHERE x.id=v.id)) ORDER BY v.invoice_year DESC,v.invoice_seq DESC) FROM visible v),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY invoice_year ASC,invoice_seq ASC LIMIT 1) ELSE NULL END INTO v_items,v_next;
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('invoices',v_items,'nextAfter',v_next,'synthetic',false);
END $$;

CREATE FUNCTION app.real_invoicing_staff_view(invoice_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_staff_actor(); i customer_private.real_invoice; v_json jsonb;
BEGIN
 IF invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM customer_private.real_invoice x WHERE x.id=invoice_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND NOT w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.real_invoicing.invoice:'||i.id::text,0));
 v_json:=customer_private.real_invoicing_invoice_json(i.id,'staff')||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=i.tenant_id));
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('invoice',v_json,'actions',CASE WHEN (v_json->>'outstandingMinor')::bigint>0 THEN '["payment","credit"]'::jsonb ELSE '[]'::jsonb END,
  'workspaceBalances',customer_private.real_invoicing_balances(i.tenant_id),'synthetic',false);
END $$;

-- Staff changes. prepare_invoice and prepare_credit write a proposal; decide approves (which writes the numbered document)
-- or rejects it; payment records money received. Idempotent by (staff person, command id).
CREATE FUNCTION app.real_invoicing_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=customer_private.real_invoicing_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.real_invoicing_command; s customer_private.billing_subscription; p customer_private.billing_plan_version; i customer_private.real_invoice;
 e customer_private.real_invoicing_entity; pr customer_private.real_invoicing_proposal; v_end date; v_start date; v_due date; v_today date:=customer_private.real_invoicing_today();
 v_year integer:=extract(year FROM customer_private.real_invoicing_today())::integer; v_seq integer; v_item integer; v_pos integer; v_amount bigint; v_outstanding bigint;
 v_tax bigint; v_fee bigint; v_id uuid; v_doc uuid; v_self boolean; v_rate integer; v_decision text; result jsonb; v_aggregate uuid; v_number text; v_kind text;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('prepare_invoice','prepare_credit','decide','payment') THEN
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

REVOKE ALL ON FUNCTION customer_private.real_invoicing_open(),customer_private.real_invoicing_second_required(),customer_private.real_invoicing_today(),
 customer_private.real_invoicing_number(text,integer,integer),customer_private.real_invoicing_tax(bigint,text,integer),
 customer_private.real_invoicing_entity_current(),customer_private.real_invoicing_paid(uuid),customer_private.real_invoicing_credited(uuid),
 customer_private.real_invoicing_position(uuid),customer_private.real_invoicing_staff_actor(),customer_private.real_invoice_guard(),
 customer_private.real_invoice_payment_guard(),customer_private.real_invoice_credit_guard(),customer_private.real_invoicing_decision_guard(),
 customer_private.real_invoicing_invoice_json(uuid,text),customer_private.real_invoicing_balances(uuid),
 customer_private.real_invoicing_emit(uuid,uuid,text,text,integer,integer,uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.real_invoicing_overview(uuid) FROM PUBLIC,corridra_auth;
REVOKE ALL ON FUNCTION app.real_invoicing_staff_pending(),app.real_invoicing_staff_list(uuid,integer),app.real_invoicing_staff_view(uuid),
 app.real_invoicing_staff_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.real_invoicing_overview(uuid),app.real_invoicing_staff_pending(),app.real_invoicing_staff_list(uuid,integer),
 app.real_invoicing_staff_view(uuid),app.real_invoicing_staff_command(uuid,text,jsonb) TO corridra_runtime;
