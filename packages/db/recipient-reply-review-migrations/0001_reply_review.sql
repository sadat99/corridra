-- Reply review (ADR-069): the Corridra team's decision about one supplier reply. Optional; installing
-- it changes nothing anyone can see. The control starts closed and only an offline schema-owner
-- operation opens it. Additive only: no existing table, policy, trigger, grant or function changes,
-- and the immutable reply table is read, never written.
-- A review is one append-only row: publish (the reply may be prepared as a mission quotation, which the
-- team still confirms through the existing quotation form), ask (the supplier is asked for named
-- terms through a new link), or reject (with a reason code). Publish and reject are final for a reply.

DO $guard$ BEGIN
 IF to_regprocedure('app.actor_id()') IS NULL OR to_regprocedure('app.member_role(uuid)') IS NULL
 OR to_regprocedure('app.fresh_mfa()') IS NULL OR to_regprocedure('app.can_access(uuid,text,text)') IS NULL
 OR to_regprocedure('app.reject_rewrite()') IS NULL OR to_regprocedure('app.record_change()') IS NULL
 OR to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_processing_purpose(uuid)') IS NULL
 OR to_regclass('app.recipient_detail_response') IS NULL OR to_regclass('app.recipient_disclosure') IS NULL
 OR to_regclass('app.domain_event') IS NULL OR to_regclass('app.audit_event') IS NULL
 THEN RAISE EXCEPTION 'Reply review prerequisites are missing'; END IF;
END $guard$;

CREATE TABLE app.reply_review_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 configured_by name NOT NULL DEFAULT current_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.reply_review_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.reply_review_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER reply_review_control_immutable BEFORE UPDATE OR DELETE ON app.reply_review_control
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

-- Closed unless the latest control row says enabled. No row means closed.
CREATE FUNCTION app.reply_review_open() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM app.reply_review_control ORDER BY version DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION app.reply_review_open() FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE TABLE app.recipient_reply_review (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,response_id uuid NOT NULL,command_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('PUBLISH','ASK','REJECT')),
 reason_code text CHECK(reason_code IN ('NOT_A_FIT','PRICE_NOT_CREDIBLE','TOO_INCOMPLETE','DUPLICATE','UNCLEAR','OTHER')),
 ask_terms text[] CHECK(ask_terms <@ ARRAY['specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','paymentTerms']::text[]),
 note text CHECK(note IS NULL OR (length(note) BETWEEN 3 AND 500 AND note !~ '[[:cntrl:]<>]')),
 reviewed_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,command_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,response_id) REFERENCES app.recipient_detail_response(tenant_id,id),
 CHECK((decision='REJECT')=(reason_code IS NOT NULL)),
 CHECK((decision='ASK')=(ask_terms IS NOT NULL AND cardinality(ask_terms) BETWEEN 1 AND 18))
);
CREATE INDEX recipient_reply_review_response_idx ON app.recipient_reply_review(tenant_id,response_id,created_at);
ALTER TABLE app.recipient_reply_review ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.recipient_reply_review FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
-- Events hold ids, the decision and the reason code, never the note or any term the supplier typed.
CREATE TRIGGER recipient_reply_review_event AFTER INSERT ON app.recipient_reply_review FOR EACH ROW EXECUTE FUNCTION app.record_change();
-- The team reads; nobody writes directly. The staff function below is the only way in.
CREATE POLICY read ON app.recipient_reply_review FOR SELECT TO corridra_runtime
 USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation'));
CREATE POLICY real_use_read ON app.recipient_reply_review FOR SELECT TO corridra_runtime
 USING(app.real_use_allowed(tenant_id) AND app.can_access(tenant_id,'INTERNAL',app.tenant_processing_purpose(tenant_id)));
REVOKE ALL ON app.recipient_reply_review FROM PUBLIC,corridra_auth,corridra_runtime;
GRANT SELECT ON app.recipient_reply_review TO corridra_runtime;

-- One review, in the caller's own workspace and transaction. It re-checks everything the application
-- checked, so a direct call cannot skip a step: a signed-in staff actor who is owner or admin of this
-- workspace, a fresh authenticator check, an open control, a reply that belongs to this workspace and is
-- still retained, and that no final decision exists yet. Idempotent by command id: the same command with
-- the same content is a replay; a different one under the same id conflicts.
CREATE FUNCTION app.review_recipient_reply(command uuid, reply uuid, outcome text, code text, asked text[], remark text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;actor uuid:=app.actor_id();
 viewer text;old app.recipient_reply_review;rid uuid;cleaned text[];
BEGIN
 IF tenant IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 viewer:=app.member_role(tenant);
 IF viewer IS NULL OR viewer NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF NOT app.fresh_mfa() THEN RAISE EXCEPTION 'Verify your authenticator again to continue' USING ERRCODE='42501'; END IF;
 IF NOT app.reply_review_open() THEN RAISE EXCEPTION 'Reply review is not open' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR reply IS NULL OR outcome NOT IN ('PUBLISH','ASK','REJECT') THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='23514'; END IF;
 IF remark IS NOT NULL THEN remark:=btrim(remark); IF remark='' THEN remark:=NULL; END IF; END IF;
 IF asked IS NOT NULL THEN SELECT coalesce(array_agg(DISTINCT t ORDER BY t),'{}') INTO cleaned FROM unnest(asked) t; END IF;
 IF (outcome='REJECT') IS DISTINCT FROM (code IS NOT NULL) OR (outcome='ASK') IS DISTINCT FROM (cleaned IS NOT NULL AND cardinality(cleaned)>0)
  OR (outcome='PUBLISH' AND (code IS NOT NULL OR asked IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('app.reply_review:'||tenant::text||':'||reply::text,0));
 IF NOT EXISTS(SELECT FROM app.recipient_detail_response r WHERE r.tenant_id=tenant AND r.id=reply AND r.retention_until>clock_timestamp())
 THEN RAISE EXCEPTION 'Reply not found' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM app.recipient_reply_review WHERE tenant_id=tenant AND command_id=command;
 IF old.id IS NOT NULL THEN
  IF old.response_id<>reply OR old.decision<>outcome OR old.reason_code IS DISTINCT FROM code OR old.ask_terms IS DISTINCT FROM cleaned
   OR old.note IS DISTINCT FROM remark OR old.reviewed_by<>actor THEN RAISE EXCEPTION 'Review command key reused' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('id',old.id,'replayed',true);
 END IF;
 IF EXISTS(SELECT FROM app.recipient_reply_review x WHERE x.tenant_id=tenant AND x.response_id=reply AND x.decision IN ('PUBLISH','REJECT'))
 THEN RAISE EXCEPTION 'This reply already has a final decision' USING ERRCODE='23514'; END IF;
 INSERT INTO app.recipient_reply_review(tenant_id,response_id,command_id,decision,reason_code,ask_terms,note,reviewed_by)
 VALUES(tenant,reply,command,outcome,code,cleaned,remark,actor) RETURNING id INTO rid;
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action)
 SELECT gen_random_uuid(),tenant,e.id,actor,'recipient_reply.'||lower(outcome)
 FROM app.domain_event e WHERE e.tenant_id=tenant AND e.aggregate_id=rid::text ORDER BY e.occurred_at DESC LIMIT 1;
 RETURN jsonb_build_object('id',rid,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION app.review_recipient_reply(uuid,uuid,text,text,text[],text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.review_recipient_reply(uuid,uuid,text,text,text[],text) TO corridra_runtime;

-- Whether review is open. The only fact a staff screen may learn about the control.
CREATE FUNCTION app.reply_review_status() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.reply_review_open() $$;
REVOKE ALL ON FUNCTION app.reply_review_status() FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.reply_review_status() TO corridra_runtime;
