-- Phase 0 view-as, stage 1. Optional; installing it shows nothing to anyone.
-- One additive function that appends the audit record of a preview being opened.
-- It changes no existing table, policy, trigger, grant or function. It reads no customer, delegate,
-- supplier or mission row. It writes no outbox row, so nothing is sent.

DO $guard$ BEGIN
 IF to_regprocedure('app.actor_id()') IS NULL OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL OR to_regclass('app.domain_event') IS NULL
 OR to_regclass('app.audit_event') IS NULL
 THEN RAISE EXCEPTION 'View-as prerequisites are missing'; END IF;
END $guard$;

-- Appends one domain event and one audit row in the caller's own workspace, in the caller's own
-- transaction. It re-checks everything the application checked, so a direct call cannot skip a step:
-- a signed-in staff actor, owner or admin in this workspace, a fresh authenticator check, and a role
-- from the fixed list. The record holds ids, roles and a version. No name, address or content.
CREATE FUNCTION app.record_view_as_open(shown_role text, preview_version integer) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 actor uuid:=app.actor_id();viewer text;eid uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();
 corr uuid:=coalesce(NULLIF(current_setting('corridra.correlation_id',true),'')::uuid,gen_random_uuid());
BEGIN
 IF tenant IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 viewer:=app.member_role(tenant);
 IF viewer IS NULL OR viewer NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF NOT app.fresh_mfa() THEN RAISE EXCEPTION 'Verify your authenticator again to continue' USING ERRCODE='42501'; END IF;
 IF shown_role IS NULL OR shown_role NOT IN ('customer','delegate','supplier')
 OR preview_version IS NULL OR preview_version NOT BETWEEN 1 AND 1000
 THEN RAISE EXCEPTION 'Invalid preview' USING ERRCODE='23514'; END IF;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,tenant,'view_as.open',1,'view_as_preview',aid::text,1,actor,clock_timestamp(),corr,corr,
 jsonb_build_object('shown_role',shown_role,'viewer_role',viewer,'preview_version',preview_version));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(aid,tenant,eid,actor,'view_as.open');
 RETURN aid;
END $$;
REVOKE ALL ON FUNCTION app.record_view_as_open(text,integer) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.record_view_as_open(text,integer) TO corridra_runtime;
