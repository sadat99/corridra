-- Part 06: additive private communication records and narrow buyer/worker capabilities.
CREATE TABLE app.communication_policy (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 jurisdiction text NOT NULL CHECK(jurisdiction IN ('BD','ES','DE','OTHER')), channel text NOT NULL CHECK(channel IN ('SYNTHETIC','MANUAL','EMAIL')),
 contact_purpose text NOT NULL CHECK(contact_purpose IN ('institutional_introduction','referral','event_introduction','buyer_opt_in','official_company_channel','manual_outreach','platform_message','network_introduction')),
 version integer NOT NULL CHECK(version>0), basis text NOT NULL CHECK(length(basis) BETWEEN 3 AND 1000), enabled boolean NOT NULL,
 effective_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL CHECK(valid_until>effective_from AND valid_until<=effective_from+interval '30 days'),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,jurisdiction,channel,contact_purpose,version)
);
CREATE TABLE app.communication_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 name text NOT NULL CHECK(length(name) BETWEEN 3 AND 120), version integer NOT NULL CHECK(version>0), contact_purpose text NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 3 AND 1500),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,name,version)
);
CREATE TABLE app.communication (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), target_id uuid NOT NULL, contact_id uuid NOT NULL, policy_id uuid NOT NULL, template_id uuid NOT NULL,
 presentation jsonb NOT NULL CHECK(jsonb_typeof(presentation)='object' AND length(presentation::text)<6000),
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id), FOREIGN KEY(tenant_id,contact_id) REFERENCES app.private_contact_data(tenant_id,id),
 FOREIGN KEY(tenant_id,policy_id) REFERENCES app.communication_policy(tenant_id,id), FOREIGN KEY(tenant_id,template_id) REFERENCES app.communication_template(tenant_id,id)
);
CREATE TABLE app.buyer_link (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, message_id uuid NOT NULL, token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,message_id),
 FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id)
);
CREATE TABLE app.buyer_link_revocation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, link_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,link_id),
 FOREIGN KEY(tenant_id,link_id) REFERENCES app.buyer_link(tenant_id,id)
);
CREATE TABLE app.buyer_response (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, link_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('INTERESTED','NEED_INFO','NOT_RELEVANT')), opt_out boolean NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,link_id),
 FOREIGN KEY(tenant_id,link_id) REFERENCES app.buyer_link(tenant_id,id)
);
CREATE TABLE app.communication_optout (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), contact_id uuid NOT NULL,
 recipient_key text NOT NULL CHECK(recipient_key ~ '^[a-f0-9]{64}$'), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,recipient_key),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES app.private_contact_data(tenant_id,id)
);
CREATE TABLE app.communication_command (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), action text NOT NULL, input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE app.communication_dispatch (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, event_id uuid NOT NULL UNIQUE, capability_hash text NOT NULL CHECK(capability_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DELIVERED','DEAD','SUPPRESSED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_id uuid,
 last_error text CHECK(last_error IN ('TRANSIENT','PERMANENT','POLICY_BLOCKED')), workflow_run_id text, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,id) REFERENCES app.communication(tenant_id,id), FOREIGN KEY(tenant_id,event_id) REFERENCES app.domain_event(tenant_id,id)
);
CREATE TABLE app.communication_receipt (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, provider text NOT NULL CHECK(provider IN ('synthetic','manual')), reference text NOT NULL CHECK(length(reference)<160),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,id) REFERENCES app.communication(tenant_id,id)
);
CREATE TABLE app.communication_attempt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, message_id uuid NOT NULL, attempt integer NOT NULL, status text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,message_id) REFERENCES app.communication(tenant_id,id)
);

CREATE FUNCTION app.communication_access(target uuid,mid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.communication c WHERE c.tenant_id=target AND c.id=mid AND app.can_access(target,c.classification,c.purpose) AND app.research_target_access(target,c.target_id,writing))
$$;
CREATE FUNCTION app.buyer_link_access(target uuid,lid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.buyer_link l WHERE l.tenant_id=target AND l.id=lid AND app.communication_access(target,l.message_id,writing))
$$;
CREATE FUNCTION app.communication_enabled(target uuid,key text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=target AND config_version.key=communication_enabled.key AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$$;
-- Pure policy predicate for an already-approved effect. Does not confer session authority.
CREATE FUNCTION app.communication_allowed(mid uuid,ignore_optout boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 WHERE c.id=mid AND ten.synthetic AND org.synthetic AND c.expires_at>now() AND m.status IN ('TARGETING','OUTREACH','MEETINGS')
 AND pc.valid_until>=c.expires_at AND src.retention_until>=c.expires_at AND pc.email LIKE '%@example.invalid'
 AND pol.enabled AND pol.channel IN ('SYNTHETIC','MANUAL') AND pol.jurisdiction=org.country AND pol.valid_until>=c.expires_at AND pol.effective_from<=now()
 AND pol.version=(SELECT max(version) FROM app.communication_policy cp WHERE cp.tenant_id=pol.tenant_id AND cp.jurisdiction=pol.jurisdiction AND cp.channel=pol.channel AND cp.contact_purpose=pol.contact_purpose AND cp.effective_from<=now())
 AND tpl.contact_purpose=pol.contact_purpose
 AND mem.revoked_at IS NULL AND mem.role IN ('owner','admin','operator') AND p.disabled_at IS NULL AND u."twoFactorEnabled"
 AND p.operating_country=ANY(mem.allowed_countries) AND c.purpose=ANY(mem.allowed_purposes) AND c.classification=ANY(mem.allowed_classifications)
 AND r.classification=ANY(mem.allowed_classifications) AND pc.classification=ANY(mem.allowed_classifications) AND r.purpose=c.purpose AND pc.purpose=c.purpose
 AND (r.owner_id=c.created_by OR mem.role IN ('owner','admin'))
 AND (ignore_optout OR NOT EXISTS(SELECT FROM app.communication_optout o WHERE o.tenant_id=c.tenant_id AND o.recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex')))
 AND NOT EXISTS(SELECT FROM app.buyer_link l JOIN app.buyer_link_revocation v ON v.tenant_id=l.tenant_id AND v.link_id=l.id WHERE l.tenant_id=c.tenant_id AND l.message_id=c.id))
$$;
CREATE FUNCTION app.guard_communication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pol app.communication_policy; pc app.private_contact_data; country text; v integer;
BEGIN
 IF NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic communications only'; END IF;
 IF TG_TABLE_NAME='communication_policy' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||NEW.jurisdiction||NEW.channel||NEW.contact_purpose,0));
  SELECT coalesce(max(version),0)+1 INTO v FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND jurisdiction=NEW.jurisdiction AND channel=NEW.channel AND contact_purpose=NEW.contact_purpose;
  IF NEW.version<>v OR NEW.channel='EMAIL' THEN RAISE EXCEPTION 'Unapproved policy version or real email'; END IF;
 ELSIF TG_TABLE_NAME='communication_template' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':template:'||NEW.name,0));
  IF NEW.version<>(SELECT coalesce(max(version),0)+1 FROM app.communication_template WHERE tenant_id=NEW.tenant_id AND name=NEW.name) THEN RAISE EXCEPTION 'Invalid template version'; END IF;
 ELSIF TG_TABLE_NAME='communication' THEN
  SELECT * INTO pc FROM app.private_contact_data WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id;
  SELECT o.country INTO country FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation o ON o.id=r.organisation_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND t.relationship_id=pc.relationship_id;
  SELECT * INTO pol FROM app.communication_policy WHERE tenant_id=NEW.tenant_id AND id=NEW.policy_id;
  IF NOT app.communication_enabled(NEW.tenant_id,'communications.introductions') OR country IS NULL OR pol.id IS NULL OR country<>pol.jurisdiction OR NOT pol.enabled OR pol.channel='EMAIL' OR pol.valid_until<NEW.expires_at OR pc.valid_until<NEW.expires_at
   OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=pc.tenant_id AND id=pc.source_id AND retention_until>=NEW.expires_at)
   OR NOT EXISTS(SELECT FROM app.target_account t JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND m.status IN ('TARGETING','OUTREACH','MEETINGS'))
   OR pol.version<>(SELECT max(version) FROM app.communication_policy WHERE tenant_id=pol.tenant_id AND jurisdiction=pol.jurisdiction AND channel=pol.channel AND contact_purpose=pol.contact_purpose AND effective_from<=now())
   OR NOT EXISTS(SELECT FROM app.communication_template WHERE tenant_id=NEW.tenant_id AND id=NEW.template_id AND contact_purpose=pol.contact_purpose)
   OR EXISTS(SELECT FROM app.communication_optout WHERE tenant_id=NEW.tenant_id AND recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'))
   OR NOT EXISTS(SELECT FROM app.intake_destination d JOIN identity.principal p ON p.id=d.service_id WHERE d.tenant_id=NEW.tenant_id AND d.enabled AND p.kind='service' AND p.disabled_at IS NULL)
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
-- Capability events use the configured service executor, never pretend to be buyer identity.
CREATE FUNCTION app.record_capability_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid:=app.actor_id(); eid uuid:=gen_random_uuid(); rec jsonb:=to_jsonb(NEW);
BEGIN
 IF TG_TABLE_NAME='buyer_response' OR a IS NULL THEN SELECT d.service_id INTO a FROM app.intake_destination d JOIN identity.principal p ON p.id=d.service_id WHERE d.tenant_id=NEW.tenant_id AND d.enabled AND p.kind='service' AND p.disabled_at IS NULL; END IF;
 IF a IS NULL OR (TG_TABLE_NAME IN ('buyer_response','communication_optout') AND (rec->>'created_by')::uuid<>a) THEN RAISE EXCEPTION 'Capability executor required'; END IF;
 INSERT INTO app.domain_event VALUES(eid,NEW.tenant_id,TG_TABLE_NAME||'.'||lower(TG_OP),1,TG_TABLE_NAME,NEW.id::text,1,a,now(),coalesce(NULLIF(current_setting('corridra.correlation_id',true),'')::uuid,gen_random_uuid()),coalesce(NULLIF(current_setting('corridra.causation_id',true),'')::uuid,gen_random_uuid()),jsonb_strip_nulls(jsonb_build_object('id',NEW.id,'status',rec->>'status')));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),NEW.tenant_id,eid,a,TG_TABLE_NAME||'.'||lower(TG_OP));
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),NEW.tenant_id,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,NEW.tenant_id);
 RETURN NEW;
END $$;
DO $$
DECLARE tbl text; extra text; roles text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['communication_policy','communication_template','communication','buyer_link','buyer_link_revocation','buyer_response','communication_optout','communication_command'] LOOP
  extra:='true'; roles:='app.member_role(tenant_id) IN (''owner'',''admin'',''operator'')';
  IF tbl IN ('communication_policy','communication_template') THEN roles:='app.member_role(tenant_id) IN (''owner'',''admin'') AND app.fresh_mfa()'; END IF;
  IF tbl='communication' THEN extra:='app.research_target_access(tenant_id,target_id)'; END IF;
  IF tbl='buyer_link' THEN extra:='app.communication_access(tenant_id,message_id)'; END IF;
  IF tbl IN ('buyer_link_revocation','buyer_response') THEN extra:='app.buyer_link_access(tenant_id,link_id)'; END IF;
  IF tbl='communication_optout' THEN extra:='EXISTS(SELECT FROM app.private_contact_data pc WHERE pc.tenant_id=communication_optout.tenant_id AND pc.id=communication_optout.contact_id)'; END IF;
  IF tbl='communication_command' THEN extra:='created_by=app.actor_id()'; END IF;
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND (%s))',tbl||'_read',tbl,extra);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',tbl);
  IF tbl<>'buyer_response' THEN
   IF tbl='communication' THEN extra:='app.research_target_access(tenant_id,target_id,true)'; END IF;
   IF tbl='buyer_link' THEN extra:='app.communication_access(tenant_id,message_id,true)'; END IF;
   IF tbl='buyer_link_revocation' THEN extra:='app.buyer_link_access(tenant_id,link_id,true)'; END IF;
   EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND %s AND created_by=app.actor_id() AND (%s))',tbl||'_insert',tbl,roles,extra);
   EXECUTE format('GRANT INSERT ON app.%I TO corridra_runtime',tbl);
  END IF;
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',tbl||'_immutable',tbl);
  IF tbl IN ('buyer_response','communication_optout') THEN
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_capability_change()',tbl||'_event',tbl);
  ELSE
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl||'_event',tbl);
  END IF;
  IF tbl IN ('communication_policy','communication_template','communication','buyer_link','buyer_link_revocation','communication_optout') THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_communication()',tbl||'_guard',tbl);
  END IF;
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['communication_dispatch','communication_receipt','communication_attempt'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT TO corridra_runtime USING(app.communication_access(tenant_id,%s))',tbl||'_read',tbl,CASE WHEN tbl='communication_attempt' THEN 'message_id' ELSE 'id' END);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',tbl);
 END LOOP;
END $$;
CREATE TRIGGER communication_receipt_immutable BEFORE UPDATE OR DELETE ON app.communication_receipt FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER communication_receipt_event AFTER INSERT ON app.communication_receipt FOR EACH ROW EXECUTE FUNCTION app.record_capability_change();
CREATE TRIGGER communication_attempt_immutable BEFORE UPDATE OR DELETE ON app.communication_attempt FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();

CREATE FUNCTION app.buyer_view(h text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.buyer_link; c app.communication; answer app.buyer_response;
BEGIN
 SELECT * INTO l FROM app.buyer_link WHERE token_hash=h;
 IF l.id IS NULL OR NOT app.communication_allowed(l.message_id) OR NOT app.communication_enabled(l.tenant_id,'communications.introductions') THEN RETURN NULL; END IF;
 SELECT * INTO c FROM app.communication WHERE tenant_id=l.tenant_id AND id=l.message_id;
 SELECT * INTO answer FROM app.buyer_response WHERE tenant_id=l.tenant_id AND link_id=l.id;
 RETURN jsonb_build_object('introduction',c.presentation,'expiresAt',c.expires_at,'template',(SELECT body FROM app.communication_template WHERE tenant_id=c.tenant_id AND id=c.template_id),'decision',answer.status,'synthetic',true);
END $$;
CREATE FUNCTION app.buyer_decide(h text,rid uuid,decision text,optout boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 SELECT d.service_id INTO service FROM app.intake_destination d JOIN identity.principal p ON p.id=d.service_id WHERE d.tenant_id=l.tenant_id AND d.enabled AND p.kind='service' AND p.disabled_at IS NULL;
 IF service IS NULL THEN RETURN NULL; END IF;
 INSERT INTO app.buyer_response(id,tenant_id,link_id,status,opt_out,created_by) VALUES(rid,l.tenant_id,l.id,decision,optout,service);
 IF optout THEN
  SELECT * INTO contact FROM app.private_contact_data WHERE tenant_id=c.tenant_id AND id=c.contact_id;
  INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by) VALUES(l.tenant_id,contact.id,encode(sha256(convert_to(lower(contact.email),'UTF8')),'hex'),'Buyer requested no further introductions',service) ON CONFLICT(tenant_id,recipient_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('decision',decision,'recorded',true);
END $$;
CREATE FUNCTION app.buyer_optout(h text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.buyer_link; c app.communication; service uuid; pc app.private_contact_data;
BEGIN
 SELECT * INTO l FROM app.buyer_link WHERE token_hash=h FOR UPDATE;
 IF l.id IS NULL OR NOT app.communication_allowed(l.message_id,true) THEN RETURN false; END IF;
 SELECT * INTO c FROM app.communication WHERE tenant_id=l.tenant_id AND id=l.message_id;
 SELECT service_id INTO service FROM app.intake_destination WHERE tenant_id=l.tenant_id AND enabled;
 SELECT * INTO pc FROM app.private_contact_data WHERE tenant_id=c.tenant_id AND id=c.contact_id;
 IF service IS NULL THEN RETURN false; END IF;
 INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by) VALUES(l.tenant_id,pc.id,encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'),'Buyer requested no further introductions',service) ON CONFLICT(tenant_id,recipient_key) DO NOTHING;
 RETURN true;
END $$;

-- Queueing and worker functions are exact-message capabilities. Runtime has no job writes.
CREATE FUNCTION app.queue_communication(mid uuid,h text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.communication; eid uuid;
BEGIN
 SELECT * INTO c FROM app.communication WHERE id=mid AND app.communication_access(tenant_id,id,true);
 IF c.id IS NULL OR c.created_by<>app.actor_id() OR h IS NULL OR h !~ '^[a-f0-9]{64}$' OR NOT app.communication_allowed(mid) THEN RAISE EXCEPTION 'Queue unavailable' USING ERRCODE='42501'; END IF;
 SELECT id INTO eid FROM app.domain_event WHERE tenant_id=c.tenant_id AND aggregate_type='communication' AND aggregate_id=c.id::text AND type='communication.insert';
 INSERT INTO app.communication_dispatch(id,tenant_id,event_id,capability_hash) VALUES(c.id,c.tenant_id,eid,h);
END $$;
CREATE FUNCTION app.claim_communication(mid uuid,h text,lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch; pol app.communication_policy;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h FOR UPDATE;
 IF j.id IS NULL THEN RETURN jsonb_build_object('status','UNAVAILABLE'); END IF;
 IF EXISTS(SELECT FROM app.communication_receipt WHERE id=mid) THEN
  UPDATE app.communication_dispatch SET status='DELIVERED',last_error=NULL,lease_until=NULL,lease_id=NULL,updated_at=now() WHERE id=mid;
  UPDATE app.outbox_delivery SET delivered_at=(SELECT created_at FROM app.communication_receipt WHERE id=mid),lease_until=NULL WHERE event_id=j.event_id;
  RETURN jsonb_build_object('status','DELIVERED');
 END IF;
 IF j.status IN ('DELIVERED','DEAD','SUPPRESSED') THEN RETURN jsonb_build_object('status',j.status); END IF;
 IF j.lease_until>now() OR j.available_at>now() THEN RETURN jsonb_build_object('status','WAIT'); END IF;
 IF NOT app.communication_allowed(mid) OR NOT app.communication_enabled(j.tenant_id,'communications.dispatch') OR NOT app.communication_enabled(j.tenant_id,'communications.introductions') THEN
  UPDATE app.communication_dispatch SET status='SUPPRESSED',last_error='POLICY_BLOCKED',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=mid;
  INSERT INTO app.communication_attempt(tenant_id,message_id,attempt,status,reason) VALUES(j.tenant_id,mid,j.attempts,'SUPPRESSED','POLICY_BLOCKED');
  RETURN jsonb_build_object('status','SUPPRESSED');
 END IF;
 IF j.attempts>=3 THEN UPDATE app.communication_dispatch SET status='DEAD',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=mid; RETURN jsonb_build_object('status','DEAD'); END IF;
 UPDATE app.communication_dispatch SET status='RUNNING',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=mid;
 UPDATE app.outbox_delivery SET attempts=attempts+1,lease_until=now()+interval '30 seconds' WHERE event_id=j.event_id;
 INSERT INTO app.communication_attempt(tenant_id,message_id,attempt,status,reason) VALUES(j.tenant_id,mid,j.attempts+1,'RUNNING','CLAIMED');
 SELECT p.* INTO pol FROM app.communication c JOIN app.communication_policy p ON p.tenant_id=c.tenant_id AND p.id=c.policy_id WHERE c.id=mid;
 RETURN jsonb_build_object('status','CLAIMED','channel',pol.channel,'attempt',j.attempts+1);
END $$;
-- The initial channel's side effect is a persisted synthetic/manual delivery receipt.
-- Its stable message ID makes a lost acknowledgement safe to retry.
CREATE FUNCTION app.deliver_synthetic(mid uuid,h text,lease uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch; mode text; recipient text;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h AND lease_id=lease AND lease_until>now() AND status='RUNNING' FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 SELECT encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex') INTO recipient FROM app.communication c JOIN app.private_contact_data pc ON pc.tenant_id=c.tenant_id AND pc.id=c.contact_id WHERE c.id=mid;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.tenant_id::text||':recipient:'||recipient,0));
 PERFORM 1 FROM app.buyer_link WHERE tenant_id=j.tenant_id AND message_id=mid FOR SHARE;
 IF NOT app.communication_allowed(mid) OR NOT app.communication_enabled(j.tenant_id,'communications.dispatch') OR NOT app.communication_enabled(j.tenant_id,'communications.introductions') THEN RAISE EXCEPTION 'Delivery unavailable' USING ERRCODE='42501'; END IF;
 SELECT p.channel INTO mode FROM app.communication c JOIN app.communication_policy p ON p.tenant_id=c.tenant_id AND p.id=c.policy_id WHERE c.id=mid;
 IF mode NOT IN ('SYNTHETIC','MANUAL') THEN RAISE EXCEPTION 'Real sender is not configured'; END IF;
 INSERT INTO app.communication_receipt(id,tenant_id,provider,reference) VALUES(mid,j.tenant_id,lower(mode),lower(mode)||':'||mid::text) ON CONFLICT(id) DO NOTHING;
 RETURN lower(mode)||':'||mid::text;
END $$;
CREATE FUNCTION app.finish_communication(mid uuid,h text,lease uuid,result text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch; state text;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND capability_hash=h FOR UPDATE;
 IF j.id IS NULL THEN RETURN 'UNAVAILABLE'; END IF;
 IF j.status='DELIVERED' THEN RETURN 'DELIVERED'; END IF;
 IF j.lease_id IS DISTINCT FROM lease OR j.status<>'RUNNING' THEN RETURN 'WAIT'; END IF;
 IF result NOT IN ('DELIVERED','TRANSIENT','PERMANENT') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
 IF EXISTS(SELECT FROM app.communication_receipt WHERE id=mid) THEN state:='DELIVERED';
 ELSIF result='DELIVERED' THEN RAISE EXCEPTION 'A delivery receipt is required';
 ELSE state:=CASE WHEN result='PERMANENT' OR j.attempts>=3 THEN 'DEAD' ELSE 'PENDING' END; END IF;
 UPDATE app.communication_dispatch SET status=state,last_error=CASE WHEN state='DELIVERED' THEN NULL ELSE result END,available_at=now()+interval '5 seconds',lease_until=NULL,lease_id=NULL,updated_at=now() WHERE id=mid;
 UPDATE app.outbox_delivery SET delivered_at=CASE WHEN state='DELIVERED' THEN now() ELSE NULL END,available_at=now()+interval '5 seconds',lease_until=NULL WHERE event_id=j.event_id;
 INSERT INTO app.communication_attempt(tenant_id,message_id,attempt,status,reason) VALUES(j.tenant_id,mid,j.attempts,state,result);
 RETURN state;
END $$;
CREATE FUNCTION app.retry_communication(mid uuid,why text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.communication_dispatch;
BEGIN
 SELECT * INTO j FROM app.communication_dispatch WHERE id=mid AND app.communication_access(tenant_id,id,true) FOR UPDATE;
 IF j.id IS NULL OR app.member_role(j.tenant_id) NOT IN ('owner','admin','operator') OR j.status NOT IN ('DEAD','SUPPRESSED') OR NOT app.communication_allowed(mid) OR NOT app.communication_enabled(j.tenant_id,'communications.dispatch') OR length(why) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Retry unavailable'; END IF;
 UPDATE app.communication_dispatch SET status='PENDING',attempts=0,available_at=now(),last_error=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=mid;
 INSERT INTO app.communication_attempt(tenant_id,message_id,attempt,status,reason) VALUES(j.tenant_id,mid,0,'PENDING',why);
END $$;
CREATE FUNCTION app.communication_started(mid uuid,rid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF rid IS NULL OR length(rid)>160 OR NOT EXISTS(SELECT FROM app.communication_dispatch WHERE id=mid AND app.communication_access(tenant_id,id,true)) OR app.member_role((SELECT tenant_id FROM app.communication WHERE id=mid)) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Dispatch unavailable'; END IF;
 UPDATE app.communication_dispatch SET workflow_run_id=rid WHERE id=mid;
END $$;

REVOKE ALL ON FUNCTION app.communication_access(uuid,uuid,boolean),app.buyer_link_access(uuid,uuid,boolean),app.communication_allowed(uuid,boolean),app.guard_communication(),app.record_capability_change(),app.buyer_view(text),app.buyer_decide(text,uuid,text,boolean),app.buyer_optout(text),app.queue_communication(uuid,text),app.claim_communication(uuid,text,uuid),app.deliver_synthetic(uuid,text,uuid),app.finish_communication(uuid,text,uuid,text),app.retry_communication(uuid,text),app.communication_started(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.communication_enabled(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.communication_enabled(uuid,text) TO corridra_runtime;
GRANT EXECUTE ON FUNCTION app.communication_access(uuid,uuid,boolean),app.buyer_link_access(uuid,uuid,boolean),app.buyer_view(text),app.buyer_decide(text,uuid,text,boolean),app.buyer_optout(text),app.queue_communication(uuid,text),app.claim_communication(uuid,text,uuid),app.deliver_synthetic(uuid,text,uuid),app.finish_communication(uuid,text,uuid,text),app.retry_communication(uuid,text),app.communication_started(uuid,text) TO corridra_runtime;
CREATE INDEX communication_target_idx ON app.communication(tenant_id,target_id,created_at DESC);
CREATE INDEX communication_dispatch_pending_idx ON app.communication_dispatch(available_at) WHERE status IN ('PENDING','RUNNING');
CREATE INDEX communication_attempt_message_idx ON app.communication_attempt(tenant_id,message_id,created_at);
