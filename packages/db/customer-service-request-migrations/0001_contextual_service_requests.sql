-- Optional additive module: contextual paid-service requests, staff-quoted, synthetic only.
-- A quote is never an order: accepting a quote records an order intent (accepted by the customer, no payment
-- taken, billing not enabled) and nothing else. No money moves, nothing is sent, no file is stored.
-- Every history table is append-only. Existing tables, functions and policies are not replaced.

-- Text rules shared by the table checks below. They hold no data and are not callable by the runtime logins.
CREATE FUNCTION customer_private.service_text_ok(t text,min_len integer,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT t IS NOT NULL AND t=btrim(t) AND length(t) BETWEEN min_len AND max_len AND t !~ '[[:cntrl:]]'
$$;
-- Free text that customers and staff write about a request must be invented: it begins with "Synthetic ".
CREATE FUNCTION customer_private.service_synthetic_ok(t text,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT customer_private.service_text_ok(t,11,max_len) AND t LIKE 'Synthetic %'
$$;
-- Catalogue wording is staff-maintained reference text: plain, no links and no contact details.
CREATE FUNCTION customer_private.service_plain_ok(t text,min_len integer,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT customer_private.service_text_ok(t,min_len,max_len) AND t !~ '(://|@|www\.)'
$$;
CREATE FUNCTION customer_private.service_list_ok(a text[],max_items integer,min_len integer,max_len integer,synthetic boolean,plain boolean) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT a IS NOT NULL AND array_ndims(a)=1 AND cardinality(a) BETWEEN 1 AND max_items
 AND NOT EXISTS(SELECT FROM unnest(a) e WHERE e IS NULL
  OR (synthetic AND NOT customer_private.service_synthetic_ok(e,max_len))
  OR (NOT synthetic AND plain AND NOT customer_private.service_plain_ok(e,min_len,max_len))
  OR (NOT synthetic AND NOT plain AND NOT customer_private.service_text_ok(e,min_len,max_len)))
 AND (SELECT count(DISTINCT lower(e)) FROM unnest(a) e)=cardinality(a)
$$;
CREATE FUNCTION customer_private.service_input_shape(input jsonb,required text[],optional text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(input)='object' AND input ?& required AND (input-(required||optional))='{}'::jsonb
$$;
REVOKE ALL ON FUNCTION customer_private.service_text_ok(text,integer,integer),customer_private.service_synthetic_ok(text,integer),
 customer_private.service_plain_ok(text,integer,integer),customer_private.service_list_ok(text[],integer,integer,integer,boolean,boolean),
 customer_private.service_input_shape(jsonb,text[],text[]) FROM PUBLIC,corridra_runtime,corridra_auth;

-- Staff-maintained catalogue, one immutable row per version. Customers read the latest active version only.
CREATE TABLE customer_private.service_catalogue_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service_key text NOT NULL CHECK(service_key ~ '^[a-z][a-z0-9-]{2,59}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 title text NOT NULL CHECK(customer_private.service_plain_ok(title,3,120)),
 summary text NOT NULL CHECK(customer_private.service_plain_ok(summary,10,400)),
 included text[] NOT NULL CHECK(customer_private.service_list_ok(included,12,3,200,false,true)),
 excluded text[] NOT NULL CHECK(customer_private.service_list_ok(excluded,12,3,200,false,true)),
 regions text[] NOT NULL CHECK(customer_private.service_list_ok(regions,12,2,80,false,true)),
 quote_basis text NOT NULL CHECK(quote_basis IN ('per_day','per_visit','per_item','fixed_scope')),
 active boolean NOT NULL,
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 source text NOT NULL CHECK(source IN ('SEED','STAFF')),
 created_by uuid REFERENCES identity.principal(id),
 staff_tenant_id uuid REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(service_key,version),
 CHECK((source='SEED' AND created_by IS NULL AND staff_tenant_id IS NULL) OR (source='STAFF' AND created_by IS NOT NULL AND staff_tenant_id IS NOT NULL))
);

-- The request itself: who asked, from which place, for which service version. Never edited.
CREATE TABLE customer_private.service_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 context_kind text NOT NULL CHECK(context_kind IN ('request','programme','company')),
 context_ref text NOT NULL CHECK(context_ref ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR context_ref ~ '^[a-f0-9]{64}$'),
 context_label text NOT NULL CHECK(customer_private.service_text_ok(context_label,3,160)),
 service_key text NOT NULL,
 service_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(service_key,service_version) REFERENCES customer_private.service_catalogue_version(service_key,version)
);
CREATE INDEX service_request_workspace ON customer_private.service_request(tenant_id,created_at DESC,id DESC);
CREATE INDEX service_request_context ON customer_private.service_request(tenant_id,context_kind,context_ref,service_key);

-- What the customer needs. Each edit while the request is still unquoted is a new immutable version.
CREATE TABLE customer_private.service_request_need (
 request_id uuid NOT NULL REFERENCES customer_private.service_request(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 need text NOT NULL CHECK(customer_private.service_synthetic_ok(need,1000)),
 preferred_from date,
 preferred_to date,
 region text NOT NULL CHECK(customer_private.service_plain_ok(region,2,80)),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,version),
 CHECK(preferred_to IS NULL OR (preferred_from IS NOT NULL AND preferred_to>=preferred_from))
);

-- One team handles a request: the first staff workspace to act holds it.
CREATE TABLE customer_private.service_request_claim (
 request_id uuid PRIMARY KEY REFERENCES customer_private.service_request(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 claimed_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- A quote: itemised components, scope, exclusions, assumptions, terms and a validity time. Never edited; a
-- change is a new version. Exclusions and assumptions are required by the table itself.
CREATE TABLE customer_private.service_quote (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES customer_private.service_request(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 currency text NOT NULL REFERENCES app.currency(code),
 scope text NOT NULL CHECK(customer_private.service_synthetic_ok(scope,1000)),
 exclusions text[] NOT NULL CHECK(customer_private.service_list_ok(exclusions,12,11,300,true,false)),
 assumptions text[] NOT NULL CHECK(customer_private.service_list_ok(assumptions,12,11,300,true,false)),
 delivery_terms text NOT NULL CHECK(customer_private.service_synthetic_ok(delivery_terms,500)),
 payment_terms text NOT NULL CHECK(customer_private.service_synthetic_ok(payment_terms,500)),
 valid_until timestamptz NOT NULL,
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 prepared_by uuid NOT NULL REFERENCES identity.principal(id),
 staff_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id,version),UNIQUE(request_id,id),
 CHECK(valid_until>created_at AND valid_until<=created_at+interval '90 days')
);
CREATE TABLE customer_private.service_quote_component (
 quote_id uuid NOT NULL REFERENCES customer_private.service_quote(id),
 position integer NOT NULL CHECK(position BETWEEN 1 AND 12),
 kind text NOT NULL CHECK(kind IN ('service_fee','local_cost','pass_through','tax')),
 label text NOT NULL CHECK(customer_private.service_synthetic_ok(label,200)),
 treatment text NOT NULL CHECK(treatment IN ('included','estimate','not_included')),
 amount_minor bigint CHECK(amount_minor BETWEEN 0 AND 99999999999),
 PRIMARY KEY(quote_id,position),
 -- A cost that is counted has an exact integer amount; a cost that is not included may say how much, or not.
 CHECK((treatment='not_included') OR amount_minor IS NOT NULL),
 CHECK(kind<>'service_fee' OR treatment<>'not_included')
);

-- Each person's view of a quote. A writer cannot accept a quote version that they have not been shown.
CREATE TABLE customer_private.service_quote_view (
 quote_id uuid NOT NULL REFERENCES customer_private.service_quote(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(quote_id,principal_id)
);

-- Acceptance of a quote is an order intent: the exact version and amounts, no payment, no billing.
CREATE TABLE customer_private.service_order_intent (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES customer_private.service_request(id),
 quote_id uuid NOT NULL,
 quote_version integer NOT NULL,
 currency text NOT NULL REFERENCES app.currency(code),
 fixed_total_minor bigint NOT NULL CHECK(fixed_total_minor>=0),
 estimated_total_minor bigint NOT NULL CHECK(estimated_total_minor>=0),
 quote_digest text NOT NULL CHECK(quote_digest ~ '^[a-f0-9]{64}$'),
 accepted_by uuid NOT NULL REFERENCES customer_private.principal(id),
 order_status text NOT NULL DEFAULT 'accepted_by_customer' CHECK(order_status='accepted_by_customer'),
 payment_taken boolean NOT NULL DEFAULT false CHECK(NOT payment_taken),
 billing text NOT NULL DEFAULT 'billing_not_enabled' CHECK(billing='billing_not_enabled'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(request_id,quote_id) REFERENCES customer_private.service_quote(request_id,id)
);

-- The timeline. Statuses only ever move forward by appending a row; the row after a row decides the status.
CREATE TABLE customer_private.service_request_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES customer_private.service_request(id),
 tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 kind text NOT NULL CHECK(kind IN ('requested','revised','quoted','question','answer','accepted','declined','withdrawn','expired','started','update','delivered','closed','internal_note')),
 status_after text NOT NULL CHECK(status_after IN ('requested','quoted','accepted','declined','withdrawn','expired','in_progress','delivered','closed')),
 actor_kind text NOT NULL CHECK(actor_kind IN ('customer','staff','system')),
 customer_actor uuid REFERENCES customer_private.principal(id),
 staff_actor uuid REFERENCES identity.principal(id),
 staff_tenant_id uuid REFERENCES app.tenant(id),
 customer_note text CHECK(customer_note IS NULL OR customer_private.service_synthetic_ok(customer_note,1000)),
 internal_note text CHECK(internal_note IS NULL OR customer_private.service_synthetic_ok(internal_note,1000)),
 quote_id uuid REFERENCES customer_private.service_quote(id),
 order_intent_id uuid REFERENCES customer_private.service_order_intent(id),
 need_version integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id,seq),
 FOREIGN KEY(tenant_id,request_id) REFERENCES customer_private.service_request(tenant_id,id),
 CHECK((actor_kind='customer' AND customer_actor IS NOT NULL AND staff_actor IS NULL AND staff_tenant_id IS NULL)
  OR (actor_kind='staff' AND customer_actor IS NULL AND staff_actor IS NOT NULL AND staff_tenant_id IS NOT NULL)
  OR (actor_kind='system' AND customer_actor IS NULL AND staff_actor IS NULL AND staff_tenant_id IS NULL)),
 CHECK(kind IN ('requested','revised','question','accepted','declined','withdrawn') = (actor_kind='customer')),
 CHECK(kind IN ('quoted','answer','started','update','delivered','closed','internal_note') = (actor_kind='staff')),
 CHECK((kind='expired') = (actor_kind='system')),
 CHECK((kind='internal_note') = (internal_note IS NOT NULL)),
 CHECK(kind NOT IN ('question','answer','started','update','delivered','closed') OR customer_note IS NOT NULL),
 CHECK(kind IN ('question','answer','started','update','delivered','closed','declined','withdrawn') OR customer_note IS NULL),
 CHECK((kind IN ('quoted','accepted','expired')) = (quote_id IS NOT NULL)),
 CHECK((kind='accepted') = (order_intent_id IS NOT NULL)),
 CHECK((kind IN ('requested','revised')) = (need_version IS NOT NULL))
);
CREATE INDEX service_request_event_latest ON customer_private.service_request_event(request_id,seq DESC);

-- Customer commands are keyed by (customer, command id); staff commands by (staff person, command id).
CREATE TABLE customer_private.service_request_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('create','revise','question','accept','decline','withdraw')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE customer_private.service_request_staff_command (
 actor_id uuid NOT NULL REFERENCES identity.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('quote','answer','start','update','deliver','close','note','catalogue')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

CREATE TRIGGER service_catalogue_version_immutable BEFORE UPDATE OR DELETE ON customer_private.service_catalogue_version FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_request_immutable BEFORE UPDATE OR DELETE ON customer_private.service_request FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_request_need_immutable BEFORE UPDATE OR DELETE ON customer_private.service_request_need FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_request_claim_immutable BEFORE UPDATE OR DELETE ON customer_private.service_request_claim FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_quote_immutable BEFORE UPDATE OR DELETE ON customer_private.service_quote FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_quote_component_immutable BEFORE UPDATE OR DELETE ON customer_private.service_quote_component FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_quote_view_immutable BEFORE UPDATE OR DELETE ON customer_private.service_quote_view FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_order_intent_immutable BEFORE UPDATE OR DELETE ON customer_private.service_order_intent FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_request_event_immutable BEFORE UPDATE OR DELETE ON customer_private.service_request_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_request_command_immutable BEFORE UPDATE OR DELETE ON customer_private.service_request_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER service_request_staff_command_immutable BEFORE UPDATE OR DELETE ON customer_private.service_request_staff_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.service_catalogue_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_request_need ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_request_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_quote ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_quote_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_quote_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_order_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_request_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_request_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.service_request_staff_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.service_catalogue_version,customer_private.service_request,customer_private.service_request_need,
 customer_private.service_request_claim,customer_private.service_quote,customer_private.service_quote_component,
 customer_private.service_quote_view,customer_private.service_order_intent,customer_private.service_request_event,
 customer_private.service_request_command,customer_private.service_request_staff_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Four invented services so the catalogue is not empty. Staff revise or retire them through the staff command.
INSERT INTO customer_private.service_catalogue_version(service_key,version,title,summary,included,excluded,regions,quote_basis,active,source) VALUES
('local-meeting-arrangement',1,'Local meeting arrangement',
 'We arrange a room, a time and a confirmed attendee list for one business meeting on the ground.',
 ARRAY['A meeting room or visit location booked','Agenda and attendee list confirmed with the other side','One local coordinator on the day'],
 ARRAY['Travel, visas and accommodation','Interpreters','Any negotiation on your behalf'],
 ARRAY['Dhaka','Chattogram','Guangzhou','Istanbul'],'per_visit',true,'SEED'),
('interpreter-day',1,'Interpreter day',
 'An interpreter works with you for one day of meetings in one city.',
 ARRAY['One interpreter for up to eight hours','A short briefing call before the day'],
 ARRAY['Written translation','Legal or contract interpretation','Interpreter travel outside the city'],
 ARRAY['Dhaka','Guangzhou','Istanbul'],'per_day',true,'SEED'),
('site-visit-coordination',1,'Site visit coordination',
 'We organise a visit to one factory or workshop, including access, timing and a local escort.',
 ARRAY['Visit access agreed with the site','Visit timetable and a local escort','A short written visit note afterwards'],
 ARRAY['Quality or safety audits','Transport between cities','Any commitment made on your behalf'],
 ARRAY['Dhaka','Chattogram','Guangzhou'],'per_visit',true,'SEED'),
('supplier-sample-check',1,'Supplier sample check',
 'We collect a sample from a supplier, check its condition and hand it on to a named address.',
 ARRAY['Collection of one sample from the supplier','Photos and a short written condition report','Courier hand-off to a named address'],
 ARRAY['Laboratory testing or certification','Customs clearance','Any payment to the supplier'],
 ARRAY['Dhaka','Guangzhou','Istanbul'],'per_item',true,'SEED');

-- The role of the current actor in a workspace: writer (owner or admin), reader (member) or NULL. It reads the
-- same helper the profile and team modules use, so revoked, left and disabled access reads as no access.
CREATE FUNCTION customer_private.service_request_role(target uuid,actor uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.organisation_profile_role(target,actor)
$$;

-- Allowed moves between statuses. NULL means the move is not allowed.
CREATE FUNCTION customer_private.service_request_next(prev text,kind text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN kind='requested' THEN CASE WHEN prev IS NULL THEN 'requested' END
  WHEN prev IS NULL OR prev IN ('declined','withdrawn','closed') THEN NULL
  WHEN kind='revised' THEN CASE WHEN prev='requested' THEN 'requested' END
  WHEN kind='quoted' THEN CASE WHEN prev IN ('requested','quoted','expired') THEN 'quoted' END
  WHEN kind IN ('question','answer','internal_note') THEN prev
  WHEN kind='accepted' THEN CASE WHEN prev='quoted' THEN 'accepted' END
  WHEN kind='declined' THEN CASE WHEN prev IN ('quoted','expired') THEN 'declined' END
  WHEN kind='withdrawn' THEN CASE WHEN prev='requested' THEN 'withdrawn' END
  WHEN kind='expired' THEN CASE WHEN prev='quoted' THEN 'expired' END
  WHEN kind='started' THEN CASE WHEN prev='accepted' THEN 'in_progress' END
  WHEN kind='update' THEN CASE WHEN prev='in_progress' THEN 'in_progress' END
  WHEN kind='delivered' THEN CASE WHEN prev='in_progress' THEN 'delivered' END
  WHEN kind='closed' THEN CASE WHEN prev IN ('accepted','in_progress','delivered') THEN 'closed' END
 END
$$;

-- A quote is complete only with exclusions, assumptions, a priced service fee and a stated tax line.
CREATE FUNCTION customer_private.service_quote_complete(quote uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.service_quote q WHERE q.id=quote AND cardinality(q.exclusions)>=1 AND cardinality(q.assumptions)>=1)
 AND EXISTS(SELECT FROM customer_private.service_quote_component c WHERE c.quote_id=quote AND c.kind='service_fee' AND c.treatment='included')
 AND EXISTS(SELECT FROM customer_private.service_quote_component c WHERE c.quote_id=quote AND c.kind='tax')
$$;
-- The exact content a customer is shown, fingerprinted. Acceptance must quote this back.
CREATE FUNCTION customer_private.service_quote_digest(quote uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',q.id,'version',q.version,'currency',q.currency,'scope',q.scope,
  'exclusions',to_jsonb(q.exclusions),'assumptions',to_jsonb(q.assumptions),'deliveryTerms',q.delivery_terms,'paymentTerms',q.payment_terms,
  'validUntil',to_char(q.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'components',(SELECT coalesce(jsonb_agg(jsonb_build_object('position',c.position,'kind',c.kind,'label',c.label,'treatment',c.treatment,'amountMinor',c.amount_minor::text) ORDER BY c.position),'[]'::jsonb)
   FROM customer_private.service_quote_component c WHERE c.quote_id=q.id))::text,'UTF8')),'hex')
 FROM customer_private.service_quote q WHERE q.id=quote
$$;
CREATE FUNCTION customer_private.service_quote_totals(quote uuid) RETURNS TABLE(fixed bigint,estimated bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(c.amount_minor) FILTER (WHERE c.treatment='included'),0)::bigint,
 coalesce(sum(c.amount_minor) FILTER (WHERE c.treatment='estimate'),0)::bigint
 FROM customer_private.service_quote_component c WHERE c.quote_id=quote
$$;
-- One quote as the customer and staff see it: every component, every exclusion, every assumption.
CREATE FUNCTION customer_private.service_quote_json(quote uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',q.id,'version',q.version,'currency',q.currency,'scope',q.scope,
  'components',(SELECT coalesce(jsonb_agg(jsonb_build_object('position',c.position,'kind',c.kind,'label',c.label,'treatment',c.treatment,'amountMinor',c.amount_minor::text) ORDER BY c.position),'[]'::jsonb)
   FROM customer_private.service_quote_component c WHERE c.quote_id=q.id),
  'fixedTotalMinor',t.fixed::text,'estimatedTotalMinor',t.estimated::text,
  'exclusions',to_jsonb(q.exclusions),'assumptions',to_jsonb(q.assumptions),'deliveryTerms',q.delivery_terms,'paymentTerms',q.payment_terms,
  'validUntil',to_char(q.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'preparedAt',to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expired',q.valid_until<=clock_timestamp(),'digest',customer_private.service_quote_digest(q.id),'synthetic',true,
  'billing','billing_not_enabled','paymentTaken',false)
 FROM customer_private.service_quote q CROSS JOIN LATERAL customer_private.service_quote_totals(q.id) t WHERE q.id=quote
$$;

-- Status for lists. A quote past its validity reads as expired even before the event is written.
CREATE FUNCTION customer_private.service_request_status_now(req uuid) RETURNS text
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN e.status_after='quoted' AND EXISTS(SELECT FROM customer_private.service_quote q WHERE q.request_id=req
  AND q.version=(SELECT max(version) FROM customer_private.service_quote WHERE request_id=req) AND q.valid_until<=clock_timestamp())
  THEN 'expired' ELSE e.status_after END
 FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1
$$;

-- One domain event, audit event and outbox row per real change. The payload carries ids and versions only.
CREATE FUNCTION customer_private.service_request_emit(req uuid,seq integer,kind text,status text,actor_kind text,initiator uuid,quote_version integer,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid; eid uuid:=gen_random_uuid(); target uuid; event_actor uuid;
BEGIN
 SELECT tenant_id INTO target FROM customer_private.service_request WHERE id=req;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF target IS NULL OR executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 -- A staff change is attributed to the staff person; customer and system changes to the service executor.
 event_actor:=CASE WHEN actor_kind='staff' THEN initiator ELSE executor END;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.service_request.'||kind,1,'customer_service_request',req::text,seq,event_actor,clock_timestamp(),command,command,
 jsonb_strip_nulls(jsonb_build_object('requestId',req,'seq',seq,'status',status,'quoteVersion',quote_version,'synthetic',true,'initiator_kind',actor_kind,'initiator_id',initiator)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,event_actor,'customer.service_request.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- Appends one timeline row (the guard below checks it) and its event chain. Callers hold the request lock.
CREATE FUNCTION customer_private.service_request_record(req uuid,kind text,actor_kind text,customer_actor uuid,staff_actor uuid,staff_tenant uuid,
 customer_note text,internal_note text,quote uuid,intent uuid,need_version integer,command uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid; prev text; next_seq integer; next_status text; quote_version integer; initiator uuid;
BEGIN
 SELECT tenant_id INTO target FROM customer_private.service_request WHERE id=req;
 SELECT e.status_after,e.seq INTO prev,next_seq FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1;
 next_seq:=coalesce(next_seq,0)+1;
 next_status:=customer_private.service_request_next(prev,kind);
 IF target IS NULL OR next_status IS NULL THEN RAISE EXCEPTION 'That change is not available for this request now' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.service_request_event(request_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor,staff_actor,staff_tenant_id,customer_note,internal_note,quote_id,order_intent_id,need_version)
 VALUES(req,target,next_seq,kind,next_status,actor_kind,customer_actor,staff_actor,staff_tenant,customer_note,internal_note,quote,intent,need_version);
 SELECT version INTO quote_version FROM customer_private.service_quote WHERE id=quote;
 initiator:=CASE actor_kind WHEN 'customer' THEN customer_actor WHEN 'staff' THEN staff_actor END;
 PERFORM customer_private.service_request_emit(req,next_seq,kind,next_status,actor_kind,initiator,quote_version,command);
 RETURN next_seq;
END $$;

-- Database guard on the timeline: sequence, allowed move, and quote and order rules, for every writer.
CREATE FUNCTION customer_private.service_request_event_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev customer_private.service_request_event; q customer_private.service_quote; found_prev boolean; expected text;
BEGIN
 SELECT * INTO prev FROM customer_private.service_request_event WHERE request_id=NEW.request_id ORDER BY seq DESC LIMIT 1;
 found_prev:=FOUND;
 IF (NOT found_prev AND NEW.seq<>1) OR (found_prev AND NEW.seq<>prev.seq+1) THEN RAISE EXCEPTION 'Timeline entries must follow in order' USING ERRCODE='23514'; END IF;
 expected:=customer_private.service_request_next(CASE WHEN found_prev THEN prev.status_after END,NEW.kind);
 IF expected IS NULL OR expected<>NEW.status_after THEN RAISE EXCEPTION 'That change is not available for this request now' USING ERRCODE='23514'; END IF;
 IF NEW.kind='requested' AND NEW.need_version<>1 THEN RAISE EXCEPTION 'First need version required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='revised' AND NEW.need_version IS DISTINCT FROM (SELECT max(version) FROM customer_private.service_request_need WHERE request_id=NEW.request_id) THEN
  RAISE EXCEPTION 'Revision must name the latest need version' USING ERRCODE='23514'; END IF;
 IF NEW.actor_kind='staff' AND NOT EXISTS(SELECT FROM customer_private.service_request_claim c WHERE c.request_id=NEW.request_id AND c.staff_tenant_id=NEW.staff_tenant_id) THEN
  RAISE EXCEPTION 'Another team handles this request' USING ERRCODE='42501'; END IF;
 IF NEW.kind IN ('quoted','accepted','expired') THEN
  SELECT * INTO q FROM customer_private.service_quote WHERE id=NEW.quote_id AND request_id=NEW.request_id;
  IF NOT FOUND OR q.version<>(SELECT max(version) FROM customer_private.service_quote WHERE request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'The current quote version is required' USING ERRCODE='23514'; END IF;
  IF NOT customer_private.service_quote_complete(q.id) THEN RAISE EXCEPTION 'A complete quote with exclusions and assumptions is required' USING ERRCODE='23514'; END IF;
  IF NEW.kind='quoted' AND (q.staff_tenant_id<>NEW.staff_tenant_id OR q.valid_until<=clock_timestamp()) THEN RAISE EXCEPTION 'An open quote from the handling team is required' USING ERRCODE='23514'; END IF;
  IF NEW.kind='expired' AND q.valid_until>clock_timestamp() THEN RAISE EXCEPTION 'Quote is still open' USING ERRCODE='23514'; END IF;
  IF NEW.kind='accepted' THEN
   IF q.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'Quote has expired' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT FROM customer_private.service_order_intent o WHERE o.id=NEW.order_intent_id AND o.request_id=NEW.request_id AND o.quote_id=q.id AND o.accepted_by=NEW.customer_actor
    AND o.quote_digest=customer_private.service_quote_digest(q.id)) THEN RAISE EXCEPTION 'Order intent must match the exact quote' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT FROM customer_private.service_quote_view v WHERE v.quote_id=q.id AND v.principal_id=NEW.customer_actor AND v.digest=customer_private.service_quote_digest(q.id)) THEN
    RAISE EXCEPTION 'Review the whole quote before accepting it' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_request_event_guard BEFORE INSERT ON customer_private.service_request_event FOR EACH ROW EXECUTE FUNCTION customer_private.service_request_event_guard();

-- A quote row never stands alone: at commit it must be complete.
CREATE FUNCTION customer_private.service_quote_complete_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT customer_private.service_quote_complete(NEW.id) THEN RAISE EXCEPTION 'A complete quote with exclusions and assumptions is required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER service_quote_complete AFTER INSERT ON customer_private.service_quote DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_private.service_quote_complete_guard();

-- Writes the "expired" entry the first time anyone looks at a request whose quote has run out. Caller holds the lock.
CREATE FUNCTION customer_private.service_request_settle(req uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q customer_private.service_quote; status text;
BEGIN
 SELECT e.status_after INTO status FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1;
 IF status IS DISTINCT FROM 'quoted' THEN RETURN; END IF;
 SELECT * INTO q FROM customer_private.service_quote WHERE request_id=req ORDER BY version DESC LIMIT 1;
 IF FOUND AND q.valid_until<=clock_timestamp() THEN
  PERFORM customer_private.service_request_record(req,'expired','system',NULL,NULL,NULL,NULL,NULL,q.id,NULL,NULL,gen_random_uuid());
 END IF;
END $$;

CREATE FUNCTION customer_private.service_request_summary(req uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r customer_private.service_request; c customer_private.service_catalogue_version; n customer_private.service_request_need;
BEGIN
 SELECT * INTO r FROM customer_private.service_request WHERE id=req;
 SELECT * INTO c FROM customer_private.service_catalogue_version WHERE service_key=r.service_key AND version=r.service_version;
 SELECT * INTO n FROM customer_private.service_request_need WHERE request_id=req ORDER BY version DESC LIMIT 1;
 RETURN jsonb_build_object('id',r.id,'workspaceId',r.tenant_id,'contextKind',r.context_kind,'contextRef',r.context_ref,'contextLabel',r.context_label,
 'serviceKey',r.service_key,'serviceTitle',c.title,'status',customer_private.service_request_status_now(req),'needVersion',n.version,'region',n.region,
 'createdAt',r.created_at,
 'updatedAt',(SELECT max(e.created_at) FROM customer_private.service_request_event e WHERE e.request_id=req AND e.kind<>'internal_note'));
END $$;

-- The place the customer is working in must be theirs to ask for help about. Returns its plain label.
CREATE FUNCTION customer_private.service_request_context(target uuid,actor uuid,kind text,ref text) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE label text; page jsonb; company jsonb; after_id uuid; rounds integer:=0;
BEGIN
 IF kind='programme' THEN
  SELECT d.name INTO label FROM app.delivery_programme d JOIN customer_private.programme_creation c ON c.workspace_id=d.tenant_id AND c.programme_id=d.id
  WHERE d.tenant_id=target AND d.id::text=ref;
 ELSIF kind='request' THEN
  SELECT 'Private request from '||to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') INTO label FROM customer_private.owned_request o
  WHERE o.id::text=ref AND o.workspace_id=target AND o.principal_id=actor
  AND NOT EXISTS(SELECT FROM customer_private.request_revocation r WHERE r.request_id=o.id);
 ELSIF kind='company' THEN
  BEGIN
   LOOP
    page:=customer.company_portfolio(after_id,5);
    SELECT value INTO company FROM jsonb_array_elements(page->'companies') WHERE value->>'id'=ref LIMIT 1;
    IF company IS NOT NULL THEN label:=company->'contexts'->0->>'company'; EXIT; END IF;
    after_id:=(page->>'nextAfter')::uuid;
    rounds:=rounds+1;
    EXIT WHEN after_id IS NULL OR rounds>=20;
   END LOOP;
  EXCEPTION WHEN OTHERS THEN label:=NULL;
  END;
 END IF;
 IF label IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'That place is not available for a help request' USING ERRCODE='42501'; END IF;
 RETURN label;
END $$;

-- Customers read the catalogue: the latest active version of each service. Nothing else is exposed.
CREATE FUNCTION customer.service_catalogue() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE items jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',v.service_key,'version',v.version,'title',v.title,'summary',v.summary,'included',to_jsonb(v.included),
  'excluded',to_jsonb(v.excluded),'regions',to_jsonb(v.regions),'quoteBasis',v.quote_basis,'synthetic',true) ORDER BY v.title,v.service_key),'[]'::jsonb) INTO items
 FROM customer_private.service_catalogue_version v WHERE v.active
 AND v.version=(SELECT max(x.version) FROM customer_private.service_catalogue_version x WHERE x.service_key=v.service_key);
 RETURN jsonb_build_object('services',items,'synthetic',true,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

CREATE FUNCTION customer.service_request_list(target uuid,kind_filter text DEFAULT NULL,ref_filter text DEFAULT NULL,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); access text; items jsonb; next_id uuid; cursor_row customer_private.service_request;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR (kind_filter IS NULL) <> (ref_filter IS NULL)
  OR (kind_filter IS NOT NULL AND kind_filter NOT IN ('request','programme','company')) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 access:=customer_private.service_request_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO cursor_row FROM customer_private.service_request WHERE id=after_id AND tenant_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH page AS(SELECT r.id,r.created_at FROM customer_private.service_request r WHERE r.tenant_id=target
  AND (kind_filter IS NULL OR (r.context_kind=kind_filter AND r.context_ref=ref_filter))
  AND (after_id IS NULL OR (r.created_at,r.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY r.created_at DESC,r.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.service_request_summary(v.id) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO items,next_id;
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.service_request_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canRequest',access='writer','requests',items,'nextAfter',next_id,'synthetic',true,
 'expiresAt',customer_private.organisation_profile_expiry());
END $$;

CREATE FUNCTION customer.service_request_view(target uuid,request_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); access text; r customer_private.service_request; c customer_private.service_catalogue_version; n customer_private.service_request_need;
 q customer_private.service_quote; intent customer_private.service_order_intent; status text; quote_json jsonb; timeline jsonb; actions jsonb:='[]'::jsonb; summary jsonb;
BEGIN
 IF actor IS NULL OR target IS NULL OR request_id IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.service_request_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||request_id::text,0));
 SELECT * INTO r FROM customer_private.service_request WHERE id=request_id AND tenant_id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.service_request_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.service_request_settle(request_id);
 SELECT * INTO c FROM customer_private.service_catalogue_version WHERE service_key=r.service_key AND version=r.service_version;
 SELECT * INTO n FROM customer_private.service_request_need WHERE service_request_need.request_id=r.id ORDER BY version DESC LIMIT 1;
 SELECT e.status_after INTO status FROM customer_private.service_request_event e WHERE e.request_id=r.id ORDER BY e.seq DESC LIMIT 1;
 SELECT * INTO q FROM customer_private.service_quote WHERE service_quote.request_id=r.id ORDER BY version DESC LIMIT 1;
 IF FOUND THEN
  quote_json:=customer_private.service_quote_json(q.id);
  -- The person who may accept is shown the full quote first; that showing is recorded.
  IF access='writer' THEN
   INSERT INTO customer_private.service_quote_view(quote_id,principal_id,digest) VALUES(q.id,actor,quote_json->>'digest') ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 SELECT * INTO intent FROM customer_private.service_order_intent WHERE service_order_intent.request_id=r.id;
 -- Internal staff notes are never selected here.
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.created_at,'kind',e.kind,'status',e.status_after,
  'by',CASE e.actor_kind WHEN 'staff' THEN 'Corridra team' WHEN 'system' THEN 'Automatic' WHEN 'customer' THEN CASE WHEN e.customer_actor=actor THEN 'You' ELSE 'A teammate' END END,
  'note',e.customer_note,'quoteVersion',(SELECT x.version FROM customer_private.service_quote x WHERE x.id=e.quote_id)) ORDER BY e.seq),'[]'::jsonb) INTO timeline
 FROM customer_private.service_request_event e WHERE e.request_id=r.id AND e.kind<>'internal_note';
 IF access='writer' THEN
  actions:=CASE status WHEN 'requested' THEN '["revise","question","withdraw"]'::jsonb
   WHEN 'quoted' THEN '["accept","decline","question"]'::jsonb
   WHEN 'expired' THEN '["decline","question"]'::jsonb
   WHEN 'accepted' THEN '["question"]'::jsonb WHEN 'in_progress' THEN '["question"]'::jsonb WHEN 'delivered' THEN '["question"]'::jsonb
   ELSE '[]'::jsonb END;
 END IF;
 summary:=customer_private.service_request_summary(r.id);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canAct',access='writer','request',summary||jsonb_build_object('serviceVersion',r.service_version),
 'service',jsonb_build_object('title',c.title,'summary',c.summary,'included',to_jsonb(c.included),'excluded',to_jsonb(c.excluded),'regions',to_jsonb(c.regions),'quoteBasis',c.quote_basis),
 'need',jsonb_build_object('version',n.version,'text',n.need,'preferredFrom',n.preferred_from,'preferredTo',n.preferred_to,'region',n.region,'updatedAt',n.created_at),
 'quote',quote_json,
 'orderIntent',CASE WHEN intent.id IS NULL THEN NULL ELSE jsonb_build_object('id',intent.id,'quoteVersion',intent.quote_version,'currency',intent.currency,
  'fixedTotalMinor',intent.fixed_total_minor::text,'estimatedTotalMinor',intent.estimated_total_minor::text,'acceptedAt',intent.created_at,
  'orderStatus',intent.order_status,'paymentTaken',false,'billing',intent.billing,
  'statement','Accepted by customer. No payment taken. Billing not enabled.') END,
 'timeline',timeline,'actions',actions,'synthetic',true,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

CREATE FUNCTION customer.service_request_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid; prior customer_private.service_request_command; r customer_private.service_request; cat customer_private.service_catalogue_version;
 n customer_private.service_request_need; q customer_private.service_quote; status text; place_label text; req uuid; intent uuid; result jsonb; current_digest text;
 from_date date; to_date date; new_version integer; fixed bigint; estimated bigint; note text; open_count integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('create','revise','question','accept','decline','withdraw')
  OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid service request command' USING ERRCODE='23514'; END IF;
 IF operation='create' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','contextKind','contextRef','serviceKey','need','preferredFrom','preferredTo','region'],ARRAY[]::text[])
   OR jsonb_typeof(input->'contextKind') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'contextRef') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'serviceKey') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'need') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'region') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'preferredFrom') NOT IN ('string','null')
   OR jsonb_typeof(input->'preferredTo') NOT IN ('string','null') OR input->>'contextKind' NOT IN ('request','programme','company') THEN
   RAISE EXCEPTION 'Invalid service request' USING ERRCODE='23514'; END IF;
 ELSIF operation='revise' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','expectedNeedVersion','need','preferredFrom','preferredTo','region'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedNeedVersion') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'need') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'region') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'preferredFrom') NOT IN ('string','null') OR jsonb_typeof(input->'preferredTo') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Invalid service request change' USING ERRCODE='23514'; END IF;
 ELSIF operation='question' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','note'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid question' USING ERRCODE='23514'; END IF;
 ELSIF operation='accept' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','quoteVersion','quoteDigest','acknowledged'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'quoteVersion') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'quoteDigest') IS DISTINCT FROM 'string' OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'The quote must be reviewed and acknowledged to accept it' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.service_input_shape(input,ARRAY['workspaceId','requestId','note'],ARRAY[]::text[])
   OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'note') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Invalid service request change' USING ERRCODE='23514'; END IF;
 END IF;
 target:=(input->>'workspaceId')::uuid;
 actor:=customer_private.lock_workspace_access(command,target);
 IF customer_private.service_request_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.service_request_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 IF operation='create' THEN
  IF input->>'preferredFrom' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredFrom')='string'
   OR input->>'preferredTo' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredTo')='string' THEN
   RAISE EXCEPTION 'Dates must look like 2026-11-30' USING ERRCODE='23514'; END IF;
  from_date:=(input->>'preferredFrom')::date;to_date:=(input->>'preferredTo')::date;
  IF (from_date IS NOT NULL AND (from_date<current_date-1 OR from_date>current_date+730)) OR (to_date IS NOT NULL AND (from_date IS NULL OR to_date<from_date OR to_date>current_date+760)) THEN
   RAISE EXCEPTION 'Preferred dates are not usable' USING ERRCODE='23514'; END IF;
  SELECT * INTO cat FROM customer_private.service_catalogue_version v WHERE v.service_key=input->>'serviceKey' AND v.active
   AND v.version=(SELECT max(x.version) FROM customer_private.service_catalogue_version x WHERE x.service_key=v.service_key);
  IF NOT FOUND THEN RAISE EXCEPTION 'That service is not offered' USING ERRCODE='23514'; END IF;
  IF NOT (input->>'region')=ANY(cat.regions) THEN RAISE EXCEPTION 'That service is not offered in this region' USING ERRCODE='23514'; END IF;
  IF NOT customer_private.service_synthetic_ok(input->>'need',1000) THEN RAISE EXCEPTION 'Describe the need with invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  place_label:=customer_private.service_request_context(target,actor,input->>'contextKind',input->>'contextRef');
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request.open:'||target::text||':'||(input->>'contextKind')||':'||(input->>'contextRef')||':'||(input->>'serviceKey'),0));
  IF EXISTS(SELECT FROM customer_private.service_request x WHERE x.tenant_id=target AND x.context_kind=input->>'contextKind' AND x.context_ref=input->>'contextRef'
   AND x.service_key=input->>'serviceKey' AND customer_private.service_request_status_now(x.id) NOT IN ('declined','withdrawn','closed')) THEN
   RAISE EXCEPTION 'There is already an open request for this service here' USING ERRCODE='23505'; END IF;
  SELECT count(*) INTO open_count FROM customer_private.service_request x WHERE x.tenant_id=target AND customer_private.service_request_status_now(x.id) NOT IN ('declined','withdrawn','closed');
  IF open_count>=50 THEN RAISE EXCEPTION 'Too many open requests in this workspace' USING ERRCODE='23514'; END IF;
  req:=gen_random_uuid();
  INSERT INTO customer_private.service_request(id,tenant_id,created_by,context_kind,context_ref,context_label,service_key,service_version)
  VALUES(req,target,actor,input->>'contextKind',input->>'contextRef',place_label,cat.service_key,cat.version);
  INSERT INTO customer_private.service_request_need(request_id,version,need,preferred_from,preferred_to,region,created_by)
  VALUES(req,1,input->>'need',from_date,to_date,input->>'region',actor);
  PERFORM customer_private.service_request_record(req,'requested','customer',actor,NULL,NULL,NULL,NULL,NULL,NULL,1,command);
 ELSE
  req:=(input->>'requestId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||req::text,0));
  SELECT * INTO r FROM customer_private.service_request x WHERE x.id=req AND x.tenant_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
  PERFORM customer_private.service_request_settle(req);
  SELECT e.status_after INTO status FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1;
  note:=input->>'note';
  IF operation='revise' THEN
   IF status<>'requested' THEN RAISE EXCEPTION 'This request can no longer be edited' USING ERRCODE='23514'; END IF;
   SELECT * INTO n FROM customer_private.service_request_need x WHERE x.request_id=req ORDER BY version DESC LIMIT 1;
   IF n.version<>(input->>'expectedNeedVersion')::integer THEN RAISE EXCEPTION 'Request changed; reload and try again' USING ERRCODE='23514'; END IF;
   IF input->>'preferredFrom' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredFrom')='string'
    OR input->>'preferredTo' !~ '^\d{4}-\d{2}-\d{2}$' AND jsonb_typeof(input->'preferredTo')='string' THEN
    RAISE EXCEPTION 'Dates must look like 2026-11-30' USING ERRCODE='23514'; END IF;
   from_date:=(input->>'preferredFrom')::date;to_date:=(input->>'preferredTo')::date;
   IF (from_date IS NOT NULL AND (from_date<current_date-1 OR from_date>current_date+730)) OR (to_date IS NOT NULL AND (from_date IS NULL OR to_date<from_date OR to_date>current_date+760)) THEN
    RAISE EXCEPTION 'Preferred dates are not usable' USING ERRCODE='23514'; END IF;
   SELECT * INTO cat FROM customer_private.service_catalogue_version v WHERE v.service_key=r.service_key AND v.version=r.service_version;
   IF NOT (input->>'region')=ANY(cat.regions) THEN RAISE EXCEPTION 'That service is not offered in this region' USING ERRCODE='23514'; END IF;
   IF NOT customer_private.service_synthetic_ok(input->>'need',1000) THEN RAISE EXCEPTION 'Describe the need with invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   IF n.need=input->>'need' AND n.preferred_from IS NOT DISTINCT FROM from_date AND n.preferred_to IS NOT DISTINCT FROM to_date AND n.region=input->>'region' THEN
    RAISE EXCEPTION 'Nothing has changed' USING ERRCODE='23514'; END IF;
   new_version:=n.version+1;
   INSERT INTO customer_private.service_request_need(request_id,version,need,preferred_from,preferred_to,region,created_by)
   VALUES(req,new_version,input->>'need',from_date,to_date,input->>'region',actor);
   PERFORM customer_private.service_request_record(req,'revised','customer',actor,NULL,NULL,NULL,NULL,NULL,NULL,new_version,command);
  ELSIF operation='question' THEN
   PERFORM customer_private.service_request_record(req,'question','customer',actor,NULL,NULL,note,NULL,NULL,NULL,NULL,command);
  ELSIF operation='accept' THEN
   IF status='expired' THEN RAISE EXCEPTION 'This quote has expired; ask for a new one' USING ERRCODE='23514'; END IF;
   IF status<>'quoted' THEN RAISE EXCEPTION 'There is no open quote to accept' USING ERRCODE='23514'; END IF;
   SELECT * INTO q FROM customer_private.service_quote x WHERE x.request_id=req ORDER BY version DESC LIMIT 1;
   current_digest:=customer_private.service_quote_digest(q.id);
   IF q.version<>(input->>'quoteVersion')::integer OR current_digest<>input->>'quoteDigest' THEN RAISE EXCEPTION 'The quote changed; reload and review it again' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT FROM customer_private.service_quote_view v WHERE v.quote_id=q.id AND v.principal_id=actor AND v.digest=current_digest) THEN
    RAISE EXCEPTION 'Review the whole quote before accepting it' USING ERRCODE='23514'; END IF;
   SELECT t.fixed,t.estimated INTO fixed,estimated FROM customer_private.service_quote_totals(q.id) t;
   intent:=gen_random_uuid();
   INSERT INTO customer_private.service_order_intent(id,request_id,quote_id,quote_version,currency,fixed_total_minor,estimated_total_minor,quote_digest,accepted_by)
   VALUES(intent,req,q.id,q.version,q.currency,fixed,estimated,current_digest,actor);
   PERFORM customer_private.service_request_record(req,'accepted','customer',actor,NULL,NULL,NULL,NULL,q.id,intent,NULL,command);
  ELSIF operation='decline' THEN
   IF note IS NOT NULL AND NOT customer_private.service_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   PERFORM customer_private.service_request_record(req,'declined','customer',actor,NULL,NULL,note,NULL,NULL,NULL,NULL,command);
  ELSE
   IF note IS NOT NULL AND NOT customer_private.service_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
   PERFORM customer_private.service_request_record(req,'withdrawn','customer',actor,NULL,NULL,note,NULL,NULL,NULL,NULL,command);
  END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.service_request_summary(req)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',true);
 INSERT INTO customer_private.service_request_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

-- Staff side. The same protected staff authority as customer delivery: an owner or admin of a synthetic operator
-- workspace with a fresh authenticator check and a live session, read from the staff session, never from the caller.
CREATE FUNCTION customer_private.service_staff_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL','synthetic_validation'),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND synthetic) THEN RAISE EXCEPTION 'Service requests need an owner or admin with a fresh authenticator check' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id JOIN identity.principal p ON p.identity_id=s."userId"
 JOIN identity."user" u ON u.id=p.identity_id JOIN app.membership m ON m.user_id=p.id AND m.tenant_id=t
 WHERE p.id=actor AND p.disabled_at IS NULL AND u."twoFactorEnabled" AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
 AND p.operating_country=ANY(m.allowed_countries) AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
 AND encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '24 hours' AND a.verified_at>clock_timestamp()-interval '5 minutes'
 FOR SHARE OF s,a,p,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff assurance expired' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

-- Requests this staff workspace may see: ones nobody holds yet, and its own.
CREATE FUNCTION app.service_request_staff_list(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; items jsonb; next_id uuid; cursor_row customer_private.service_request;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO cursor_row FROM customer_private.service_request WHERE id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT r.id,r.created_at FROM customer_private.service_request r JOIN app.tenant w ON w.id=r.tenant_id AND w.synthetic
  LEFT JOIN customer_private.service_request_claim c ON c.request_id=r.id WHERE (c.request_id IS NULL OR c.staff_tenant_id=t)
  AND (after_id IS NULL OR (r.created_at,r.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY r.created_at DESC,r.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.service_request_summary(v.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w JOIN customer_private.service_request x ON x.tenant_id=w.id WHERE x.id=v.id),
   'claimed',EXISTS(SELECT FROM customer_private.service_request_claim c WHERE c.request_id=v.id)) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO items,next_id;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requests',items,'nextAfter',next_id,'synthetic',true);
END $$;

CREATE FUNCTION app.service_request_staff_view(request_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 r customer_private.service_request; c customer_private.service_catalogue_version; claim customer_private.service_request_claim; n customer_private.service_request_need;
 intent customer_private.service_order_intent; quotes jsonb; events jsonb; last_seq integer; needs jsonb;
BEGIN
 IF request_id IS NULL THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||request_id::text,0));
 SELECT * INTO r FROM customer_private.service_request x WHERE x.id=request_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO claim FROM customer_private.service_request_claim x WHERE x.request_id=r.id;
 IF FOUND AND claim.staff_tenant_id<>t THEN RAISE EXCEPTION 'Another team handles this request' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.service_request_settle(r.id);
 SELECT * INTO c FROM customer_private.service_catalogue_version v WHERE v.service_key=r.service_key AND v.version=r.service_version;
 SELECT * INTO n FROM customer_private.service_request_need x WHERE x.request_id=r.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO intent FROM customer_private.service_order_intent x WHERE x.request_id=r.id;
 SELECT coalesce(jsonb_agg(customer_private.service_quote_json(q.id) ORDER BY q.version),'[]'::jsonb) INTO quotes FROM customer_private.service_quote q WHERE q.request_id=r.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.created_at,'kind',e.kind,'status',e.status_after,'actorKind',e.actor_kind,
  'customerNote',e.customer_note,'internalNote',e.internal_note,'quoteVersion',(SELECT x.version FROM customer_private.service_quote x WHERE x.id=e.quote_id)) ORDER BY e.seq),'[]'::jsonb),max(e.seq) INTO events,last_seq
 FROM customer_private.service_request_event e WHERE e.request_id=r.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',x.version,'text',x.need,'preferredFrom',x.preferred_from,'preferredTo',x.preferred_to,'region',x.region,'at',x.created_at) ORDER BY x.version),'[]'::jsonb) INTO needs
 FROM customer_private.service_request_need x WHERE x.request_id=r.id;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('request',customer_private.service_request_summary(r.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=r.tenant_id),
  'claimedByThisTeam',claim.request_id IS NOT NULL,'serviceVersion',r.service_version),
 'service',jsonb_build_object('title',c.title,'included',to_jsonb(c.included),'excluded',to_jsonb(c.excluded),'regions',to_jsonb(c.regions),'quoteBasis',c.quote_basis),
 'need',jsonb_build_object('version',n.version,'text',n.need,'preferredFrom',n.preferred_from,'preferredTo',n.preferred_to,'region',n.region),'needs',needs,
 'quotes',quotes,'orderIntent',CASE WHEN intent.id IS NULL THEN NULL ELSE jsonb_build_object('id',intent.id,'quoteVersion',intent.quote_version,'currency',intent.currency,
  'fixedTotalMinor',intent.fixed_total_minor::text,'estimatedTotalMinor',intent.estimated_total_minor::text,'acceptedAt',intent.created_at,'paymentTaken',false,'billing',intent.billing) END,
 'events',events,'lastSeq',last_seq,'synthetic',true);
END $$;

CREATE FUNCTION app.service_request_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.service_request_staff_command; r customer_private.service_request; claim customer_private.service_request_claim; status text; last_seq integer;
 req uuid; q uuid; qv integer; component jsonb; position integer:=0; kind text; note text; internal text; result jsonb; currency text; valid timestamptz;
 has_tax boolean:=false; has_fee boolean:=false;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('quote','answer','start','update','deliver','close','note')
  OR jsonb_typeof(input->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedSeq') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Invalid staff service request command' USING ERRCODE='23514'; END IF;
 IF operation='quote' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['requestId','expectedSeq','currency','components','scope','exclusions','assumptions','deliveryTerms','paymentTerms','validUntil'],ARRAY[]::text[])
   OR jsonb_typeof(input->'currency') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'components') IS DISTINCT FROM 'array'
   OR jsonb_typeof(input->'scope') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'exclusions') IS DISTINCT FROM 'array'
   OR jsonb_typeof(input->'assumptions') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'deliveryTerms') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'paymentTerms') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'validUntil') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid quote' USING ERRCODE='23514'; END IF;
 ELSIF operation='note' THEN
  IF NOT customer_private.service_input_shape(input,ARRAY['requestId','expectedSeq','internalNote'],ARRAY[]::text[]) OR jsonb_typeof(input->'internalNote') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid staff note' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.service_input_shape(input,ARRAY['requestId','expectedSeq','customerNote'],ARRAY[]::text[]) OR jsonb_typeof(input->'customerNote') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid customer note' USING ERRCODE='23514'; END IF;
 END IF;
 req:=(input->>'requestId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_staff.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_request:'||req::text,0));
 SELECT * INTO prior FROM customer_private.service_request_staff_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO r FROM customer_private.service_request x WHERE x.id=req AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Service request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO claim FROM customer_private.service_request_claim x WHERE x.request_id=req;
 IF FOUND AND claim.staff_tenant_id<>t THEN RAISE EXCEPTION 'Another team handles this request' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.service_request_settle(req);
 SELECT e.status_after,e.seq INTO status,last_seq FROM customer_private.service_request_event e WHERE e.request_id=req ORDER BY e.seq DESC LIMIT 1;
 IF last_seq<>(input->>'expectedSeq')::integer THEN RAISE EXCEPTION 'The request changed; reload and try again' USING ERRCODE='23514'; END IF;
 IF NOT FOUND OR claim.request_id IS NULL THEN
  INSERT INTO customer_private.service_request_claim(request_id,staff_tenant_id,claimed_by) VALUES(req,t,actor) ON CONFLICT DO NOTHING;
 END IF;
 IF operation='quote' THEN
  IF status NOT IN ('requested','quoted','expired') THEN RAISE EXCEPTION 'A quote cannot be prepared at this stage' USING ERRCODE='23514'; END IF;
  currency:=input->>'currency';
  IF NOT EXISTS(SELECT FROM app.currency c WHERE c.code=currency) THEN RAISE EXCEPTION 'Choose a supported currency' USING ERRCODE='23514'; END IF;
  IF input->>'validUntil' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'Validity must be an exact UTC time' USING ERRCODE='23514'; END IF;
  valid:=(input->>'validUntil')::timestamptz;
  IF jsonb_array_length(input->'components') NOT BETWEEN 1 AND 12 OR jsonb_array_length(input->'exclusions') NOT BETWEEN 1 AND 12 OR jsonb_array_length(input->'assumptions') NOT BETWEEN 1 AND 12
   OR EXISTS(SELECT FROM jsonb_array_elements(input->'exclusions') x WHERE jsonb_typeof(x)<>'string')
   OR EXISTS(SELECT FROM jsonb_array_elements(input->'assumptions') x WHERE jsonb_typeof(x)<>'string') THEN
   RAISE EXCEPTION 'A quote needs priced components, at least one exclusion and at least one assumption' USING ERRCODE='23514'; END IF;
  IF valid<=clock_timestamp() OR valid>clock_timestamp()+interval '90 days' THEN RAISE EXCEPTION 'Validity must be in the future and within 90 days' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(x.version),0)+1 INTO qv FROM customer_private.service_quote x WHERE x.request_id=req;
  q:=gen_random_uuid();
  INSERT INTO customer_private.service_quote(id,request_id,version,currency,scope,exclusions,assumptions,delivery_terms,payment_terms,valid_until,prepared_by,staff_tenant_id)
  VALUES(q,req,qv,currency,input->>'scope',
   ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'exclusions') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
   ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'assumptions') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
   input->>'deliveryTerms',input->>'paymentTerms',valid,actor,t);
  FOR component IN SELECT value FROM jsonb_array_elements(input->'components') LOOP
   position:=position+1;
   IF NOT customer_private.service_input_shape(component,ARRAY['kind','label','treatment','amountMinor'],ARRAY[]::text[])
    OR jsonb_typeof(component->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(component->'label') IS DISTINCT FROM 'string'
    OR jsonb_typeof(component->'treatment') IS DISTINCT FROM 'string' OR jsonb_typeof(component->'amountMinor') NOT IN ('string','null')
    OR (jsonb_typeof(component->'amountMinor')='string' AND component->>'amountMinor' !~ '^(0|[1-9][0-9]{0,10})$') THEN
    RAISE EXCEPTION 'Each component needs a kind, label, treatment and an exact whole-number amount' USING ERRCODE='23514'; END IF;
   INSERT INTO customer_private.service_quote_component(quote_id,position,kind,label,treatment,amount_minor)
   VALUES(q,position,component->>'kind',component->>'label',component->>'treatment',(component->>'amountMinor')::bigint);
   IF component->>'kind'='tax' THEN has_tax:=true; END IF;
   IF component->>'kind'='service_fee' AND component->>'treatment'='included' THEN has_fee:=true; END IF;
  END LOOP;
  IF NOT has_fee OR NOT has_tax THEN RAISE EXCEPTION 'A quote needs a priced service fee and a stated tax line' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.service_request_record(req,'quoted','staff',NULL,actor,t,NULL,NULL,q,NULL,NULL,command);
 ELSIF operation='note' THEN
  internal:=input->>'internalNote';
  PERFORM customer_private.service_request_record(req,'internal_note','staff',NULL,actor,t,NULL,internal,NULL,NULL,NULL,command);
 ELSE
  note:=input->>'customerNote';
  kind:=CASE operation WHEN 'answer' THEN 'answer' WHEN 'start' THEN 'started' WHEN 'update' THEN 'update' WHEN 'deliver' THEN 'delivered' ELSE 'closed' END;
  PERFORM customer_private.service_request_record(req,kind,'staff',NULL,actor,t,note,NULL,NULL,NULL,NULL,command);
 END IF;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.service_request_summary(req)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',true);
 INSERT INTO customer_private.service_request_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

-- Catalogue maintenance by staff: a new immutable version per change, or a retirement.
CREATE FUNCTION app.service_catalogue_staff_list() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor();
BEGIN
 RETURN jsonb_build_object('services',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',v.service_key,'version',v.version,'title',v.title,'summary',v.summary,
  'included',to_jsonb(v.included),'excluded',to_jsonb(v.excluded),'regions',to_jsonb(v.regions),'quoteBasis',v.quote_basis,'active',v.active,'source',v.source) ORDER BY v.title,v.service_key),'[]'::jsonb)
  FROM customer_private.service_catalogue_version v WHERE v.version=(SELECT max(x.version) FROM customer_private.service_catalogue_version x WHERE x.service_key=v.service_key)),'synthetic',true);
END $$;

CREATE FUNCTION app.service_catalogue_staff_command(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.service_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; prior customer_private.service_request_staff_command;
 head integer; key text; v customer_private.service_catalogue_version; executor uuid; eid uuid:=gen_random_uuid(); result jsonb;
BEGIN
 IF command IS NULL OR NOT customer_private.service_input_shape(input,ARRAY['serviceKey','expectedVersion','title','summary','included','excluded','regions','quoteBasis','active'],ARRAY[]::text[])
  OR jsonb_typeof(input->'serviceKey') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number'
  OR jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'summary') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'included') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'excluded') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'regions') IS DISTINCT FROM 'array'
  OR jsonb_typeof(input->'quoteBasis') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'active') IS DISTINCT FROM 'boolean'
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'included') x WHERE jsonb_typeof(x)<>'string')
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'excluded') x WHERE jsonb_typeof(x)<>'string')
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'regions') x WHERE jsonb_typeof(x)<>'string') THEN
  RAISE EXCEPTION 'Invalid service entry' USING ERRCODE='23514'; END IF;
 key:=input->>'serviceKey';
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_staff.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.service_catalogue:'||key,0));
 SELECT * INTO prior FROM customer_private.service_request_staff_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>'catalogue' OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT coalesce(max(x.version),0) INTO head FROM customer_private.service_catalogue_version x WHERE x.service_key=key;
 IF head<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'The service changed; reload and try again' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.service_catalogue_version(service_key,version,title,summary,included,excluded,regions,quote_basis,active,source,created_by,staff_tenant_id)
 VALUES(key,head+1,input->>'title',input->>'summary',
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'included') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'excluded') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'regions') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  input->>'quoteBasis',(input->>'active')::boolean,'STAFF',actor,t) RETURNING * INTO v;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,t,'customer.service_catalogue.revised',1,'customer_service_catalogue',key,v.version,actor,clock_timestamp(),command,command,
 jsonb_build_object('serviceKey',key,'version',v.version,'active',v.active,'synthetic',true,'initiator_kind','staff','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),t,eid,actor,'customer.service_catalogue.revised');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),t,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,t);
 result:=jsonb_build_object('serviceKey',key,'version',v.version,'active',v.active,'commandId',command,'synthetic',true);
 INSERT INTO customer_private.service_request_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,'catalogue',input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.service_request_role(uuid,uuid),customer_private.service_request_next(text,text),
 customer_private.service_quote_complete(uuid),customer_private.service_quote_digest(uuid),customer_private.service_quote_totals(uuid),
 customer_private.service_quote_json(uuid),customer_private.service_request_status_now(uuid),
 customer_private.service_request_emit(uuid,integer,text,text,text,uuid,integer,uuid),
 customer_private.service_request_record(uuid,text,text,uuid,uuid,uuid,text,text,uuid,uuid,integer,uuid),
 customer_private.service_request_event_guard(),customer_private.service_quote_complete_guard(),customer_private.service_request_settle(uuid),
 customer_private.service_request_summary(uuid),customer_private.service_request_context(uuid,uuid,text,text),customer_private.service_staff_actor()
 FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.service_catalogue(),customer.service_request_list(uuid,text,text,uuid,integer),customer.service_request_view(uuid,uuid),
 customer.service_request_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
REVOKE ALL ON FUNCTION app.service_request_staff_list(uuid,integer),app.service_request_staff_view(uuid),app.service_request_staff_command(uuid,text,jsonb),
 app.service_catalogue_staff_list(),app.service_catalogue_staff_command(uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.service_catalogue(),customer.service_request_list(uuid,text,text,uuid,integer),customer.service_request_view(uuid,uuid),
 customer.service_request_command(uuid,text,jsonb),app.service_request_staff_list(uuid,integer),app.service_request_staff_view(uuid),
 app.service_request_staff_command(uuid,text,jsonb),app.service_catalogue_staff_list(),app.service_catalogue_staff_command(uuid,jsonb) TO corridra_runtime;
