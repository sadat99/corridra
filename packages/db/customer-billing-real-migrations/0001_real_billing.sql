-- Optional additive module: real plans, subscriptions and entitlements for real workspaces (billing stage 1, ADR-062).
-- Nothing is charged and nothing is invoiced. A subscription here is a record that a real workspace holds a plan
-- for a stated period. There is no payment, invoice, card, tax number or contact detail in this module.
-- Installing this module alone changes nothing for anyone: the control below starts closed, and only an offline
-- schema-owner operation opens it. Sample workspaces behave exactly as before. The invoicing module is untouched
-- and still serves sample workspaces only.
-- The constraints that said "sample only" are replaced by constraints that hold per catalogue (sample or real);
-- the functions that served sample workspaces only are replaced with the same behaviour for them plus the real path.
-- History tables stay append-only. No existing row is changed or relabelled.

DO $guard$ BEGIN
 IF to_regprocedure('customer_private.real_admission_open()') IS NULL
 OR to_regprocedure('customer_private.synthetic_context()') IS NULL
 OR to_regprocedure('customer_private.real_session()') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('customer_private.organisation_profile_role(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.billing_role(uuid,uuid)') IS NULL
 OR to_regprocedure('customer_private.billing_staff_actor()') IS NULL
 OR to_regclass('customer_private.billing_plan_version') IS NULL
 OR to_regclass('customer_private.billing_subscription_event') IS NULL
 OR to_regclass('customer_private.real_use_configuration') IS NULL
 THEN RAISE EXCEPTION 'Real billing prerequisites are missing'; END IF;
END $guard$;

-- The control. Closed unless real admission is open AND the latest control row says enabled. No row means closed.
CREATE TABLE customer_private.real_billing_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.real_billing_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.real_billing_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER real_billing_control_immutable BEFORE UPDATE OR DELETE ON customer_private.real_billing_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE FUNCTION customer_private.real_billing_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT customer_private.real_admission_open()
 AND coalesce((SELECT enabled FROM customer_private.real_billing_control ORDER BY version DESC LIMIT 1),false)
$$;

-- Note text for a workspace: invented ("Synthetic ...") for sample workspaces, plain text for real ones.
CREATE FUNCTION customer_private.billing_note_ok(t text,max_len integer,sample boolean) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN sample THEN customer_private.billing_synthetic_ok(t,max_len) ELSE customer_private.billing_plain_ok(t,1,max_len) END
$$;

-- Table rules. A sample plan still must say "sample" or "synthetic" in its title; a real plan is staff-written, must not
-- claim to be a sample, and never takes the name of an example plan. Notes are checked by the timeline guard, which
-- knows the workspace; the table only keeps them plain.
DO $constraints$ BEGIN
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='customer_private.billing_plan_version'::regclass
     AND conname IN ('billing_plan_version_title_check','billing_plan_version_synthetic_check'))<>2
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='customer_private.billing_subscription_event'::regclass
     AND conname IN ('billing_subscription_event_customer_note_check','billing_subscription_event_internal_note_check'))<>2
 THEN RAISE EXCEPTION 'Real billing prerequisite constraints differ'; END IF;
END $constraints$;
ALTER TABLE customer_private.billing_plan_version DROP CONSTRAINT billing_plan_version_title_check;
ALTER TABLE customer_private.billing_plan_version DROP CONSTRAINT billing_plan_version_synthetic_check;
ALTER TABLE customer_private.billing_plan_version ADD CONSTRAINT billing_plan_version_title_check
 CHECK(customer_private.billing_plain_ok(title,3,120) AND (NOT synthetic OR title ~* '(sample|synthetic)'));
ALTER TABLE customer_private.billing_plan_version ADD CONSTRAINT billing_plan_version_real_check
 CHECK(synthetic OR (source='STAFF' AND plan_key !~ '^example-' AND title !~* '(sample|synthetic)'));
ALTER TABLE customer_private.billing_subscription_event DROP CONSTRAINT billing_subscription_event_customer_note_check;
ALTER TABLE customer_private.billing_subscription_event DROP CONSTRAINT billing_subscription_event_internal_note_check;
ALTER TABLE customer_private.billing_subscription_event ADD CONSTRAINT billing_subscription_event_customer_note_check
 CHECK(customer_note IS NULL OR customer_private.billing_text_ok(customer_note,1,1000));
ALTER TABLE customer_private.billing_subscription_event ADD CONSTRAINT billing_subscription_event_internal_note_check
 CHECK(internal_note IS NULL OR customer_private.billing_text_ok(internal_note,1,1000));

-- A plan key belongs to one catalogue for ever, and a real plan can only be written while the control is open.
CREATE FUNCTION customer_private.billing_plan_catalogue_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM customer_private.billing_plan_version x WHERE x.plan_key=NEW.plan_key AND x.synthetic<>NEW.synthetic) THEN
  RAISE EXCEPTION 'That plan key belongs to the other catalogue' USING ERRCODE='23514'; END IF;
 IF NOT NEW.synthetic AND NOT customer_private.real_billing_open() THEN
  RAISE EXCEPTION 'Real plans need the real billing control to be open' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_plan_catalogue_guard BEFORE INSERT ON customer_private.billing_plan_version
 FOR EACH ROW EXECUTE FUNCTION customer_private.billing_plan_catalogue_guard();

-- The role of the current actor in a workspace: writer (owner or admin), reader (member) or NULL. A sample workspace
-- is served to sample sessions and a real workspace to real sessions, never across. A real workspace whose control is
-- closed answers "switched off" (55000) to its own members, so the screen can say so instead of "denied".
-- billing_role (sample only) stays as it was: the invoicing module still uses it and still serves sample workspaces only.
CREATE FUNCTION customer_private.billing_workspace_role(target uuid,actor uuid) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sample boolean; found_role text;
BEGIN
 SELECT t.synthetic INTO sample FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id WHERE w.tenant_id=target;
 IF sample IS NULL OR sample=customer_private.real_session() THEN RETURN NULL; END IF;
 found_role:=customer_private.organisation_profile_role(target,actor);
 IF found_role IS NOT NULL AND NOT sample AND NOT customer_private.real_billing_open() THEN
  RAISE EXCEPTION 'Real plans are switched off' USING ERRCODE='55000'; END IF;
 RETURN found_role;
END $$;

-- Staff authority, the same protected path as paid-service requests: an owner or admin of an operator workspace with a
-- fresh authenticator check and a live session, read from the staff session, never from the caller. A sample operator
-- workspace serves sample subscriptions; a real operator workspace serves real ones, and only while the control is open.
CREATE FUNCTION customer_private.billing_staff_actor_scoped() RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT coalesce(app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)),false)
  OR coalesce(app.member_role(t),'') NOT IN ('owner','admin') OR NOT app.fresh_mfa()
  OR NOT EXISTS(SELECT FROM app.tenant WHERE id=t AND (synthetic OR (app.real_use_allowed(id) AND customer_private.real_billing_open()))) THEN
  RAISE EXCEPTION 'Billing needs an owner or admin with a fresh authenticator check' USING ERRCODE='42501'; END IF;
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

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.billing_plan_json(uuid)'::regprocedure),'UTF8')),'hex')<>'2db0eea2f32d6fea1a5783948d5ea1c730acbc382ad0800f6a01e3febfdabf57' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: customer_private.billing_plan_json'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer_private.billing_plan_json(plan uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',p.id,'key',p.plan_key,'version',p.version,'title',p.title,'summary',p.summary,'interval',p.billing_interval,
  'priceMinor',p.price_minor::text,'currency',p.currency,'taxTreatment',p.tax_treatment,'included',to_jsonb(p.included),'excluded',to_jsonb(p.excluded),
  'entitlements',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',e.entitlement_key,'label',k.label,'description',k.description,'unit',e.unit,'mode',e.mode,'limit',e.limit_count) ORDER BY e.entitlement_key COLLATE "C"),'[]'::jsonb)
   FROM customer_private.billing_plan_entitlement e JOIN customer_private.billing_entitlement_key k ON k.key=e.entitlement_key WHERE e.plan_id=p.id),
  'digest',customer_private.billing_plan_digest(p.id),'active',p.active,'synthetic',p.synthetic,'invoicing','not_enabled','paymentTaken',false)
 FROM customer_private.billing_plan_version p WHERE p.id=plan
$$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.billing_emit(uuid,integer,text,text,text,uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'814b658020763af45bf1b6e586fda0234b122bbab03e7b8cb8d7dd213d0ef47b' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: customer_private.billing_emit'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer_private.billing_emit(sub uuid,seq integer,kind text,status text,actor_kind text,initiator uuid,command uuid) RETURNS void
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
 jsonb_strip_nulls(jsonb_build_object('subscriptionId',sub,'seq',seq,'status',status,'planKey',plan_key,'planVersion',plan_version,'synthetic',(SELECT t.synthetic FROM app.tenant t WHERE t.id=target),'initiator_kind',actor_kind,'initiator_id',initiator)));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,event_actor,'customer.billing.subscription.'||kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.billing_event_guard()'::regprocedure),'UTF8')),'hex')<>'9de11f92cb01621404e86cfe6fed82f63a725d9844e05483eaf3f949cd7bd620' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: customer_private.billing_event_guard'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer_private.billing_event_guard() RETURNS trigger
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
 IF NOT EXISTS(SELECT FROM app.tenant t WHERE t.id=s.tenant_id AND (t.synthetic OR customer_private.real_billing_open())) THEN
  RAISE EXCEPTION 'Billing records need a sample workspace or the real billing control to be open' USING ERRCODE='42501'; END IF;
 -- A workspace only ever holds a plan from its own catalogue: sample plans for sample workspaces, real plans for real ones.
 IF (SELECT p.synthetic FROM customer_private.billing_plan_version p WHERE p.id=s.plan_id) IS DISTINCT FROM (SELECT t.synthetic FROM app.tenant t WHERE t.id=s.tenant_id) THEN
  RAISE EXCEPTION 'That plan belongs to the other catalogue' USING ERRCODE='23514'; END IF;
 -- Sample workspaces keep the rule that every free-text note is invented and starts with "Synthetic ".
 IF (SELECT t.synthetic FROM app.tenant t WHERE t.id=s.tenant_id)
  AND ((NEW.customer_note IS NOT NULL AND NOT customer_private.billing_synthetic_ok(NEW.customer_note,1000))
   OR (NEW.internal_note IS NOT NULL AND NOT customer_private.billing_synthetic_ok(NEW.internal_note,1000))) THEN
  RAISE EXCEPTION 'Use invented text that starts with Synthetic' USING ERRCODE='23514'; END IF;
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

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.billing_plans(uuid)'::regprocedure),'UTF8')),'hex')<>'743054ff203545c90ba77e86c9bc1ed29bf13f5d778b3bf5000512aabb990b13' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: customer.billing_plans'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer.billing_plans(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); access text; items jsonb;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.billing_workspace_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.billing_plan_json(p.id) ORDER BY p.plan_key COLLATE "C"),'[]'::jsonb) INTO items
 FROM customer_private.billing_plan_version p WHERE p.active AND p.synthetic=app.tenant_is_synthetic(target)
 AND p.version=(SELECT max(x.version) FROM customer_private.billing_plan_version x WHERE x.plan_key=p.plan_key);
 IF access='writer' THEN
  INSERT INTO customer_private.billing_plan_view(plan_id,principal_id,digest)
  SELECT (i->>'id')::uuid,actor,i->>'digest' FROM jsonb_array_elements(items) i ON CONFLICT DO NOTHING;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.billing_workspace_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'canRequest',access='writer','plans',items,'entitlementsEnforced',false,'invoicing','not_enabled',
  'paymentTaken',false,'synthetic',app.tenant_is_synthetic(target),'expiresAt',customer_private.organisation_profile_expiry());
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.billing_overview(uuid)'::regprocedure),'UTF8')),'hex')<>'6c07aedf59f005ef882ba705fc1289e30a015aeff67b46c718436a904b9a4f39' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: customer.billing_overview'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer.billing_overview(target uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id(); access text; sub record; holding uuid; pending uuid; subs jsonb:='[]'::jsonb; cur jsonb; pend jsonb; ents jsonb:='[]'::jsonb;
 timeline jsonb; actions jsonb:='[]'::jsonb; sub_status text; elapsed boolean:=false; held_plan uuid;
BEGIN
 IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 access:=customer_private.billing_workspace_role(target,actor);
 IF access IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.billing.workspace:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor OR customer_private.billing_workspace_role(target,actor) IS DISTINCT FROM access THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501'; END IF;
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
   SELECT coalesce(jsonb_agg(jsonb_build_object('key',e.entitlement_key,'label',k.label,'description',k.description,'unit',e.unit,'mode',e.mode,'limit',e.limit_count) ORDER BY e.entitlement_key COLLATE "C"),'[]'::jsonb) INTO ents
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
  'subscriptions',subs,'actions',actions,'invoicing','not_enabled','paymentTaken',false,'synthetic',app.tenant_is_synthetic(target),'expiresAt',customer_private.organisation_profile_expiry());
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.billing_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'ab9faeee1a3d9f8ca26fd32ee5b47b3f6d1bbf4b9e3a33c1dd5288fc51259fb8' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: customer.billing_command'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer.billing_command(command uuid,operation text,input jsonb) RETURNS jsonb
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
 IF customer_private.billing_workspace_role(target,actor) IS DISTINCT FROM 'writer' THEN RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501'; END IF;
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
  IF NOT FOUND OR NOT p.active OR p.synthetic IS DISTINCT FROM app.tenant_is_synthetic(target) OR p.version<>(SELECT max(x.version) FROM customer_private.billing_plan_version x WHERE x.plan_key=p.plan_key) THEN
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
 result:=customer_private.billing_summary(sub)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',app.tenant_is_synthetic(target));
 INSERT INTO customer_private.billing_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.billing_staff_list(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'d5f6332d68dc1b6200c0c677a905570fa8d34a4ba780f285c38c39456975dd2f' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: app.billing_staff_list'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.billing_staff_list(after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor_scoped(); items jsonb; next_id uuid; cursor_row customer_private.billing_subscription;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO cursor_row FROM customer_private.billing_subscription WHERE id=after_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 END IF;
 WITH mine AS(SELECT s.id,s.created_at FROM customer_private.billing_subscription s JOIN app.tenant w ON w.id=s.tenant_id AND w.synthetic=customer_private.synthetic_context()
  WHERE (after_id IS NULL OR (s.created_at,s.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY s.created_at DESC,s.id DESC LIMIT page_size+1),
 visible AS(SELECT * FROM mine ORDER BY created_at DESC,id DESC LIMIT page_size)
 SELECT coalesce((SELECT jsonb_agg(customer_private.billing_summary(v.id)||jsonb_build_object('workspaceName',(SELECT w.name FROM app.tenant w JOIN customer_private.billing_subscription x ON x.tenant_id=w.id WHERE x.id=v.id),
   'lastSeq',(SELECT max(e.seq) FROM customer_private.billing_subscription_event e WHERE e.subscription_id=v.id)) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
 CASE WHEN (SELECT count(*) FROM mine)>page_size THEN (SELECT id FROM visible ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END INTO items,next_id;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('subscriptions',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.billing_staff_view(uuid)'::regprocedure),'UTF8')),'hex')<>'036fbba058c41f62865aab19f9895099c6fa2a820a88b06225b208bb78396645' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: app.billing_staff_view'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.billing_staff_view(subscription_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor_scoped(); s customer_private.billing_subscription; events jsonb; last_seq integer; st text; elapsed boolean; actions jsonb; held_elsewhere boolean;
 other record;
BEGIN
 IF subscription_id IS NULL THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=subscription_id AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic=customer_private.synthetic_context());
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
  'replacesHeldPlan',held_elsewhere AND st='requested','periodElapsed',elapsed,'synthetic',customer_private.synthetic_context());
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.billing_staff_command(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')<>'9f33c556feb4a1c97c62819b348cd216bbc0add5ea48d07646667a0f5db0c47b' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: app.billing_staff_command'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.billing_staff_command(command uuid,operation text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor_scoped(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
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
 SELECT * INTO s FROM customer_private.billing_subscription x WHERE x.id=sub AND EXISTS(SELECT FROM app.tenant w WHERE w.id=x.tenant_id AND w.synthetic=customer_private.synthetic_context());
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
  IF note IS NOT NULL AND NOT customer_private.billing_note_ok(note,1000,customer_private.synthetic_context()) THEN RAISE EXCEPTION 'Notes must be plain text; sample workspaces use text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  -- A change of plan: the held subscription ends in the same step, with the reason "replaced".
  FOR other IN SELECT x.id FROM customer_private.billing_subscription x WHERE x.tenant_id=target AND x.id<>sub
   AND customer_private.billing_status(x.id) IN ('active','cancel_scheduled') LOOP
   PERFORM customer_private.billing_record(other.id,'ended','staff',NULL,actor,t,NULL,NULL,NULL,NULL,'replaced',command);
  END LOOP;
  PERFORM customer_private.billing_record(sub,'activated','staff',NULL,actor,t,note,NULL,start_day,customer_private.billing_period_end(start_day,s.billing_interval),NULL,command);
 ELSIF operation='renew' THEN
  note:=input->>'customerNote';
  IF note IS NOT NULL AND NOT customer_private.billing_note_ok(note,1000,customer_private.synthetic_context()) THEN RAISE EXCEPTION 'Notes must be plain text; sample workspaces use text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  SELECT x.period_end INTO last_end FROM customer_private.billing_period(sub) x;
  IF last_end IS NULL THEN RAISE EXCEPTION 'That change is not available for this subscription now' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.billing_record(sub,'renewed','staff',NULL,actor,t,note,NULL,last_end,customer_private.billing_period_end(last_end,s.billing_interval),NULL,command);
 ELSIF operation='note' THEN
  IF NOT customer_private.billing_note_ok(input->>'internalNote',1000,customer_private.synthetic_context()) THEN RAISE EXCEPTION 'Notes must be plain text; sample workspaces use text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  PERFORM customer_private.billing_record(sub,'internal_note','staff',NULL,actor,t,NULL,input->>'internalNote',NULL,NULL,NULL,command);
 ELSE
  note:=input->>'customerNote';
  IF NOT customer_private.billing_note_ok(note,1000,customer_private.synthetic_context()) THEN RAISE EXCEPTION 'Notes must be plain text; sample workspaces use text that starts with Synthetic' USING ERRCODE='23514'; END IF;
  IF operation='decline' THEN
   PERFORM customer_private.billing_record(sub,'declined','staff',NULL,actor,t,note,NULL,NULL,NULL,NULL,command);
  ELSE
   PERFORM customer_private.billing_record(sub,'ended','staff',NULL,actor,t,note,NULL,NULL,NULL,'ended_by_team',command);
  END IF;
 END IF;
 IF app.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 result:=customer_private.billing_summary(sub)||jsonb_build_object('commandId',command,'operation',operation,'synthetic',customer_private.synthetic_context());
 INSERT INTO customer_private.billing_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,operation,input,result);
 RETURN result;
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.billing_plan_staff_list()'::regprocedure),'UTF8')),'hex')<>'0bfc46445e05762e14f85c7cffe155c9bea7cb64bc3fa3ed9708759b70ffc13e' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: app.billing_plan_staff_list'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.billing_plan_staff_list() RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor_scoped();
BEGIN
 RETURN jsonb_build_object('plans',(SELECT coalesce(jsonb_agg(customer_private.billing_plan_json(p.id)||jsonb_build_object('source',p.source) ORDER BY p.plan_key COLLATE "C"),'[]'::jsonb)
  FROM customer_private.billing_plan_version p WHERE p.synthetic=customer_private.synthetic_context() AND p.version=(SELECT max(x.version) FROM customer_private.billing_plan_version x WHERE x.plan_key=p.plan_key)),
  'entitlementKeys',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',k.key,'unit',k.unit,'label',k.label,'description',k.description) ORDER BY k.key COLLATE "C"),'[]'::jsonb) FROM customer_private.billing_entitlement_key k),
  'synthetic',customer_private.synthetic_context());
END $$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.billing_plan_staff_command(uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'8b5398c81aa5e2dd495dcf971826b5b4f0108b1ba79ef5f2184bb9cde138c248' THEN RAISE EXCEPTION 'Real billing prerequisite function differs: app.billing_plan_staff_command'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.billing_plan_staff_command(command uuid,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.billing_staff_actor_scoped(); t uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; prior customer_private.billing_staff_command;
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
 IF EXISTS(SELECT FROM customer_private.billing_plan_version x WHERE x.plan_key=key AND x.synthetic<>customer_private.synthetic_context()) THEN
  RAISE EXCEPTION 'That plan key belongs to the other catalogue' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,synthetic,source,created_by,staff_tenant_id)
 VALUES(key,head+1,input->>'title',input->>'summary',input->>'interval',(input->>'priceMinor')::bigint,input->>'currency',input->>'taxTreatment',
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'included') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  ARRAY(SELECT x.value FROM jsonb_array_elements_text(input->'excluded') WITH ORDINALITY x(value,ord) ORDER BY x.ord),
  (input->>'active')::boolean,customer_private.synthetic_context(),'STAFF',actor,t) RETURNING * INTO v;
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
 jsonb_build_object('planKey',key,'version',v.version,'active',v.active,'synthetic',v.synthetic,'initiator_kind','staff','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),t,eid,actor,'customer.billing_plan.revised');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),t,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,t);
 result:=jsonb_build_object('planKey',key,'version',v.version,'active',v.active,'commandId',command,'synthetic',v.synthetic);
 INSERT INTO customer_private.billing_staff_command(actor_id,command_id,operation,request,result) VALUES(actor,command,'plan',input,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.real_billing_open(),customer_private.billing_note_ok(text,integer,boolean),
 customer_private.billing_plan_catalogue_guard(),customer_private.billing_workspace_role(uuid,uuid),
 customer_private.billing_staff_actor_scoped() FROM PUBLIC,corridra_runtime,corridra_auth;
