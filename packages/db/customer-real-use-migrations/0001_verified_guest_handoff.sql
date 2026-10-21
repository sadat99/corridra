-- ADR056. Optional real-use authority; installing this schema alone opens no admission.
-- Existing configurations, records, migration registries and customer grants are preserved.
CREATE TABLE customer_private.real_use_configuration (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 issuer text NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 intake_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 owner_id uuid NOT NULL REFERENCES identity.principal(id),
 notice_version text NOT NULL CHECK(notice_version='real-intake-2026-10-21-v1'),
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER real_use_configuration_immutable BEFORE UPDATE OR DELETE ON customer_private.real_use_configuration
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TABLE customer_private.real_use_admission_control (
 version integer PRIMARY KEY CHECK(version>0),enabled boolean NOT NULL,
 executor_id uuid NOT NULL REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.real_use_admission_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.real_use_admission_control FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER real_use_admission_control_immutable BEFORE UPDATE OR DELETE ON customer_private.real_use_admission_control FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE FUNCTION customer_private.real_admission_open() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled) AND coalesce((SELECT enabled FROM customer_private.real_use_admission_control ORDER BY version DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION customer_private.real_admission_open() FROM PUBLIC,corridra_runtime,corridra_auth;
ALTER TABLE customer_private.session_proof ADD COLUMN data_mode text NOT NULL DEFAULT 'synthetic' CHECK(data_mode IN ('synthetic','real'));
ALTER TABLE customer_private.session_proof ADD COLUMN verified_email_hash text CHECK(verified_email_hash ~ '^[a-f0-9]{64}$');
GRANT INSERT(data_mode,verified_email_hash) ON customer_private.session_proof TO corridra_auth;

CREATE TABLE customer_private.pending_request (
 id uuid PRIMARY KEY,
 possession_hash text NOT NULL CHECK(possession_hash ~ '^[a-f0-9]{64}$'),
 brief jsonb NOT NULL CHECK(jsonb_typeof(brief)='object' AND octet_length(brief::text)<=32768),
 brief_digest text NOT NULL CHECK(brief_digest ~ '^[a-f0-9]{64}$'),
 email_hash text NOT NULL CHECK(email_hash ~ '^[a-f0-9]{64}$'),
 notice_version text NOT NULL CHECK(notice_version='real-intake-2026-10-21-v1'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours 1 second')
);
CREATE TABLE customer_private.pending_request_claim (
 pending_id uuid PRIMARY KEY REFERENCES customer_private.pending_request(id),
 principal_id uuid NOT NULL REFERENCES customer_private.principal(id),
 request_id uuid NOT NULL UNIQUE REFERENCES customer_private.owned_request(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER pending_request_immutable BEFORE UPDATE OR DELETE ON customer_private.pending_request
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER pending_request_claim_immutable BEFORE UPDATE OR DELETE ON customer_private.pending_request_claim
 FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
REVOKE ALL ON customer_private.real_use_configuration,customer_private.pending_request,customer_private.pending_request_claim FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.real_brief_valid(b jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE fields text[]:=ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','name','company','email','acknowledged'];
BEGIN
 IF b IS NULL OR jsonb_typeof(b)<>'object' OR octet_length(b::text)>16000
 OR jsonb_path_exists(b,'$.**.password') OR jsonb_path_exists(b,'$.**.newPassword')
 OR jsonb_path_exists(b,'$.**.sessionToken') OR jsonb_path_exists(b,'$.**.accountSubject')
 OR NOT(b ?& fields) OR b-(fields||ARRAY['experience'])<>'{}'::jsonb
 OR b->'acknowledged' IS DISTINCT FROM 'true'::jsonb
 OR EXISTS(SELECT FROM jsonb_each(b) v WHERE v.key=ANY(array_remove(array_remove(fields,'acknowledged'),'outcomes')) AND jsonb_typeof(v.value)<>'string')
 OR b->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else')
 OR length(b->>'market') NOT BETWEEN 2 AND 120 OR length(b->>'offer') NOT BETWEEN 10 AND 2000
 OR length(b->>'name') NOT BETWEEN 2 AND 120 OR length(b->>'company') NOT BETWEEN 2 AND 160
 OR length(b->>'email')>254 OR b->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 OR length(b->>'notes')>1000 OR length(b->>'website')>2000
 OR (b->>'website'<>'' AND b->>'website' !~ '^https?://[^[:space:]]+$')
 OR b->>'attendance' NOT IN ('Yes','No','Not decided')
 OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=b->>'timezone')
 OR jsonb_typeof(b->'outcomes')<>'array' THEN RETURN false;END IF;
 IF jsonb_array_length(b->'outcomes') NOT BETWEEN 1 AND 7
 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(b->'outcomes'))<>jsonb_array_length(b->'outcomes')
 OR EXISTS(SELECT FROM jsonb_array_elements(b->'outcomes') o WHERE jsonb_typeof(o)<>'string' OR o#>>'{}' NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) THEN RETURN false;END IF;
 IF (b->>'attendance'='Yes' AND (b->>'startDate'='' OR b->>'endDate'=''))
 OR (b->>'attendance'<>'Yes' AND (b->>'startDate'<>'' OR b->>'endDate'<>'')) THEN RETURN false;END IF;
 IF b->>'startDate'<>'' AND (b->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((b->>'startDate')::date,'YYYY-MM-DD')<>b->>'startDate') THEN RETURN false;END IF;
 IF b->>'endDate'<>'' AND (b->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((b->>'endDate')::date,'YYYY-MM-DD')<>b->>'endDate') THEN RETURN false;END IF;
 IF b->>'startDate'<>'' AND b->>'endDate'<>'' AND b->>'endDate'<b->>'startDate' THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE FUNCTION customer.stage_pending_request(pending_key uuid, possession text, b jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old customer_private.pending_request%ROWTYPE;digest text;
BEGIN
 IF NOT customer_private.real_admission_open() THEN RAISE EXCEPTION 'Real request intake is unavailable' USING ERRCODE='42501';END IF;
 IF pending_key IS NULL OR possession IS NULL OR possession !~ '^[a-f0-9]{64}$' OR NOT customer_private.real_brief_valid(b) THEN RAISE EXCEPTION 'Invalid request handoff' USING ERRCODE='23514';END IF;
 digest:=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.pending:'||pending_key::text,0));
 SELECT * INTO old FROM customer_private.pending_request WHERE id=pending_key;
 IF FOUND THEN
  IF old.possession_hash<>possession OR old.brief_digest<>digest OR old.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Request handoff conflicts or expired' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('id',old.id,'expiresAt',old.expires_at);
 END IF;
 IF (SELECT count(*) FROM customer_private.pending_request WHERE expires_at>clock_timestamp())>=10000 THEN RAISE EXCEPTION 'Request intake is busy' USING ERRCODE='53400';END IF;
 INSERT INTO customer_private.pending_request(id,possession_hash,brief,brief_digest,email_hash,notice_version)
 VALUES(pending_key,possession,b,digest,encode(sha256(convert_to(lower(btrim(b->>'email')),'UTF8')),'hex'),'real-intake-2026-10-21-v1') RETURNING * INTO old;
 RETURN jsonb_build_object('id',old.id,'expiresAt',old.expires_at);
END $$;

CREATE FUNCTION customer.pending_request_for_claim(pending_key uuid, possession text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pending customer_private.pending_request%ROWTYPE;actor uuid:=customer.actor_id();proof customer_private.session_proof%ROWTYPE;claimed customer_private.pending_request_claim%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE='42501';END IF;
 SELECT * INTO proof FROM customer_private.session_proof WHERE hash=current_setting('corridra.customer_proof_hash',true) AND expires_at>clock_timestamp();
 IF NOT FOUND OR proof.data_mode<>'real' OR proof.verified_email_hash IS NULL OR NOT EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled AND issuer=proof.issuer) THEN RAISE EXCEPTION 'Verified real-use identity required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.pending:'||pending_key::text,0));
 SELECT * INTO pending FROM customer_private.pending_request WHERE id=pending_key AND possession_hash=possession AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Request handoff expired or unavailable' USING ERRCODE='42501';END IF;
 IF pending.email_hash<>proof.verified_email_hash THEN RAISE EXCEPTION 'Sign in with the account used for this request' USING ERRCODE='42501';END IF;
 SELECT * INTO claimed FROM customer_private.pending_request_claim WHERE pending_id=pending_key;
 IF FOUND AND claimed.principal_id<>actor THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('brief',pending.brief,'requestId',claimed.request_id);
END $$;

CREATE FUNCTION customer.complete_pending_request(pending_key uuid, possession text, owned_request uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pending jsonb;actor uuid:=customer.actor_id();saved customer_private.pending_request_claim%ROWTYPE;
BEGIN
 pending:=customer.pending_request_for_claim(pending_key,possession);
 IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.id=owned_request AND r.principal_id=actor AND r.command_id=pending_key AND r.brief_digest=encode(sha256(convert_to((pending->'brief')::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Canonical request ownership mismatch' USING ERRCODE='42501';END IF;
 INSERT INTO customer_private.pending_request_claim(pending_id,principal_id,request_id) VALUES(pending_key,actor,owned_request) ON CONFLICT(pending_id) DO NOTHING;
 SELECT * INTO saved FROM customer_private.pending_request_claim WHERE pending_id=pending_key;
 IF saved.principal_id<>actor OR saved.request_id<>owned_request THEN RAISE EXCEPTION 'Request claim conflicts' USING ERRCODE='23514';END IF;
 RETURN customer_private.request_result(saved.request_id,actor);
END $$;
REVOKE ALL ON FUNCTION customer_private.real_brief_valid(jsonb),customer.stage_pending_request(uuid,text,jsonb),customer.pending_request_for_claim(uuid,text),customer.complete_pending_request(uuid,text,uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.stage_pending_request(uuid,text,jsonb),customer.pending_request_for_claim(uuid,text),customer.complete_pending_request(uuid,text,uuid) TO corridra_runtime;
ALTER TABLE customer_private.real_use_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.pending_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.pending_request_claim ENABLE ROW LEVEL SECURITY;
