-- ADR-082 slice S2 (13 November 2026): the supply sources module skeleton and the role-agnostic structured profile.
-- Optional module: installing it changes nothing anyone can see. Its `module` control starts closed (no row means
-- closed), nothing in the build opens the other six controls, and a profile version alone changes no behaviour.
-- Additive only: no existing function, policy, constraint, grant, trigger or row is replaced or changed (no CREATE OR REPLACE).
-- Every table is tenant scoped, append only (changes are new versions), has the synthetic policy and the ADR-056 real-use
-- pair, and is written only through the SECURITY DEFINER command function below. Events carry ids, version and role only.
DO $guard$ BEGIN
 IF to_regclass('app.mission') IS NULL
 OR to_regclass('app.target_profile') IS NULL
 OR to_regclass('app.domain_event') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regprocedure('app.record_change()') IS NULL
 OR to_regprocedure('app.actor_id()') IS NULL
 OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL
 OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='app.mission'::regclass AND contype IN ('p','u') AND pg_get_constraintdef(oid)='UNIQUE (tenant_id, id)')
 THEN RAISE EXCEPTION 'Supply source prerequisites are missing'; END IF;
END $guard$;

-- One row per control and version. Closed unless the latest row of that control says enabled; no row means closed. Only
-- the offline schema owner writes it. The configure step accepts `module` only; the other six are opened, in tests, by
-- inserting rows as the table owner.
CREATE TABLE app.supply_source_control (
 control text NOT NULL CHECK(control IN ('module','partner_kinds','platform_kind','connectors','mode_b_release','personal_data','staff_file_import')),
 version integer NOT NULL CHECK(version>0), enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(control,version)
);
ALTER TABLE app.supply_source_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.supply_source_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER supply_source_control_immutable BEFORE UPDATE OR DELETE ON app.supply_source_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
-- Private helper: any control by name. Not granted to the runtime or auth login.
CREATE FUNCTION app.supply_control_open(c text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM app.supply_source_control WHERE control=c ORDER BY version DESC LIMIT 1),false)
$$;
-- The one control the application may ask about.
CREATE FUNCTION app.supply_module_enabled() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.supply_control_open('module')
$$;

-- Every staff, contributor and customer write is one command: an exact retry returns the stored result, the same id with
-- changed content is refused. The result holds ids only.
CREATE TABLE app.supply_command (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 command_id uuid NOT NULL,
 actor_kind text NOT NULL CHECK(actor_kind IN ('staff','contributor','customer')),
 staff_actor uuid REFERENCES identity.principal(id),
 customer_principal uuid REFERENCES identity.principal(id),
 action text NOT NULL CHECK(action IN ('save_profile')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND length(result::text)<2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((actor_kind IN ('staff','contributor') AND staff_actor IS NOT NULL AND customer_principal IS NULL)
    OR (actor_kind='customer' AND customer_principal IS NOT NULL AND staff_actor IS NULL)),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,command_id)
);

-- The structured twin of app.target_profile (which stays the free-text version). A new version is a new row.
CREATE TABLE app.counterparty_profile_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 mission_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('BUYER','SUPPLIER','DISTRIBUTOR','PARTNER')),
 version integer NOT NULL CHECK(version>0),
 target_profile_id uuid,
 fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='object' AND octet_length(fields::text)<=8000),
 fields_digest text NOT NULL CHECK(fields_digest ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,mission_id,role,version),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE INDEX counterparty_profile_version_latest_idx ON app.counterparty_profile_version(tenant_id,mission_id,role,version DESC);

-- Shape guard that holds even for a direct insert by the table owner: only known keys, the four required keys present,
-- the digest recomputed from the stored JSON, and the next version number exactly. The strict schema in
-- packages/domain/src/counterparty-profiles.ts does the field by field validation before the command runs.
CREATE FUNCTION app.guard_counterparty_profile_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE latest integer;
BEGIN
 IF EXISTS(SELECT FROM jsonb_object_keys(NEW.fields) k WHERE k<>ALL(ARRAY['productCategory','counterpartyTypes','sizeBand','channels','requiredCertifications','orderSizeBand','pricePositioning','mustHaves','niceToHaves','candidatesWanted','deadline','eventContext','exclusions','sellerNotes']))
 OR NOT NEW.fields ?& ARRAY['productCategory','counterpartyTypes','candidatesWanted','deadline'] THEN
  RAISE EXCEPTION 'The profile has an unknown or missing field';
 END IF;
 IF jsonb_typeof(NEW.fields->'deadline')<>'string' OR NEW.fields->>'deadline' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'The deadline must be a date'; END IF;
 IF jsonb_typeof(NEW.fields->'candidatesWanted')<>'number' OR (NEW.fields->>'candidatesWanted')::numeric NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Candidates wanted must be 1 to 100';
 END IF;
 IF NEW.fields_digest<>encode(sha256(convert_to(NEW.fields::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'The profile digest does not match its fields';
 END IF;
 SELECT coalesce(max(version),0) INTO latest FROM app.counterparty_profile_version WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id AND role=NEW.role;
 IF NEW.version<>latest+1 THEN RAISE EXCEPTION 'This profile changed. Reload it and try again.'; END IF;
 IF NEW.target_profile_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.target_profile WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id AND id=NEW.target_profile_id) THEN
  RAISE EXCEPTION 'Mission unavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER counterparty_profile_version_guard BEFORE INSERT ON app.counterparty_profile_version
 FOR EACH ROW EXECUTE FUNCTION app.guard_counterparty_profile_version();

-- Append only, and events (ids, version and role only: record_change keeps nothing else) on the profile table. app.supply_command has
-- no event trigger (ADR-082 section 2): customer commands have no actor for record_change, and the row is itself the audit.
CREATE TRIGGER supply_command_immutable BEFORE UPDATE OR DELETE ON app.supply_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER counterparty_profile_version_immutable BEFORE UPDATE OR DELETE ON app.counterparty_profile_version FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER counterparty_profile_version_event AFTER INSERT ON app.counterparty_profile_version FOR EACH ROW EXECUTE FUNCTION app.record_change();

-- Staff of the tenant read; nobody writes through the table. Synthetic and real tenants are separate policies.
-- A command is visible only to the person who made it.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['supply_command','counterparty_profile_version'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer'',''viewer'')%s)',t,CASE WHEN t='supply_command' THEN ' AND staff_actor=app.actor_id()' ELSE '' END);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('CREATE POLICY real_use_read ON app.%I FOR SELECT TO corridra_runtime USING(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer'',''viewer'')%s)',t,CASE WHEN t='supply_command' THEN ' AND staff_actor=app.actor_id()' ELSE '' END);
  EXECUTE format('CREATE POLICY real_use_add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,''INTERNAL'',app.tenant_processing_purpose(tenant_id)) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator''))',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,corridra_auth,corridra_runtime',t);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',t);
 END LOOP;
END $$;

-- The one profile command. Staff with research.manage roles (owner, admin, operator), on a mission of their own tenant,
-- in the synthetic tenant or a real one the real-use switch allows. Refuses while the module control is closed or paused.
-- A stale expected version is refused. An exact retry (same command id and request hash) returns the first result.
CREATE FUNCTION app.save_counterparty_profile(p_tenant uuid,p_command uuid,p_request_hash text,p_mission uuid,p_role text,p_expected_version integer,
 p_fields jsonb,p_reason text,p_target_profile uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=app.actor_id(); seen record; latest integer; made uuid:=gen_random_uuid(); answer jsonb;
BEGIN
 IF actor IS NULL OR p_tenant IS DISTINCT FROM NULLIF(current_setting('corridra.tenant_id',true),'')::uuid
  OR NOT app.can_access(p_tenant,'INTERNAL',app.tenant_processing_purpose(p_tenant))
  OR NOT (app.tenant_is_synthetic(p_tenant) OR app.real_use_allowed(p_tenant))
  OR app.member_role(p_tenant) NOT IN ('owner','admin','operator') THEN
  RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
 END IF;
 IF NOT app.supply_module_enabled() THEN RAISE EXCEPTION 'Supply sources are paused. Records stay readable.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':supply-command:'||p_command::text,0));
 SELECT request_hash,result,staff_actor INTO seen FROM app.supply_command WHERE tenant_id=p_tenant AND command_id=p_command;
 IF FOUND THEN
  IF seen.request_hash<>p_request_hash OR seen.staff_actor IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Command ID reused with different values'; END IF;
  RETURN seen.result;
 END IF;
 IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=p_tenant AND id=p_mission) THEN RAISE EXCEPTION 'Mission unavailable'; END IF;
 IF EXISTS(SELECT FROM app.mission WHERE tenant_id=p_tenant AND id=p_mission AND status IN ('CLOSED','CANCELLED')) THEN
  RAISE EXCEPTION 'This mission is closed, so its profile cannot change.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':counterparty-profile:'||p_mission::text||':'||p_role,0));
 SELECT coalesce(max(version),0) INTO latest FROM app.counterparty_profile_version WHERE tenant_id=p_tenant AND mission_id=p_mission AND role=p_role;
 IF latest IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'This profile changed. Reload it and try again.'; END IF;
 INSERT INTO app.counterparty_profile_version(id,tenant_id,mission_id,role,version,target_profile_id,fields,fields_digest,reason,created_by)
  VALUES(made,p_tenant,p_mission,p_role,latest+1,p_target_profile,p_fields,encode(sha256(convert_to(p_fields::text,'UTF8')),'hex'),p_reason,actor);
 answer:=jsonb_build_object('profileVersionId',made,'version',latest+1);
 INSERT INTO app.supply_command(tenant_id,command_id,actor_kind,staff_actor,action,request_hash,result)
  VALUES(p_tenant,p_command,'staff',actor,'save_profile',p_request_hash,answer);
 RETURN answer;
END $$;

REVOKE ALL ON FUNCTION app.supply_control_open(text),app.guard_counterparty_profile_version() FROM PUBLIC,corridra_runtime,corridra_auth;
REVOKE ALL ON FUNCTION app.supply_module_enabled(),app.save_counterparty_profile(uuid,uuid,text,uuid,text,integer,jsonb,text,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.supply_module_enabled(),app.save_counterparty_profile(uuid,uuid,text,uuid,text,integer,jsonb,text,uuid) TO corridra_runtime;
