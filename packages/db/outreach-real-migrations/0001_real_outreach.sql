-- ADR-090. Optional module: the real email lane for introductions, beside the sample lane. Nothing is sent by this file.
-- One pipeline, two lanes that cannot mix: a sample workspace takes only the SYNTHETIC and MANUAL channels and a real workspace
-- (app.real_use_allowed) takes only EMAIL. Seven functions are replaced, each hash-guarded against the definition named here:
--  1. app.guard_communication() (migrations/0009). Sample conditions are unchanged. A real workspace is accepted when real use
--     is allowed, only with an EMAIL policy, with policy jurisdiction OTHER for a country outside BD, ES and DE, and never for
--     a suppressed address.
--  2. app.communication_allowed(uuid,boolean) (migrations/0009). Sample conditions are unchanged. A real message is allowed only
--     with recorded consent, an EMAIL policy and an address that is not suppressed. Every other condition (approver role,
--     two-step sign-in, country, purpose, classification, expiry, policy version, revocation) applies to both lanes as before.
--  3. app.experience_outreach_rows_for(uuid,uuid[]) (customer-real-use 0017). One condition added: a test-mode receipt
--     (provider email_test) never counts a target as approached.
--  4. app.record_capability_change(), app.buyer_decide(text,uuid,text,boolean), app.buyer_optout(text) (migrations/0009) and
--     app.recipient_detail_respond(text,uuid,jsonb) (migrations/0025 as changed by customer-real-use 0020). In each, only the lookup of the service executor that
--     records a receipt, an answer or an opt-out is replaced by app.outreach_executor: the same lookup for a sample workspace,
--     the configured real-use executor for a real workspace, and nobody for anything else. Guard 1 uses the same call.
-- The receipt provider check gains 'email' (live) and 'email_test' (test mode). New tables hold consent, suppression, provider
-- notices and daily counts; the runtime role writes them only through the functions below.
-- Rollback: rollback/0001_restore.sql restores the seven definitions and the check; it is run only as a reviewed forward run.
DO $guard$ BEGIN
 IF to_regprocedure('app.real_use_allowed(uuid)') IS NULL OR to_regprocedure('app.tenant_is_synthetic(uuid)') IS NULL
  OR to_regprocedure('app.guard_communication()') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.guard_communication()'::regprocedure),'UTF8')),'hex')<>'8cb1b516ee4779bb60d063392963168457b7b4f1cc5c1899216ff17977aa371a'
  OR to_regprocedure('app.communication_allowed(uuid,boolean)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.communication_allowed(uuid,boolean)'::regprocedure),'UTF8')),'hex')<>'b0bd1d71e29456555852f9d041f377edf41d1f917d006f2ba0ca471678313b1e'
  OR to_regprocedure('app.experience_outreach_rows_for(uuid,uuid[])') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.experience_outreach_rows_for(uuid,uuid[])'::regprocedure),'UTF8')),'hex')<>'2db8a86152ef0bda44a5bc6f1bc31d192a2cf29e741f610a95bd21e653ea438f'
  OR to_regprocedure('app.record_capability_change()') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.record_capability_change()'::regprocedure),'UTF8')),'hex')<>'40126ce07f7acdc0a848f7dd000996f30be4fcc81805421f6531f7d0d6c8380b'
  OR to_regprocedure('app.buyer_decide(text,uuid,text,boolean)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.buyer_decide(text,uuid,text,boolean)'::regprocedure),'UTF8')),'hex')<>'793a0bd10d4838e304396b2f60ca06847596b625f721ccad63a8bef2f4dbf134'
  OR to_regprocedure('app.buyer_optout(text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.buyer_optout(text)'::regprocedure),'UTF8')),'hex')<>'bb5b7f87b61e941c1f2cfdb8fd6e5a8cb75d4107ca33eb36e591ae1bc4b6aa8c'
  OR to_regprocedure('app.recipient_detail_respond(text,uuid,jsonb)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef('app.recipient_detail_respond(text,uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'32526f9c89d6483fe12d6f51bb0fb4a379e06adc6aa8c23a69f92fa5870bc71c'
  OR (SELECT encode(sha256(convert_to(pg_get_constraintdef(oid),'UTF8')),'hex') FROM pg_constraint WHERE conrelid='app.communication_receipt'::regclass AND conname='communication_receipt_provider_check') IS DISTINCT FROM '174138f6919e061f801b941a2318cee4d854a3afad79c1adb1c2c11768fb810d'
 THEN RAISE EXCEPTION 'Real outreach prerequisite differs'; END IF;
END $guard$;

ALTER TABLE app.communication_receipt DROP CONSTRAINT communication_receipt_provider_check;
ALTER TABLE app.communication_receipt ADD CONSTRAINT communication_receipt_provider_check CHECK(provider IN ('synthetic','manual','email','email_test'));

CREATE TABLE app.outreach_consent (
 message_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, contact_id uuid NOT NULL,
 basis text NOT NULL CHECK(basis IN ('CONSENT','LEGITIMATE_INTEREST','EXISTING_RELATIONSHIP','PUBLISHED_BUSINESS_CONTACT')),
 note text NOT NULL CHECK(length(note) BETWEEN 3 AND 500), unsubscribe_hash text NOT NULL UNIQUE CHECK(unsubscribe_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id), FOREIGN KEY(tenant_id,contact_id) REFERENCES app.private_contact_data(tenant_id,id)
);
-- Suppression is by address hash and applies to every workspace. No address is stored.
CREATE TABLE app.outreach_suppression (
 recipient_key text PRIMARY KEY CHECK(recipient_key ~ '^[a-f0-9]{64}$'), reason text NOT NULL CHECK(reason IN ('OPT_OUT','HARD_BOUNCE','COMPLAINT')),
 tenant_id uuid NOT NULL, message_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id)
);
CREATE TABLE app.outreach_provider_event (
 event_id text PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 200), tenant_id uuid NOT NULL, message_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('DELIVERED','BOUNCED','COMPLAINED')), hard boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id)
);
CREATE TABLE app.outreach_send_count (
 day date NOT NULL, tenant_id uuid NOT NULL REFERENCES app.tenant(id), sent integer NOT NULL CHECK(sent>0), PRIMARY KEY(day,tenant_id)
);
ALTER TABLE app.outreach_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outreach_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outreach_provider_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outreach_send_count ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.outreach_consent,app.outreach_suppression,app.outreach_provider_event,app.outreach_send_count FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE POLICY outreach_consent_read ON app.outreach_consent FOR SELECT TO corridra_runtime USING(app.communication_access(tenant_id,message_id));
CREATE POLICY outreach_provider_event_read ON app.outreach_provider_event FOR SELECT TO corridra_runtime USING(app.communication_access(tenant_id,message_id));
GRANT SELECT ON app.outreach_consent,app.outreach_provider_event TO corridra_runtime;
CREATE TRIGGER outreach_consent_immutable BEFORE UPDATE OR DELETE ON app.outreach_consent FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER outreach_suppression_immutable BEFORE UPDATE OR DELETE ON app.outreach_suppression FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER outreach_provider_event_immutable BEFORE UPDATE OR DELETE ON app.outreach_provider_event FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

CREATE FUNCTION app.outreach_real_installed() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT true $$;
-- An address is suppressed by an opt-out link, a hard bounce or a complaint in any workspace, or by an opt-out recorded in any real workspace.
CREATE FUNCTION app.outreach_suppressed(k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.outreach_suppression s WHERE s.recipient_key=k)
  OR EXISTS(SELECT FROM app.communication_optout o WHERE o.recipient_key=k AND NOT app.tenant_is_synthetic(o.tenant_id))
$$;
-- The service executor that records what no signed-in person records. A sample workspace resolves only the sample intake
-- executor and a real workspace only the real-use executor; neither can resolve the other's, and anything else resolves nobody.
CREATE FUNCTION app.outreach_executor(t uuid,strict boolean) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN app.tenant_is_synthetic(t) THEN (SELECT d.service_id FROM app.intake_destination d WHERE d.tenant_id=t AND d.enabled
   AND (NOT strict OR EXISTS(SELECT FROM identity.principal p WHERE p.id=d.service_id AND p.kind='service' AND p.disabled_at IS NULL)))
  WHEN app.real_use_allowed(t) THEN (SELECT c.executor_id FROM customer_private.real_use_configuration c WHERE c.enabled
   AND (NOT strict OR EXISTS(SELECT FROM identity.principal p WHERE p.id=c.executor_id AND p.kind='service' AND p.disabled_at IS NULL))) END
$$;
REVOKE ALL ON FUNCTION app.outreach_executor(uuid,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE FUNCTION app.outreach_link_real(h text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT app.tenant_is_synthetic(l.tenant_id) FROM app.buyer_link l WHERE l.token_hash=h
$$;
-- Consent is recorded by the staff member who creates the introduction, in the same transaction, before it is queued.
CREATE FUNCTION app.outreach_record_consent(mid uuid,b text,n text,u text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.communication;
BEGIN
 SELECT * INTO c FROM app.communication WHERE id=mid AND app.communication_access(tenant_id,id,true);
 IF c.id IS NULL OR c.created_by IS DISTINCT FROM app.actor_id() OR app.tenant_is_synthetic(c.tenant_id) OR NOT app.real_use_allowed(c.tenant_id) THEN RAISE EXCEPTION 'Consent unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.outreach_consent(message_id,tenant_id,contact_id,basis,note,unsubscribe_hash,created_by) VALUES(mid,c.tenant_id,c.contact_id,b,n,u,c.created_by);
END $$;
-- The address and the reviewed words, only for the holder of the live lease of a message that may still be sent.
CREATE FUNCTION app.outreach_real_payload(mid uuid,h text,lease uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h AND lease_id=lease AND lease_until>now() AND status='RUNNING';
 IF j.id IS NULL OR app.tenant_is_synthetic(j.tenant_id) OR NOT app.communication_allowed(mid) OR NOT app.communication_enabled(j.tenant_id,'communications.dispatch') OR NOT app.communication_enabled(j.tenant_id,'communications.introductions') THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('email',pc.email,'name',pc.name,'template',t.body,'presentation',c.presentation) FROM app.communication c
  JOIN app.private_contact_data pc ON pc.tenant_id=c.tenant_id AND pc.id=c.contact_id JOIN app.communication_template t ON t.tenant_id=c.tenant_id AND t.id=c.template_id WHERE c.id=mid);
END $$;
-- One send is counted for the workspace and the day (UTC) before any provider call. The database caps both limits.
CREATE FUNCTION app.outreach_rate_take(mid uuid,h text,lease uuid,workspace_limit integer,global_limit integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch; d date:=(now() AT TIME ZONE 'UTC')::date; w integer; g integer;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h AND lease_id=lease AND lease_until>now() AND status='RUNNING';
 IF j.id IS NULL OR app.tenant_is_synthetic(j.tenant_id) THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('corridra:outreach:rate',0));
 SELECT coalesce(sum(sent),0),coalesce(sum(sent) FILTER(WHERE tenant_id=j.tenant_id),0) INTO g,w FROM app.outreach_send_count WHERE day=d;
 IF w>=least(greatest(coalesce(workspace_limit,0),0),200) OR g>=least(greatest(coalesce(global_limit,0),0),1000) THEN RETURN false; END IF;
 INSERT INTO app.outreach_send_count(day,tenant_id,sent) VALUES(d,j.tenant_id,1) ON CONFLICT(day,tenant_id) DO UPDATE SET sent=app.outreach_send_count.sent+1;
 RETURN true;
END $$;
-- The receipt of the real lane. 'email' is a live delivery; 'email_test' is test mode and is never counted as an approach.
CREATE FUNCTION app.deliver_real_email(mid uuid,h text,lease uuid,provider text,reference text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch; mode text; recipient text;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h AND lease_id=lease AND lease_until>now() AND status='RUNNING' FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 IF provider IS NULL OR provider NOT IN ('email','email_test') OR reference IS NULL OR length(reference) NOT BETWEEN 3 AND 159 THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='23514'; END IF;
 SELECT encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex') INTO recipient FROM app.communication c JOIN app.private_contact_data pc ON pc.tenant_id=c.tenant_id AND pc.id=c.contact_id WHERE c.id=mid;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.tenant_id::text||':recipient:'||recipient,0));
 PERFORM 1 FROM app.buyer_link WHERE tenant_id=j.tenant_id AND message_id=mid FOR SHARE;
 IF app.tenant_is_synthetic(j.tenant_id) OR NOT app.communication_allowed(mid) OR NOT app.communication_enabled(j.tenant_id,'communications.dispatch') OR NOT app.communication_enabled(j.tenant_id,'communications.introductions') THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 SELECT p.channel INTO mode FROM app.communication c JOIN app.communication_policy p ON p.tenant_id=c.tenant_id AND p.id=c.policy_id WHERE c.id=mid;
 IF mode IS DISTINCT FROM 'EMAIL' THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.communication_receipt(id,tenant_id,provider,reference) VALUES(mid,j.tenant_id,provider,reference) ON CONFLICT(id) DO NOTHING;
 RETURN provider||':'||mid::text;
END $$;
-- An opt-out by the private link of one message. It needs no switch, no sign-in and no unexpired message, and it can be repeated.
CREATE FUNCTION app.outreach_unsubscribe(u text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oc app.outreach_consent;
BEGIN
 IF u IS NULL OR u !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 SELECT * INTO oc FROM app.outreach_consent WHERE unsubscribe_hash=u;
 IF oc.message_id IS NULL THEN RETURN false; END IF;
 INSERT INTO app.outreach_suppression(recipient_key,reason,tenant_id,message_id)
  SELECT encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'),'OPT_OUT',oc.tenant_id,oc.message_id FROM app.private_contact_data pc WHERE pc.tenant_id=oc.tenant_id AND pc.id=oc.contact_id ON CONFLICT(recipient_key) DO NOTHING;
 RETURN true;
END $$;
-- A provider notice about one real message, recorded once. A hard bounce or a complaint suppresses the address everywhere.
CREATE FUNCTION app.outreach_record_event(eid text,mid uuid,k text,is_hard boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oc app.outreach_consent; n integer;
BEGIN
 IF eid IS NULL OR length(eid) NOT BETWEEN 1 AND 200 OR mid IS NULL OR k IS NULL OR k NOT IN ('DELIVERED','BOUNCED','COMPLAINED') OR is_hard IS NULL THEN RETURN false; END IF;
 SELECT * INTO oc FROM app.outreach_consent WHERE message_id=mid;
 IF oc.message_id IS NULL THEN RETURN false; END IF;
 INSERT INTO app.outreach_provider_event(event_id,tenant_id,message_id,kind,hard) VALUES(eid,oc.tenant_id,mid,k,is_hard) ON CONFLICT(event_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RETURN false; END IF;
 IF k='COMPLAINED' OR (k='BOUNCED' AND is_hard) THEN
  INSERT INTO app.outreach_suppression(recipient_key,reason,tenant_id,message_id)
   SELECT encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'),CASE WHEN k='COMPLAINED' THEN 'COMPLAINT' ELSE 'HARD_BOUNCE' END,oc.tenant_id,mid FROM app.private_contact_data pc WHERE pc.tenant_id=oc.tenant_id AND pc.id=oc.contact_id ON CONFLICT(recipient_key) DO NOTHING;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.outreach_real_installed(),app.outreach_suppressed(text),app.outreach_link_real(text),app.outreach_record_consent(uuid,text,text,text),app.outreach_real_payload(uuid,text,uuid),app.outreach_rate_take(uuid,text,uuid,integer,integer),app.deliver_real_email(uuid,text,uuid,text,text),app.outreach_unsubscribe(text),app.outreach_record_event(text,uuid,text,boolean) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.outreach_real_installed(),app.outreach_suppressed(text),app.outreach_link_real(text),app.outreach_record_consent(uuid,text,text,text),app.outreach_real_payload(uuid,text,uuid),app.outreach_rate_take(uuid,text,uuid,integer,integer),app.deliver_real_email(uuid,text,uuid,text,text),app.outreach_unsubscribe(text),app.outreach_record_event(text,uuid,text,boolean) TO corridra_runtime;

CREATE OR REPLACE FUNCTION app.guard_communication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pol app.communication_policy; pc app.private_contact_data; country text; v integer; real boolean;
BEGIN
 SELECT NOT synthetic INTO real FROM app.tenant WHERE id=NEW.tenant_id;
 IF real IS NULL OR (real AND NOT app.real_use_allowed(NEW.tenant_id)) THEN RAISE EXCEPTION 'Synthetic communications only'; END IF;
 IF TG_TABLE_NAME='communication_policy' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||NEW.jurisdiction||NEW.channel||NEW.contact_purpose,0));
  SELECT coalesce(max(version),0)+1 INTO v FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND jurisdiction=NEW.jurisdiction AND channel=NEW.channel AND contact_purpose=NEW.contact_purpose;
  IF NEW.version<>v OR (NEW.channel='EMAIL')<>real THEN RAISE EXCEPTION 'Unapproved policy version or real email'; END IF;
 ELSIF TG_TABLE_NAME='communication_template' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':template:'||NEW.name,0));
  IF NEW.version<>(SELECT coalesce(max(version),0)+1 FROM app.communication_template WHERE tenant_id=NEW.tenant_id AND name=NEW.name) THEN RAISE EXCEPTION 'Invalid template version'; END IF;
 ELSIF TG_TABLE_NAME='communication' THEN
  SELECT * INTO pc FROM app.private_contact_data WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id;
  SELECT o.country INTO country FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation o ON o.id=r.organisation_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND t.relationship_id=pc.relationship_id;
  SELECT * INTO pol FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND id=NEW.policy_id;
  IF NOT app.communication_enabled(NEW.tenant_id,'communications.introductions') OR country IS NULL OR pol.id IS NULL OR (country<>pol.jurisdiction AND NOT (real AND pol.jurisdiction='OTHER' AND country NOT IN ('BD','ES','DE'))) OR NOT pol.enabled OR (pol.channel='EMAIL')<>real OR pol.valid_until<NEW.expires_at OR pc.valid_until<NEW.expires_at
   OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=pc.tenant_id AND id=pc.source_id AND retention_until>=NEW.expires_at)
   OR NOT EXISTS(SELECT FROM app.target_account t JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND m.status IN ('TARGETING','OUTREACH','MEETINGS'))
   OR pol.version<>(SELECT max(version) FROM app.communication_policy WHERE tenant_id=pol.tenant_id AND jurisdiction=pol.jurisdiction AND channel=pol.channel AND contact_purpose=pol.contact_purpose AND effective_from<=now())
   OR NOT EXISTS(SELECT FROM app.communication_template WHERE tenant_id=NEW.tenant_id AND id=NEW.template_id AND contact_purpose=pol.contact_purpose)
   OR EXISTS(SELECT FROM app.communication_optout WHERE tenant_id=NEW.tenant_id AND recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'))
   OR (real AND app.outreach_suppressed(encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex')))
   OR app.outreach_executor(NEW.tenant_id,true) IS NULL
  THEN RAISE EXCEPTION 'Contact policy, recipient, mission or capability executor unavailable'; END IF;
  IF NOT (NEW.presentation ?& ARRAY['company','country','capability','fit','evidence','uncertainty','conversationPurpose','availableDates']) OR (SELECT count(*) FROM jsonb_object_keys(NEW.presentation))<>8 OR EXISTS(SELECT FROM jsonb_each(NEW.presentation) WHERE jsonb_typeof(value)<>'string' OR length(value#>>'{}') NOT BETWEEN 2 AND 1000) THEN RAISE EXCEPTION 'Invalid introduction'; END IF;
 ELSIF TG_TABLE_NAME='buyer_link_revocation' THEN
  PERFORM 1 FROM app.buyer_link WHERE tenant_id=NEW.tenant_id AND id=NEW.link_id FOR UPDATE;
 ELSIF TG_TABLE_NAME='buyer_link' THEN
  IF NEW.id<>NEW.message_id OR NOT EXISTS(SELECT FROM app.communication WHERE tenant_id=NEW.tenant_id AND id=NEW.message_id AND created_by=NEW.created_by) THEN RAISE EXCEPTION 'Introduction link mismatch'; END IF;
 ELSIF TG_TABLE_NAME='communication_optout' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':recipient:'||NEW.recipient_key,0));
  IF NOT EXISTS(SELECT FROM app.private_contact_data WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND NEW.recipient_key=encode(sha256(convert_to(lower(email),'UTF8')),'hex')) THEN RAISE EXCEPTION 'Opt-out recipient mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.communication_allowed(mid uuid,ignore_optout boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.communication c
 JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id
 JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id
 JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id
 JOIN app.private_contact_data pc ON pc.tenant_id=c.tenant_id AND pc.id=c.contact_id AND pc.relationship_id=r.id
 JOIN app.source_record src ON src.tenant_id=pc.tenant_id AND src.id=pc.source_id
 JOIN app.organisation org ON org.id=r.organisation_id
 JOIN app.communication_policy pol ON pol.tenant_id=c.tenant_id AND pol.id=c.policy_id
 JOIN app.communication_template tpl ON tpl.tenant_id=c.tenant_id AND tpl.id=c.template_id
 JOIN app.membership mem ON mem.tenant_id=c.tenant_id AND mem.user_id=c.created_by
 JOIN identity.principal p ON p.id=mem.user_id JOIN identity."user" u ON u.id=p.identity_id
 JOIN app.tenant ten ON ten.id=c.tenant_id
 WHERE c.id=mid AND ten.synthetic=org.synthetic AND (ten.synthetic OR (app.real_use_allowed(c.tenant_id)
  AND EXISTS(SELECT FROM app.outreach_consent oc WHERE oc.tenant_id=c.tenant_id AND oc.message_id=c.id)
  AND (ignore_optout OR NOT app.outreach_suppressed(encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex')))))
 AND c.expires_at>now() AND m.status IN ('TARGETING','OUTREACH','MEETINGS')
 AND pc.valid_until>=c.expires_at AND src.retention_until>=c.expires_at AND (pc.email LIKE '%@example.invalid' OR NOT ten.synthetic)
 AND pol.enabled AND (pol.channel='EMAIL')=(NOT ten.synthetic) AND (pol.jurisdiction=org.country OR (NOT ten.synthetic AND pol.jurisdiction='OTHER' AND org.country NOT IN ('BD','ES','DE'))) AND pol.valid_until>=c.expires_at AND pol.effective_from<=now()
 AND pol.version=(SELECT max(version) FROM app.communication_policy cp WHERE cp.tenant_id=pol.tenant_id AND cp.jurisdiction=pol.jurisdiction AND cp.channel=pol.channel AND cp.contact_purpose=pol.contact_purpose AND cp.effective_from<=now())
 AND tpl.contact_purpose=pol.contact_purpose
 AND mem.revoked_at IS NULL AND mem.role IN ('owner','admin','operator') AND p.disabled_at IS NULL AND u."twoFactorEnabled"
 AND p.operating_country=ANY(mem.allowed_countries) AND c.purpose=ANY(mem.allowed_purposes) AND c.classification=ANY(mem.allowed_classifications)
 AND r.classification=ANY(mem.allowed_classifications) AND pc.classification=ANY(mem.allowed_classifications) AND r.purpose=c.purpose AND pc.purpose=c.purpose
 AND (r.owner_id=c.created_by OR mem.role IN ('owner','admin'))
 AND (ignore_optout OR NOT EXISTS(SELECT FROM app.communication_optout o WHERE o.tenant_id=c.tenant_id AND o.recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex')))
 AND NOT EXISTS(SELECT FROM app.buyer_link l JOIN app.buyer_link_revocation v ON v.tenant_id=l.tenant_id AND v.link_id=l.id WHERE l.tenant_id=c.tenant_id AND l.message_id=c.id))
$$;
CREATE OR REPLACE FUNCTION app.experience_outreach_rows_for(t uuid, targets uuid[]) RETURNS TABLE(target_id uuid, approached boolean, responded boolean, interested boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT x.id,
  r.any OR EXISTS(SELECT FROM app.communication c JOIN app.communication_receipt cr ON cr.tenant_id=c.tenant_id AND cr.id=c.id AND cr.provider<>'email_test' WHERE c.tenant_id=t AND c.target_id=x.id),
  r.any,
  r.interested
 FROM unnest(targets) AS x(id)
 CROSS JOIN LATERAL(SELECT coalesce(bool_or(true),false) AS any, coalesce(bool_or(br.status='INTERESTED'),false) AS interested
  FROM app.communication c
  JOIN app.buyer_link l ON l.tenant_id=c.tenant_id AND l.message_id=c.id
  JOIN app.buyer_response br ON br.tenant_id=l.tenant_id AND br.link_id=l.id
  WHERE c.tenant_id=t AND c.target_id=x.id) r
 WHERE EXISTS(SELECT FROM app.target_account ta WHERE ta.tenant_id=t AND ta.id=x.id)
$$;
CREATE OR REPLACE FUNCTION app.record_capability_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid:=app.actor_id(); eid uuid:=gen_random_uuid(); rec jsonb:=to_jsonb(NEW);
BEGIN
 IF TG_TABLE_NAME='buyer_response' OR a IS NULL THEN a:=app.outreach_executor(NEW.tenant_id,true); END IF;
 IF a IS NULL OR (TG_TABLE_NAME IN ('buyer_response','communication_optout') AND (rec->>'created_by')::uuid<>a) THEN RAISE EXCEPTION 'Capability executor required'; END IF;
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,TG_TABLE_NAME||'.'||lower(TG_OP),1,TG_TABLE_NAME,NEW.id::text,1,a,now(),coalesce(NULLIF(current_setting('corridra.correlation_id',true),'')::uuid,gen_random_uuid()),coalesce(NULLIF(current_setting('corridra.causation_id',true),'')::uuid,gen_random_uuid()),jsonb_strip_nulls(jsonb_build_object('id',NEW.id,'status',rec->>'status')));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,TG_TABLE_NAME||'.'||lower(TG_OP));
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.buyer_decide(h text,rid uuid,decision text,optout boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.buyer_link; c app.communication; old app.buyer_response; service uuid; contact app.private_contact_data;
BEGIN
 IF h IS NULL OR rid IS NULL OR decision IS NULL OR optout IS NULL OR h !~ '^[a-f0-9]{64}$' OR decision NOT IN ('INTERESTED','NEED_INFO','NOT_RELEVANT') OR (decision='INTERESTED' AND optout) THEN RAISE EXCEPTION 'Invalid response' USING ERRCODE='23514'; END IF;
 SELECT * INTO l FROM app.buyer_link WHERE token_hash=h FOR UPDATE;
 IF l.id IS NULL OR NOT app.communication_enabled(l.tenant_id,'communications.introductions') THEN RETURN NULL; END IF;
 SELECT * INTO old FROM app.buyer_response WHERE tenant_id=l.tenant_id AND link_id=l.id;
 IF old.id IS NOT NULL THEN
  IF NOT app.communication_allowed(l.message_id,true) THEN RETURN NULL; END IF;
  IF old.status<>decision OR old.opt_out<>optout THEN RAISE EXCEPTION 'Decision already recorded' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('decision',old.status,'recorded',true);
 END IF;
 IF NOT app.communication_allowed(l.message_id) THEN RETURN NULL; END IF;
 SELECT * INTO c FROM app.communication WHERE tenant_id=l.tenant_id AND id=l.message_id;
 service:=app.outreach_executor(l.tenant_id,true);
 IF service IS NULL THEN RETURN NULL; END IF;
 INSERT INTO app.buyer_response(id,tenant_id,link_id,status,opt_out,created_by) VALUES(rid,l.tenant_id,l.id,decision,optout,service);
 IF optout THEN
  SELECT * INTO contact FROM app.private_contact_data WHERE tenant_id=c.tenant_id AND id=c.contact_id;
  INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by) VALUES(l.tenant_id,contact.id,encode(sha256(convert_to(lower(contact.email),'UTF8')),'hex'),'Buyer requested no further introductions',service) ON CONFLICT(tenant_id,recipient_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('decision',decision,'recorded',true);
END $$;
CREATE OR REPLACE FUNCTION app.buyer_optout(h text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.buyer_link; c app.communication; service uuid; pc app.private_contact_data;
BEGIN
 SELECT * INTO l FROM app.buyer_link WHERE token_hash=h FOR UPDATE;
 IF l.id IS NULL OR NOT app.communication_allowed(l.message_id,true) THEN RETURN false; END IF;
 SELECT * INTO c FROM app.communication WHERE tenant_id=l.tenant_id AND id=l.message_id;
 service:=app.outreach_executor(l.tenant_id,false);
 SELECT * INTO pc FROM app.private_contact_data WHERE tenant_id=c.tenant_id AND id=c.contact_id;
 IF service IS NULL THEN RETURN false; END IF;
 INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by) VALUES(l.tenant_id,pc.id,encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'),'Buyer requested no further introductions',service) ON CONFLICT(tenant_id,recipient_key) DO NOTHING;
 RETURN true;
END $$;
-- app.recipient_detail_respond is changed in place, because a later real-use file already changed its text: only the executor lookup is swapped.
DO $swap$ DECLARE d text:=pg_get_functiondef('app.recipient_detail_respond(text,uuid,jsonb)'::regprocedure);
 a text:=$a$SELECT dest.service_id INTO service FROM app.intake_destination dest JOIN identity.principal p ON p.id=dest.service_id WHERE dest.tenant_id=l.tenant_id AND dest.enabled AND p.kind='service' AND p.disabled_at IS NULL;$a$; b text:=$b$service:=app.outreach_executor(l.tenant_id,true);$b$;
BEGIN
 IF (length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Real outreach prerequisite differs'; END IF;
 EXECUTE replace(d,a,b);
END $swap$;
