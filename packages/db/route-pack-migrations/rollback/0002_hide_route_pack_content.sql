-- ADR-093 Phase 2b rollback. Hides the route pack content module: drops the marker app.route_pack_content_installed(), so the
-- application treats the module as absent (the content service answers Not found, the go-live check does nothing and the
-- guided form takes its earlier path), and revokes INSERT on app.route_pack_content from corridra_runtime, so no content can be
-- added. The table, its rows and the module's registry row stay: content is append-only and harmless when unread, and turning
-- the module on again needs a new reviewed forward file. The first rollback step is simply turning CORRIDRA_ROUTE_PACK_FORM
-- off; run this file only through a further reviewed forward run.
-- One statement (one DO block) with no BEGIN or COMMIT of its own, as for rollback/0001, so it is all or nothing however it is
-- run. It first takes the migration lock the installer takes, and refuses, changing nothing, unless the marker and the
-- module's registry row both exist.
DO $rollback$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('corridra:migrations'));
 IF to_regprocedure('app.route_pack_content_installed()') IS NULL OR to_regclass('route_pack_migrations.applied') IS NULL THEN
  RAISE EXCEPTION 'Route pack content rollback refused: the module is not installed';
 END IF;
 IF NOT EXISTS(SELECT FROM route_pack_migrations.applied WHERE name='0002_route_pack_content.sql') THEN
  RAISE EXCEPTION 'Route pack content rollback refused: the module is not recorded as installed';
 END IF;
 EXECUTE 'DROP FUNCTION app.route_pack_content_installed()';
 EXECUTE 'REVOKE INSERT ON app.route_pack_content FROM corridra_runtime';
END $rollback$;
