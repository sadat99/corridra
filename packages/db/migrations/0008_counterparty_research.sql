-- Shared identities are source-reported, never implicitly verified. Private knowledge stays scoped.
CREATE TABLE app.public_identifier (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 identifier_type text NOT NULL CHECK(identifier_type IN ('registry','tax','source_id')), identifier text NOT NULL CHECK(length(identifier) BETWEEN 1 AND 100),
 domain text NOT NULL CHECK(domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*example\.invalid$'), address text NOT NULL CHECK(length(address) BETWEEN 1 AND 300),
 source_locator text NOT NULL, observed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL, synthetic boolean NOT NULL CHECK(synthetic),
 UNIQUE(organisation_id), CHECK(valid_until>observed_at)
);
CREATE INDEX public_identifier_domain_idx ON app.public_identifier(domain);
CREATE INDEX public_identifier_exact_idx ON app.public_identifier(identifier_type,identifier);
CREATE INDEX public_identifier_address_idx ON app.public_identifier(lower(address));
CREATE INDEX organisation_search_idx ON app.organisation USING gin(to_tsvector('simple',name));
ALTER TABLE app.public_identifier ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_identifier_read ON app.public_identifier FOR SELECT TO corridra_runtime USING(app.member_role(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) IS NOT NULL);
GRANT SELECT ON app.public_identifier TO corridra_runtime;
CREATE TRIGGER public_identifier_immutable BEFORE UPDATE OR DELETE ON app.public_identifier FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE app.relationship ADD COLUMN visibility text NOT NULL DEFAULT 'OWNER' CHECK(visibility IN ('OWNER','TEAM'));
DROP POLICY relationship_read ON app.relationship;
CREATE POLICY relationship_read ON app.relationship FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND (visibility='TEAM' OR owner_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','admin','reviewer')));
CREATE FUNCTION app.research_owner(target uuid,who uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.member_role(target) IS NOT NULL AND EXISTS(SELECT FROM app.membership m JOIN identity.principal p ON p.id=m.user_id WHERE m.tenant_id=target AND m.user_id=who AND m.revoked_at IS NULL AND m.role IN ('owner','admin','operator') AND p.disabled_at IS NULL AND p.operating_country=ANY(m.allowed_countries) AND 'synthetic_validation'=ANY(m.allowed_purposes) AND 'INTERNAL'=ANY(m.allowed_classifications))
$$;
CREATE FUNCTION app.guard_research_relationship() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.research_owner(NEW.tenant_id,NEW.owner_id) THEN RAISE EXCEPTION 'Active relationship owner required'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.organisation_id<>OLD.organisation_id OR NEW.classification<>OLD.classification OR NEW.purpose<>OLD.purpose) THEN RAISE EXCEPTION 'Relationship provenance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER research_relationship_guard BEFORE INSERT OR UPDATE ON app.relationship FOR EACH ROW EXECUTE FUNCTION app.guard_research_relationship();
CREATE FUNCTION app.research_relationship_access(target uuid,rid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.relationship r WHERE r.tenant_id=target AND r.id=rid AND app.can_access(target,r.classification,r.purpose) AND (r.visibility='TEAM' OR r.owner_id=app.actor_id() OR app.member_role(target) IN ('owner','admin','reviewer')) AND (NOT writing OR r.owner_id=app.actor_id() OR app.member_role(target) IN ('owner','admin')))
$$;
CREATE TABLE app.organisation_source (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 source_id uuid NOT NULL, classification text NOT NULL DEFAULT 'PUBLIC' CHECK(classification='PUBLIC'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,organisation_id,source_id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.private_contact_data (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, relationship_id uuid NOT NULL, source_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), job_title text NOT NULL CHECK(length(job_title) BETWEEN 1 AND 120), email text NOT NULL CHECK(email ~ '^[^@]+@example\.invalid$'),
 valid_until timestamptz NOT NULL CHECK(valid_until>created_at), classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,relationship_id,id),
 FOREIGN KEY(tenant_id,relationship_id) REFERENCES app.relationship(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.private_note (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, relationship_id uuid NOT NULL, source_id uuid NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,relationship_id) REFERENCES app.relationship(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id)
);
CREATE TABLE app.organisation_attribute (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 kind text NOT NULL CHECK(kind IN ('product','capability','certification','requirement','market')), claim_id uuid NOT NULL, valid_until timestamptz NOT NULL CHECK(valid_until>created_at),
 classification text NOT NULL, purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE INDEX organisation_attribute_scope_idx ON app.organisation_attribute(tenant_id,organisation_id,kind);
CREATE TABLE app.public_company_fact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES app.organisation(id), kind text NOT NULL,
 statement text NOT NULL, source_locator text NOT NULL, observed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
 method text NOT NULL, scope text NOT NULL, scan_status text NOT NULL CHECK(scan_status IN ('CLEAN','BYPASSED')), reviewer_id uuid NOT NULL REFERENCES identity.principal(id),
 origin_fact_id uuid NOT NULL UNIQUE REFERENCES app.canonical_fact(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK(valid_until>created_at)
);
ALTER TABLE app.public_company_fact ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_company_fact_read ON app.public_company_fact FOR SELECT TO corridra_runtime USING(app.member_role(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) IS NOT NULL);
GRANT SELECT ON app.public_company_fact TO corridra_runtime;
CREATE TRIGGER public_company_fact_immutable BEFORE UPDATE OR DELETE ON app.public_company_fact FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TABLE app.entity_candidate (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), left_id uuid NOT NULL REFERENCES app.organisation(id), right_id uuid NOT NULL REFERENCES app.organisation(id),
 reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array' AND jsonb_array_length(reasons)>0),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,left_id,right_id), CHECK(left_id<right_id)
);
CREATE TABLE app.entity_resolution (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, candidate_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('MERGE','DISTINCT','REVERSE')),
 survivor_id uuid NOT NULL REFERENCES app.organisation(id), reverse_of uuid, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,reverse_of), FOREIGN KEY(tenant_id,candidate_id) REFERENCES app.entity_candidate(tenant_id,id), FOREIGN KEY(tenant_id,reverse_of) REFERENCES app.entity_resolution(tenant_id,id), CHECK((decision='REVERSE')=(reverse_of IS NOT NULL))
);
CREATE INDEX resolution_candidate_idx ON app.entity_resolution(tenant_id,candidate_id,created_at);
CREATE TABLE app.target_account (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, mission_id uuid NOT NULL, relationship_id uuid NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,mission_id,relationship_id), UNIQUE(tenant_id,id,relationship_id),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,relationship_id) REFERENCES app.relationship(tenant_id,id)
);
CREATE INDEX target_account_mission_idx ON app.target_account(tenant_id,mission_id);
CREATE TABLE app.target_contact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, target_id uuid NOT NULL, relationship_id uuid NOT NULL, contact_id uuid NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,target_id,relationship_id) REFERENCES app.target_account(tenant_id,id,relationship_id), FOREIGN KEY(tenant_id,relationship_id,contact_id) REFERENCES app.private_contact_data(tenant_id,relationship_id,id)
);
CREATE TABLE app.match_assessment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, target_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 fit text NOT NULL CHECK(fit IN ('RESEARCH','POSSIBLE','STRONG','UNSUITABLE')), rationale text NOT NULL CHECK(length(rationale) BETWEEN 3 AND 1000), uncertainty text NOT NULL CHECK(length(uncertainty) BETWEEN 3 AND 1000),
 gaps text NOT NULL CHECK(length(gaps) BETWEEN 3 AND 1000), next_action text NOT NULL CHECK(length(next_action) BETWEEN 3 AND 500), due_at timestamptz NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,target_id,version),
 FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id)
);
CREATE TABLE app.assessment_claim (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, assessment_id uuid NOT NULL, claim_id uuid NOT NULL, attribute_id uuid NOT NULL,
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,assessment_id,claim_id),
 FOREIGN KEY(tenant_id,attribute_id) REFERENCES app.organisation_attribute(tenant_id,id), FOREIGN KEY(tenant_id,assessment_id) REFERENCES app.match_assessment(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.research_command (
 id uuid NOT NULL, tenant_id uuid NOT NULL REFERENCES app.tenant(id), action text NOT NULL CHECK(action IN ('ingest','relationship','contact','note','attribute','publish','candidates','resolve','reverse','target','assess')), request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 classification text NOT NULL DEFAULT 'INTERNAL' CHECK(classification='INTERNAL'), purpose text NOT NULL, created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE FUNCTION app.research_target_access(target uuid,tid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.target_account t WHERE t.tenant_id=target AND t.id=tid AND app.can_access(target,t.classification,t.purpose) AND app.research_relationship_access(target,t.relationship_id,writing))
$$;
CREATE FUNCTION app.research_canonical(target uuid,oid uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN app.can_access(target,'INTERNAL','synthetic_validation') THEN COALESCE((SELECT r.survivor_id FROM app.entity_resolution r JOIN app.entity_candidate c ON c.tenant_id=r.tenant_id AND c.id=r.candidate_id WHERE r.tenant_id=target AND r.decision='MERGE' AND oid IN(c.left_id,c.right_id) AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=target AND u.reverse_of=r.id) LIMIT 1),oid) ELSE oid END
$$;
CREATE FUNCTION app.ingest_public_organisation(target uuid,sid uuid,company text,cc text,host text,addr text,itype text,ident text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE src record; oid uuid:=gen_random_uuid();
BEGIN
 IF app.member_role(target) IS NULL OR app.member_role(target) NOT IN ('owner','admin','operator') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=target AND synthetic) THEN RAISE EXCEPTION 'Synthetic operator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO src FROM app.source_record WHERE tenant_id=target AND id=sid AND classification='PUBLIC' AND kind='public_record' AND app.can_access(target,classification,purpose) AND retention_until>now() AND observed_at<=now() AND ai_policy='DENY';
 IF NOT FOUND OR src.locator !~ '^https://([a-z0-9-]+\.)*example\.invalid(/[^[:space:]]*)?$' OR length(company) NOT BETWEEN 1 AND 160 OR cc NOT IN ('BD','ES','DE') THEN RAISE EXCEPTION 'Current synthetic public-record source required'; END IF;
 INSERT INTO app.organisation(id,name,country,synthetic) VALUES(oid,company,cc,true);
 INSERT INTO app.public_identifier(organisation_id,identifier_type,identifier,domain,address,source_locator,observed_at,valid_until,synthetic) VALUES(oid,itype,ident,host,addr,src.locator,src.observed_at,src.retention_until,true);
 INSERT INTO app.organisation_source(tenant_id,organisation_id,source_id,purpose,created_by) VALUES(target,oid,sid,src.purpose,app.actor_id());
 RETURN oid;
END $$;
CREATE FUNCTION app.publish_company_fact(target uuid,aid uuid,fid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v record; result uuid:=gen_random_uuid();
BEGIN
 IF app.member_role(target) IS NULL OR app.member_role(target) NOT IN ('owner','admin','reviewer') OR NOT app.fresh_mfa() OR NOT EXISTS(SELECT FROM app.tenant WHERE id=target AND synthetic) THEN RAISE EXCEPTION 'Authorized reviewer with fresh MFA required' USING ERRCODE='42501'; END IF;
 SELECT a.organisation_id,a.kind,c.statement,s.locator,s.observed_at,least(s.retention_until,a.valid_until,e.retention_until,r.valid_until) valid_until,r.method,r.scope,r.reviewer_id,es.scan_status INTO v
 FROM app.organisation_attribute a JOIN app.claim c ON c.tenant_id=a.tenant_id AND c.id=a.claim_id
 JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id JOIN app.evidence_object e ON e.tenant_id=c.tenant_id AND e.claim_id=c.id
 JOIN app.verification r ON r.tenant_id=e.tenant_id AND r.evidence_id=e.id JOIN app.canonical_fact f ON f.tenant_id=r.tenant_id AND f.verification_id=r.id
 JOIN app.evidence_state es ON es.tenant_id=e.tenant_id AND es.id=e.id
 WHERE a.tenant_id=target AND a.id=aid AND f.id=fid AND app.can_access(target,a.classification,a.purpose) AND a.classification='PUBLIC' AND s.kind='public_record' AND s.ai_policy='DENY'
 AND s.locator ~ '^https://([a-z0-9-]+\.)*example\.invalid(/[^[:space:]]*)?$' AND es.status='VERIFIED' AND r.decision='VERIFIED' AND r.reviewer_id<>e.created_by AND r.reviewer_id=app.actor_id();
 IF NOT FOUND OR v.valid_until<=now() THEN RAISE EXCEPTION 'Independent current public verification required'; END IF;
 INSERT INTO app.public_company_fact(id,organisation_id,kind,statement,source_locator,observed_at,valid_until,method,scope,scan_status,reviewer_id,origin_fact_id) VALUES(result,v.organisation_id,v.kind,v.statement,v.locator,v.observed_at,v.valid_until,v.method,v.scope,v.scan_status,v.reviewer_id,fid);
 RETURN result;
END $$;
CREATE FUNCTION app.guard_research_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE src record; parent record;
BEGIN
 IF NEW.created_by<>app.actor_id() OR NEW.purpose<>'synthetic_validation' OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic authenticated provenance required'; END IF;
 IF TG_TABLE_NAME IN ('organisation_source','private_contact_data','private_note') THEN
  SELECT * INTO src FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=NEW.source_id;
  IF NOT FOUND OR src.purpose<>NEW.purpose OR src.retention_until<=now() OR src.observed_at>now() OR src.ai_policy<>'DENY' OR src.classification NOT IN ('PUBLIC','INTERNAL') THEN RAISE EXCEPTION 'Current source required'; END IF;
  IF TG_TABLE_NAME='organisation_source' AND (src.classification<>'PUBLIC' OR src.kind<>'public_record') THEN RAISE EXCEPTION 'Public identity source required'; END IF;
  IF TG_TABLE_NAME='private_contact_data' AND (to_jsonb(NEW)->>'valid_until')::timestamptz>src.retention_until THEN RAISE EXCEPTION 'Contact validity exceeds source retention'; END IF;
 ELSIF TG_TABLE_NAME='organisation_attribute' THEN
  SELECT c.classification,c.purpose,s.retention_until,s.observed_at,s.ai_policy INTO src FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.claim_id;
  IF NOT FOUND OR src.classification<>NEW.classification OR src.purpose<>NEW.purpose OR src.retention_until<=now() OR src.observed_at>now() OR src.ai_policy<>'DENY' OR NEW.valid_until>src.retention_until THEN RAISE EXCEPTION 'Claim provenance required'; END IF;
 ELSIF TG_TABLE_NAME='target_account' THEN
  PERFORM 1 FROM app.mission WHERE tenant_id=NEW.tenant_id AND id=NEW.mission_id AND status IN ('ACTIVE','TARGETING') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active mission required'; END IF;
 ELSIF TG_TABLE_NAME='target_contact' THEN
  IF NOT EXISTS(SELECT FROM app.private_contact_data c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.contact_id AND c.valid_until>now() AND s.retention_until>now()) THEN RAISE EXCEPTION 'Current contact source required'; END IF;
 ELSIF TG_TABLE_NAME='match_assessment' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':assessment:'||NEW.target_id::text,0));
  PERFORM 1 FROM app.target_account t JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id AND m.status IN ('ACTIVE','TARGETING') FOR SHARE OF m;
  IF NOT FOUND OR NEW.version<>(SELECT COALESCE(max(version),0)+1 FROM app.match_assessment WHERE tenant_id=NEW.tenant_id AND target_id=NEW.target_id) THEN RAISE EXCEPTION 'Invalid assessment version'; END IF;
 ELSIF TG_TABLE_NAME='assessment_claim' THEN
  IF NOT EXISTS(SELECT FROM app.match_assessment a JOIN app.target_account t ON t.tenant_id=a.tenant_id AND t.id=a.target_id JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation_attribute oa ON oa.tenant_id=r.tenant_id AND app.research_canonical(r.tenant_id,oa.organisation_id)=app.research_canonical(r.tenant_id,r.organisation_id) JOIN app.claim c ON c.tenant_id=oa.tenant_id AND c.id=oa.claim_id JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.assessment_id AND c.id=NEW.claim_id AND oa.id=NEW.attribute_id AND oa.valid_until>now() AND s.retention_until>now()) THEN RAISE EXCEPTION 'Current attributable target evidence required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.guard_entity_resolution() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c record; prior record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':resolution',0));
 SELECT * INTO c FROM app.entity_candidate WHERE tenant_id=NEW.tenant_id AND id=NEW.candidate_id;
 IF NOT FOUND OR NEW.survivor_id NOT IN(c.left_id,c.right_id) THEN RAISE EXCEPTION 'Candidate survivor required'; END IF;
 IF NEW.decision='REVERSE' THEN
  SELECT * INTO prior FROM app.entity_resolution WHERE tenant_id=NEW.tenant_id AND id=NEW.reverse_of;
  IF NOT FOUND OR prior.decision='REVERSE' OR prior.candidate_id<>NEW.candidate_id OR prior.survivor_id<>NEW.survivor_id THEN RAISE EXCEPTION 'Original resolution required'; END IF;
 ELSE
  IF EXISTS(SELECT FROM app.entity_resolution r WHERE r.tenant_id=NEW.tenant_id AND r.candidate_id=NEW.candidate_id AND r.decision<>'REVERSE' AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=r.tenant_id AND u.reverse_of=r.id)) THEN RAISE EXCEPTION 'Reverse the current decision first'; END IF;
  IF NEW.decision='MERGE' AND EXISTS(SELECT FROM app.entity_resolution r JOIN app.entity_candidate ec ON ec.tenant_id=r.tenant_id AND ec.id=r.candidate_id WHERE r.tenant_id=NEW.tenant_id AND r.decision='MERGE' AND (ec.left_id IN(c.left_id,c.right_id) OR ec.right_id IN(c.left_id,c.right_id)) AND NOT EXISTS(SELECT FROM app.entity_resolution u WHERE u.tenant_id=r.tenant_id AND u.reverse_of=r.id)) THEN RAISE EXCEPTION 'Resolve existing merge before chaining'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entity_resolution_decision_guard BEFORE INSERT ON app.entity_resolution FOR EACH ROW EXECUTE FUNCTION app.guard_entity_resolution();
REVOKE ALL ON FUNCTION app.research_owner(uuid,uuid),app.guard_research_relationship(),app.research_relationship_access(uuid,uuid,boolean),app.research_target_access(uuid,uuid,boolean),app.research_canonical(uuid,uuid),app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text),app.publish_company_fact(uuid,uuid,uuid),app.guard_research_record(),app.guard_entity_resolution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.research_owner(uuid,uuid),app.research_relationship_access(uuid,uuid,boolean),app.research_target_access(uuid,uuid,boolean),app.research_canonical(uuid,uuid),app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text),app.publish_company_fact(uuid,uuid,uuid) TO corridra_runtime;
CREATE FUNCTION app.research_assessment_access(target uuid,aid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.match_assessment a WHERE a.tenant_id=target AND a.id=aid AND app.can_access(target,a.classification,a.purpose) AND app.research_target_access(target,a.target_id,writing))
$$;
REVOKE ALL ON FUNCTION app.research_assessment_access(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.research_assessment_access(uuid,uuid,boolean) TO corridra_runtime;
DO $$
DECLARE tbl text; read_extra text; write_extra text; roles text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['organisation_source','private_contact_data','private_note','organisation_attribute','entity_candidate','entity_resolution','target_account','target_contact','match_assessment','assessment_claim','research_command'] LOOP
  read_extra:='true'; write_extra:='true'; roles:='app.member_role(tenant_id) IN (''owner'',''admin'',''operator'')';
  IF tbl IN ('private_contact_data','private_note','target_account','target_contact') THEN read_extra:='app.research_relationship_access(tenant_id,relationship_id)';write_extra:='app.research_relationship_access(tenant_id,relationship_id,true)'; END IF;
  IF tbl='match_assessment' THEN read_extra:='app.research_target_access(tenant_id,target_id)';write_extra:='app.research_target_access(tenant_id,target_id,true)'; END IF;
  IF tbl='assessment_claim' THEN read_extra:='app.research_assessment_access(tenant_id,assessment_id)';write_extra:='app.research_assessment_access(tenant_id,assessment_id,true)'; END IF;
  IF tbl='entity_resolution' THEN roles:='app.member_role(tenant_id) IN (''owner'',''admin'',''reviewer'') AND app.fresh_mfa()'; END IF;
  IF tbl='research_command' THEN read_extra:='created_by=app.actor_id()';roles:='app.member_role(tenant_id) IN (''owner'',''admin'',''operator'',''reviewer'')'; END IF;
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE app.%I ADD CHECK(classification IN (''PUBLIC'',''INTERNAL'',''CONFIDENTIAL'',''PERSONAL'',''SENSITIVE_COMMERCIAL'',''HIGHLY_RESTRICTED''))',tbl);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,classification,purpose) AND (%s))',tbl||'_read',tbl,read_extra);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,classification,purpose) AND %s AND created_by=app.actor_id() AND (%s))',tbl||'_insert',tbl,roles,write_extra);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',tbl);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_research_record()',tbl||'_guard',tbl);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',tbl||'_immutable',tbl);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',tbl||'_event',tbl);
 END LOOP;
END $$;
-- Only a published, independently reviewed fact can disclose this status across tenants.
CREATE FUNCTION app.public_fact_status(fid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN least(p.valid_until,v.valid_until,e.retention_until)<=now() THEN 'EXPIRED' WHEN s.status<>'VERIFIED' THEN s.status ELSE 'VERIFIED' END
 FROM app.public_company_fact p JOIN app.canonical_fact f ON f.id=p.origin_fact_id JOIN app.verification v ON v.tenant_id=f.tenant_id AND v.id=f.verification_id
 JOIN app.evidence_object e ON e.tenant_id=v.tenant_id AND e.id=v.evidence_id JOIN app.evidence_state s ON s.tenant_id=e.tenant_id AND s.id=e.id
 WHERE p.id=fid AND app.member_role(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.public_fact_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_fact_status(uuid) TO corridra_runtime;
CREATE FUNCTION app.research_enabled(target uuid,key text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT (value->>'enabled')::boolean FROM app.config_version WHERE tenant_id=target AND config_version.key=research_enabled.key AND effective_from<=now() ORDER BY version DESC LIMIT 1),true)
$$;
CREATE FUNCTION app.guard_research_controls() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.research_enabled(NEW.tenant_id,CASE WHEN TG_TABLE_NAME='entity_resolution' THEN 'research.resolution' ELSE 'research.ingestion' END) THEN RAISE EXCEPTION 'Research command disabled'; END IF;
 IF TG_TABLE_NAME='entity_candidate' THEN
 IF NOT EXISTS(SELECT FROM app.public_identifier a JOIN app.organisation ao ON ao.id=a.organisation_id CROSS JOIN app.public_identifier b JOIN app.organisation bo ON bo.id=b.organisation_id WHERE a.organisation_id=NEW.left_id AND b.organisation_id=NEW.right_id AND a.valid_until>now() AND b.valid_until>now() AND (a.domain=b.domain OR (ao.country=bo.country AND ((a.identifier_type=b.identifier_type AND a.identifier=b.identifier) OR lower(a.address)=lower(b.address))))) THEN RAISE EXCEPTION 'Deterministic current candidate required'; END IF; END IF;
 IF TG_TABLE_NAME='entity_resolution' THEN
 IF NEW.decision='MERGE' AND NOT EXISTS(SELECT FROM app.entity_candidate c JOIN app.public_identifier a ON a.organisation_id=c.left_id JOIN app.public_identifier b ON b.organisation_id=c.right_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.candidate_id AND a.valid_until>now() AND b.valid_until>now()) THEN RAISE EXCEPTION 'Current identity evidence required'; END IF; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.research_enabled(uuid,text),app.guard_research_controls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.research_enabled(uuid,text) TO corridra_runtime;
CREATE TRIGGER research_ingestion_control BEFORE INSERT ON app.organisation_source FOR EACH ROW EXECUTE FUNCTION app.guard_research_controls();
CREATE TRIGGER research_candidate_control BEFORE INSERT ON app.entity_candidate FOR EACH ROW EXECUTE FUNCTION app.guard_research_controls();
CREATE TRIGGER research_resolution_control BEFORE INSERT ON app.entity_resolution FOR EACH ROW EXECUTE FUNCTION app.guard_research_controls();

-- Part 05 reserves outreach for the next packet and permits deliberate targeting only.
CREATE OR REPLACE FUNCTION app.guard_mission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='app.mission'::regclass),'MEMBER') OR NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Ingress required' USING ERRCODE='42501'; END IF;
 ELSE
  IF app.actor_id() IS NULL OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.tenant_id,NEW.created_by,NEW.created_at,NEW.classification,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_by,OLD.created_at,OLD.classification,OLD.purpose) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Mission identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='QUALIFICATION') OR (OLD.status='QUALIFICATION' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status='TARGETING') OR (OLD.status IN ('QUALIFICATION','ACTIVE','TARGETING') AND NEW.status='ON_HOLD' AND NEW.held_from=OLD.status) OR (OLD.status='ON_HOLD' AND NEW.status=OLD.held_from AND NEW.held_from IS NULL) OR (OLD.status IN ('DRAFT','QUALIFICATION','ACTIVE','TARGETING','ON_HOLD') AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'Invalid mission transition' USING ERRCODE='23514'; END IF;
  IF NEW.status=OLD.status AND NEW.held_from IS DISTINCT FROM OLD.held_from THEN RAISE EXCEPTION 'Hold state mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'ON_HOLD' AND NEW.held_from IS NOT NULL THEN RAISE EXCEPTION 'Unexpected hold state' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active operator owner required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('QUALIFICATION','ACTIVE','TARGETING') AND (NOT EXISTS(SELECT FROM app.commercial_intent WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND claim_id IS NOT NULL) OR NOT EXISTS(SELECT FROM app.target_profile WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id) OR NOT EXISTS(SELECT FROM app.mission_market WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.id AND country_code IS NOT NULL)) THEN RAISE EXCEPTION 'Qualification records required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;

CREATE INDEX research_relationship_organisation_idx ON app.relationship(tenant_id,organisation_id);
CREATE INDEX organisation_attribute_claim_idx ON app.organisation_attribute(tenant_id,organisation_id,claim_id);
CREATE INDEX contact_relationship_idx ON app.private_contact_data(tenant_id,relationship_id);
CREATE INDEX private_note_relationship_idx ON app.private_note(tenant_id,relationship_id);
CREATE INDEX target_contact_target_idx ON app.target_contact(tenant_id,target_id);
CREATE INDEX assessment_claim_assessment_idx ON app.assessment_claim(tenant_id,assessment_id);
