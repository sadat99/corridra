-- ADR-083 slice S1. Optional module: installing it changes nothing anyone can see. Its control starts closed, and while it is
-- closed a route pack with a `sourcing` block is refused. Packs without the block behave exactly as before.
-- Replaces exactly one function, app.guard_corridor_configuration(), hash-guarded against the definition installed by
-- customer-real-use-migrations/0003_real_customer_modules.sql. The replacement refuses everything the old one refused, and
-- additionally allows an optional 19th top-level key `sourcing` that is exempt from the 18-key count and the array-of-strings
-- loop and is checked on its own: a JSON object of at most 4096 octets (as stored text) with a positive integer profileVersion.
-- The proposal envelope limit (8192 octets on app.configuration_proposal) and the publication equality check are untouched.
-- Existing pack versions are never rewritten. Rollback: switch off, pause the control, and a further forward migration restores
-- the previous hashed definition if ever needed.
DO $guard$ BEGIN
 IF to_regprocedure('app.guard_corridor_configuration()') IS NULL
  OR to_regclass('app.corridor_pack_version') IS NULL
  OR to_regprocedure('app.reject_rewrite()') IS NULL
  OR encode(sha256(convert_to(pg_get_functiondef('app.guard_corridor_configuration()'::regprocedure),'UTF8')),'hex')<>'dde12ac9b97b716ca3f4183c78414557ba3222111682be4d510f864d344fe863'
 THEN RAISE EXCEPTION 'Sourcing workflow prerequisite function differs: app.guard_corridor_configuration'; END IF;
END $guard$;

-- One switch for the sourcing workflow. Closed unless the latest row says enabled; no row means closed.
CREATE TABLE app.sourcing_workflow_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.sourcing_workflow_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.sourcing_workflow_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER sourcing_workflow_control_immutable BEFORE UPDATE OR DELETE ON app.sourcing_workflow_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE FUNCTION app.sourcing_workflow_enabled() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM app.sourcing_workflow_control ORDER BY version DESC LIMIT 1),false)
$$;

CREATE OR REPLACE FUNCTION app.guard_corridor_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE c app.corridor_definition; p app.corridor_pack_version; k text; v jsonb;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Synthetic configuration authority with fresh MFA required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':corridor',0));
 IF TG_TABLE_NAME='corridor_route' THEN
  SELECT * INTO c FROM app.corridor_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.corridor_id;
  IF c.id IS NULL OR ARRAY[least(NEW.origin_market,NEW.destination_market),greatest(NEW.origin_market,NEW.destination_market)]<>ARRAY[c.market_a,c.market_b] THEN RAISE EXCEPTION 'Route endpoints must belong to corridor'; END IF;
 ELSIF TG_TABLE_NAME='corridor_pack_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id),0)+1 THEN RAISE EXCEPTION 'Sequential pack version required'; END IF;
  IF EXISTS(SELECT FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Pack effective date must increase'; END IF;
  IF NOT (NEW.configuration ?& ARRAY['missionTypes','requiredCapabilities','languages','currencies','timeZones','localities','clusters','requirements','assessments','sourceCategories','channels','jurisdictionPolicyRefs','evidenceTypes','reviewRequired','operatorCapabilities','coverage','aiPolicyRef','pricingRef']) OR (SELECT count(*) FROM jsonb_object_keys(NEW.configuration) AS key_name WHERE key_name<>'sourcing')<>18 OR NEW.configuration->'reviewRequired'<>'true'::jsonb THEN RAISE EXCEPTION 'Invalid or elevated pack configuration'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.configuration) LOOP
   IF k NOT IN ('reviewRequired','aiPolicyRef','pricingRef','sourcing') THEN
    IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>50 THEN RAISE EXCEPTION 'Bounded configuration arrays required'; END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'Configuration strings required'; END IF;
   END IF;
  END LOOP;
  IF NEW.configuration ? 'sourcing' THEN
   IF NOT app.sourcing_workflow_enabled() THEN RAISE EXCEPTION 'Sourcing profile requires the sourcing workflow control to be open'; END IF;
   IF jsonb_typeof(NEW.configuration->'sourcing') IS DISTINCT FROM 'object' OR octet_length((NEW.configuration->'sourcing')::text)>4096 OR jsonb_typeof(NEW.configuration->'sourcing'->'profileVersion') IS DISTINCT FROM 'number' OR coalesce((NEW.configuration->'sourcing'->>'profileVersion') !~ '^[1-9][0-9]{0,3}$',true) THEN RAISE EXCEPTION 'Bounded sourcing profile with a version required'; END IF;
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'currencies') x WHERE NOT EXISTS(SELECT FROM app.currency WHERE code=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'channels') x WHERE x NOT IN ('SYNTHETIC','MANUAL')) THEN RAISE EXCEPTION 'Unsupported currency or channel'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'timeZones') x WHERE NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'languages') x WHERE x !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$') THEN RAISE EXCEPTION 'Valid timezone and locale required'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'requirements') x WHERE NOT EXISTS(SELECT FROM app.requirement_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'assessments') x WHERE NOT EXISTS(SELECT FROM app.assessment_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) THEN RAISE EXCEPTION 'Exact same-tenant definition versions required'; END IF;
  IF NEW.configuration->'aiPolicyRef'<>'null'::jsonb AND NOT EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id::text=NEW.configuration->>'aiPolicyRef' AND effective_from<=now() AND (configuration->>'effectiveUntil')::timestamptz>now() AND version=(SELECT max(version) FROM app.ai_model_policy next_policy WHERE next_policy.tenant_id=NEW.tenant_id AND next_policy.key=app.ai_model_policy.key AND next_policy.effective_from<=now())) THEN RAISE EXCEPTION 'Current same-tenant reviewed AI policy required'; END IF;
  IF NEW.configuration->'pricingRef'<>'null'::jsonb THEN RAISE EXCEPTION 'Pricing activation belongs to a later reviewed service'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'jurisdictionPolicyRefs') x WHERE NOT EXISTS(SELECT FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND id::text=x AND effective_from<=now() AND valid_until>now())) THEN RAISE EXCEPTION 'Current same-tenant communication policy required'; END IF;
 ELSIF TG_TABLE_NAME='mission_route_assignment' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential assignment version required'; END IF;
  IF NEW.status='ASSIGNED' THEN
   SELECT * INTO p FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND id=NEW.pack_id;
   IF p.id IS NULL OR p.status NOT IN ('TESTING','LIMITED','ACTIVE') OR p.effective_from>now() OR p.version<>(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=p.tenant_id AND route_id=p.route_id AND effective_from<=now()) OR NOT EXISTS(SELECT FROM app.mission_type_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_type_id AND p.configuration->'missionTypes' ? key) THEN RAISE EXCEPTION 'Current available pack and mission type required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $function$
;
