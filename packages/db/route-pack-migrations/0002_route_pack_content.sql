-- ADR-093 Phase 2b (decision H). Optional module: the standard content of a route pack, one append-only jsonb document per
-- route and version, beside the locked pack. Content never grants authority and is never read by an authorization or
-- assignment check. Full validation is the domain schema of its standard version (packages/domain/src/route-pack-standard.ts);
-- the database checks shape and size, the tenant of the route and pack, the sequential version and the current pack.
-- It follows the corridor table pattern of 0020_versioned_corridors.sql: row security with the same read and add policies as
-- app.corridor_pack_version (including the real-use pair of customer-real-use-migrations/0002), SELECT and INSERT only, the
-- reject_rewrite trigger and the record_change event, which carries ids and the version only.
-- A marker function app.route_pack_content_installed() tells the application the module is present. It opens no gate and adds
-- no switch: the content features and the go-live check act only while CORRIDRA_ROUTE_PACK_FORM is on and the marker exists.
-- Rollback: rollback/0002_hide_route_pack_content.sql drops the marker and the runtime INSERT grant; the table and its rows stay.
DO $guard$ BEGIN
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Route pack content prerequisite functions are missing: install the customer real-use modules first';
 END IF;
END $guard$;
CREATE TABLE app.route_pack_content(
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 route_id uuid NOT NULL,
 pack_id uuid,
 version integer NOT NULL CHECK(version>0),
 standard_version integer NOT NULL CHECK(standard_version=1),
 document jsonb NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,route_id,version),
 FOREIGN KEY(tenant_id,route_id) REFERENCES app.corridor_route(tenant_id,id),
 FOREIGN KEY(tenant_id,pack_id) REFERENCES app.corridor_pack_version(tenant_id,id),
 -- A CHECK passes on NULL, so these are written to fail when the key is missing.
 CHECK(jsonb_typeof(document)='object' AND document->'standardVersion' IS NOT DISTINCT FROM to_jsonb(standard_version)),
 CHECK(octet_length(document::text)<=131072),
 CHECK(CASE WHEN jsonb_typeof(document->'facts')='array' THEN jsonb_array_length(document->'facts')<=500 ELSE false END),
 CHECK(jsonb_array_length(jsonb_path_query_array(document,'$.facts[*] ? (@.key starts with "custom.")'))<=100)
);
-- Runs as the inserting role, so its reads see only what that role may read. The lock is the per-workspace corridor lock the
-- service and every pack write take, so a pack published meanwhile cannot slip between the check and the insert.
CREATE FUNCTION app.guard_route_pack_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'Server-owned content time required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':corridor',0));
 IF NEW.version<>coalesce((SELECT max(version) FROM app.route_pack_content WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id),0)+1 THEN
  RAISE EXCEPTION 'Sequential route content version required' USING ERRCODE='23514';
 END IF;
 IF NEW.pack_id IS DISTINCT FROM (SELECT id FROM app.corridor_pack_version WHERE tenant_id=NEW.tenant_id AND route_id=NEW.route_id AND effective_from<=now() ORDER BY version DESC LIMIT 1) THEN
  RAISE EXCEPTION 'Current route pack required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE INSERT ON app.route_pack_content FOR EACH ROW EXECUTE FUNCTION app.guard_route_pack_content();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.route_pack_content FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER event AFTER INSERT ON app.route_pack_content FOR EACH ROW EXECUTE FUNCTION app.record_change();
ALTER TABLE app.route_pack_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.route_pack_content FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation'));
CREATE POLICY add ON app.route_pack_content FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(tenant_id) IN ('owner','admin') AND app.fresh_mfa() AND created_by=app.actor_id());
CREATE POLICY "real_use_add" ON app."route_pack_content" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."route_pack_content".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_pack_content".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));
CREATE POLICY "real_use_read" ON app."route_pack_content" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."route_pack_content".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_pack_content".tenant_id))));
REVOKE ALL ON app.route_pack_content FROM PUBLIC,corridra_auth,corridra_runtime;
GRANT SELECT,INSERT ON app.route_pack_content TO corridra_runtime;
REVOKE ALL ON FUNCTION app.guard_route_pack_content() FROM PUBLIC;
CREATE FUNCTION app.route_pack_content_installed() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION app.route_pack_content_installed() FROM PUBLIC;
