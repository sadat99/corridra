-- ADR-082 slice S3 (13 November 2026): the source registry, counterparty candidates, the supply file import, candidate review and
-- match decisions, and the company do-not-contact record with its four additive contact triggers.
-- Optional module file: it is applied only by the explicit supply sources installer, after 0001, and changes nothing anyone can see
-- while the module control is closed. Nothing here opens any of the six other controls.
-- Additive only. The one change to an existing object is the module's own app.supply_command action list, widened. Four new
-- triggers are added to core communication tables; each returns at once unless a do-not-contact row exists for the tenant. No
-- existing function, policy, trigger or grant is replaced and no core function is edited (no CREATE OR REPLACE).
-- Every table is tenant scoped, append only, has the synthetic policy and the ADR-056 real-use pair, and is written only through the
-- SECURITY DEFINER commands below. Events carry ids, version and status only. No column holds a person's name, email or phone number.
DO $guard$ BEGIN
 IF to_regclass('app.supply_command') IS NULL
 OR to_regclass('app.counterparty_profile_version') IS NULL
 OR to_regclass('app.supply_source_control') IS NULL
 OR to_regclass('app.source_record') IS NULL
 OR to_regclass('app.claim') IS NULL
 OR to_regclass('app.data_rights_policy') IS NULL
 OR to_regclass('app.organisation') IS NULL
 OR to_regclass('app.country') IS NULL
 OR to_regclass('app.mission_route_assignment') IS NULL
 OR to_regclass('app.corridor_pack_version') IS NULL
 OR to_regclass('app.entity_resolution') IS NULL
 OR to_regclass('app.entity_candidate') IS NULL
 OR to_regclass('app.target_account') IS NULL
 OR to_regclass('app.relationship') IS NULL
 OR to_regclass('app.communication') IS NULL
 OR to_regclass('app.communication_dispatch') IS NULL
 OR to_regclass('app.communication_receipt') IS NULL
 OR to_regclass('customer_private.organisation_source_rights') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.record_change()') IS NULL
 OR to_regprocedure('app.record_capability_change()') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL
 OR to_regprocedure('app.supply_control_open(text)') IS NULL
 OR to_regprocedure('app.supply_module_enabled()') IS NULL
 OR to_regprocedure('customer_private.organisation_link_name_key(text)') IS NULL
 OR to_regprocedure('customer_private.organisation_link_same_context(boolean,boolean)') IS NULL
 OR to_regprocedure('customer_private.organisation_link_suppressed(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Supply source prerequisites are missing'; END IF;
END $guard$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Tables. Decision tables carry a seq identity so that "the latest row decides" never depends on a timestamp tie.
-- ---------------------------------------------------------------------------------------------------------------------------

-- The registry: a source and its kind. The kind never changes; everything else is a new version.
CREATE TABLE app.supply_source (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 kind text NOT NULL CHECK(kind IN ('staff_research','partner_organisation','partner_person','data_platform')),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);

-- command_id is the id of the supply_command row, which is written last (it stores the result and the table is append only), so
-- the foreign key is deferred to the end of the transaction.
CREATE TABLE app.supply_source_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 source_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('no_agreement','active','paused','expired','retired')),
 label text NOT NULL CHECK(label=btrim(label) AND length(label) BETWEEN 3 AND 120),
 -- Nullable for staff_research only; the guard trigger requires it for any other kind that is active.
 source_record_id uuid,
 default_retention_months integer NOT NULL CHECK(default_retention_months BETWEEN 1 AND 24),
 agreement_ends_at timestamptz,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500 AND reason !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,source_id,version),
 FOREIGN KEY(tenant_id,source_id) REFERENCES app.supply_source(tenant_id,id),
 FOREIGN KEY(tenant_id,source_record_id) REFERENCES app.source_record(tenant_id,id),
 FOREIGN KEY(tenant_id,command_id) REFERENCES app.supply_command(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);

-- Row results are an array of {row, code}: a number and a short code, never the row's text.
CREATE FUNCTION app.supply_row_results_ok(r jsonb) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(r)='array' AND jsonb_array_length(r)<=100 AND NOT EXISTS(
  SELECT FROM jsonb_array_elements(r) e
  WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
   OR CASE WHEN jsonb_typeof(e)='object' THEN (SELECT count(*) FROM jsonb_object_keys(e)) ELSE 0 END<>2
   OR jsonb_typeof(e->'row') IS DISTINCT FROM 'number'
   OR jsonb_typeof(e->'code') IS DISTINCT FROM 'string'
   OR length(e->>'code')>40)
$$;
CREATE TABLE app.supply_import_batch (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 mission_id uuid NOT NULL,
 profile_version_id uuid NOT NULL,
 source_version_id uuid NOT NULL,
 file_digest text NOT NULL CHECK(file_digest ~ '^[a-f0-9]{64}$'),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 100),
 accepted_count integer NOT NULL CHECK(accepted_count>=0),
 rejected_count integer NOT NULL CHECK(rejected_count>=0),
 row_results jsonb NOT NULL CHECK(app.supply_row_results_ok(row_results)),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(accepted_count+rejected_count=row_count),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,mission_id,source_version_id,profile_version_id,file_digest),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_version_id) REFERENCES app.counterparty_profile_version(tenant_id,id),
 FOREIGN KEY(tenant_id,source_version_id) REFERENCES app.supply_source_version(tenant_id,id),
 FOREIGN KEY(tenant_id,command_id) REFERENCES app.supply_command(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);

-- A candidate company. company-level facts only: no column for a person. network_task_id and sync_run_id are plain ids here; the
-- partner and connector slices add their own tables and foreign keys. command_id may be empty only for a connector row, written by
-- the background worker with no person behind it (its created_by is then the intake service principal).
CREATE TABLE app.supply_candidate (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 mission_id uuid NOT NULL,
 profile_version_id uuid NOT NULL,
 source_version_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('manual','file_import','partner_submission','connector')),
 import_batch_id uuid,
 network_task_id uuid,
 sync_run_id uuid,
 external_key text CHECK(external_key IS NULL OR (length(external_key) BETWEEN 1 AND 200 AND external_key !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+')),
 company_name text NOT NULL CHECK(company_name=btrim(company_name) AND length(company_name) BETWEEN 1 AND 160
  AND company_name !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+' AND company_name !~ '\+?[0-9]([[:space:].()-]*[0-9]){6,}'),
 country text NOT NULL REFERENCES app.country(code),
 website_host text CHECK(website_host ~ '^[a-z0-9]([a-z0-9.-]{0,118}[a-z0-9])?$'),
 public_identifier text CHECK(public_identifier=btrim(public_identifier) AND length(public_identifier) BETWEEN 1 AND 80 AND public_identifier !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'),
 size_band text CHECK(size_band IN ('micro','small','medium','large')),
 counterparty_types text[] NOT NULL DEFAULT '{}' CHECK(counterparty_types <@ ARRAY['importer','distributor','wholesaler','retailer','brand_owner','manufacturer','online_retailer','agent','institutional_buyer']::text[] AND cardinality(counterparty_types)<=8),
 nomination_note text CHECK(nomination_note=btrim(nomination_note) AND length(nomination_note) BETWEEN 3 AND 500
  AND nomination_note !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+' AND nomination_note !~ '\+?[0-9]([[:space:].()-]*[0-9]){6,}'),
 name_key text NOT NULL CHECK(length(name_key) BETWEEN 1 AND 160),
 warnings text[] NOT NULL DEFAULT '{}' CHECK(warnings <@ ARRAY['personal_name_check']::text[]),
 nomination_source_id uuid NOT NULL,
 observed_at timestamptz NOT NULL,
 retention_until timestamptz NOT NULL CHECK(retention_until>observed_at),
 licence_scope text NOT NULL CHECK(licence_scope IN ('internal_only','publication')),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(method='connector' OR command_id IS NOT NULL),
 CHECK(method<>'connector' OR sync_run_id IS NOT NULL),
 CHECK(method<>'manual' OR (import_batch_id IS NULL AND network_task_id IS NULL AND sync_run_id IS NULL)),
 CHECK(method<>'file_import' OR (import_batch_id IS NOT NULL AND network_task_id IS NULL AND sync_run_id IS NULL)),
 CHECK(method<>'partner_submission' OR (network_task_id IS NOT NULL AND import_batch_id IS NULL AND sync_run_id IS NULL)),
 CHECK(method<>'connector' OR (sync_run_id IS NOT NULL AND import_batch_id IS NULL AND network_task_id IS NULL)),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_version_id) REFERENCES app.counterparty_profile_version(tenant_id,id),
 FOREIGN KEY(tenant_id,source_version_id) REFERENCES app.supply_source_version(tenant_id,id),
 FOREIGN KEY(tenant_id,import_batch_id) REFERENCES app.supply_import_batch(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,nomination_source_id) REFERENCES app.source_record(tenant_id,id),
 FOREIGN KEY(tenant_id,command_id) REFERENCES app.supply_command(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX supply_candidate_external_key ON app.supply_candidate(tenant_id,mission_id,source_version_id,external_key) WHERE external_key IS NOT NULL;
CREATE INDEX supply_candidate_mission_idx ON app.supply_candidate(tenant_id,mission_id,created_at DESC);

CREATE TABLE app.supply_candidate_review (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 seq bigint GENERATED ALWAYS AS IDENTITY,
 candidate_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('QUALIFIED','WRONG_FIT','DUPLICATE','EXPIRED','REJECTED_SOURCE')),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{1,39}$'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500 AND reason !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'),
 reviewer uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,candidate_id) REFERENCES app.supply_candidate(tenant_id,id),
 FOREIGN KEY(tenant_id,command_id) REFERENCES app.supply_command(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX supply_candidate_review_latest_idx ON app.supply_candidate_review(tenant_id,candidate_id,seq DESC);

CREATE TABLE app.supply_candidate_match (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 seq bigint GENERATED ALWAYS AS IDENTITY,
 candidate_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('MATCH','NO_MATCH','REVERSE')),
 organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 reverse_of uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500 AND reason !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((decision='REVERSE')=(reverse_of IS NOT NULL)),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,reverse_of),
 FOREIGN KEY(tenant_id,candidate_id) REFERENCES app.supply_candidate(tenant_id,id),
 FOREIGN KEY(tenant_id,reverse_of) REFERENCES app.supply_candidate_match(tenant_id,id),
 FOREIGN KEY(tenant_id,command_id) REFERENCES app.supply_command(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX supply_candidate_match_latest_idx ON app.supply_candidate_match(tenant_id,candidate_id,seq DESC);

-- A company asked not to be contacted: an organisation (and, through the merge helper, every organisation merged with it) or, for a
-- company not yet in the catalogue, a name key and country. The latest row of a subject decides.
CREATE TABLE app.supply_do_not_contact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 seq bigint GENERATED ALWAYS AS IDENTITY,
 organisation_id uuid REFERENCES app.organisation(id),
 name_key text CHECK(length(name_key) BETWEEN 1 AND 160),
 country text REFERENCES app.country(code),
 state text NOT NULL CHECK(state IN ('BLOCKED','LIFTED')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500 AND reason !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'),
 reference text NOT NULL CHECK(length(reference) BETWEEN 3 AND 120 AND reference !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+' AND reference !~ '\+?[0-9]([[:space:].()-]*[0-9]){6,}'),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 command_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((organisation_id IS NOT NULL AND name_key IS NULL AND country IS NULL) OR (organisation_id IS NULL AND name_key IS NOT NULL AND country IS NOT NULL)),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,command_id) REFERENCES app.supply_command(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX supply_do_not_contact_org_idx ON app.supply_do_not_contact(tenant_id,organisation_id,seq DESC);
CREATE INDEX supply_do_not_contact_name_idx ON app.supply_do_not_contact(tenant_id,name_key,country,seq DESC);

-- The module's command list grows by the S3 commands. Existing rows still satisfy it.
ALTER TABLE app.supply_command DROP CONSTRAINT supply_command_action_check,
 ADD CONSTRAINT supply_command_action_check CHECK(action IN ('save_profile','create_source','add_source_version','add_candidate','import_file','review_candidate','match_candidate','block_company','lift_company'));

-- ---------------------------------------------------------------------------------------------------------------------------
-- Private helpers. Granted to nobody: called only from the definer functions and triggers below, so none is a cross-tenant oracle.
-- ---------------------------------------------------------------------------------------------------------------------------

-- The canonical organisation of an organisation, as app.research_canonical answers it, but scoped by tenant only and with no
-- app.can_access test, so the answer does not depend on who calls it (a customer session or a session-less receipt insert too).
CREATE FUNCTION app.supply_canonical_org(p_tenant uuid,p_org uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT r.survivor_id FROM app.entity_resolution r JOIN app.entity_candidate c ON c.tenant_id=r.tenant_id AND c.id=r.candidate_id
  WHERE r.tenant_id=p_tenant AND r.decision='MERGE' AND p_org IN (c.left_id,c.right_id)
   AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=p_tenant AND u.reverse_of=r.id) LIMIT 1),p_org)
$$;

-- True when the latest do-not-contact row that applies to this organisation, or to anything merged with it, is BLOCKED.
CREATE FUNCTION app.supply_org_blocked(p_tenant uuid,p_org uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT d.state='BLOCKED' FROM app.supply_do_not_contact d
  WHERE d.tenant_id=p_tenant AND d.organisation_id IS NOT NULL
   AND app.supply_canonical_org(p_tenant,d.organisation_id)=app.supply_canonical_org(p_tenant,p_org)
  ORDER BY d.seq DESC LIMIT 1),false)
$$;

CREATE FUNCTION app.supply_name_blocked(p_tenant uuid,p_name_key text,p_country text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT d.state='BLOCKED' FROM app.supply_do_not_contact d
  WHERE d.tenant_id=p_tenant AND d.name_key=p_name_key AND d.country=p_country
  ORDER BY d.seq DESC LIMIT 1),false)
$$;

-- The intake rule (ADR-082 section 3.3): the exact source version is the latest of its source and active; staff research is allowed on
-- every route; any other kind needs a route pack (TESTING, LIMITED or ACTIVE) listing it, its control open, an agreement that has not
-- ended and a current data rights policy with retention in the future. Takes the mission because the route is the mission's.
CREATE FUNCTION app.supply_source_usable(p_tenant uuid,p_source_version uuid,p_mission uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v app.supply_source_version; k text; pack app.corridor_pack_version; asg app.mission_route_assignment; pol app.data_rights_policy; rec app.source_record;
BEGIN
 SELECT * INTO v FROM app.supply_source_version WHERE tenant_id=p_tenant AND id=p_source_version;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT kind INTO k FROM app.supply_source WHERE tenant_id=p_tenant AND id=v.source_id;
 IF v.status<>'active' OR v.version<>(SELECT max(x.version) FROM app.supply_source_version x WHERE x.tenant_id=p_tenant AND x.source_id=v.source_id) THEN RETURN false; END IF;
 IF k='staff_research' THEN RETURN true; END IF;
 SELECT * INTO asg FROM app.mission_route_assignment WHERE tenant_id=p_tenant AND mission_id=p_mission ORDER BY version DESC LIMIT 1;
 IF NOT FOUND OR asg.status<>'ASSIGNED' THEN RETURN false; END IF;
 SELECT * INTO pack FROM app.corridor_pack_version WHERE tenant_id=p_tenant AND id=asg.pack_id;
 IF NOT FOUND OR pack.status NOT IN ('TESTING','LIMITED','ACTIVE') OR NOT (pack.configuration->'sourceCategories' ? ('supply.'||k)) THEN RETURN false; END IF;
 IF NOT app.supply_control_open(CASE WHEN k='data_platform' THEN 'platform_kind' ELSE 'partner_kinds' END) THEN RETURN false; END IF;
 IF v.agreement_ends_at IS NOT NULL AND v.agreement_ends_at<=now() THEN RETURN false; END IF;
 IF v.source_record_id IS NULL THEN RETURN false; END IF;
 SELECT * INTO rec FROM app.source_record WHERE tenant_id=p_tenant AND id=v.source_record_id;
 IF NOT FOUND OR rec.retention_until<=now() THEN RETURN false; END IF;
 SELECT * INTO pol FROM app.data_rights_policy WHERE tenant_id=p_tenant AND source_id=v.source_record_id AND effective_from<=now() ORDER BY version DESC LIMIT 1;
 RETURN FOUND AND pol.retention_until>now();
END $$;

-- The command preamble every supply command shares (the 0001 pattern, once instead of seven times): the person, the tenant, the role,
-- fresh MFA when asked, the module control unless the command is a safety command, the per-command lock and the exact retry.
-- Returns the stored result of an exact retry, or NULL when the command should go on. The same id with changed content is refused.
CREATE FUNCTION app.supply_command_enter(p_tenant uuid,p_command uuid,p_hash text,p_action text,p_roles text[],p_mfa boolean,p_allow_paused boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); seen record;
BEGIN
 IF actor IS NULL OR p_tenant IS DISTINCT FROM NULLIF(current_setting('corridra.tenant_id',true),'')::uuid
  OR NOT app.can_access(p_tenant,'INTERNAL',app.tenant_processing_purpose(p_tenant))
  OR NOT (app.tenant_is_synthetic(p_tenant) OR app.real_use_allowed(p_tenant))
  OR NOT coalesce(app.member_role(p_tenant)=ANY(p_roles),false)
  OR (p_mfa AND NOT coalesce(app.fresh_mfa(),false)) THEN
  RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
 END IF;
 IF NOT p_allow_paused AND NOT app.supply_module_enabled() THEN RAISE EXCEPTION 'Supply sources are paused. Records stay readable.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':supply-command:'||p_command::text,0));
 SELECT request_hash,result,staff_actor,action INTO seen FROM app.supply_command WHERE tenant_id=p_tenant AND command_id=p_command;
 IF FOUND THEN
  IF seen.request_hash<>p_hash OR seen.staff_actor IS DISTINCT FROM actor OR seen.action<>p_action THEN RAISE EXCEPTION 'Command ID reused with different values'; END IF;
  RETURN seen.result;
 END IF;
 RETURN NULL;
END $$;

-- Writes the command row last: the result holds ids only.
CREATE FUNCTION app.supply_command_done(p_tenant uuid,p_row uuid,p_command uuid,p_action text,p_hash text,p_result jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO app.supply_command(id,tenant_id,command_id,actor_kind,staff_actor,action,request_hash,result)
  VALUES(p_row,p_tenant,p_command,'staff',app.actor_id(),p_action,p_hash,p_result);
 RETURN p_result;
END $$;

-- One candidate, with its nomination source and one self-declared claim per nominated fact. Called by the manual command and, one row
-- at a time inside a subtransaction, by the file import. It checks everything about the company; the caller has checked the mission,
-- the profile version and the source. Raises only the module's fixed sentences.
CREATE FUNCTION app.supply_insert_candidate(p_tenant uuid,p_mission uuid,p_profile_version uuid,p_source_version uuid,p_method text,p_batch uuid,p_external_key text,
 p_company text,p_country text,p_host text,p_identifier text,p_size_band text,p_types text[],p_note text,p_observed_at timestamptz,p_locator text,p_command_row uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); sv app.supply_source_version; kind text; rec app.source_record; pol app.data_rights_policy; retention timestamptz;
 key text; warn text[]:='{}'; scope text; src uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); purpose text:=app.tenant_processing_purpose(p_tenant);
 email text:='[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'; phone text:='\+?[0-9]([[:space:].()-]*[0-9]){6,}';
BEGIN
 IF p_company ~ email OR p_company ~ phone OR coalesce(p_note,'') ~ email OR coalesce(p_note,'') ~ phone OR coalesce(p_identifier,'') ~ email OR coalesce(p_locator,'') ~ email THEN
  RAISE EXCEPTION 'Remove contact details; personal data cannot be recorded here.';
 END IF;
 key:=customer_private.organisation_link_name_key(p_company);
 IF key='' THEN RAISE EXCEPTION 'Enter the company name.'; END IF;
 IF app.supply_name_blocked(p_tenant,key,p_country) THEN
  RAISE EXCEPTION 'This company asked not to be contacted.';
 END IF;
 IF p_observed_at>now() THEN RAISE EXCEPTION 'The observation date cannot be in the future.'; END IF;
 SELECT * INTO sv FROM app.supply_source_version WHERE tenant_id=p_tenant AND id=p_source_version;
 SELECT s.kind INTO kind FROM app.supply_source s WHERE s.tenant_id=p_tenant AND s.id=sv.source_id;
 IF sv.source_record_id IS NOT NULL THEN
  SELECT * INTO rec FROM app.source_record WHERE tenant_id=p_tenant AND id=sv.source_record_id;
  SELECT * INTO pol FROM app.data_rights_policy WHERE tenant_id=p_tenant AND source_id=sv.source_record_id AND effective_from<=now() ORDER BY version DESC LIMIT 1;
 END IF;
 -- The earliest of the source record, its current rights policy, the agreement end and the default months from the observation.
 retention:=least(rec.retention_until,pol.retention_until,sv.agreement_ends_at,p_observed_at+make_interval(months=>sv.default_retention_months));
 IF retention<=now() OR retention<=p_observed_at THEN RAISE EXCEPTION 'The retention date for this record has passed.'; END IF;
 scope:=CASE WHEN kind='staff_research' THEN 'publication' WHEN pol.id IS NOT NULL AND 'PUBLICATION'=ANY(pol.permitted_reuse) THEN 'publication' ELSE 'internal_only' END;
 -- The ADR-079 rule: a legal-form word is deleted from the name key, so a key equal to the plain letters of the name means no word was
 -- deleted and the company may be a sole trader, which is personal data. A prompt to look, not a judgement.
 IF key=regexp_replace(regexp_replace(lower(p_company),CASE WHEN app.tenant_is_synthetic(p_tenant) THEN '^synthetic[[:space:]]+' ELSE '^$' END,''),'[^[:alnum:]]+','','g') THEN
  warn:=ARRAY['personal_name_check'];
 END IF;
 INSERT INTO app.source_record(id,tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by)
  VALUES(src,p_tenant,'document',p_locator,p_observed_at,'PUBLIC',purpose,retention,'DENY',actor);
 INSERT INTO app.supply_candidate(id,tenant_id,mission_id,profile_version_id,source_version_id,method,import_batch_id,external_key,company_name,country,website_host,public_identifier,
  size_band,counterparty_types,nomination_note,name_key,warnings,nomination_source_id,observed_at,retention_until,licence_scope,created_by,command_id)
  VALUES(cid,p_tenant,p_mission,p_profile_version,p_source_version,p_method,p_batch,p_external_key,p_company,p_country,p_host,p_identifier,
  p_size_band,coalesce(p_types,'{}'),p_note,key,warn,src,p_observed_at,retention,scope,actor,p_command_row);
 INSERT INTO app.claim(tenant_id,source_id,statement,classification,purpose,created_by)
  SELECT p_tenant,src,f.statement,'PUBLIC',purpose,actor FROM (VALUES
   (1,'Company name: '||p_company),(2,'Country: '||p_country),(3,CASE WHEN p_host IS NOT NULL THEN 'Website host: '||p_host END),
   (4,CASE WHEN p_identifier IS NOT NULL THEN 'Public identifier: '||p_identifier END),(5,CASE WHEN p_size_band IS NOT NULL THEN 'Size band: '||p_size_band END),
   (6,CASE WHEN cardinality(coalesce(p_types,'{}'))>0 THEN 'Counterparty types: '||array_to_string(p_types,', ') END)) f(n,statement)
  WHERE f.statement IS NOT NULL ORDER BY f.n;
 RETURN cid;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Guard triggers on the module's own tables, so a direct insert by the table owner is held to the same shape.
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION app.guard_supply_source_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k text; pol app.data_rights_policy; rec app.source_record;
BEGIN
 SELECT kind INTO k FROM app.supply_source WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source unavailable'; END IF;
 IF NEW.version<>coalesce((SELECT max(version) FROM app.supply_source_version WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id),0)+1 THEN
  RAISE EXCEPTION 'This source changed. Reload it and try again.';
 END IF;
 IF NEW.status='active' AND NEW.agreement_ends_at IS NOT NULL AND NEW.agreement_ends_at<=now() THEN
  RAISE EXCEPTION 'The agreement end date must be in the future.';
 END IF;
 IF NEW.status='active' AND k<>'staff_research' THEN
  IF NEW.source_record_id IS NULL OR NOT app.supply_control_open(CASE WHEN k='data_platform' THEN 'platform_kind' ELSE 'partner_kinds' END) THEN
   RAISE EXCEPTION 'This kind of source needs an agreement record with current reuse rights before it can be active.';
  END IF;
  SELECT * INTO rec FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_record_id;
  SELECT * INTO pol FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_record_id AND effective_from<=now() ORDER BY version DESC LIMIT 1;
  IF rec.id IS NULL OR rec.retention_until<=now() OR pol.id IS NULL OR pol.retention_until<=now() THEN
   RAISE EXCEPTION 'This kind of source needs an agreement record with current reuse rights before it can be active.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supply_source_version_guard BEFORE INSERT ON app.supply_source_version FOR EACH ROW EXECUTE FUNCTION app.guard_supply_source_version();

CREATE FUNCTION app.guard_supply_candidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.retention_until<=now() THEN RAISE EXCEPTION 'The retention date for this record has passed.'; END IF;
 IF NEW.name_key IS DISTINCT FROM customer_private.organisation_link_name_key(NEW.company_name) THEN RAISE EXCEPTION 'The name key does not match the company name'; END IF;
 IF NOT EXISTS(SELECT FROM app.counterparty_profile_version WHERE tenant_id=NEW.tenant_id AND id=NEW.profile_version_id AND mission_id=NEW.mission_id) THEN
  RAISE EXCEPTION 'Profile version unavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supply_candidate_guard BEFORE INSERT ON app.supply_candidate FOR EACH ROW EXECUTE FUNCTION app.guard_supply_candidate();

-- Append only, and events (ids, version and status only). The candidate carries the capability event, which falls back to the intake
-- service principal when no person is behind the write (the connector worker, S6).
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['supply_source','supply_source_version','supply_import_batch','supply_candidate','supply_candidate_review','supply_candidate_match','supply_do_not_contact'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t||'_immutable',t);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION %s',t||'_event',t,CASE WHEN t='supply_candidate' THEN 'app.record_capability_change()' ELSE 'app.record_change()' END);
 END LOOP;
END $$;

-- Staff of the tenant read; nobody writes through a table. Synthetic and real tenants are separate policies.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['supply_source','supply_source_version','supply_import_batch','supply_candidate','supply_candidate_review','supply_candidate_match','supply_do_not_contact'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer'',''viewer''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('CREATE POLICY real_use_read ON app.%I FOR SELECT TO corridra_runtime USING(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer'',''viewer''))',t);
  EXECUTE format('CREATE POLICY real_use_add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,corridra_auth,corridra_runtime',t);
  IF t<>'supply_candidate' THEN EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',t); END IF;
 END LOOP;
END $$;
-- The company name, host, identifier, note and name key are not selectable by the runtime login; they are read only through
-- app.supply_candidate_read and app.supply_candidate_detail, which stop returning them once the retention date has passed. That
-- masking covers the candidate row and this module's reads only: the same nominated facts are also written as claims in app.claim
-- against the nomination source record, under the core claim model (ADR-082 sections 1 and 6), which this slice does not change
-- and which carries no supply-side expiry of its own.
GRANT SELECT(id,tenant_id,mission_id,profile_version_id,source_version_id,method,import_batch_id,network_task_id,sync_run_id,external_key,country,size_band,counterparty_types,
 warnings,nomination_source_id,observed_at,retention_until,licence_scope,created_by,command_id,created_at) ON app.supply_candidate TO corridra_runtime;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Commands. Staff with research.manage roles (owner, admin, operator) unless the command says otherwise; each returns ids only.
-- ---------------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION app.supply_create_source(p_tenant uuid,p_command uuid,p_hash text,p_kind text,p_label text,p_source_record uuid,p_months integer,p_agreement_ends timestamptz,p_status text,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); actor uuid:=app.actor_id();
BEGIN
 -- Activating a kind that needs an agreement takes an owner or admin with fresh MFA; everything else is research.manage.
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'create_source',
  CASE WHEN p_status='active' AND p_kind<>'staff_research' THEN ARRAY['owner','admin'] ELSE ARRAY['owner','admin','operator'] END,
  p_status='active' AND p_kind<>'staff_research',false);
 IF done IS NOT NULL THEN RETURN done; END IF;
 IF p_source_record IS NOT NULL AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=p_tenant AND id=p_source_record AND app.can_access(tenant_id,classification,purpose)) THEN
  RAISE EXCEPTION 'Source unavailable';
 END IF;
 INSERT INTO app.supply_source(id,tenant_id,kind,created_by) VALUES(sid,p_tenant,p_kind,actor);
 INSERT INTO app.supply_source_version(id,tenant_id,source_id,version,status,label,source_record_id,default_retention_months,agreement_ends_at,reason,created_by,command_id)
  VALUES(vid,p_tenant,sid,1,p_status,p_label,p_source_record,p_months,p_agreement_ends,p_reason,actor,row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'create_source',p_hash,jsonb_build_object('sourceId',sid,'sourceVersionId',vid,'version',1));
END $$;

-- Pause, resume and retire are this command with another status. A stale expected version is refused.
CREATE FUNCTION app.supply_add_source_version(p_tenant uuid,p_command uuid,p_hash text,p_source uuid,p_expected integer,p_status text,p_label text,p_source_record uuid,p_months integer,p_agreement_ends timestamptz,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); actor uuid:=app.actor_id(); k text; latest integer;
BEGIN
 SELECT kind INTO k FROM app.supply_source WHERE tenant_id=p_tenant AND id=p_source;
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'add_source_version',
  CASE WHEN p_status='active' AND k IS DISTINCT FROM 'staff_research' THEN ARRAY['owner','admin'] ELSE ARRAY['owner','admin','operator'] END,
  p_status='active' AND k IS DISTINCT FROM 'staff_research',false);
 IF done IS NOT NULL THEN RETURN done; END IF;
 IF k IS NULL THEN RAISE EXCEPTION 'Source unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':supply-source:'||p_source::text,0));
 SELECT max(version) INTO latest FROM app.supply_source_version WHERE tenant_id=p_tenant AND source_id=p_source;
 IF latest IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'This source changed. Reload it and try again.'; END IF;
 IF p_source_record IS NOT NULL AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=p_tenant AND id=p_source_record AND app.can_access(tenant_id,classification,purpose)) THEN
  RAISE EXCEPTION 'Source unavailable';
 END IF;
 INSERT INTO app.supply_source_version(id,tenant_id,source_id,version,status,label,source_record_id,default_retention_months,agreement_ends_at,reason,created_by,command_id)
  VALUES(vid,p_tenant,p_source,latest+1,p_status,p_label,p_source_record,p_months,p_agreement_ends,p_reason,actor,row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'add_source_version',p_hash,jsonb_build_object('sourceId',p_source,'sourceVersionId',vid,'version',latest+1));
END $$;

-- The checks every intake shares for the mission, the profile version and the source.
CREATE FUNCTION app.supply_intake_checks(p_tenant uuid,p_mission uuid,p_profile_version uuid,p_source_version uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ms text;
BEGIN
 SELECT status INTO ms FROM app.mission WHERE tenant_id=p_tenant AND id=p_mission FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mission unavailable'; END IF;
 IF ms IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'This mission is closed, so its candidates cannot change.'; END IF;
 IF NOT EXISTS(SELECT FROM app.counterparty_profile_version WHERE tenant_id=p_tenant AND id=p_profile_version AND mission_id=p_mission) THEN RAISE EXCEPTION 'Profile version unavailable'; END IF;
 IF NOT app.supply_source_usable(p_tenant,p_source_version,p_mission) THEN RAISE EXCEPTION 'This source is not active. Check its status and agreement.'; END IF;
END $$;

-- Manual entry: one transaction, one candidate, its nomination source and one claim per fact, and the command row.
CREATE FUNCTION app.supply_add_candidate(p_tenant uuid,p_command uuid,p_hash text,p_mission uuid,p_profile_version uuid,p_source_version uuid,p_company text,p_country text,p_host text,p_identifier text,
 p_size_band text,p_types text[],p_note text,p_observed_at timestamptz,p_locator text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); cid uuid;
BEGIN
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'add_candidate',ARRAY['owner','admin','operator'],false,false);
 IF done IS NOT NULL THEN RETURN done; END IF;
 PERFORM app.supply_intake_checks(p_tenant,p_mission,p_profile_version,p_source_version);
 cid:=app.supply_insert_candidate(p_tenant,p_mission,p_profile_version,p_source_version,'manual',NULL,NULL,p_company,p_country,p_host,p_identifier,p_size_band,p_types,p_note,p_observed_at,p_locator,row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'add_candidate',p_hash,
  jsonb_build_object('candidateId',cid,'warnings',(SELECT to_jsonb(warnings) FROM app.supply_candidate WHERE tenant_id=p_tenant AND id=cid)));
END $$;

-- File import: up to 100 rows, each judged on its own in a subtransaction; valid rows land, the others are reported by row number
-- and reason code. The same file for the same mission, source version and profile version returns the first batch. Needs the
-- staff_file_import control, which no installer value opens.
CREATE FUNCTION app.supply_import_file(p_tenant uuid,p_command uuid,p_hash text,p_mission uuid,p_profile_version uuid,p_source_version uuid,p_digest text,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); old app.supply_import_batch; r jsonb; v_n integer; v_cells jsonb; v_code text; v_results jsonb:='[]'::jsonb;
 v_accepted integer:=0; v_rejected integer:=0; v_msg text; v_state text; v_observed timestamptz; v_types text[]; v_size text; v_country text; v_host text; v_ident text; v_company text; v_locator text;
BEGIN
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'import_file',ARRAY['owner','admin','operator'],false,false);
 IF done IS NOT NULL THEN RETURN done; END IF;
 IF NOT app.supply_control_open('staff_file_import') THEN RAISE EXCEPTION 'File import is not available yet.'; END IF;
 IF p_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid file digest'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)<1 THEN RAISE EXCEPTION 'Include at least one candidate row'; END IF;
 IF jsonb_array_length(p_rows)>100 THEN RAISE EXCEPTION 'Use at most 100 candidate rows'; END IF;
 PERFORM app.supply_intake_checks(p_tenant,p_mission,p_profile_version,p_source_version);
 SELECT * INTO old FROM app.supply_import_batch WHERE tenant_id=p_tenant AND mission_id=p_mission AND source_version_id=p_source_version AND profile_version_id=p_profile_version AND file_digest=p_digest;
 IF FOUND THEN
  RETURN app.supply_command_done(p_tenant,row_id,p_command,'import_file',p_hash,
   jsonb_build_object('batchId',old.id,'accepted',old.accepted_count,'rejected',old.rejected_count,'duplicate',true));
 END IF;
 FOR r IN SELECT e FROM jsonb_array_elements(p_rows) e LOOP
  v_n:=(r->>'row')::integer; v_cells:=r->'cells'; v_code:='ok';
  BEGIN
   v_company:=btrim(coalesce(v_cells->>'company_name','')); v_country:=upper(btrim(coalesce(v_cells->>'country',''))); v_host:=lower(nullif(btrim(coalesce(v_cells->>'website_host','')),''));
   v_ident:=nullif(btrim(coalesce(v_cells->>'public_identifier','')),''); v_size:=lower(nullif(btrim(coalesce(v_cells->>'size_band','')),'')); v_locator:=btrim(coalesce(v_cells->>'source_locator',''));
   IF length(v_company)<1 THEN v_code:='bad_name';
   ELSIF length(v_company)>160 OR length(coalesce(v_host,''))>120 OR length(coalesce(v_ident,''))>80 OR length(v_locator)>500 THEN v_code:='too_long';
   ELSIF NOT EXISTS(SELECT FROM app.country k WHERE k.code=v_country) THEN v_code:='bad_country';
   ELSIF v_size IS NOT NULL AND v_size NOT IN ('micro','small','medium','large') THEN v_code:='bad_size';
   ELSIF v_host IS NOT NULL AND v_host !~ '^[a-z0-9]([a-z0-9.-]{0,118}[a-z0-9])?$' THEN v_code:='bad_host';
   ELSIF length(v_locator)<1 THEN v_code:='bad_locator';
   END IF;
   IF v_code='ok' THEN
    v_types:=ARRAY(SELECT lower(btrim(t)) FROM unnest(string_to_array(coalesce(v_cells->>'counterparty_types',''),'|')) t WHERE btrim(t)<>'');
    IF cardinality(v_types)>8 OR EXISTS(SELECT FROM unnest(v_types) t WHERE t<>ALL(ARRAY['importer','distributor','wholesaler','retailer','brand_owner','manufacturer','online_retailer','agent','institutional_buyer']))
     OR cardinality(v_types)<>(SELECT count(DISTINCT t) FROM unnest(v_types) t) THEN v_code:='bad_types'; END IF;
   END IF;
   IF v_code='ok' THEN
    BEGIN v_observed:=btrim(coalesce(v_cells->>'observed_at',''))::timestamptz; EXCEPTION WHEN OTHERS THEN v_code:='bad_date'; END;
   END IF;
   IF v_code='ok' THEN
    PERFORM app.supply_insert_candidate(p_tenant,p_mission,p_profile_version,p_source_version,'file_import',batch,'row-'||v_n||'-'||left(p_digest,12),v_company,v_country,v_host,v_ident,v_size,v_types,NULL,v_observed,v_locator,row_id);
   END IF;
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_msg=MESSAGE_TEXT,v_state=RETURNED_SQLSTATE;
   v_code:=CASE v_msg
    WHEN 'Remove contact details; personal data cannot be recorded here.' THEN 'contact_details'
    WHEN 'This company asked not to be contacted.' THEN 'dnc_blocked'
    WHEN 'Enter the company name.' THEN 'bad_name'
    WHEN 'The observation date cannot be in the future.' THEN 'bad_date'
    WHEN 'The retention date for this record has passed.' THEN 'bad_date'
    ELSE CASE WHEN v_state='23505' THEN 'duplicate_key' ELSE NULL END END;
   -- Anything else is not a row problem: the whole import fails and nothing is written.
   IF v_code IS NULL THEN RAISE; END IF;
  END;
  IF v_code='ok' THEN v_accepted:=v_accepted+1; ELSE v_rejected:=v_rejected+1; END IF;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_n,'code',v_code));
 END LOOP;
 INSERT INTO app.supply_import_batch(id,tenant_id,mission_id,profile_version_id,source_version_id,file_digest,row_count,accepted_count,rejected_count,row_results,created_by,command_id)
  VALUES(batch,p_tenant,p_mission,p_profile_version,p_source_version,p_digest,jsonb_array_length(p_rows),v_accepted,v_rejected,v_results,app.actor_id(),row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'import_file',p_hash,jsonb_build_object('batchId',batch,'accepted',v_accepted,'rejected',v_rejected,'duplicate',false));
END $$;

-- The latest un-reversed MATCH of a candidate, if any.
CREATE FUNCTION app.supply_current_match(p_tenant uuid,p_candidate uuid) RETURNS app.supply_candidate_match
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m FROM app.supply_candidate_match m WHERE m.tenant_id=p_tenant AND m.candidate_id=p_candidate AND m.decision='MATCH'
  AND NOT EXISTS(SELECT FROM app.supply_candidate_match u WHERE u.tenant_id=p_tenant AND u.reverse_of=m.id) ORDER BY m.seq DESC LIMIT 1
$$;

-- Append only seller-independent review of a candidate. QUALIFIED is refused when the retention date has passed, when the company
-- asked not to be contacted (by name and country, or through a matched organisation), and, for a partner's candidate, when the
-- reviewer is the person who submitted it.
CREATE FUNCTION app.supply_review_candidate(p_tenant uuid,p_command uuid,p_hash text,p_candidate uuid,p_decision text,p_reason_code text,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); cand app.supply_candidate; cur app.supply_candidate_match; actor uuid:=app.actor_id();
BEGIN
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'review_candidate',ARRAY['owner','admin','operator'],false,false);
 IF done IS NOT NULL THEN RETURN done; END IF;
 -- One decider per candidate at a time: the candidate row is only held FOR SHARE, so two sessions would otherwise read the same
 -- latest decision and both write. The match command takes the same lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':supply-candidate:'||p_candidate::text,0));
 SELECT * INTO cand FROM app.supply_candidate WHERE tenant_id=p_tenant AND id=p_candidate FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Candidate unavailable'; END IF;
 IF p_decision='QUALIFIED' THEN
  IF cand.retention_until<=now() THEN RAISE EXCEPTION 'This candidate has expired and can no longer be decided.'; END IF;
  IF app.supply_name_blocked(p_tenant,cand.name_key,cand.country) THEN RAISE EXCEPTION 'This company asked not to be contacted.'; END IF;
  cur:=app.supply_current_match(p_tenant,p_candidate);
  IF cur.id IS NOT NULL AND app.supply_org_blocked(p_tenant,cur.organisation_id) THEN RAISE EXCEPTION 'This company asked not to be contacted.'; END IF;
  IF cand.method='partner_submission' AND cand.created_by=actor THEN RAISE EXCEPTION 'The reviewer must be someone other than the person who submitted it.'; END IF;
 END IF;
 INSERT INTO app.supply_candidate_review(id,tenant_id,candidate_id,decision,reason_code,reason,reviewer,command_id) VALUES(rid,p_tenant,p_candidate,p_decision,p_reason_code,p_reason,actor,row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'review_candidate',p_hash,jsonb_build_object('reviewId',rid,'candidateId',p_candidate));
END $$;

-- Append only link of a candidate to one organisation (the ADR-017 pattern: a reverse names the exact earlier decision).
CREATE FUNCTION app.supply_match_candidate(p_tenant uuid,p_command uuid,p_hash text,p_candidate uuid,p_decision text,p_organisation uuid,p_reverse_of uuid,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); cand app.supply_candidate; o app.organisation; cur app.supply_candidate_match; prior app.supply_candidate_match;
 rights text; org uuid:=p_organisation; actor uuid:=app.actor_id();
BEGIN
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'match_candidate',ARRAY['owner','admin','operator'],false,false);
 IF done IS NOT NULL THEN RETURN done; END IF;
 -- One decider per candidate at a time, so two concurrent matches cannot both pass the current-match test and leave two
 -- un-reversed MATCH rows. The review command takes the same lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':supply-candidate:'||p_candidate::text,0));
 SELECT * INTO cand FROM app.supply_candidate WHERE tenant_id=p_tenant AND id=p_candidate FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Candidate unavailable'; END IF;
 IF p_decision='REVERSE' THEN
  SELECT * INTO prior FROM app.supply_candidate_match WHERE tenant_id=p_tenant AND id=p_reverse_of;
  cur:=app.supply_current_match(p_tenant,p_candidate);
  IF NOT FOUND OR prior.candidate_id<>p_candidate OR cur.id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION 'Reverse the latest match of this candidate.'; END IF;
  org:=prior.organisation_id;
 ELSE
  SELECT * INTO o FROM app.organisation WHERE id=org;
  IF NOT FOUND OR NOT customer_private.organisation_link_same_context(o.synthetic,app.tenant_is_synthetic(p_tenant)) OR customer_private.organisation_link_suppressed(org) THEN
   RAISE EXCEPTION 'Organisation unavailable';
  END IF;
  IF p_decision='MATCH' THEN
   IF cand.retention_until<=now() THEN RAISE EXCEPTION 'This candidate has expired and can no longer be decided.'; END IF;
   IF app.supply_org_blocked(p_tenant,org) THEN RAISE EXCEPTION 'This company asked not to be contacted.'; END IF;
   cur:=app.supply_current_match(p_tenant,p_candidate);
   IF cur.id IS NOT NULL THEN RAISE EXCEPTION 'Reverse the current match first.'; END IF;
   SELECT r.source_type INTO rights FROM customer_private.organisation_source_rights r WHERE r.organisation_id=org ORDER BY r.version DESC LIMIT 1;
   IF rights IN ('licensed_dataset','other') THEN RAISE EXCEPTION 'This company was recorded from a licensed or unclassified source. Record it from a public source first.'; END IF;
  END IF;
 END IF;
 INSERT INTO app.supply_candidate_match(id,tenant_id,candidate_id,decision,organisation_id,reverse_of,reason,created_by,command_id)
  VALUES(mid,p_tenant,p_candidate,p_decision,org,CASE WHEN p_decision='REVERSE' THEN p_reverse_of END,p_reason,actor,row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'match_candidate',p_hash,jsonb_build_object('matchId',mid,'candidateId',p_candidate));
END $$;

-- Do-not-contact. Both commands work while the module is paused: they protect a third party, and a safety exception must not be
-- locked behind the module switch. Blocking needs research.manage; lifting needs an owner or admin with fresh MFA.
-- Either command may name an existing row of the same tenant instead of a subject. The subject is then taken from that row as it
-- was recorded, so a block on a name whose key is not the name again (an ampersand, punctuation, a legal-form word) can still be
-- lifted and blocked again. A row of another tenant, or none, answers 'Block unavailable'.
CREATE FUNCTION app.supply_dnc_row(p_tenant uuid,p_block uuid) RETURNS app.supply_do_not_contact
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.supply_do_not_contact;
BEGIN
 SELECT * INTO d FROM app.supply_do_not_contact WHERE tenant_id=p_tenant AND id=p_block;
 IF NOT FOUND THEN RAISE EXCEPTION 'Block unavailable'; END IF;
 RETURN d;
END $$;

CREATE FUNCTION app.supply_block_company(p_tenant uuid,p_command uuid,p_hash text,p_organisation uuid,p_company text,p_country text,p_reason text,p_reference text,p_block uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); bid uuid:=gen_random_uuid(); v_key text; v_country text:=p_country; v_org uuid:=p_organisation; o app.organisation; d app.supply_do_not_contact;
BEGIN
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'block_company',ARRAY['owner','admin','operator'],false,true);
 IF done IS NOT NULL THEN RETURN done; END IF;
 IF p_block IS NOT NULL THEN
  d:=app.supply_dnc_row(p_tenant,p_block); v_org:=d.organisation_id; v_key:=d.name_key; v_country:=d.country;
 ELSIF v_org IS NOT NULL THEN
  SELECT * INTO o FROM app.organisation WHERE id=v_org;
  IF NOT FOUND OR NOT customer_private.organisation_link_same_context(o.synthetic,app.tenant_is_synthetic(p_tenant)) THEN RAISE EXCEPTION 'Organisation unavailable'; END IF;
 ELSE
  v_key:=customer_private.organisation_link_name_key(p_company);
  IF v_key='' THEN RAISE EXCEPTION 'Enter the company name.'; END IF;
  IF NOT EXISTS(SELECT FROM app.country WHERE code=v_country) THEN RAISE EXCEPTION 'Choose a country.'; END IF;
 END IF;
 INSERT INTO app.supply_do_not_contact(id,tenant_id,organisation_id,name_key,country,state,reason,reference,created_by,command_id)
  VALUES(bid,p_tenant,v_org,CASE WHEN v_org IS NULL THEN v_key END,CASE WHEN v_org IS NULL THEN v_country END,'BLOCKED',p_reason,p_reference,app.actor_id(),row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'block_company',p_hash,jsonb_build_object('blockId',bid));
END $$;

CREATE FUNCTION app.supply_lift_company(p_tenant uuid,p_command uuid,p_hash text,p_organisation uuid,p_company text,p_country text,p_reason text,p_reference text,p_block uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done jsonb; row_id uuid:=gen_random_uuid(); bid uuid:=gen_random_uuid(); v_key text; v_country text:=p_country; v_org uuid:=p_organisation; blocked boolean; d app.supply_do_not_contact;
BEGIN
 done:=app.supply_command_enter(p_tenant,p_command,p_hash,'lift_company',ARRAY['owner','admin'],true,true);
 IF done IS NOT NULL THEN RETURN done; END IF;
 IF p_block IS NOT NULL THEN
  d:=app.supply_dnc_row(p_tenant,p_block); v_org:=d.organisation_id; v_key:=d.name_key; v_country:=d.country;
 ELSIF v_org IS NULL THEN
  v_key:=customer_private.organisation_link_name_key(p_company);
 END IF;
 IF v_org IS NOT NULL THEN blocked:=app.supply_org_blocked(p_tenant,v_org);
 ELSE blocked:=coalesce(v_key,'')<>'' AND app.supply_name_blocked(p_tenant,v_key,v_country);
 END IF;
 IF NOT coalesce(blocked,false) THEN RAISE EXCEPTION 'This company is not blocked.'; END IF;
 INSERT INTO app.supply_do_not_contact(id,tenant_id,organisation_id,name_key,country,state,reason,reference,created_by,command_id)
  VALUES(bid,p_tenant,v_org,CASE WHEN v_org IS NULL THEN v_key END,CASE WHEN v_org IS NULL THEN v_country END,'LIFTED',p_reason,p_reference,app.actor_id(),row_id);
 RETURN app.supply_command_done(p_tenant,row_id,p_command,'lift_company',p_hash,jsonb_build_object('blockId',bid));
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Reads. Staff roles of the tenant, in the synthetic tenant or a real one the real-use switch allows. Readable while paused. The
-- text of a candidate whose retention date has passed is no longer returned: expired is true and the words are null.
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION app.supply_read_allowed(p_tenant uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.actor_id() IS NOT NULL AND p_tenant IS NOT DISTINCT FROM NULLIF(current_setting('corridra.tenant_id',true),'')::uuid
  AND app.can_access(p_tenant,'INTERNAL',app.tenant_processing_purpose(p_tenant)) AND (app.tenant_is_synthetic(p_tenant) OR app.real_use_allowed(p_tenant))
  AND coalesce(app.member_role(p_tenant) IN ('owner','admin','operator','reviewer','viewer'),false)
$$;

CREATE FUNCTION app.supply_candidate_json(p_tenant uuid,c app.supply_candidate) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',c.id,'missionId',c.mission_id,'profileVersionId',c.profile_version_id,'sourceVersionId',c.source_version_id,
  'sourceKind',s.kind,'sourceLabel',sv.label,'sourceVersion',sv.version,'method',c.method,'state','source-reported',
  'companyName',CASE WHEN c.retention_until>now() THEN c.company_name END,'country',c.country,
  'websiteHost',CASE WHEN c.retention_until>now() THEN c.website_host END,'publicIdentifier',CASE WHEN c.retention_until>now() THEN c.public_identifier END,
  'nominationNote',CASE WHEN c.retention_until>now() THEN c.nomination_note END,'sizeBand',c.size_band,'counterpartyTypes',to_jsonb(c.counterparty_types),
  'warnings',to_jsonb(c.warnings),'observedAt',c.observed_at,'retentionUntil',c.retention_until,'expired',c.retention_until<=now(),'licenceScope',c.licence_scope,
  'createdAt',c.created_at,
  'latestReview',(SELECT jsonb_build_object('decision',r.decision,'reasonCode',r.reason_code,'at',r.created_at) FROM app.supply_candidate_review r WHERE r.tenant_id=p_tenant AND r.candidate_id=c.id ORDER BY r.seq DESC LIMIT 1),
  'latestMatch',(SELECT jsonb_build_object('id',m.id,'decision',m.decision,'organisationId',m.organisation_id,'at',m.created_at) FROM app.supply_candidate_match m WHERE m.tenant_id=p_tenant AND m.candidate_id=c.id ORDER BY m.seq DESC LIMIT 1),
  -- The newest un-reversed MATCH, which is the only decision the match command lets staff reverse. The latest match above may be
  -- a NO_MATCH or a reversal.
  'currentMatch',(SELECT jsonb_build_object('id',m.id,'decision',m.decision,'organisationId',m.organisation_id,'at',m.created_at) FROM app.supply_current_match(p_tenant,c.id) m WHERE m.id IS NOT NULL))
 FROM app.supply_source_version sv JOIN app.supply_source s ON s.tenant_id=sv.tenant_id AND s.id=sv.source_id WHERE sv.tenant_id=p_tenant AND sv.id=c.source_version_id
$$;

CREATE FUNCTION app.supply_candidate_read(p_tenant uuid,p_mission uuid,p_limit integer) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.supply_read_allowed(p_tenant) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(q.j ORDER BY q.created_at DESC,q.id) FROM
  (SELECT app.supply_candidate_json(p_tenant,c) AS j,c.created_at,c.id FROM app.supply_candidate c WHERE c.tenant_id=p_tenant AND c.mission_id=p_mission
   ORDER BY c.created_at DESC,c.id LIMIT greatest(1,least(coalesce(p_limit,100),200))) q),'[]'::jsonb);
END $$;

-- One candidate with its review and match history. Reasons are staff text, shown to staff only.
CREATE FUNCTION app.supply_candidate_detail(p_tenant uuid,p_candidate uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.supply_candidate;
BEGIN
 IF NOT app.supply_read_allowed(p_tenant) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM app.supply_candidate WHERE tenant_id=p_tenant AND id=p_candidate;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN app.supply_candidate_json(p_tenant,c)||jsonb_build_object(
  'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'decision',r.decision,'reasonCode',r.reason_code,'reason',r.reason,'reviewer',r.reviewer,'at',r.created_at) ORDER BY r.seq DESC)
   FROM app.supply_candidate_review r WHERE r.tenant_id=p_tenant AND r.candidate_id=p_candidate),'[]'::jsonb),
  'matches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'decision',m.decision,'organisationId',m.organisation_id,
    'organisationName',CASE WHEN customer_private.organisation_link_same_context(o.synthetic,app.tenant_is_synthetic(p_tenant)) AND NOT customer_private.organisation_link_suppressed(o.id) THEN o.name END,
    'reverseOf',m.reverse_of,'reason',m.reason,'decidedBy',m.created_by,'at',m.created_at,'reversed',EXISTS(SELECT FROM app.supply_candidate_match u WHERE u.tenant_id=p_tenant AND u.reverse_of=m.id)) ORDER BY m.seq DESC)
   FROM app.supply_candidate_match m JOIN app.organisation o ON o.id=m.organisation_id WHERE m.tenant_id=p_tenant AND m.candidate_id=p_candidate),'[]'::jsonb));
END $$;

-- Missions of the tenant with their candidate counts, newest first.
CREATE FUNCTION app.supply_missions_read(p_tenant uuid,p_limit integer) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.supply_read_allowed(p_tenant) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,'nextAction',m.next_action,'createdAt',m.created_at,
   'candidates',(SELECT count(*) FROM app.supply_candidate c WHERE c.tenant_id=m.tenant_id AND c.mission_id=m.id),
   'candidatesLive',(SELECT count(*) FROM app.supply_candidate c WHERE c.tenant_id=m.tenant_id AND c.mission_id=m.id AND c.retention_until>now()),
   'profileVersion',(SELECT max(version) FROM app.counterparty_profile_version p WHERE p.tenant_id=m.tenant_id AND p.mission_id=m.id)) ORDER BY m.created_at DESC,m.id)
  FROM (SELECT * FROM app.mission WHERE tenant_id=p_tenant ORDER BY created_at DESC,id LIMIT greatest(1,least(coalesce(p_limit,100),200))) m),'[]'::jsonb);
END $$;

-- True when this row is the latest of its subject, so it is the row that decides for that company.
CREATE FUNCTION app.supply_block_current(p_tenant uuid,d app.supply_do_not_contact) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.seq=(SELECT max(x.seq) FROM app.supply_do_not_contact x WHERE x.tenant_id=p_tenant AND
  ((d.organisation_id IS NOT NULL AND x.organisation_id IS NOT NULL AND app.supply_canonical_org(p_tenant,x.organisation_id)=app.supply_canonical_org(p_tenant,d.organisation_id))
   OR (d.organisation_id IS NULL AND x.name_key=d.name_key AND x.country=d.country)))
$$;

-- Who is blocked now and who was, newest first. An organisation row shows the catalogue name when the organisation is of this
-- tenant's side; a name row shows the name key, which holds the letters of the name without legal-form words. A company blocked
-- now comes first, so the limit can only hide older history, never a block that still applies.
CREATE FUNCTION app.supply_blocks_read(p_tenant uuid,p_limit integer) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.supply_read_allowed(p_tenant) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'organisationId',d.organisation_id,
   'organisationName',CASE WHEN customer_private.organisation_link_same_context(o.synthetic,app.tenant_is_synthetic(p_tenant)) AND NOT customer_private.organisation_link_suppressed(o.id) THEN o.name END,
   'nameKey',d.name_key,'country',coalesce(d.country,o.country),'reason',d.reason,'reference',d.reference,'at',d.created_at,'by',d.created_by,
   'current',d.is_current) ORDER BY (d.is_current AND d.state='BLOCKED') DESC,d.seq DESC)
  FROM (SELECT x.*,app.supply_block_current(p_tenant,x) AS is_current FROM app.supply_do_not_contact x WHERE x.tenant_id=p_tenant
    ORDER BY (app.supply_block_current(p_tenant,x) AND x.state='BLOCKED') DESC,x.seq DESC LIMIT greatest(1,least(coalesce(p_limit,100),200))) d
  LEFT JOIN app.organisation o ON o.id=d.organisation_id),'[]'::jsonb);
END $$;

-- The route pack of a mission as the kinds check sees it: the status and the source categories, or null with no assigned pack.
CREATE FUNCTION app.supply_route_pack(p_tenant uuid,p_mission uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE asg app.mission_route_assignment; pack app.corridor_pack_version;
BEGIN
 IF NOT app.supply_read_allowed(p_tenant) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO asg FROM app.mission_route_assignment WHERE tenant_id=p_tenant AND mission_id=p_mission ORDER BY version DESC LIMIT 1;
 IF NOT FOUND OR asg.status<>'ASSIGNED' THEN RETURN NULL; END IF;
 SELECT * INTO pack FROM app.corridor_pack_version WHERE tenant_id=p_tenant AND id=asg.pack_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('status',pack.status,'sourceCategories',coalesce(pack.configuration->'sourceCategories','[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- The do-not-contact guard on the introduction path: the same four points the contact-state guard uses (a message, its dispatch, a
-- retry of a stopped dispatch, its receipt). Definer on purpose, so a refusal does not depend on the caller's row access, and so a
-- receipt insert with no tenant role is answered too. It returns at once unless the tenant has a do-not-contact row. The body is
-- stable text: slice S4 replaces this function once, under a hash guard, to add the seller approval checks.
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION app.supply_contact_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org uuid;
BEGIN
 IF NOT EXISTS(SELECT FROM app.supply_do_not_contact WHERE tenant_id=NEW.tenant_id) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='communication' THEN
  SELECT r.organisation_id INTO org FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id
   WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id;
 ELSE
  SELECT r.organisation_id INTO org FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id
   JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.id;
 END IF;
 IF org IS NOT NULL AND app.supply_org_blocked(NEW.tenant_id,org) THEN RAISE EXCEPTION 'This company asked not to be contacted.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communication_supply_dnc BEFORE INSERT ON app.communication FOR EACH ROW EXECUTE FUNCTION app.supply_contact_guard();
CREATE TRIGGER communication_dispatch_supply_dnc BEFORE INSERT ON app.communication_dispatch FOR EACH ROW EXECUTE FUNCTION app.supply_contact_guard();
CREATE TRIGGER communication_dispatch_retry_supply_dnc BEFORE UPDATE OF status ON app.communication_dispatch FOR EACH ROW
 WHEN (NEW.status='PENDING' AND OLD.status IN ('DEAD','SUPPRESSED')) EXECUTE FUNCTION app.supply_contact_guard();
CREATE TRIGGER communication_receipt_supply_dnc BEFORE INSERT ON app.communication_receipt FOR EACH ROW EXECUTE FUNCTION app.supply_contact_guard();

-- ---------------------------------------------------------------------------------------------------------------------------
-- Grants. Private helpers and trigger functions go to nobody. Commands and reads go to the runtime login only.
-- ---------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.supply_row_results_ok(jsonb),app.supply_canonical_org(uuid,uuid),app.supply_org_blocked(uuid,uuid),app.supply_name_blocked(uuid,text,text),
 app.supply_source_usable(uuid,uuid,uuid),app.supply_command_enter(uuid,uuid,text,text,text[],boolean,boolean),app.supply_command_done(uuid,uuid,uuid,text,text,jsonb),
 app.supply_insert_candidate(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text[],text,timestamptz,text,uuid),app.supply_intake_checks(uuid,uuid,uuid,uuid),
 app.supply_current_match(uuid,uuid),app.supply_dnc_row(uuid,uuid),app.supply_block_current(uuid,app.supply_do_not_contact),
 app.supply_read_allowed(uuid),app.supply_candidate_json(uuid,app.supply_candidate),
 app.guard_supply_source_version(),app.guard_supply_candidate(),app.supply_contact_guard() FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION app.supply_create_source(uuid,uuid,text,text,text,uuid,integer,timestamptz,text,text),
 app.supply_add_source_version(uuid,uuid,text,uuid,integer,text,text,uuid,integer,timestamptz,text),
 app.supply_add_candidate(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text[],text,timestamptz,text),
 app.supply_import_file(uuid,uuid,text,uuid,uuid,uuid,text,jsonb),
 app.supply_review_candidate(uuid,uuid,text,uuid,text,text,text),
 app.supply_match_candidate(uuid,uuid,text,uuid,text,uuid,uuid,text),
 app.supply_block_company(uuid,uuid,text,uuid,text,text,text,text,uuid),
 app.supply_lift_company(uuid,uuid,text,uuid,text,text,text,text,uuid),
 app.supply_candidate_read(uuid,uuid,integer),app.supply_candidate_detail(uuid,uuid),app.supply_missions_read(uuid,integer),app.supply_blocks_read(uuid,integer),
 app.supply_route_pack(uuid,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.supply_create_source(uuid,uuid,text,text,text,uuid,integer,timestamptz,text,text),
 app.supply_add_source_version(uuid,uuid,text,uuid,integer,text,text,uuid,integer,timestamptz,text),
 app.supply_add_candidate(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text[],text,timestamptz,text),
 app.supply_import_file(uuid,uuid,text,uuid,uuid,uuid,text,jsonb),
 app.supply_review_candidate(uuid,uuid,text,uuid,text,text,text),
 app.supply_match_candidate(uuid,uuid,text,uuid,text,uuid,uuid,text),
 app.supply_block_company(uuid,uuid,text,uuid,text,text,text,text,uuid),
 app.supply_lift_company(uuid,uuid,text,uuid,text,text,text,text,uuid),
 app.supply_candidate_read(uuid,uuid,integer),app.supply_candidate_detail(uuid,uuid),app.supply_missions_read(uuid,integer),app.supply_blocks_read(uuid,integer),
 app.supply_route_pack(uuid,uuid) TO corridra_runtime;
