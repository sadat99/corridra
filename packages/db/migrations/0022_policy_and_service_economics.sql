-- Separate Corridra delivery economics. Customer commercial_record is never service revenue.
CREATE TABLE app.data_rights_policy (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,source_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),licence text NOT NULL CHECK(length(licence) BETWEEN 3 AND 200),permitted_reuse text[] NOT NULL,
 data_role text NOT NULL CHECK(data_role IN ('CONTROLLER','PROCESSOR','UNREVIEWED')),data_purpose text NOT NULL, data_classification text NOT NULL CHECK(data_classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL','SENSITIVE_COMMERCIAL','HIGHLY_RESTRICTED')),
 jurisdictions text[] NOT NULL,subject_locations text[] NOT NULL,processing_locations text[] NOT NULL,retention_until timestamptz NOT NULL,legal_hold boolean NOT NULL DEFAULT false,
 ai_permission text NOT NULL DEFAULT 'DENY' CHECK(ai_permission IN ('DENY','REVIEW_REQUIRED')),transfer_status text NOT NULL DEFAULT 'UNREVIEWED' CHECK(transfer_status IN ('UNREVIEWED','DENIED','APPROVED')),transfer_mechanism text,
 effective_from timestamptz NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,source_id,version),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),CHECK(transfer_status<>'APPROVED' OR (transfer_mechanism IS NOT NULL AND length(transfer_mechanism)>=3)),CHECK(permitted_reuse <@ ARRAY['INTERNAL_REVIEW','PUBLICATION','AI_REVIEW'])
);
CREATE TABLE app.reward_rule_version (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES app.tenant(id),key text NOT NULL,version integer NOT NULL CHECK(version>0),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999999999999),currency text NOT NULL REFERENCES app.currency(code),effective_from timestamptz NOT NULL,effective_until timestamptz NOT NULL CHECK(effective_until>effective_from),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,key,version)
);
CREATE TABLE app.contribution (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,contributor_id uuid NOT NULL REFERENCES identity.principal(id),source_id uuid NOT NULL,task_key text NOT NULL CHECK(length(task_key) BETWEEN 3 AND 100),relationship_disclosure text NOT NULL CHECK(length(relationship_disclosure) BETWEEN 3 AND 500),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,mission_id,task_key,contributor_id),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.service_ledger (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,mission_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('SERVICE_FEE','DELIVERY_COST','CONTRIBUTOR_REWARD')),
 amount_minor bigint NOT NULL CHECK(amount_minor<>0 AND abs(amount_minor)<=999999999999999999),currency text NOT NULL REFERENCES app.currency(code),source_id uuid NOT NULL,contribution_id uuid,rule_id uuid,reverse_of uuid,external_reference text NOT NULL CHECK(length(external_reference) BETWEEN 3 AND 200),occurred_at timestamptz NOT NULL CHECK(occurred_at<=now()),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,external_reference),UNIQUE(tenant_id,reverse_of),FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id),FOREIGN KEY(tenant_id,contribution_id) REFERENCES app.contribution(tenant_id,id),FOREIGN KEY(tenant_id,rule_id) REFERENCES app.reward_rule_version(tenant_id,id),FOREIGN KEY(tenant_id,reverse_of) REFERENCES app.service_ledger(tenant_id,id),CHECK((reverse_of IS NULL AND amount_minor>0) OR (reverse_of IS NOT NULL AND amount_minor<0)),CHECK((kind='CONTRIBUTOR_REWARD' AND contribution_id IS NOT NULL AND rule_id IS NOT NULL) OR (kind<>'CONTRIBUTOR_REWARD' AND contribution_id IS NULL AND rule_id IS NULL))
);
CREATE UNIQUE INDEX reward_credit_once ON app.service_ledger(tenant_id,contribution_id) WHERE kind='CONTRIBUTOR_REWARD' AND reverse_of IS NULL;
CREATE TABLE app.reward_reconciliation (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,ledger_id uuid NOT NULL,source_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('HELD','MANUALLY_RECONCILED','CANCELLED')),version integer NOT NULL CHECK(version>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),created_by uuid NOT NULL REFERENCES identity.principal(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,ledger_id,version),FOREIGN KEY(tenant_id,ledger_id) REFERENCES app.service_ledger(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE FUNCTION app.guard_service_foundation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE original app.service_ledger; rule app.reward_rule_version; task app.contribution; src app.source_record;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic tenant actor required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='contribution' THEN
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin','operator'),false) THEN RAISE EXCEPTION 'Contribution operator required' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT coalesce(app.member_role(NEW.tenant_id) IN ('owner','admin') AND app.fresh_mfa(),false) THEN RAISE EXCEPTION 'Accounting/configuration authority and fresh MFA required' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':service-economics',0));
 IF TG_TABLE_NAME<>'reward_rule_version' THEN
  SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now() AND observed_at<=now();
  IF src.id IS NULL THEN RAISE EXCEPTION 'Current accessible source required'; END IF;
 END IF;
 IF TG_TABLE_NAME='data_rights_policy' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id),0)+1 OR EXISTS(SELECT FROM app.data_rights_policy WHERE tenant_id=NEW.tenant_id AND source_id=NEW.source_id AND effective_from>=NEW.effective_from) THEN RAISE EXCEPTION 'Sequential effective policy version required'; END IF;
  IF NEW.retention_until>src.retention_until OR NEW.retention_until<=now() OR NEW.data_classification<>src.classification OR NEW.data_purpose<>src.purpose OR cardinality(NEW.jurisdictions)=0 OR cardinality(NEW.processing_locations)=0 OR EXISTS(SELECT FROM unnest(NEW.jurisdictions||NEW.subject_locations||NEW.processing_locations) c WHERE NOT EXISTS(SELECT FROM app.country WHERE code=c)) THEN RAISE EXCEPTION 'Policy cannot expand source rights'; END IF;
  IF NEW.ai_permission<>'DENY' AND src.ai_policy='DENY' THEN RAISE EXCEPTION 'Source AI denial cannot be overridden'; END IF;
 ELSIF TG_TABLE_NAME='reward_rule_version' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND key=NEW.key),0)+1 OR EXISTS(SELECT FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND key=NEW.key AND tstzrange(effective_from,effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN RAISE EXCEPTION 'Nonoverlapping sequential reward rule required'; END IF;
 ELSIF TG_TABLE_NAME='contribution' THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) OR NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.contributor_id) THEN RAISE EXCEPTION 'Scoped mission and active contributor required'; END IF;
 ELSIF TG_TABLE_NAME='service_ledger' THEN
  IF NOT EXISTS(SELECT FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id) THEN RAISE EXCEPTION 'Accessible mission required'; END IF;
  IF NEW.reverse_of IS NOT NULL THEN
   SELECT * INTO original FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of;
   IF original.id IS NULL OR original.reverse_of IS NOT NULL OR (NEW.mission_id,NEW.kind,NEW.currency,NEW.contribution_id,NEW.rule_id,NEW.amount_minor) IS DISTINCT FROM (original.mission_id,original.kind,original.currency,original.contribution_id,original.rule_id,-original.amount_minor) OR NEW.occurred_at<original.occurred_at OR EXISTS(SELECT FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=original.id AND status='MANUALLY_RECONCILED') THEN RAISE EXCEPTION 'Exact unreconciled compensation required'; END IF;
  ELSIF NEW.kind='CONTRIBUTOR_REWARD' THEN
   SELECT * INTO rule FROM app.reward_rule_version WHERE tenant_id=NEW.tenant_id AND id=NEW.rule_id;
   SELECT * INTO task FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=NEW.contribution_id;
   IF rule.id IS NULL OR task.id IS NULL OR task.mission_id<>NEW.mission_id OR NEW.created_by IN (task.created_by,task.contributor_id) OR NEW.amount_minor<>rule.amount_minor OR NEW.currency<>rule.currency OR task.created_at<rule.effective_from OR task.created_at>=rule.effective_until THEN RAISE EXCEPTION 'Independent review and exact effective reward required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='reward_reconciliation' THEN
  SELECT * INTO original FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.ledger_id AND kind='CONTRIBUTOR_REWARD' AND reverse_of IS NULL;
  SELECT * INTO task FROM app.contribution WHERE tenant_id=NEW.tenant_id AND id=original.contribution_id;
  IF original.id IS NULL OR NEW.created_by IN (original.created_by,task.contributor_id,task.created_by) OR NEW.version<>coalesce((SELECT max(version) FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=NEW.ledger_id),0)+1 OR EXISTS(SELECT FROM app.reward_reconciliation WHERE tenant_id=NEW.tenant_id AND ledger_id=NEW.ledger_id AND status IN ('MANUALLY_RECONCILED','CANCELLED')) OR EXISTS(SELECT FROM app.service_ledger WHERE tenant_id=NEW.tenant_id AND reverse_of=original.id) THEN RAISE EXCEPTION 'Independent reconciler and open reward required'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['data_rights_policy','reward_rule_version','contribution','service_ledger','reward_reconciliation'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin''))',t);
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND created_by=app.actor_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_service_foundation()',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
 END LOOP;
END $$;
CREATE VIEW app.service_margin WITH(security_invoker=true) AS SELECT tenant_id,mission_id,currency,
 coalesce(sum(amount_minor) FILTER(WHERE kind='SERVICE_FEE'),0)::text service_fees_minor,
 coalesce(sum(amount_minor) FILTER(WHERE kind='DELIVERY_COST'),0)::text delivery_cost_minor,
 coalesce(sum(amount_minor) FILTER(WHERE kind='CONTRIBUTOR_REWARD'),0)::text reward_obligation_minor,
 sum(CASE WHEN kind='SERVICE_FEE' THEN amount_minor ELSE -amount_minor END)::text margin_minor
 FROM app.service_ledger GROUP BY tenant_id,mission_id,currency;
GRANT SELECT ON app.service_margin TO corridra_runtime;
REVOKE ALL ON FUNCTION app.guard_service_foundation() FROM PUBLIC;
