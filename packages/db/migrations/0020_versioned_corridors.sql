-- Immutable global identities; tenant-private operating configuration never grants membership.
CREATE TABLE app.market_scope (
 key text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('COUNTRY','TRADE_BLOC','REGION','SUBDIVISION','CITY','COMMERCIAL_CLUSTER')),
 country_code text REFERENCES app.country(code), name text NOT NULL,
 CHECK(kind<>'COUNTRY' OR (country_code IS NOT NULL AND key=country_code))
);
CREATE UNIQUE INDEX country_market_identity ON app.market_scope(country_code) WHERE kind='COUNTRY';
INSERT INTO app.market_scope SELECT code,'COUNTRY',code,code FROM app.country;
INSERT INTO app.market_scope VALUES('EU','TRADE_BLOC',NULL,'European Union');
CREATE TABLE app.market_alias (market_key text NOT NULL REFERENCES app.market_scope(key),locale text NOT NULL,label text NOT NULL,PRIMARY KEY(market_key,locale,label));
CREATE TABLE app.market_member (market_key text NOT NULL REFERENCES app.market_scope(key),country_code text NOT NULL REFERENCES app.country(code),effective_from date NOT NULL,effective_until date,PRIMARY KEY(market_key,country_code,effective_from),CHECK(effective_until IS NULL OR effective_until>effective_from));
INSERT INTO app.market_member SELECT 'EU',code,DATE '2026-10-12',NULL FROM app.country WHERE code=ANY(ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);
GRANT SELECT ON app.market_scope,app.market_alias,app.market_member TO corridra_runtime;
CREATE TABLE app.corridor_definition (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES app.tenant(id),market_a text NOT NULL REFERENCES app.market_scope(key),market_b text NOT NULL REFERENCES app.market_scope(key),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),UNIQUE(tenant_id,id),UNIQUE(tenant_id,market_a,market_b),CHECK(market_a<market_b)
);
CREATE TABLE app.corridor_route (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,corridor_id uuid NOT NULL,origin_market text NOT NULL REFERENCES app.market_scope(key),destination_market text NOT NULL REFERENCES app.market_scope(key),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),UNIQUE(tenant_id,id),UNIQUE(tenant_id,origin_market,destination_market),FOREIGN KEY(tenant_id,corridor_id) REFERENCES app.corridor_definition(tenant_id,id),CHECK(origin_market<>destination_market)
);
CREATE TABLE app.mission_type_definition (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES app.tenant(id),key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_.-]{0,79}$'),version integer NOT NULL CHECK(version>0),description text NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),UNIQUE(tenant_id,id),UNIQUE(tenant_id,key,version)
);
CREATE TABLE app.requirement_definition (LIKE app.mission_type_definition INCLUDING ALL);
ALTER TABLE app.requirement_definition ADD FOREIGN KEY(tenant_id) REFERENCES app.tenant(id),ADD FOREIGN KEY(created_by) REFERENCES identity.principal(id);
CREATE TABLE app.assessment_definition (LIKE app.mission_type_definition INCLUDING ALL);
ALTER TABLE app.assessment_definition ADD FOREIGN KEY(tenant_id) REFERENCES app.tenant(id),ADD FOREIGN KEY(created_by) REFERENCES identity.principal(id);
CREATE TABLE app.corridor_pack_version (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,route_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN ('DRAFT','TESTING','LIMITED','ACTIVE','PAUSED')),
 configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),effective_from timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),UNIQUE(tenant_id,id),UNIQUE(tenant_id,route_id,version),FOREIGN KEY(tenant_id,route_id) REFERENCES app.corridor_route(tenant_id,id)
);
CREATE TABLE app.mission_route_assignment (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,pack_id uuid,mission_type_id uuid,status text NOT NULL CHECK(status IN ('LEGACY_UNRESOLVED','ASSIGNED')),version integer NOT NULL CHECK(version>0),
 created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),UNIQUE(tenant_id,id),UNIQUE(tenant_id,mission_id,version),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,pack_id) REFERENCES app.corridor_pack_version(tenant_id,id),FOREIGN KEY(tenant_id,mission_type_id) REFERENCES app.mission_type_definition(tenant_id,id),CHECK((status='ASSIGNED' AND pack_id IS NOT NULL AND mission_type_id IS NOT NULL) OR (status='LEGACY_UNRESOLVED' AND pack_id IS NULL AND mission_type_id IS NULL))
);
-- No inferred demand origin. Preserve prior missions, actors and accepted version history.
INSERT INTO app.mission_route_assignment SELECT gen_random_uuid(),tenant_id,id,NULL,NULL,'LEGACY_UNRESOLVED',1,created_by,created_at,'Legacy origin not classified' FROM app.mission;
CREATE FUNCTION app.guard_corridor_configuration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c app.corridor_definition; p app.corridor_pack_version; k text; v jsonb;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic configuration authority with fresh MFA required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':corridor',0));
 IF TG_TABLE_NAME='corridor_route' THEN
  SELECT * INTO c FROM app.corridor_definition WHERE tenant_id=NEW.tenant_id AND id=NEW.corridor_id;
  IF c.id IS NULL OR ARRAY[least(NEW.origin_market,NEW.destination_market),greatest(NEW.origin_market,NEW.destination_market)]<>ARRAY[c.market_a,c.market_b] THEN RAISE EXCEPTION 'Route endpoints must belong to corridor'; END IF;
 ELSIF TG_TABLE_NAME='corridor_pack_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id),0)+1 THEN RAISE EXCEPTION 'Sequential pack version required'; END IF;
  IF EXISTS(SELECT FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Pack effective date must increase'; END IF;
  IF NOT (NEW.configuration ?& ARRAY['missionTypes','requiredCapabilities','languages','currencies','timeZones','localities','clusters','requirements','assessments','sourceCategories','channels','jurisdictionPolicyRefs','evidenceTypes','reviewRequired','operatorCapabilities','coverage','aiPolicyRef','pricingRef']) OR (SELECT count(*) FROM jsonb_object_keys(NEW.configuration))<>18 OR NEW.configuration->'reviewRequired'<>'true'::jsonb OR NEW.configuration->'aiPolicyRef'<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid or elevated pack configuration'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.configuration) LOOP
   IF k NOT IN ('reviewRequired','aiPolicyRef','pricingRef') THEN
    IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>50 THEN RAISE EXCEPTION 'Bounded configuration arrays required'; END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'Configuration strings required'; END IF;
   END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'currencies') x WHERE NOT EXISTS(SELECT FROM app.currency WHERE code=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'channels') x WHERE x NOT IN ('SYNTHETIC','MANUAL')) THEN RAISE EXCEPTION 'Unsupported currency or channel'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'timeZones') x WHERE NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'languages') x WHERE x !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$') THEN RAISE EXCEPTION 'Valid timezone and locale required'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'requirements') x WHERE NOT EXISTS(SELECT FROM app.requirement_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) OR EXISTS(SELECT FROM jsonb_array_elements_text(NEW.configuration->'assessments') x WHERE NOT EXISTS(SELECT FROM app.assessment_definition WHERE tenant_id=NEW.tenant_id AND id::text=x)) THEN RAISE EXCEPTION 'Exact same-tenant definition versions required'; END IF;
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
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['corridor_definition','corridor_route','mission_type_definition','requirement_definition','assessment_definition','corridor_pack_version','mission_route_assignment'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'') AND app.fresh_mfa() AND created_by=app.actor_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_corridor_configuration()',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.guard_corridor_configuration() FROM PUBLIC;
