-- Additive Part 07: synthetic commercial truth. Existing records are not rewritten.
CREATE TABLE app.currency (code text PRIMARY KEY, exponent integer NOT NULL CHECK(exponent BETWEEN 0 AND 3));
INSERT INTO app.currency VALUES ('BDT',2),('EUR',2),('USD',2),('GBP',2),('JPY',0);
GRANT SELECT ON app.currency TO corridra_runtime;
CREATE TABLE app.opportunity (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, mission_id uuid NOT NULL, target_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160), attribution text NOT NULL CHECK(length(attribution) BETWEEN 3 AND 1000), attribution_scope text NOT NULL DEFAULT 'MISSION_ASSOCIATED' CHECK(attribution_scope='MISSION_ASSOCIATED'),
 status text NOT NULL DEFAULT 'LEAD' CHECK(status IN ('LEAD','QUALIFIED_OPPORTUNITY','PROPOSAL','COMMITMENT','CONTRACT','INVOICE','CASH_COLLECTED','RECURRING_REVENUE','LOST')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), owner_id uuid NOT NULL REFERENCES identity.principal(id), next_action text NOT NULL CHECK(length(next_action) BETWEEN 3 AND 300), due_at timestamptz NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500), loss_reason text,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,meeting_id) REFERENCES app.meeting(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id), CHECK((status='LOST' AND loss_reason IS NOT NULL AND length(loss_reason) BETWEEN 3 AND 500) OR (status<>'LOST' AND loss_reason IS NULL))
);
CREATE TABLE app.commercial_record (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, opportunity_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('RFQ','SAMPLE','PROPOSAL','COMMITMENT','CONTRACT','INVOICE','CASH_RECEIPT','REPEAT_ORDER')),
 parent_id uuid, prior_receipt_id uuid, reverse_of uuid, source_id uuid NOT NULL, evidence_id uuid,
 occurred_at timestamptz NOT NULL CHECK(occurred_at<=now()), summary text NOT NULL CHECK(length(summary) BETWEEN 3 AND 1000), external_reference text NOT NULL CHECK(length(external_reference) BETWEEN 3 AND 200), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 amount_minor bigint CHECK(amount_minor<>0 AND abs(amount_minor)<=999999999999999999), currency text REFERENCES app.currency(code),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'), retention_until timestamptz NOT NULL, ai_policy text NOT NULL DEFAULT 'DENY' CHECK(ai_policy='DENY'),
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,kind,external_reference), UNIQUE(tenant_id,reverse_of),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES app.opportunity(tenant_id,id), FOREIGN KEY(tenant_id,parent_id) REFERENCES app.commercial_record(tenant_id,id), FOREIGN KEY(tenant_id,prior_receipt_id) REFERENCES app.commercial_record(tenant_id,id), FOREIGN KEY(tenant_id,reverse_of) REFERENCES app.commercial_record(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id), FOREIGN KEY(tenant_id,evidence_id) REFERENCES app.evidence_object(tenant_id,id),
 CHECK((kind IN ('PROPOSAL','COMMITMENT','CONTRACT','INVOICE','CASH_RECEIPT') AND amount_minor IS NOT NULL AND currency IS NOT NULL AND ((reverse_of IS NULL AND amount_minor>0) OR (reverse_of IS NOT NULL AND amount_minor<0))) OR (kind IN ('RFQ','SAMPLE','REPEAT_ORDER') AND amount_minor IS NULL AND currency IS NULL AND reverse_of IS NULL))
);
CREATE TABLE app.accounting_confirmation (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, opportunity_id uuid NOT NULL, record_id uuid NOT NULL, source_id uuid NOT NULL, occurred_at timestamptz NOT NULL CHECK(occurred_at<=now()), basis text NOT NULL CHECK(length(basis) BETWEEN 3 AND 1000), reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,record_id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES app.opportunity(tenant_id,id), FOREIGN KEY(tenant_id,record_id) REFERENCES app.commercial_record(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.commercial_command (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant(id), opportunity_id uuid, action text NOT NULL CHECK(action IN ('create','transition','followup','record','reverse','confirm','rebuild')), input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL DEFAULT 'synthetic_validation' CHECK(purpose='synthetic_validation'), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,opportunity_id) REFERENCES app.opportunity(tenant_id,id)
);
CREATE FUNCTION app.commercial_enabled(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.can_access(t,'INTERNAL','synthetic_validation') AND EXISTS(SELECT FROM app.tenant WHERE id=t AND synthetic) AND coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=t AND key='opportunities.commands' AND effective_from<=now() ORDER BY version DESC LIMIT 1),false)
$$;
CREATE FUNCTION app.opportunity_access(t uuid,oid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.opportunity o WHERE o.tenant_id=t AND o.id=oid AND app.can_access(t,o.classification,o.purpose) AND app.meeting_access(t,o.meeting_id,writing))
$$;
CREATE FUNCTION app.commercial_stage(s text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT array_position(ARRAY['LEAD','QUALIFIED_OPPORTUNITY','PROPOSAL','COMMITMENT','CONTRACT','INVOICE','CASH_COLLECTED','RECURRING_REVENUE'],s)
$$;
CREATE FUNCTION app.guard_opportunity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE required_kind text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial',0));
 IF NOT app.commercial_enabled(NEW.tenant_id) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') OR NOT app.meeting_access(NEW.tenant_id,NEW.meeting_id,true) THEN RAISE EXCEPTION 'Commercial commands are unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM app.meeting mt JOIN app.communication c ON c.tenant_id=mt.tenant_id AND c.id=mt.message_id JOIN app.mission m ON m.tenant_id=mt.tenant_id AND m.id=mt.mission_id WHERE mt.tenant_id=NEW.tenant_id AND mt.id=NEW.meeting_id AND mt.status='HELD' AND mt.mission_id=NEW.mission_id AND c.target_id=NEW.target_id AND m.status IN ('FOLLOW_UP','COMMERCIAL_PIPELINE')) THEN RAISE EXCEPTION 'Held meeting and active commercial mission required' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active opportunity owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'LEAD' OR NEW.version<>1 OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Create a lead first' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.tenant_id,NEW.meeting_id,NEW.mission_id,NEW.target_id,NEW.title,NEW.attribution,NEW.attribution_scope,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.meeting_id,OLD.mission_id,OLD.target_id,OLD.title,OLD.attribution,OLD.attribution_scope,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Opportunity identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF OLD.status='LOST' OR NOT coalesce((NEW.status=OLD.status OR (app.commercial_stage(NEW.status)=app.commercial_stage(OLD.status)+1) OR (NEW.status='LOST' AND app.commercial_stage(OLD.status)<=6)),false) THEN RAISE EXCEPTION 'Invalid opportunity transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='LOST' AND coalesce((SELECT sum(r.amount_minor) FROM app.commercial_record r JOIN app.accounting_confirmation a ON a.tenant_id=r.tenant_id AND a.record_id=r.id WHERE r.tenant_id=NEW.tenant_id AND r.opportunity_id=NEW.id),0)>0 THEN RAISE EXCEPTION 'Confirmed cash must be compensated before loss' USING ERRCODE='23514'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   required_kind:=CASE NEW.status WHEN 'PROPOSAL' THEN 'PROPOSAL' WHEN 'COMMITMENT' THEN 'COMMITMENT' WHEN 'CONTRACT' THEN 'CONTRACT' WHEN 'INVOICE' THEN 'INVOICE' WHEN 'CASH_COLLECTED' THEN 'CASH_RECEIPT' WHEN 'RECURRING_REVENUE' THEN 'REPEAT_ORDER' END;
   IF required_kind IS NOT NULL AND NOT EXISTS(SELECT FROM app.commercial_record r WHERE r.tenant_id=NEW.tenant_id AND r.opportunity_id=NEW.id AND r.kind=required_kind AND r.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=r.tenant_id AND rv.reverse_of=r.id) AND (r.kind<>'CASH_RECEIPT' OR EXISTS(SELECT FROM app.accounting_confirmation ac WHERE ac.tenant_id=r.tenant_id AND ac.record_id=r.id))) THEN RAISE EXCEPTION 'Commercial evidence or confirmed cash required' USING ERRCODE='23514'; END IF;
   IF NEW.status='RECURRING_REVENUE' AND NOT EXISTS(SELECT FROM app.commercial_record rr JOIN app.commercial_record cash ON cash.tenant_id=rr.tenant_id AND cash.id=rr.parent_id JOIN app.commercial_record prior ON prior.tenant_id=rr.tenant_id AND prior.id=rr.prior_receipt_id WHERE rr.tenant_id=NEW.tenant_id AND rr.opportunity_id=NEW.id AND rr.kind='REPEAT_ORDER' AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=rr.tenant_id AND rv.reverse_of IN(cash.id,prior.id))) THEN RAISE EXCEPTION 'Unreversed repeat cash required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE FUNCTION app.guard_commercial_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o app.opportunity; src app.source_record; p app.commercial_record; original app.commercial_record; prior app.commercial_record; minimum integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial',0));
 IF NOT app.commercial_enabled(NEW.tenant_id) OR NOT app.opportunity_access(NEW.tenant_id,NEW.opportunity_id,true) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM app.opportunity WHERE tenant_id=NEW.tenant_id AND id=NEW.opportunity_id;
 SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND classification IN ('PUBLIC','INTERNAL') AND ai_policy='DENY' AND observed_at<=now() AND retention_until>now();
 IF src.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='CONTRACT' AND src.kind='self_declaration' THEN RAISE EXCEPTION 'Observed contract evidence required' USING ERRCODE='23514'; END IF;
 NEW.retention_until:=src.retention_until;
 IF NEW.evidence_id IS NOT NULL AND NOT EXISTS(SELECT FROM app.evidence_object e JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id JOIN app.claim c ON c.tenant_id=e.tenant_id AND c.id=e.claim_id WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.evidence_id AND c.source_id=NEW.source_id AND e.retention_until>now() AND es.status IN ('UNDER_REVIEW','VERIFIED') AND (es.scan_status='CLEAN' OR (es.scan_status='BYPASSED' AND coalesce((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=e.tenant_id AND key='evidence.scan_bypass' AND effective_from<=now() ORDER BY version DESC LIMIT 1),false))) AND e.classification IN ('PUBLIC','INTERNAL') AND app.can_access(e.tenant_id,e.classification,e.purpose)) THEN RAISE EXCEPTION 'Available matching evidence required' USING ERRCODE='23514'; END IF;
 IF NEW.reverse_of IS NOT NULL THEN
  IF app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa() THEN RAISE EXCEPTION 'Accounting authority and fresh MFA required' USING ERRCODE='42501'; END IF;
  SELECT * INTO original FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of;
  IF original.id IS NULL OR original.reverse_of IS NOT NULL OR original.opportunity_id<>NEW.opportunity_id OR original.kind<>NEW.kind OR original.currency IS DISTINCT FROM NEW.currency OR NEW.amount_minor IS DISTINCT FROM -original.amount_minor OR NEW.parent_id IS DISTINCT FROM original.parent_id OR NEW.occurred_at<original.occurred_at OR NEW.prior_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Exact compensating record required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM app.commercial_record child WHERE child.tenant_id=NEW.tenant_id AND child.parent_id=original.id AND child.kind<>'REPEAT_ORDER' AND child.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.commercial_record rv WHERE rv.tenant_id=child.tenant_id AND rv.reverse_of=child.id AND (child.kind<>'CASH_RECEIPT' OR NOT EXISTS(SELECT FROM app.accounting_confirmation ac WHERE ac.tenant_id=child.tenant_id AND ac.record_id=child.id) OR EXISTS(SELECT FROM app.accounting_confirmation ac WHERE ac.tenant_id=rv.tenant_id AND ac.record_id=rv.id)))) THEN RAISE EXCEPTION 'Compensate dependent records first' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=o.tenant_id AND id=o.mission_id AND status IN ('FOLLOW_UP','COMMERCIAL_PIPELINE')) OR o.status='LOST' THEN RAISE EXCEPTION 'Active commercial opportunity required' USING ERRCODE='23514'; END IF;
 minimum:=CASE NEW.kind WHEN 'RFQ' THEN 2 WHEN 'SAMPLE' THEN 2 WHEN 'PROPOSAL' THEN 2 WHEN 'COMMITMENT' THEN 3 WHEN 'CONTRACT' THEN 4 WHEN 'INVOICE' THEN 5 WHEN 'CASH_RECEIPT' THEN 6 WHEN 'REPEAT_ORDER' THEN 7 END;
 IF app.commercial_stage(o.status)<minimum THEN RAISE EXCEPTION 'Progress the opportunity before recording this outcome' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('RFQ','SAMPLE','PROPOSAL') THEN
  IF NEW.parent_id IS NOT NULL OR NEW.prior_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected commercial parent' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id;
  IF p.id IS NULL OR p.opportunity_id<>NEW.opportunity_id OR p.reverse_of IS NOT NULL OR p.kind<>(CASE NEW.kind WHEN 'COMMITMENT' THEN 'PROPOSAL' WHEN 'CONTRACT' THEN 'COMMITMENT' WHEN 'INVOICE' THEN 'CONTRACT' WHEN 'CASH_RECEIPT' THEN 'INVOICE' WHEN 'REPEAT_ORDER' THEN 'CASH_RECEIPT' END) OR p.occurred_at>NEW.occurred_at OR EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=p.tenant_id AND reverse_of=p.id) THEN RAISE EXCEPTION 'Current matching parent required' USING ERRCODE='23514'; END IF;
  IF NEW.kind<>'REPEAT_ORDER' AND NEW.currency IS DISTINCT FROM p.currency THEN RAISE EXCEPTION 'Parent currency must match' USING ERRCODE='23514'; END IF;
  IF NEW.kind='INVOICE' AND NEW.amount_minor+coalesce((SELECT sum(amount_minor) FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND parent_id=p.id AND kind='INVOICE'),0)>p.amount_minor THEN RAISE EXCEPTION 'Invoices exceed contract amount' USING ERRCODE='23514'; END IF;
  IF NEW.kind='REPEAT_ORDER' THEN
   SELECT * INTO prior FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.prior_receipt_id;
   IF prior.id IS NULL OR prior.kind<>'CASH_RECEIPT' OR prior.reverse_of IS NOT NULL OR prior.opportunity_id<>NEW.opportunity_id OR prior.currency<>p.currency OR prior.occurred_at>=p.occurred_at OR prior.parent_id=p.parent_id OR EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=prior.tenant_id AND reverse_of=prior.id) OR NOT EXISTS(SELECT FROM app.accounting_confirmation WHERE tenant_id=p.tenant_id AND record_id=p.id) OR NOT EXISTS(SELECT FROM app.accounting_confirmation WHERE tenant_id=prior.tenant_id AND record_id=prior.id) OR EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=p.tenant_id AND kind='REPEAT_ORDER' AND parent_id=p.id) THEN RAISE EXCEPTION 'Distinct later confirmed cash required for recurrence' USING ERRCODE='23514'; END IF;
  ELSIF NEW.prior_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Prior receipt is only for recurrence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.guard_accounting_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r app.commercial_record; invoice app.commercial_record; total numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial',0));
 IF NOT app.commercial_enabled(NEW.tenant_id) OR NOT app.opportunity_access(NEW.tenant_id,NEW.opportunity_id,true) OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa() OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Accounting authority and fresh MFA required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=NEW.record_id;
 IF r.id IS NULL OR r.kind<>'CASH_RECEIPT' OR r.opportunity_id<>NEW.opportunity_id OR NEW.occurred_at<r.occurred_at OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND kind IN ('observation','document','public_record') AND app.can_access(tenant_id,classification,purpose) AND classification IN ('PUBLIC','INTERNAL') AND ai_policy='DENY' AND observed_at<=now() AND retention_until>now()) THEN RAISE EXCEPTION 'Observed accounting source and receipt required' USING ERRCODE='23514'; END IF;
 IF r.reverse_of IS NOT NULL AND NOT EXISTS(SELECT FROM app.accounting_confirmation WHERE tenant_id=r.tenant_id AND record_id=r.reverse_of) THEN RAISE EXCEPTION 'Original cash confirmation required' USING ERRCODE='23514'; END IF;
 SELECT * INTO invoice FROM app.commercial_record WHERE tenant_id=NEW.tenant_id AND id=r.parent_id;
 IF r.reverse_of IS NULL AND EXISTS(SELECT FROM app.commercial_record WHERE tenant_id=r.tenant_id AND reverse_of IN(r.id,invoice.id)) THEN RAISE EXCEPTION 'Compensated receipt or invoice cannot be confirmed' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(c.amount_minor),0) INTO total FROM app.commercial_record c JOIN app.accounting_confirmation a ON a.tenant_id=c.tenant_id AND a.record_id=c.id WHERE c.tenant_id=r.tenant_id AND c.parent_id=r.parent_id;
 IF total+r.amount_minor<0 OR total+r.amount_minor>invoice.amount_minor THEN RAISE EXCEPTION 'Confirmed cash exceeds invoice or reverses unconfirmed cash' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$
DECLARE tbl text; access text; roles text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['opportunity','commercial_record','accounting_confirmation','commercial_command'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  -- Materialize permitted opportunity IDs once per statement through the opportunity table's RLS.
  -- All four relations constrain classification/purpose to INTERNAL/synthetic_validation.
  access:=CASE WHEN tbl='opportunity' THEN 'app.meeting_access(tenant_id,meeting_id)' ELSE '(opportunity_id IS NULL OR opportunity_id IN (SELECT id FROM app.opportunity))' END;
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(tenant_id=(SELECT NULLIF(current_setting(''corridra.tenant_id'',true),'''')::uuid) AND (SELECT app.can_access(NULLIF(current_setting(''corridra.tenant_id'',true),'''')::uuid,''INTERNAL'',''synthetic_validation'')) AND %s)',tbl,access);
  access:=CASE WHEN tbl='opportunity' THEN 'app.meeting_access(tenant_id,meeting_id,true)' ELSE '(opportunity_id IS NULL OR app.opportunity_access(tenant_id,opportunity_id,true))' END;
  roles:=CASE WHEN tbl='accounting_confirmation' THEN 'app.member_role(tenant_id) IN (''owner'',''admin'') AND app.fresh_mfa()' ELSE 'app.member_role(tenant_id) IN (''owner'',''admin'',''operator'')' END;
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND app.commercial_enabled(tenant_id) AND %s AND created_by=app.actor_id() AND %s)',tbl,roles,access);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',tbl);
  IF tbl='opportunity' THEN
   EXECUTE 'CREATE POLICY change ON app.opportunity FOR UPDATE TO corridra_runtime USING(app.opportunity_access(tenant_id,id,true) AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'')) WITH CHECK(app.opportunity_access(tenant_id,id,true))';
   EXECUTE 'GRANT UPDATE ON app.opportunity TO corridra_runtime';
   EXECUTE 'CREATE TRIGGER opportunity_guard BEFORE INSERT OR UPDATE ON app.opportunity FOR EACH ROW EXECUTE FUNCTION app.guard_opportunity()';
   EXECUTE 'CREATE TRIGGER opportunity_event AFTER INSERT OR UPDATE ON app.opportunity FOR EACH ROW EXECUTE FUNCTION app.record_change()';
  ELSE
   EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',tbl);
   EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl);
  END IF;
 END LOOP;
END $$;
CREATE TRIGGER commercial_record_guard BEFORE INSERT ON app.commercial_record FOR EACH ROW EXECUTE FUNCTION app.guard_commercial_record();
CREATE TRIGGER accounting_confirmation_guard BEFORE INSERT ON app.accounting_confirmation FOR EACH ROW EXECUTE FUNCTION app.guard_accounting_confirmation();
CREATE UNIQUE INDEX repeat_cash_once ON app.commercial_record(tenant_id,parent_id) WHERE kind='REPEAT_ORDER';
CREATE INDEX opportunity_mission ON app.opportunity(tenant_id,mission_id,due_at,id);
CREATE INDEX commercial_opportunity ON app.commercial_record(tenant_id,opportunity_id,kind,occurred_at,id);
CREATE INDEX commercial_parent ON app.commercial_record(tenant_id,parent_id);
CREATE INDEX confirmation_opportunity ON app.accounting_confirmation(tenant_id,opportunity_id);
-- Typed canonical families use invoker security: the base relation's RLS remains authoritative.
DO $$ DECLARE pair text[]; BEGIN
 FOREACH pair SLICE 1 IN ARRAY ARRAY[['rfq','RFQ'],['sample','SAMPLE'],['proposal','PROPOSAL'],['commitment','COMMITMENT'],['contract','CONTRACT'],['invoice','INVOICE'],['cash_receipt','CASH_RECEIPT'],['repeat_order','REPEAT_ORDER']] LOOP
  EXECUTE format('CREATE VIEW app.%I WITH (security_invoker=true) AS SELECT * FROM app.commercial_record WHERE kind=%L',pair[1],pair[2]);
  EXECUTE format('GRANT SELECT ON app.%I TO corridra_runtime',pair[1]);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.commercial_enabled(uuid),app.opportunity_access(uuid,uuid,boolean),app.commercial_stage(text),app.guard_opportunity(),app.guard_commercial_record(),app.guard_accounting_confirmation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.commercial_enabled(uuid),app.opportunity_access(uuid,uuid,boolean),app.commercial_stage(text) TO corridra_runtime;
