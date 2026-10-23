-- Optional additive module: synthetic billing plans, subscriptions and entitlements (billing slice 1, ADR-059).
-- A subscription here is a record that a synthetic workspace holds a plan for a stated period. Nothing is charged:
-- there is no payment, invoice, card, tax number or contact detail in this module and none can be stored.
-- Entitlements record what a plan grants; no other module reads them, so they restrict nothing.
-- Every history table is append-only. Existing tables, functions and policies are not replaced.

-- Text rules shared by the table checks below. They hold no data and are not callable by the runtime logins.
CREATE FUNCTION customer_private.billing_text_ok(t text,min_len integer,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT t IS NOT NULL AND t=btrim(t) AND length(t) BETWEEN min_len AND max_len AND t !~ '[[:cntrl:]]'
$$;
-- Free text that staff write about a subscription must be invented: it begins with "Synthetic ".
CREATE FUNCTION customer_private.billing_synthetic_ok(t text,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT customer_private.billing_text_ok(t,11,max_len) AND t LIKE 'Synthetic %'
$$;
-- Plan wording is staff-maintained reference text: plain, no links and no contact details.
CREATE FUNCTION customer_private.billing_plain_ok(t text,min_len integer,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT customer_private.billing_text_ok(t,min_len,max_len) AND t !~ '(://|@|www\.)'
$$;
CREATE FUNCTION customer_private.billing_list_ok(a text[],max_items integer,min_len integer,max_len integer) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT a IS NOT NULL AND array_ndims(a)=1 AND cardinality(a) BETWEEN 1 AND max_items
 AND NOT EXISTS(SELECT FROM unnest(a) e WHERE e IS NULL OR NOT customer_private.billing_plain_ok(e,min_len,max_len))
 AND (SELECT count(DISTINCT lower(e)) FROM unnest(a) e)=cardinality(a)
$$;
CREATE FUNCTION customer_private.billing_input_shape(input jsonb,required text[],optional text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(input)='object' AND input ?& required AND (input-(required||optional))='{}'::jsonb
$$;
-- Dates are computed in UTC so that every reader and the guards agree on "today".
CREATE FUNCTION customer_private.billing_today() RETURNS date
 LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date
$$;
-- A period runs from its start date up to, not including, the same day one month or one year later.
CREATE FUNCTION customer_private.billing_period_end(start_day date,billing_interval text) RETURNS date
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT (start_day + CASE billing_interval WHEN 'month' THEN interval '1 month' WHEN 'year' THEN interval '1 year' END)::date
$$;
REVOKE ALL ON FUNCTION customer_private.billing_text_ok(text,integer,integer),customer_private.billing_synthetic_ok(text,integer),
 customer_private.billing_plain_ok(text,integer,integer),customer_private.billing_list_ok(text[],integer,integer,integer),
 customer_private.billing_input_shape(jsonb,text[],text[]),customer_private.billing_today(),
 customer_private.billing_period_end(date,text) FROM PUBLIC,corridra_runtime,corridra_auth;

-- The closed list of things a plan can grant. Each is something the product already does.
CREATE TABLE customer_private.billing_entitlement_key (
 key text PRIMARY KEY CHECK(key ~ '^[a-z][a-z_]{2,39}$'),
 unit text NOT NULL CHECK(unit IN ('count','flag')),
 label text NOT NULL CHECK(customer_private.billing_plain_ok(label,3,80)),
 description text NOT NULL CHECK(customer_private.billing_plain_ok(description,10,240)),
 UNIQUE(key,unit)
);

-- Staff-maintained plan catalogue, one immutable row per version. Customers read the latest active version only.
CREATE TABLE customer_private.billing_plan_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_key text NOT NULL CHECK(plan_key ~ '^[a-z][a-z0-9-]{2,59}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 title text NOT NULL CHECK(customer_private.billing_plain_ok(title,3,120) AND title ~* '(sample|synthetic)'),
 summary text NOT NULL CHECK(customer_private.billing_plain_ok(summary,10,400)),
 billing_interval text NOT NULL CHECK(billing_interval IN ('month','year')),
 price_minor bigint NOT NULL CHECK(price_minor BETWEEN 0 AND 99999999999),
 currency text NOT NULL REFERENCES app.currency(code),
 tax_treatment text NOT NULL CHECK(tax_treatment IN ('price_excludes_tax','price_includes_tax','tax_to_be_confirmed')),
 included text[] NOT NULL CHECK(customer_private.billing_list_ok(included,12,3,200)),
 excluded text[] NOT NULL CHECK(customer_private.billing_list_ok(excluded,12,3,200)),
 active boolean NOT NULL,
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 source text NOT NULL CHECK(source IN ('SEED','STAFF')),
 created_by uuid REFERENCES identity.principal(id),
 staff_tenant_id uuid REFERENCES app.tenant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(plan_key,version),UNIQUE(id,billing_interval),
 CHECK((source='SEED' AND created_by IS NULL AND staff_tenant_id IS NULL) OR (source='STAFF' AND created_by IS NOT NULL AND staff_tenant_id IS NOT NULL))
);
-- What a plan version grants. The unit of the key decides which modes are possible.
CREATE TABLE customer_private.billing_plan_entitlement (
 plan_id uuid NOT NULL REFERENCES customer_private.billing_plan_version(id),
 entitlement_key text NOT NULL,
 unit text NOT NULL,
 mode text NOT NULL,
 limit_count integer,
 PRIMARY KEY(plan_id,entitlement_key),
 FOREIGN KEY(entitlement_key,unit) REFERENCES customer_private.billing_entitlement_key(key,unit),
 CHECK((unit='count' AND mode IN ('limit','unlimited')) OR (unit='flag' AND mode IN ('included','excluded'))),
 CHECK((mode='limit') = (limit_count IS NOT NULL)),
 CHECK(limit_count IS NULL OR limit_count BETWEEN 0 AND 100000)
);
-- A writer cannot request a plan version that they have not been shown.
CREATE TABLE customer_private.billing_plan_view (
 plan_id uuid NOT NULL REFERENCES customer_private.billing_plan_version(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(plan_id,principal_id)
);

-- The subscription record: which workspace asked for which exact plan version. Never edited.
CREATE TABLE customer_private.billing_subscription (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 created_by uuid NOT NULL REFERENCES customer_private.principal(id),
 plan_id uuid NOT NULL,
 billing_interval text NOT NULL,
 plan_digest text NOT NULL CHECK(plan_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(plan_id,billing_interval) REFERENCES customer_private.billing_plan_version(id,billing_interval)
);
CREATE INDEX billing_subscription_workspace ON customer_private.billing_subscription(tenant_id,created_at DESC,id DESC);

-- The timeline. Statuses only ever move forward by appending a row; the row after a row decides the status.
CREATE TABLE customer_private.billing_subscription_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES customer_private.billing_subscription(id),
 tenant_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 500),
 kind text NOT NULL CHECK(kind IN ('requested','activated','renewed','declined','withdrawn','cancel_requested','cancel_withdrawn','ended','internal_note')),
 status_after text NOT NULL CHECK(status_after IN ('requested','active','cancel_scheduled','declined','withdrawn','ended')),
 actor_kind text NOT NULL CHECK(actor_kind IN ('customer','staff','system')),
 customer_actor uuid REFERENCES customer_private.principal(id),
 staff_actor uuid REFERENCES identity.principal(id),
 staff_tenant_id uuid REFERENCES app.tenant(id),
 customer_note text CHECK(customer_note IS NULL OR customer_private.billing_synthetic_ok(customer_note,1000)),
 internal_note text CHECK(internal_note IS NULL OR customer_private.billing_synthetic_ok(internal_note,1000)),
 period_start date,
 period_end date,
 end_reason text CHECK(end_reason IN ('ended_by_team','replaced','period_elapsed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(subscription_id,seq),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES customer_private.billing_subscription(tenant_id,id),
 CHECK((actor_kind='customer' AND customer_actor IS NOT NULL AND staff_actor IS NULL AND staff_tenant_id IS NULL)
  OR (actor_kind='staff' AND customer_actor IS NULL AND staff_actor IS NOT NULL AND staff_tenant_id IS NOT NULL)
  OR (actor_kind='system' AND customer_actor IS NULL AND staff_actor IS NULL AND staff_tenant_id IS NULL)),
 CHECK(kind IN ('requested','withdrawn','cancel_requested','cancel_withdrawn') = (actor_kind='customer')),
 CHECK(kind NOT IN ('activated','renewed','declined','internal_note') OR actor_kind='staff'),
 CHECK(kind<>'ended' OR actor_kind IN ('staff','system')),
 CHECK(kind<>'ended' OR (actor_kind='system' AND end_reason='period_elapsed') OR (actor_kind='staff' AND end_reason IN ('ended_by_team','replaced'))),
 CHECK(kind='ended' OR end_reason IS NULL),
 CHECK((kind='internal_note') = (internal_note IS NOT NULL)),
 CHECK(customer_note IS NULL OR (actor_kind='staff' AND kind IN ('activated','renewed','declined','ended'))),
 CHECK(kind<>'declined' OR customer_note IS NOT NULL),
 CHECK(end_reason IS DISTINCT FROM 'ended_by_team' OR customer_note IS NOT NULL),
 CHECK((kind IN ('activated','renewed')) = (period_start IS NOT NULL)),
 CHECK((period_start IS NULL) = (period_end IS NULL)),
 CHECK(period_end IS NULL OR period_end>period_start)
);
CREATE INDEX billing_subscription_event_latest ON customer_private.billing_subscription_event(subscription_id,seq DESC);

-- Customer commands are keyed by (customer, command id); staff commands by (staff person, command id).
CREATE TABLE customer_private.billing_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('request','withdraw','cancel','keep')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE customer_private.billing_staff_command (
 actor_id uuid NOT NULL REFERENCES identity.principal(id),command_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('activate','renew','decline','end','note','plan')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);

CREATE TRIGGER billing_entitlement_key_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_entitlement_key FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_plan_version_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_plan_version FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_plan_entitlement_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_plan_entitlement FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_plan_view_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_plan_view FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_subscription_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_subscription FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_subscription_event_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_subscription_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_command_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER billing_staff_command_immutable BEFORE UPDATE OR DELETE ON customer_private.billing_staff_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.billing_entitlement_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_plan_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_plan_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_plan_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_subscription_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.billing_staff_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.billing_entitlement_key,customer_private.billing_plan_version,customer_private.billing_plan_entitlement,
 customer_private.billing_plan_view,customer_private.billing_subscription,customer_private.billing_subscription_event,
 customer_private.billing_command,customer_private.billing_staff_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Five things the product already does. A plan version must say something about every one of them.
INSERT INTO customer_private.billing_entitlement_key(key,unit,label,description) VALUES
('workspace_members','count','People in the workspace','How many people can belong to the workspace, counting its owner.'),
('active_programmes','count','Active delegation programmes','How many delegation programmes the workspace can run at the same time.'),
('programme_participants','count','Participants in each programme','How many participants one programme can hold, waiting list excluded.'),
('open_service_requests','count','Open help requests','How many paid-service help requests can be open at once.'),
('report_exports','flag','Programme report exports','Whether programme reports can be exported as files.');

-- Three invented example plans so the catalogue is not empty. Titles say they are examples; the prices are invented.
INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,source) VALUES
('example-starter',1,'Starter workspace (sample plan)',
 'A free example plan for one small team. It exists to show how a plan reads and is not an offer.','month',0,'USD','tax_to_be_confirmed',
 ARRAY['A shared workspace for a small team','One delegation programme at a time','Plain-language reports on screen'],
 ARRAY['Programme report exports','Help requests','Any support commitment'],true,'SEED'),
('example-organiser',1,'Organiser monthly (sample plan)',
 'An example monthly plan for a delegation organiser. The price is invented and is not an offer.','month',4900,'USD','price_excludes_tax',
 ARRAY['A shared workspace for a larger team','Several delegation programmes at the same time','Report exports for each programme','Help requests, quoted separately'],
 ARRAY['The cost of any help request','Payment collection from participants','Travel, visas and accommodation'],true,'SEED'),
('example-organiser-bdt',1,'Organiser monthly in taka (sample plan)',
 'The same example organiser plan priced in Bangladeshi taka. The price is invented and is not an offer.','month',480000,'BDT','tax_to_be_confirmed',
 ARRAY['A shared workspace for a larger team','Several delegation programmes at the same time','Report exports for each programme'],
 ARRAY['The cost of any help request','Payment collection from participants','Currency conversion of any kind'],true,'SEED');
INSERT INTO customer_private.billing_plan_entitlement(plan_id,entitlement_key,unit,mode,limit_count)
SELECT p.id,k.key,k.unit,
 CASE WHEN k.unit='flag' THEN CASE WHEN p.plan_key='example-starter' THEN 'excluded' ELSE 'included' END
      WHEN p.plan_key='example-starter' THEN 'limit' WHEN k.key IN ('workspace_members','active_programmes') AND p.plan_key<>'example-starter' THEN 'limit' ELSE 'unlimited' END,
 CASE WHEN k.unit='flag' THEN NULL
      WHEN p.plan_key='example-starter' THEN CASE k.key WHEN 'workspace_members' THEN 3 WHEN 'active_programmes' THEN 1 WHEN 'programme_participants' THEN 15 ELSE 0 END
      WHEN k.key='workspace_members' THEN 10 WHEN k.key='active_programmes' THEN 6 ELSE NULL END
FROM customer_private.billing_plan_version p CROSS JOIN customer_private.billing_entitlement_key k WHERE p.source='SEED';

-- The role of the current actor in a workspace: writer (owner or admin), reader (member) or NULL. A workspace that
-- is not synthetic has no billing role at all, so every function below refuses it.
CREATE FUNCTION customer_private.billing_role(target uuid,actor uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(SELECT FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id WHERE w.tenant_id=target AND t.synthetic)
  THEN customer_private.organisation_profile_role(target,actor) END
$$;

-- Allowed moves between statuses. NULL means the move is not allowed.
CREATE FUNCTION customer_private.billing_next(prev text,kind text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN kind='requested' THEN CASE WHEN prev IS NULL THEN 'requested' END
  WHEN prev IS NULL OR prev IN ('declined','withdrawn','ended') THEN NULL
  WHEN kind='activated' THEN CASE WHEN prev='requested' THEN 'active' END
  WHEN kind='declined' THEN CASE WHEN prev='requested' THEN 'declined' END
  WHEN kind='withdrawn' THEN CASE WHEN prev='requested' THEN 'withdrawn' END
  WHEN kind='renewed' THEN CASE WHEN prev='active' THEN 'active' END
  WHEN kind='cancel_requested' THEN CASE WHEN prev='active' THEN 'cancel_scheduled' END
  WHEN kind='cancel_withdrawn' THEN CASE WHEN prev='cancel_scheduled' THEN 'active' END
  WHEN kind='ended' THEN CASE WHEN prev IN ('active','cancel_scheduled') THEN 'ended' END
  WHEN kind='internal_note' THEN prev
 END
$$;

-- The exact plan content a customer is shown, fingerprinted. A request must quote this back.
CREATE FUNCTION customer_private.billing_plan_digest(plan uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',p.id,'key',p.plan_key,'version',p.version,'title',p.title,'summary',p.summary,
  'interval',p.billing_interval,'priceMinor',p.price_minor::text,'currency',p.currency,'taxTreatment',p.tax_treatment,
  'included',to_jsonb(p.included),'excluded',to_jsonb(p.excluded),
  'entitlements',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',e.entitlement_key,'mode',e.mode,'limit',e.limit_count) ORDER BY e.entitlement_key),'[]'::jsonb)
   FROM customer_private.billing_plan_entitlement e WHERE e.plan_id=p.id))::text,'UTF8')),'hex')
 FROM customer_private.billing_plan_version p WHERE p.id=plan
$$;
-- One plan version as customers and staff see it: price, tax treatment, what is in and out, every entitlement.
CREATE FUNCTION customer_private.billing_plan_json(plan uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',p.id,'key',p.plan_key,'version',p.version,'title',p.title,'summary',p.summary,'interval',p.billing_interval,
  'priceMinor',p.price_minor::text,'currency',p.currency,'taxTreatment',p.tax_treatment,'included',to_jsonb(p.included),'excluded',to_jsonb(p.excluded),
  'entitlements',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',e.entitlement_key,'label',k.label,'description',k.description,'unit',e.unit,'mode',e.mode,'limit',e.limit_count) ORDER BY e.entitlement_key),'[]'::jsonb)
   FROM customer_private.billing_plan_entitlement e JOIN customer_private.billing_entitlement_key k ON k.key=e.entitlement_key WHERE e.plan_id=p.id),
  'digest',customer_private.billing_plan_digest(p.id),'active',p.active,'synthetic',true,'invoicing','not_enabled','paymentTaken',false)
 FROM customer_private.billing_plan_version p WHERE p.id=plan
$$;

-- A plan version never stands alone: at commit it must say something about every entitlement.
CREATE FUNCTION customer_private.billing_plan_complete_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT count(*) FROM customer_private.billing_plan_entitlement e WHERE e.plan_id=NEW.id)<>(SELECT count(*) FROM customer_private.billing_entitlement_key) THEN
  RAISE EXCEPTION 'A plan must state every entitlement' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER billing_plan_complete AFTER INSERT ON customer_private.billing_plan_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_private.billing_plan_complete_guard();

-- Current status and current period of a subscription, read from its timeline.
CREATE FUNCTION customer_private.billing_status(sub uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.status_after FROM customer_private.billing_subscription_event e WHERE e.subscription_id=sub ORDER BY e.seq DESC LIMIT 1
$$;
CREATE FUNCTION customer_private.billing_period(sub uuid) RETURNS TABLE(period_start date,period_end date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.period_start,e.period_end FROM customer_private.billing_subscription_event e WHERE e.subscription_id=sub AND e.period_start IS NOT NULL ORDER BY e.seq DESC LIMIT 1
$$;

-- One domain event, audit event and outbox row per real change. The payload carries ids and versions only.
CREATE FUNCTION customer_private.billing_emit(sub uuid,seq integer,kind text,status text,actor_kind text,initiator uuid,command uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid; eid uuid:=gen_random_uuid(); target uuid; event_actor uuid; plan_key text; plan_version integer;
BEGIN
 SELECT s.tenant_id,p.plan_key,p.version INTO target,plan_key,plan_version FROM customer_private.billing_subscription s
 JOIN customer_private.billing_plan_version p ON p.id=s.plan_id WHERE s.id=sub;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF target IS NULL OR executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 -- A staff change is attributed to the staff person; customer and system changes to the service executor.
 event_actor:=CASE WHEN actor_kind='staff' THEN initiator ELSE executor END;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.billing.subscription.'||kind,1,'customer_billing_subscription',sub::text,seq,event_actor,clock_timestamp(),command,command,
 jsonb_strip_nulls(jsonb_build_object('subscriptionId',sub,'seq',seq,'status',status,'planKey',plan_key,'planVersion',plan_version,'synthetic',true,'initiator_kind',actor_kind,'initiator_id',initiator)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,event_actor,'customer.billing.subscription.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- Appends one timeline row (the guard below checks it) and its event chain. Callers hold the workspace lock.
CREATE FUNCTION customer_private.billing_record(sub uuid,kind text,actor_kind text,customer_actor uuid,staff_actor uuid,staff_tenant uuid,
 customer_note text,internal_note text,period_start date,period_end date,end_reason text,command uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid; prev text; next_seq integer; next_status text; initiator uuid;
BEGIN
 SELECT tenant_id INTO target FROM customer_private.billing_subscription WHERE id=sub;
 SELECT e.status_after,e.seq INTO prev,next_seq FROM customer_private.billing_subscription_event e WHERE e.subscription_id=sub ORDER BY e.seq DESC LIMIT 1;
 next_seq:=coalesce(next_seq,0)+1;
 next_status:=customer_private.billing_next(prev,kind);
 IF target IS NULL OR next_status IS NULL THEN RAISE EXCEPTION 'That change is not available for this subscription now' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor,staff_actor,staff_tenant_id,customer_note,internal_note,period_start,period_end,end_reason)
 VALUES(sub,target,next_seq,kind,next_status,actor_kind,customer_actor,staff_actor,staff_tenant,customer_note,internal_note,period_start,period_end,end_reason);
 initiator:=CASE actor_kind WHEN 'customer' THEN customer_actor WHEN 'staff' THEN staff_actor END;
 PERFORM customer_private.billing_emit(sub,next_seq,kind,next_status,actor_kind,initiator,command);
 RETURN next_seq;
END $$;

-- Database guard on the timeline, for every writer: sequence, allowed move, synthetic workspace, and the period,
-- one-open-request and one-held-plan rules.
CREATE FUNCTION customer_private.billing_event_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev customer_private.billing_subscription_event; found_prev boolean; expected text; s customer_private.billing_subscription;
 last_end date; today date:=customer_private.billing_today();
BEGIN
 SELECT * INTO prev FROM customer_private.billing_subscription_event WHERE subscription_id=NEW.subscription_id ORDER BY seq DESC LIMIT 1;
 found_prev:=FOUND;
 IF (NOT found_prev AND NEW.seq<>1) OR (found_prev AND NEW.seq<>prev.seq+1) THEN RAISE EXCEPTION 'Timeline entries must follow in order' USING ERRCODE='23514'; END IF;
 expected:=customer_private.billing_next(CASE WHEN found_prev THEN prev.status_after END,NEW.kind);
 IF expected IS NULL OR expected<>NEW.status_after THEN RAISE EXCEPTION 'That change is not available for this subscription now' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM customer_private.billing_subscription WHERE id=NEW.subscription_id;
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=s.tenant_id AND t.synthetic) THEN RAISE EXCEPTION 'Billing records are synthetic only' USING ERRCODE='42501'; END IF;
 SELECT e.period_end INTO last_end FROM customer_private.billing_subscription_event e WHERE e.subscription_id=NEW.subscription_id AND e.period_start IS NOT NULL ORDER BY e.seq DESC LIMIT 1;
 IF NEW.kind='requested' THEN
  IF EXISTS(SELECT FROM customer_private.billing_subscription x WHERE x.tenant_id=s.tenant_id AND x.id<>s.id AND customer_private.billing_status(x.id)='requested') THEN
   RAISE EXCEPTION 'There is already an open plan request in this workspace' USING ERRCODE='23505'; END IF;
 ELSIF NEW.kind='activated' THEN
  IF NEW.period_start<today-1 OR NEW.period_start>today+31 OR NEW.period_end<>customer_private.billing_period_end(NEW.period_start,s.billing_interval) THEN
   RAISE EXCEPTION 'The period must start within a month of today and last one full interval' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.billing_subscription x WHERE x.tenant_id=s.tenant_id AND x.id<>s.id AND customer_private.billing_status(x.id) IN ('active','cancel_scheduled')) THEN
   RAISE EXCEPTION 'This workspace already holds a plan' USING ERRCODE='23505'; END IF;
 ELSIF NEW.kind='renewed' THEN
  IF NEW.period_start IS DISTINCT FROM last_end OR NEW.period_end<>customer_private.billing_period_end(NEW.period_start,s.billing_interval) OR NEW.period_start>today+31 THEN
   RAISE EXCEPTION 'A renewal starts when the period ends and may be booked 31 days ahead at most' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='cancel_requested' THEN
  IF last_end IS NULL OR last_end<=today THEN RAISE EXCEPTION 'The current period has ended' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='cancel_withdrawn' THEN
  IF last_end IS NULL OR last_end<=today THEN RAISE EXCEPTION 'The current period has ended' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='ended' AND NEW.actor_kind='system' THEN
  IF prev.status_after<>'cancel_scheduled' OR last_end IS NULL OR last_end>today THEN RAISE EXCEPTION 'The period has not ended' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_event_guard BEFORE INSERT ON customer_private.billing_subscription_event FOR EACH ROW EXECUTE FUNCTION customer_private.billing_event_guard();

-- Writes the "ended" entry the first time anyone looks at a subscription whose scheduled cancellation has arrived.
CREATE FUNCTION customer_private.billing_settle(sub uuid) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE status text; last_end date;
BEGIN
 status:=customer_private.billing_status(sub);
 IF status IS DISTINCT FROM 'cancel_scheduled' THEN RETURN; END IF;
 SELECT period_end INTO last_end FROM customer_private.billing_period(sub);
 IF last_end IS NOT NULL AND last_end<=customer_private.billing_today() THEN
  PERFORM customer_private.billing_record(sub,'ended','system',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'period_elapsed',gen_random_uuid());
 END IF;
END $$;

CREATE FUNCTION customer_private.billing_summary(sub uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s customer_private.billing_subscription; p customer_private.billing_plan_version; st text; ps date; pe date;
BEGIN
 SELECT * INTO s FROM customer_private.billing_subscription WHERE id=sub;
 SELECT * INTO p FROM customer_private.billing_plan_version WHERE id=s.plan_id;
 st:=customer_private.billing_status(sub);
 SELECT x.period_start,x.period_end INTO ps,pe FROM customer_private.billing_period(sub) x;
 RETURN jsonb_build_object('id',s.id,'workspaceId',s.tenant_id,'planKey',p.plan_key,'planVersion',p.version,'planTitle',p.title,'interval',p.billing_interval,
  'priceMinor',p.price_minor::text,'currency',p.currency,'taxTreatment',p.tax_treatment,'status',st,'periodStart',ps,'periodEnd',pe,
  'periodElapsed',st IN ('active','cancel_scheduled') AND pe IS NOT NULL AND pe<=customer_private.billing_today(),
  'createdAt',s.created_at,
  'updatedAt',(SELECT max(e.created_at) FROM customer_private.billing_subscription_event e WHERE e.subscription_id=sub AND e.kind<>'internal_note'));
END $$;

-- Customers read the catalogue as a workspace member. A writer who is shown a plan has that showing recorded.
CREATE FUNCTION customer.billing_plans(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); access text; items jsonb;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.billing_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.billing_plan_json(p.id) ORDER BY p.title,p.plan_key),'[]'::jsonb) INTO items
 FROM customer_private.billing_plan_version p WHERE p.active
 AND p.version=(SELECT max(x.version) FROM customer_private.billing_plan_version x WHERE x.plan_key=p.plan_key);
 IF access='writer' THEN
  INSERT INTO customer_private.billing_plan_view(plan_id,principal_id,digest)
  SELECT (i->>'id')::uuid,actor,i->>'digest' FROM jsonb_array_elements(items) i ON CONFLICT DO NOTHING;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.billing_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canRequest',access='writer','plans',items,'entitlementsEnforced',false,'invoicing','not_enabled',
  'paymentTaken',false,'synthetic',true,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

CREATE FUNCTION customer.billing_overview(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); access text; sub record; holding uuid; pending uuid; subs jsonb:='[]'::jsonb; cur jsonb; pend jsonb; ents jsonb:='[]'::jsonb;
 timeline jsonb; actions jsonb:='[]'::jsonb; sub_status text; elapsed boolean:=false; held_plan uuid;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.billing_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.workspace:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.billing_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 FOR sub IN SELECT s.id FROM customer_private.billing_subscription s WHERE s.tenant_id=target ORDER BY s.created_at DESC,s.id DESC LIMIT 50 LOOP
  PERFORM customer_private.billing_settle(sub.id);
 END LOOP;
 FOR sub IN SELECT s.id,s.plan_id FROM customer_private.billing_subscription s WHERE s.tenant_id=target ORDER BY s.created_at DESC,s.id DESC LIMIT 50 LOOP
  -- Internal staff notes are never selected here.
  SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.created_at,'kind',e.kind,'status',e.status_after,
   'by',CASE e.actor_kind WHEN 'staff' THEN 'Corridra team' WHEN 'system' THEN 'Automatic' WHEN 'customer' THEN CASE WHEN e.customer_actor=actor THEN 'You' ELSE 'A teammate' END END,
   'note',e.customer_note,'periodStart',e.period_start,'periodEnd',e.period_end,'endReason',e.end_reason) ORDER BY e.seq),'[]'::jsonb) INTO timeline
  FROM customer_private.billing_subscription_event e WHERE e.subscription_id=sub.id AND e.kind<>'internal_note';
  subs:=subs||jsonb_build_array(customer_private.billing_summary(sub.id)||jsonb_build_object('timeline',timeline));
  sub_status:=customer_private.billing_status(sub.id);
  IF sub_status IN ('active','cancel_scheduled') AND holding IS NULL THEN holding:=sub.id; held_plan:=sub.plan_id; END IF;
  IF sub_status='requested' AND pending IS NULL THEN pending:=sub.id; END IF;
 END LOOP;
 IF holding IS NOT NULL THEN
  cur:=customer_private.billing_summary(holding);
  elapsed:=(cur->>'periodElapsed')::boolean;
  IF NOT elapsed THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('key',e.entitlement_key,'label',k.label,'description',k.description,'unit',e.unit,'mode',e.mode,'limit',e.limit_count) ORDER BY e.entitlement_key),'[]'::jsonb) INTO ents
   FROM customer_private.billing_plan_entitlement e JOIN customer_private.billing_entitlement_key k ON k.key=e.entitlement_key WHERE e.plan_id=held_plan;
  END IF;
 END IF;
 IF pending IS NOT NULL THEN pend:=customer_private.billing_summary(pending); END IF;
 IF access='writer' THEN
  actions:=CASE WHEN pending IS NOT NULL THEN '["withdraw"]'::jsonb
   WHEN holding IS NULL THEN '["request"]'::jsonb
   WHEN customer_private.billing_status(holding)='active' AND NOT elapsed THEN '["request","cancel"]'::jsonb
   WHEN customer_private.billing_status(holding)='cancel_scheduled' AND NOT elapsed THEN '["request","keep"]'::jsonb
   ELSE '["request"]'::jsonb END;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canAct',access='writer','current',cur,'pending',pend,'entitlements',ents,'entitlementsEnforced',false,
  'subscriptions',subs,'actions',actions,'invoicing','not_enabled','paymentTaken',false,'synthetic',true,'expiresAt',customer_private.organisation_profile_expiry());
END $$;

CREATE FUNCTION customer.billing_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid; prior customer_private.billing_command; sub uuid; p customer_private.billing_plan_version; shown text; kind text; result jsonb; other record;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('request','withdraw','cancel','keep')
  OR jsonb_typeof(input->'workspaceId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid billing command' USING ERRCODE='23514'; END IF;
 IF operation='request' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['workspaceId','planKey','planVersion','planDigest','acknowledged'],ARRAY[]::text[])
   OR jsonb_typeof(input->'planKey') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'planVersion') IS DISTINCT FROM 'number'
   OR jsonb_typeof(input->'planDigest') IS DISTINCT FROM 'string' OR input->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'The plan must be reviewed and acknowledged to ask for it' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.billing_input_shape(input,ARRAY['workspaceId','subscriptionId'],ARRAY[]::text[])
   OR jsonb_typeof(input->'subscriptionId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid billing change' USING ERRCODE='23514'; END IF;
 END IF;
 target:=(input->>'workspaceId')::uuid;
 actor:=customer_private.lock_workspace_access(command,target);
 IF customer_private.billing_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM customer_private.billing_command x WHERE x.actor_id=actor AND x.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.workspace:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 FOR other IN SELECT s.id FROM customer_private.billing_subscription s WHERE s.tenant_id=target LOOP
  PERFORM customer_private.billing_settle(other.id);
 END LOOP;
 IF operation='request' THEN
  SELECT * INTO p FROM customer_private.billing_plan_version x WHERE x.plan_key=input->>'planKey' AND x.version=(input->>'planVersion')::integer;
  IF NOT FOUND OR NOT p.active OR p.version<>(SELECT max(x.version) FROM customer_private.billing_plan_version x WHERE x.plan_key=p.plan_key) THEN
   RAISE EXCEPTION 'That plan is not on offer' USING ERRCODE='23514'; END IF;
  shown:=customer_private.billing_plan_digest(p.id);
  IF shown<>input->>'planDigest' THEN RAISE EXCEPTION 'The plan changed; reload and review it again' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM customer_private.billing_plan_view v WHERE v.plan_id=p.id AND v.principal_id=actor AND v.digest=shown) THEN
   RAISE EXCEPTION 'Review the whole plan before asking for it' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM customer_private.billing_subscription s WHERE s.tenant_id=target AND customer_private.billing_status(s.id)='requested') THEN
   RAISE EXCEPTION 'There is already an open plan request in this workspace' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT FROM customer_private.billing_subscription s WHERE s.tenant_id=target AND s.plan_id=p.id AND customer_private.billing_status(s.id) IN ('active','cancel_scheduled')) THEN
   RAISE EXCEPTION 'This workspace already holds this plan' USING ERRCODE='23514'; END IF;
  sub:=gen_random_uuid();
  INSERT INTO customer_private.billing_subscription(id,tenant_id,created_by,plan_id,billing_interval,plan_digest) VALUES(sub,target,actor,p.id,p.billing_interval,shown);
  PERFORM customer_private.billing_record(sub,'requested','customer',actor,NULL,NULL,NULL,NULL,NULL,NULL,NULL,command);
 ELSE
  sub:=(input->>'subscriptionId')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.billing_subscription s WHERE s.id=sub AND s.tenant_id=target) THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
  kind:=CASE operation WHEN 'withdraw' THEN 'withdrawn' WHEN 'cancel' THEN 'cancel_requested' ELSE 'cancel_withdrawn' END;
  PERFORM customer_private.billing_record(sub,kind,'customer',actor,NULL,NULL,NULL,NULL,NULL,NULL,NULL,command);
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.billing_summary(sub)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',true);
 INSERT INTO customer_private.billing_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

-- Staff side. The same protected staff authority as customer delivery and paid-service requests: an owner or admin
-- of a synthetic operator workspace with a fresh authenticator check and a live session, read from the staff
-- session, never from the caller.
CREATE FUNCTION customer_private.billing_staff_actor() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL','synthetic_validation'),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND synthetic) THEN RAISE EXCEPTION 'Billing needs an owner or admin with a fresh authenticator check' USING ERRCODE='42501'; END IF;
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

-- Every subscription in a synthetic workspace, newest first.
CREATE FUNCTION app.billing_staff_list(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor(); items jsonb; next_id uuid; cursor_row customer_private.billing_subscription;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO cursor_row FROM customer_private.billing_subscription WHERE id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT s.id,s.created_at FROM customer_private.billing_subscription s JOIN app.tenant w ON w.id=s.tenant_id AND w.synthetic
  WHERE (after_id IS NULL OR (s.created_at,s.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY s.created_at DESC,s.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.billing_summary(v.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w JOIN customer_private.billing_subscription x ON x.tenant_id=w.id WHERE x.id=v.id),
   'lastSeq',(SELECT max(e.seq) FROM customer_private.billing_subscription_event e WHERE e.subscription_id=v.id)) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO items,next_id;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('subscriptions',items,'nextAfter',next_id,'synthetic',true);
END $$;

CREATE FUNCTION app.billing_staff_view(subscription_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor(); s customer_private.billing_subscription; events jsonb; last_seq integer; st text; elapsed boolean; actions jsonb; held_elsewhere boolean;
 other record;
BEGIN
 IF subscription_id IS NULL THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=subscription_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.workspace:'||s.tenant_id::text,0));
 FOR other IN SELECT x.id FROM customer_private.billing_subscription x WHERE x.tenant_id=s.tenant_id LOOP
  PERFORM customer_private.billing_settle(other.id);
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.created_at,'kind',e.kind,'status',e.status_after,'actorKind',e.actor_kind,
  'customerNote',e.customer_note,'internalNote',e.internal_note,'periodStart',e.period_start,'periodEnd',e.period_end,'endReason',e.end_reason) ORDER BY e.seq),'[]'::jsonb),max(e.seq) INTO events,last_seq
 FROM customer_private.billing_subscription_event e WHERE e.subscription_id=s.id;
 st:=customer_private.billing_status(s.id);
 elapsed:=coalesce((customer_private.billing_summary(s.id)->>'periodElapsed')::boolean,false);
 held_elsewhere:=EXISTS(SELECT FROM customer_private.billing_subscription x WHERE x.tenant_id=s.tenant_id AND x.id<>s.id AND customer_private.billing_status(x.id) IN ('active','cancel_scheduled'));
 actions:=CASE st WHEN 'requested' THEN '["activate","decline","note"]'::jsonb WHEN 'active' THEN '["renew","end","note"]'::jsonb
  WHEN 'cancel_scheduled' THEN '["end","note"]'::jsonb ELSE '[]'::jsonb END;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('subscription',customer_private.billing_summary(s.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w WHERE w.id=s.tenant_id)),
  'plan',customer_private.billing_plan_json(s.plan_id),'planDigestAtRequest',s.plan_digest,'events',events,'lastSeq',last_seq,'actions',actions,
  'replacesHeldPlan',held_elsewhere AND st='requested','periodElapsed',elapsed,'synthetic',true);
END $$;

CREATE FUNCTION app.billing_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 prior customer_private.billing_staff_command; s customer_private.billing_subscription; sub uuid; target uuid; last_seq integer; st text; result jsonb; other record;
 start_day date; last_end date; note text;
BEGIN
 IF command IS NULL OR input IS NULL OR operation IS NULL OR operation NOT IN ('activate','renew','decline','end','note')
  OR jsonb_typeof(input->'subscriptionId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedSeq') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Invalid staff billing command' USING ERRCODE='23514'; END IF;
 IF operation='activate' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['subscriptionId','expectedSeq','periodStart','customerNote'],ARRAY[]::text[])
   OR jsonb_typeof(input->'periodStart') IS DISTINCT FROM 'string' OR input->>'periodStart' !~ '^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(input->'customerNote') NOT IN ('string','null') THEN RAISE EXCEPTION 'A period start date such as 2026-11-30 is required' USING ERRCODE='23514'; END IF;
 ELSIF operation='renew' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['subscriptionId','expectedSeq','customerNote'],ARRAY[]::text[])
   OR jsonb_typeof(input->'customerNote') NOT IN ('string','null') THEN RAISE EXCEPTION 'Invalid renewal' USING ERRCODE='23514'; END IF;
 ELSIF operation='note' THEN
  IF NOT customer_private.billing_input_shape(input,ARRAY['subscriptionId','expectedSeq','internalNote'],ARRAY[]::text[]) OR jsonb_typeof(input->'internalNote') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid staff note' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT customer_private.billing_input_shape(input,ARRAY['subscriptionId','expectedSeq','customerNote'],ARRAY[]::text[]) OR jsonb_typeof(input->'customerNote') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid customer note' USING ERRCODE='23514'; END IF;
 END IF;
 sub:=(input->>'subscriptionId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.staff.command:'||actor::text||':'||command::text,0));
 SELECT * INTO prior FROM customer_private.billing_staff_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>operation OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=sub AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic);
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 target:=s.tenant_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.workspace:'||target::text,0));
 FOR other IN SELECT x.id FROM customer_private.billing_subscription x WHERE x.tenant_id=target LOOP
  PERFORM customer_private.billing_settle(other.id);
 END LOOP;
 SELECT max(e.seq) INTO last_seq FROM customer_private.billing_subscription_event e WHERE e.subscription_id=sub;
 IF last_seq IS DISTINCT FROM (input->>'expectedSeq')::integer THEN RAISE EXCEPTION 'The subscription changed; reload and try again' USING ERRCODE='23514'; END IF;
 st:=customer_private.billing_status(sub);
 IF operation='activate' THEN
  start_day:=(input->>'periodStart')::date;
  note:=input->>'customerNote';
  IF note IS NOT NULL AND NOT customer_private.billing_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  -- A change of plan: the held subscription ends in the same step, with the reason "replaced".
  FOR other IN SELECT x.id FROM customer_private.billing_subscription x WHERE x.tenant_id=target AND x.id<>sub
   AND customer_private.billing_status(x.id) IN ('active','cancel_scheduled') LOOP
   PERFORM customer_private.billing_record(other.id,'ended','staff',NULL,actor,t,NULL,NULL,NULL,NULL,'replaced',command);
  END LOOP;
  PERFORM customer_private.billing_record(sub,'activated','staff',NULL,actor,t,note,NULL,start_day,customer_private.billing_period_end(start_day,s.billing_interval),NULL,command);
 ELSIF operation='renew' THEN
  note:=input->>'customerNote';
  IF note IS NOT NULL AND NOT customer_private.billing_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  SELECT x.period_end INTO last_end FROM customer_private.billing_period(sub) x;
  IF last_end IS NULL THEN RAISE EXCEPTION 'That change is not available for this subscription now' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.billing_record(sub,'renewed','staff',NULL,actor,t,note,NULL,last_end,customer_private.billing_period_end(last_end,s.billing_interval),NULL,command);
 ELSIF operation='note' THEN
  IF NOT customer_private.billing_synthetic_ok(input->>'internalNote',1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.billing_record(sub,'internal_note','staff',NULL,actor,t,NULL,input->>'internalNote',NULL,NULL,NULL,command);
 ELSE
  note:=input->>'customerNote';
  IF NOT customer_private.billing_synthetic_ok(note,1000) THEN RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  IF operation='decline' THEN
   PERFORM customer_private.billing_record(sub,'declined','staff',NULL,actor,t,note,NULL,NULL,NULL,NULL,command);
  ELSE
   PERFORM customer_private.billing_record(sub,'ended','staff',NULL,actor,t,note,NULL,NULL,NULL,'ended_by_team',command);
  END IF;
 END IF;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.billing_summary(sub)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',true);
 INSERT INTO customer_private.billing_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

-- Plan maintenance by staff: a new immutable version per change, or a retirement.
CREATE FUNCTION app.billing_plan_staff_list() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor();
BEGIN
 RETURN jsonb_build_object('plans',(SELECT coalesce(jsonb_agg(customer_private.billing_plan_json(p.id)||jsonb_build_object('source',p.source) ORDER BY p.title,p.plan_key),'[]'::jsonb)
  FROM customer_private.billing_plan_version p WHERE p.version=(SELECT max(x.version) FROM customer_private.billing_plan_version x WHERE x.plan_key=p.plan_key)),
  'entitlementKeys',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',k.key,'unit',k.unit,'label',k.label,'description',k.description) ORDER BY k.key),'[]'::jsonb) FROM customer_private.billing_entitlement_key k),
  'synthetic',true);
END $$;

CREATE FUNCTION app.billing_plan_staff_command(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; prior customer_private.billing_staff_command;
 head integer; key text; v customer_private.billing_plan_version; executor uuid; eid uuid:=gen_random_uuid(); result jsonb; item jsonb; unit_of text; seen text[]:=ARRAY[]::text[];
BEGIN
 IF command IS NULL OR NOT customer_private.billing_input_shape(input,ARRAY['planKey','expectedVersion','title','summary','interval','priceMinor','currency','taxTreatment','included','excluded','active','entitlements'],ARRAY[]::text[])
  OR jsonb_typeof(input->'planKey') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number'
  OR jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'summary') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'interval') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'priceMinor') IS DISTINCT FROM 'string'
  OR input->>'priceMinor' !~ '^(0|[1-9][0-9]{0,10})$' OR jsonb_typeof(input->'currency') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'taxTreatment') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'included') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'excluded') IS DISTINCT FROM 'array'
  OR jsonb_typeof(input->'active') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'entitlements') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'included') x WHERE jsonb_typeof(x)<>'string')
  OR EXISTS(SELECT FROM jsonb_array_elements(input->'excluded') x WHERE jsonb_typeof(x)<>'string') THEN
  RAISE EXCEPTION 'Invalid plan' USING ERRCODE='23514'; END IF;
 key:=input->>'planKey';
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.staff.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.plan:'||key,0));
 SELECT * INTO prior FROM customer_private.billing_staff_command p WHERE p.actor_id=actor AND p.command_id=command;
 IF FOUND THEN
  IF prior.operation<>'plan' OR prior.request<>input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result;
 END IF;
 SELECT coalesce(max(x.version),0) INTO head FROM customer_private.billing_plan_version x WHERE x.plan_key=key;
 IF head<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'The plan changed; reload and try again' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM app.currency c WHERE c.code=input->>'currency') THEN RAISE EXCEPTION 'Choose a supported currency' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(input->'entitlements')<>(SELECT count(*) FROM customer_private.billing_entitlement_key) THEN RAISE EXCEPTION 'A plan must state every entitlement exactly once' USING ERRCODE='23514'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,source,created_by,staff_tenant_id)
 VALUES(key,head+1,input->>'title',input->>'summary',input->>'interval',(input->>'priceMinor')::bigint,input->>'currency',input->>'taxTreatment',
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'included') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'excluded') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  (input->>'active')::boolean,'STAFF',actor,t) RETURNING * INTO v;
 FOR item IN SELECT value FROM jsonb_array_elements(input->'entitlements') LOOP
  IF NOT customer_private.billing_input_shape(item,ARRAY['key','mode','limit'],ARRAY[]::text[]) OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'mode') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'limit') NOT IN ('number','null')
   OR (jsonb_typeof(item->'limit')='number' AND item->>'limit' !~ '^(0|[1-9][0-9]{0,5})$') THEN
   RAISE EXCEPTION 'Each entitlement needs a key, a mode and a limit or null' USING ERRCODE='23514'; END IF;
  SELECT k.unit INTO unit_of FROM customer_private.billing_entitlement_key k WHERE k.key=item->>'key';
  IF unit_of IS NULL OR (item->>'key')=ANY(seen) THEN RAISE EXCEPTION 'A plan must state every entitlement exactly once' USING ERRCODE='23514'; END IF;
  seen:=seen||(item->>'key');
  INSERT INTO customer_private.billing_plan_entitlement(plan_id,entitlement_key,unit,mode,limit_count)
  VALUES(v.id,item->>'key',unit_of,item->>'mode',(item->>'limit')::integer);
 END LOOP;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,t,'customer.billing_plan.revised',1,'customer_billing_plan',key,v.version,actor,clock_timestamp(),command,command,
 jsonb_build_object('planKey',key,'version',v.version,'active',v.active,'synthetic',true,'initiator_kind','staff','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),t,eid,actor,'customer.billing_plan.revised');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),t,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,t);
 result:=jsonb_build_object('planKey',key,'version',v.version,'active',v.active,'commandId',command,'synthetic',true);
 INSERT INTO customer_private.billing_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,'plan',input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.billing_role(uuid,uuid),customer_private.billing_next(text,text),customer_private.billing_plan_digest(uuid),
 customer_private.billing_plan_json(uuid),customer_private.billing_plan_complete_guard(),customer_private.billing_status(uuid),customer_private.billing_period(uuid),
 customer_private.billing_emit(uuid,integer,text,text,text,uuid,uuid),
 customer_private.billing_record(uuid,text,text,uuid,uuid,uuid,text,text,date,date,text,uuid),
 customer_private.billing_event_guard(),customer_private.billing_settle(uuid),customer_private.billing_summary(uuid),
 customer_private.billing_staff_actor() FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION customer.billing_plans(uuid),customer.billing_overview(uuid),customer.billing_command(uuid,text,jsonb) FROM PUBLIC,corridra_auth;
REVOKE ALL ON FUNCTION app.billing_staff_list(uuid,integer),app.billing_staff_view(uuid),app.billing_staff_command(uuid,text,jsonb),
 app.billing_plan_staff_list(),app.billing_plan_staff_command(uuid,jsonb) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.billing_plans(uuid),customer.billing_overview(uuid),customer.billing_command(uuid,text,jsonb),
 app.billing_staff_list(uuid,integer),app.billing_staff_view(uuid),app.billing_staff_command(uuid,text,jsonb),
 app.billing_plan_staff_list(),app.billing_plan_staff_command(uuid,jsonb) TO corridra_runtime;
