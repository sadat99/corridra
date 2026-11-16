-- Data cleanup (U2): an owner-run, reversible archive of made-up (synthetic) workspaces. Optional module, installed and
-- run only from the install script with an explicit action. Additive only: one append-only table, and one existing
-- function replaced under a fingerprint. Nothing is deleted or updated; workspaces, money, audit, event and invoice rows
-- are never touched. Archiving and restoring write rows here and nowhere else.
DO $guard$ BEGIN
 IF to_regprocedure('app.reject_rewrite()') IS NULL
 OR to_regclass('customer.workspace') IS NULL
 OR to_regclass('identity.principal') IS NULL
 OR to_regclass('customer_private.workspace_revision') IS NULL
 THEN RAISE EXCEPTION 'Data cleanup prerequisites are missing'; END IF;
END $guard$;

-- One row per workspace per archive or restore run, under one batch id per run. Only made-up workspaces are written:
-- the category check holds no other value, so a real workspace can never be archived from here.
CREATE TABLE customer_private.data_cleanup_archive (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 category text NOT NULL CHECK(category IN ('synthetic_workspace')),
 action text NOT NULL CHECK(action IN ('archive','restore')),
 batch_id uuid NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX data_cleanup_archive_latest ON customer_private.data_cleanup_archive(tenant_id,created_at DESC);
CREATE TRIGGER data_cleanup_archive_immutable BEFORE UPDATE OR DELETE ON customer_private.data_cleanup_archive
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.data_cleanup_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.data_cleanup_archive FROM PUBLIC,corridra_runtime,corridra_auth;

-- Whether a workspace is archived now. The newest member revision (by version) and the newest cleanup row (by time)
-- are compared: whichever is later decides. A member's restore after a cleanup archive wins, and a cleanup restore
-- undoes a cleanup archive. A workspace with no cleanup row answers exactly as before. Replaced only when the live text
-- is the reviewed text of workspace lifecycle file 0001, recorded on a database built in production order (real-use,
-- programme lifecycle, workspace lifecycle, account lifecycle). The previous text, for an exact rollback by a later
-- forward migration, is:
--   CREATE OR REPLACE FUNCTION customer_private.workspace_archived(target uuid)
--    RETURNS boolean
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO 'pg_catalog'
--   AS $function$
--    SELECT coalesce((SELECT r.archived FROM customer_private.workspace_revision r WHERE r.tenant_id=target ORDER BY r.version DESC LIMIT 1),false)
--   $function$
DO $archived$
DECLARE original text;
BEGIN
 IF to_regprocedure('customer_private.workspace_archived(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Data cleanup prerequisite is missing: customer_private.workspace_archived';
 END IF;
 original:=pg_get_functiondef('customer_private.workspace_archived(uuid)'::regprocedure);
 IF position('customer_private.data_cleanup_archive' IN original)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'81a6a98874c97fa3870c4c83beef76560e598e75b2ece6e62e0518c6b111b1a0'
 THEN RAISE EXCEPTION 'Data cleanup prerequisite differs: customer_private.workspace_archived'; END IF;
 EXECUTE $replace$
CREATE OR REPLACE FUNCTION customer_private.workspace_archived(target uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(CASE WHEN c.created_at IS NOT NULL AND (r.created_at IS NULL OR c.created_at>r.created_at)
  THEN c.action='archive' ELSE r.archived END,false)
 FROM (SELECT 1) one
 LEFT JOIN LATERAL (SELECT x.archived,x.created_at FROM customer_private.workspace_revision x
  WHERE x.tenant_id=target ORDER BY x.version DESC LIMIT 1) r ON true
 LEFT JOIN LATERAL (SELECT y.action,y.created_at FROM customer_private.data_cleanup_archive y
  WHERE y.tenant_id=target ORDER BY y.created_at DESC,y.id DESC LIMIT 1) c ON true
$$
$replace$;
END $archived$;
REVOKE ALL ON FUNCTION customer_private.workspace_archived(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
