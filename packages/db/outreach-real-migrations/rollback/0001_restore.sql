-- ADR-090 rollback. Restores the seven replaced functions and the receipt check to the definitions that the real outreach
-- module found. Run only as a reviewed forward run, after the switch is off. Tables and history written by the module stay.
-- It refuses while any real-lane receipt exists, because the restored check could not hold it.
DO $guard$ BEGIN IF EXISTS(SELECT FROM app.communication_receipt WHERE provider IN ('email','email_test')) THEN RAISE EXCEPTION 'Real outreach receipts exist; the check cannot be restored'; END IF; END $guard$;
ALTER TABLE app.communication_receipt DROP CONSTRAINT communication_receipt_provider_check;
ALTER TABLE app.communication_receipt ADD CONSTRAINT communication_receipt_provider_check CHECK(provider IN ('synthetic','manual'));
CREATE OR REPLACE FUNCTION app.guard_communication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
CREATE OR REPLACE FUNCTION app.experience_outreach_rows_for(t uuid, targets uuid[]) RETURNS TABLE(target_id uuid, approached boolean, responded boolean, interested boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT x.id,
  r.any OR EXISTS(SELECT FROM app.communication c JOIN app.communication_receipt cr ON cr.tenant_id=c.tenant_id AND cr.id=c.id WHERE c.tenant_id=t AND c.target_id=x.id),
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
 IF TG_TABLE_NAME='buyer_response' OR a IS NULL THEN SELECT d.service_id INTO a FROM app.intake_destination d JOIN identity.principal p ON p.id=d.service_id WHERE d.tenant_id=NEW.tenant_id AND d.enabled AND p.kind='service' AND p.disabled_at IS NULL; END IF;
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
 SELECT d.service_id INTO service FROM app.intake_destination d JOIN identity.principal p ON p.id=d.service_id WHERE d.tenant_id=l.tenant_id AND d.enabled AND p.kind='service' AND p.disabled_at IS NULL;
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
 SELECT service_id INTO service FROM app.intake_destination WHERE tenant_id=l.tenant_id AND enabled;
 SELECT * INTO pc FROM app.private_contact_data WHERE tenant_id=c.tenant_id AND id=c.contact_id;
 IF service IS NULL THEN RETURN false; END IF;
 INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by) VALUES(l.tenant_id,pc.id,encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex'),'Buyer requested no further introductions',service) ON CONFLICT(tenant_id,recipient_key) DO NOTHING;
 RETURN true;
END $$;
-- app.recipient_detail_respond is changed in place, because a later real-use file already changed its text: only the executor lookup is put back.
DO $swap$ DECLARE d text:=pg_get_functiondef('app.recipient_detail_respond(text,uuid,jsonb)'::regprocedure);
 a text:=$a$service:=app.outreach_executor(l.tenant_id,true);$a$; b text:=$b$SELECT dest.service_id INTO service FROM app.intake_destination dest JOIN identity.principal p ON p.id=dest.service_id WHERE dest.tenant_id=l.tenant_id AND dest.enabled AND p.kind='service' AND p.disabled_at IS NULL;$b$;
BEGIN
 IF (length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Real outreach prerequisite differs'; END IF;
 EXECUTE replace(d,a,b);
END $swap$;
