-- Additive, versioned human observations. Customer financial records remain unchanged.
ALTER TABLE app.requirement_definition ADD COLUMN schema jsonb NOT NULL DEFAULT '{"schemaVersion":0}' CHECK(jsonb_typeof(schema)='object' AND length(schema::text)<=16000);
ALTER TABLE app.assessment_definition ADD COLUMN schema jsonb NOT NULL DEFAULT '{"schemaVersion":0}' CHECK(jsonb_typeof(schema)='object' AND length(schema::text)<=16000);
CREATE TABLE app.mission_requirements (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, assignment_id uuid NOT NULL, definition_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), schema_version integer NOT NULL CHECK(schema_version=1), declaration text NOT NULL CHECK(length(declaration) BETWEEN 3 AND 2000), fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='object' AND length(fields::text)<=16000),
 source_id uuid NOT NULL, claim_id uuid NOT NULL, reviewer_id uuid REFERENCES identity.principal(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,mission_id,version),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,assignment_id) REFERENCES app.mission_route_assignment(tenant_id,id), FOREIGN KEY(tenant_id,definition_id) REFERENCES app.requirement_definition(tenant_id,id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.mission_assessment (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, requirement_id uuid NOT NULL, definition_id uuid NOT NULL, target_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 method text NOT NULL CHECK(length(method) BETWEEN 3 AND 1000), observed_at timestamptz NOT NULL CHECK(observed_at<=now()), results jsonb NOT NULL CHECK(jsonb_typeof(results)='array' AND jsonb_array_length(results) BETWEEN 1 AND 30), unknowns text NOT NULL CHECK(length(unknowns) BETWEEN 3 AND 1000), gaps text NOT NULL CHECK(length(gaps) BETWEEN 3 AND 1000), rationale text NOT NULL CHECK(length(rationale) BETWEEN 3 AND 1000),
 source_id uuid NOT NULL, claim_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,target_id,version),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,requirement_id) REFERENCES app.mission_requirements(tenant_id,id), FOREIGN KEY(tenant_id,definition_id) REFERENCES app.assessment_definition(tenant_id,id), FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.mission_rfq (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, requirement_id uuid NOT NULL, target_ids uuid[] NOT NULL CHECK(cardinality(target_ids) BETWEEN 1 AND 30), buyer_context text NOT NULL CHECK(length(buyer_context) BETWEEN 3 AND 1000), requested_terms text NOT NULL CHECK(length(requested_terms) BETWEEN 3 AND 1000), due_at timestamptz NOT NULL,
 source_id uuid NOT NULL, claim_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,requirement_id) REFERENCES app.mission_requirements(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.mission_quotation (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, rfq_id uuid NOT NULL, target_id uuid NOT NULL, requirement_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), previous_id uuid,
 currency text NOT NULL REFERENCES app.currency(code), terms jsonb NOT NULL CHECK(jsonb_typeof(terms)='object' AND length(terms::text)<=16000), uncertainties text NOT NULL CHECK(length(uncertainties) BETWEEN 3 AND 1000), observed_at timestamptz NOT NULL CHECK(observed_at<=now()),
 source_id uuid NOT NULL, claim_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,rfq_id,target_id,revision), UNIQUE(tenant_id,previous_id),
 FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,rfq_id) REFERENCES app.mission_rfq(tenant_id,id), FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id), FOREIGN KEY(tenant_id,requirement_id) REFERENCES app.mission_requirements(tenant_id,id), FOREIGN KEY(tenant_id,previous_id) REFERENCES app.mission_quotation(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.mission_selection (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, requirement_id uuid NOT NULL, target_id uuid NOT NULL, assessment_id uuid NOT NULL, quotation_id uuid,
 decision text NOT NULL CHECK(decision IN ('SELECT','DECLINE','NEED_INFORMATION')), rationale text NOT NULL CHECK(length(rationale) BETWEEN 3 AND 1000), next_action text NOT NULL CHECK(length(next_action) BETWEEN 3 AND 1000), owner_id uuid NOT NULL REFERENCES identity.principal(id), due_at timestamptz NOT NULL,
 source_id uuid NOT NULL, claim_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id), FOREIGN KEY(tenant_id,requirement_id) REFERENCES app.mission_requirements(tenant_id,id), FOREIGN KEY(tenant_id,target_id) REFERENCES app.target_account(tenant_id,id), FOREIGN KEY(tenant_id,assessment_id) REFERENCES app.mission_assessment(tenant_id,id), FOREIGN KEY(tenant_id,quotation_id) REFERENCES app.mission_quotation(tenant_id,id), FOREIGN KEY(tenant_id,source_id) REFERENCES app.source_record(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES app.claim(tenant_id,id)
);
CREATE TABLE app.mission_schedule (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array' AND jsonb_array_length(entries)<=50),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,mission_id,version), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
CREATE TABLE app.commercial_mission_command (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, mission_id uuid NOT NULL, action text NOT NULL, input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES identity.principal(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,mission_id) REFERENCES app.mission(tenant_id,id)
);
ALTER TABLE app.mission_assessment ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1);
ALTER TABLE app.mission_assessment ADD COLUMN technical_results jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(technical_results)='array' AND jsonb_array_length(technical_results)<=15);
ALTER TABLE app.mission_rfq ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1);
ALTER TABLE app.mission_quotation ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1);
ALTER TABLE app.mission_selection ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1);
ALTER TABLE app.mission_schedule ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1);
CREATE FUNCTION app.guard_commercial_mission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE req app.mission_requirements; pack app.corridor_pack_version; rfq app.mission_rfq; quote app.mission_quotation; a app.mission_assessment; v jsonb; k text; tid uuid; expected integer; template jsonb;
BEGIN
 IF NOT coalesce(app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') AND app.member_role(NEW.tenant_id) IN ('owner','admin','operator') AND NEW.created_by=app.actor_id(),false) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Synthetic mission authority required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':commercial-missions',0));
 IF NOT EXISTS(SELECT FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.mission_id AND m.status NOT IN ('CLOSED','CANCELLED') AND i.retention_until>now()) THEN RAISE EXCEPTION 'Current mission required'; END IF;
 IF TG_TABLE_NAME NOT IN ('mission_schedule','commercial_mission_command') THEN
  IF NOT EXISTS(SELECT FROM app.claim c JOIN app.source_record s ON s.tenant_id=c.tenant_id AND s.id=c.source_id WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.claim_id AND s.id=NEW.source_id AND s.retention_until>now() AND s.observed_at<=now() AND s.ai_policy='DENY' AND s.classification IN ('PUBLIC','INTERNAL') AND app.can_access(s.tenant_id,s.classification,s.purpose) AND app.can_access(c.tenant_id,c.classification,c.purpose)) THEN RAISE EXCEPTION 'Current matching source and claim required'; END IF;
 END IF;
 IF TG_TABLE_NAME='mission_requirements' THEN
  SELECT p.* INTO pack FROM app.mission_route_assignment r JOIN app.corridor_pack_version p ON p.tenant_id=r.tenant_id AND p.id=r.pack_id WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.assignment_id AND r.mission_id=NEW.mission_id AND r.status='ASSIGNED' AND r.version=(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=r.tenant_id AND mission_id=r.mission_id);
  IF pack.id IS NULL OR NOT pack.configuration->'requirements' ? NEW.definition_id::text THEN RAISE EXCEPTION 'Pinned requirement definition required'; END IF;
  SELECT d.schema INTO template FROM app.requirement_definition d JOIN app.mission_route_assignment r ON r.tenant_id=d.tenant_id AND r.id=NEW.assignment_id JOIN app.mission_type_definition t ON t.tenant_id=r.tenant_id AND t.id=r.mission_type_id WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id AND d.schema->>'typeKey'=t.key;
  IF template IS NULL OR template->>'schemaVersion'<>'1' THEN RAISE EXCEPTION 'Versioned mission requirement template required'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential requirement version required'; END IF;
  IF NEW.reviewer_id IS NOT NULL AND (NEW.reviewer_id<>app.actor_id() OR app.member_role(NEW.tenant_id) NOT IN ('owner','admin') OR NOT app.fresh_mfa()) THEN RAISE EXCEPTION 'Reviewer must personally review with fresh MFA' USING ERRCODE='42501'; END IF;
  IF NOT NEW.fields ?& ARRAY['objective','role','product'] OR NEW.fields->>'role' NOT IN ('EXPORTER','IMPORTER','BUYER','SUPPLIER','INSTITUTION','OPERATOR') OR length(coalesce(NEW.fields->>'product',''))<3 OR length(coalesce(NEW.fields->>'objective',''))<3 THEN RAISE EXCEPTION 'Short requirement fields required'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.fields) LOOP
   IF k NOT IN ('objective','role','product','category','specifications','quantity','unit','targetMarkets','budgetMinor','currency','budgetBasis','moq','orderFrequency','materials','dimensions','technicalConstraints','certifications','oemOdm','delivery','leadTime','incoterm','requiredEvidence','travelDates','decisionCriteria','responsiblePersons','machinery') THEN RAISE EXCEPTION 'Unsupported requirement field'; END IF;
   IF k IN ('targetMarkets','certifications','requiredEvidence','decisionCriteria','responsiblePersons') THEN
    IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>30 OR EXISTS(SELECT FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}') NOT BETWEEN 2 AND 1000) THEN RAISE EXCEPTION 'Bounded requirement lists required'; END IF;
   ELSIF k='machinery' THEN
    IF jsonb_typeof(v)<>'object' OR EXISTS(SELECT FROM jsonb_each(v) e WHERE e.key NOT IN ('application','capacity','configuration','inputOutput','utilities','integration','documentation','commissioning','training','acceptance','warrantySpares','support','installationReferences','transport','risks') OR jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}') NOT BETWEEN 3 AND 1000) THEN RAISE EXCEPTION 'Typed machinery requirements required'; END IF;
   ELSIF jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Bounded declared requirement text required'; END IF;
   IF k IN ('quantity','moq') AND v#>>'{}' !~ '^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Exact positive requirement quantity required'; END IF;
  END LOOP;
  IF NEW.fields ?| ARRAY['budgetMinor','currency','budgetBasis'] AND (NOT NEW.fields ?& ARRAY['budgetMinor','currency','budgetBasis'] OR NEW.fields->>'budgetMinor' !~ '^(0|[1-9][0-9]{0,17})$' OR length(NEW.fields->>'budgetBasis')<3 OR NOT pack.configuration->'currencies' ? (NEW.fields->>'currency')) THEN RAISE EXCEPTION 'Supported exact budget and quantity basis required'; END IF;
  IF NEW.fields ?| ARRAY['quantity','moq'] AND (NOT NEW.fields ? 'unit' OR length(NEW.fields->>'unit')<3) THEN RAISE EXCEPTION 'Quantity unit required'; END IF;
 ELSE
  IF TG_TABLE_NAME NOT IN ('mission_schedule','commercial_mission_command') THEN
   SELECT * INTO req FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND id=NEW.requirement_id AND mission_id=NEW.mission_id;
   IF req.id IS NULL OR req.version<>(SELECT max(version) FROM app.mission_requirements WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id) THEN RAISE EXCEPTION 'Current requirement version required'; END IF;
   SELECT p.* INTO pack FROM app.mission_route_assignment r JOIN app.corridor_pack_version p ON p.tenant_id=r.tenant_id AND p.id=r.pack_id WHERE r.tenant_id=req.tenant_id AND r.id=req.assignment_id;
   IF req.assignment_id<>(SELECT id FROM app.mission_route_assignment WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Requirements need review after route reclassification'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('mission_assessment','mission_quotation','mission_selection') THEN
   IF NOT EXISTS(SELECT FROM app.target_account WHERE tenant_id=NEW.tenant_id AND id=NEW.target_id AND mission_id=NEW.mission_id AND app.research_target_access(NEW.tenant_id,NEW.target_id,true)) THEN RAISE EXCEPTION 'Matching accessible mission target required' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_TABLE_NAME='mission_assessment' THEN
   IF NOT pack.configuration->'assessments' ? NEW.definition_id::text OR NEW.version<>coalesce((SELECT max(version) FROM app.mission_assessment WHERE tenant_id=NEW.tenant_id AND target_id=NEW.target_id),0)+1 THEN RAISE EXCEPTION 'Pinned assessment and sequential version required'; END IF;
   SELECT d.schema INTO template FROM app.assessment_definition d JOIN app.mission_route_assignment r ON r.tenant_id=d.tenant_id AND r.id=req.assignment_id JOIN app.mission_type_definition t ON t.tenant_id=r.tenant_id AND t.id=r.mission_type_id WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id AND d.schema->>'typeKey'=t.key;
   IF template IS NULL OR template->>'schemaVersion'<>'1' OR EXISTS(SELECT FROM jsonb_array_elements_text(template->'criteria') c WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.results) r WHERE r->>'criterion'=c)) THEN RAISE EXCEPTION 'Complete configured assessment criteria required'; END IF;
   IF EXISTS(SELECT FROM jsonb_array_elements_text(template->'machineryFields') f WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.technical_results) r WHERE r->>'field'=f)) THEN RAISE EXCEPTION 'Record each configured machinery field, including unknowns'; END IF;
   FOR v IN SELECT * FROM jsonb_array_elements(NEW.technical_results) LOOP
    IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['field','result','basis'] OR (SELECT count(*) FROM jsonb_object_keys(v))<>3 OR NOT template->'machineryFields' ? (v->>'field') OR v->>'result' NOT IN ('FIT','GAP','UNKNOWN','UNSUITABLE') OR length(coalesce(v->>'basis','')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Typed machinery observation required'; END IF;
   END LOOP;
   FOR v IN SELECT * FROM jsonb_array_elements(NEW.results) LOOP
    IF jsonb_typeof(v)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>4 OR NOT v ?& ARRAY['criterion','result','requirement','basis'] OR v->>'criterion' NOT IN ('commercial_relevance','buyer_fit','supplier_fit','distributor_capability','machinery_fit','visit_suitability','evidence_completeness') OR v->>'result' NOT IN ('FIT','GAP','UNKNOWN','UNSUITABLE') OR length(coalesce(v->>'requirement',''))<3 OR length(coalesce(v->>'basis',''))<3 THEN RAISE EXCEPTION 'Typed evidence-aware assessment required'; END IF;
   END LOOP;
  ELSIF TG_TABLE_NAME='mission_rfq' THEN
   FOREACH tid IN ARRAY NEW.target_ids LOOP
    IF NOT EXISTS(SELECT FROM app.target_account WHERE tenant_id=NEW.tenant_id AND id=tid AND mission_id=NEW.mission_id AND app.research_target_access(NEW.tenant_id,tid,true)) THEN RAISE EXCEPTION 'Matching RFQ target required' USING ERRCODE='42501'; END IF;
   END LOOP;
  ELSIF TG_TABLE_NAME='mission_quotation' THEN
   SELECT * INTO rfq FROM app.mission_rfq WHERE tenant_id=NEW.tenant_id AND id=NEW.rfq_id AND mission_id=NEW.mission_id AND requirement_id=NEW.requirement_id;
   IF rfq.id IS NULL OR NOT NEW.target_id=ANY(rfq.target_ids) THEN RAISE EXCEPTION 'Original RFQ supplier association required'; END IF;
   IF NOT pack.configuration->'currencies' ? NEW.currency THEN RAISE EXCEPTION 'Unsupported route currency'; END IF;
   expected:=coalesce((SELECT max(revision) FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND rfq_id=NEW.rfq_id AND target_id=NEW.target_id),0)+1;
   IF NEW.revision<>expected OR (NEW.revision=1 AND NEW.previous_id IS NOT NULL) OR (NEW.revision>1 AND NOT EXISTS(SELECT FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND id=NEW.previous_id AND rfq_id=NEW.rfq_id AND target_id=NEW.target_id AND revision=NEW.revision-1)) THEN RAISE EXCEPTION 'Quotation revision history required'; END IF;
   FOR k,v IN SELECT * FROM jsonb_each(NEW.terms) LOOP
    IF k NOT IN ('specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','paymentTerms') OR jsonb_typeof(v)<>'string' OR length(v#>>'{}')>1000 THEN RAISE EXCEPTION 'Unsupported quotation term'; END IF;
    IF k IN ('unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor') AND v#>>'{}' !~ '^(0|[1-9][0-9]{0,17})$' THEN RAISE EXCEPTION 'Exact nonnegative minor units required'; END IF;
    IF k IN ('quantity','moq') AND v#>>'{}' !~ '^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Exact positive quantity required'; END IF;
   END LOOP;
   IF NEW.terms ? 'shipping' AND NEW.terms->>'shipping' NOT IN ('INCLUDED','EXCLUDED','NOT_SUPPLIED') THEN RAISE EXCEPTION 'Explicit shipping scope required'; END IF;
   IF NEW.terms ? 'incoterm' AND NEW.terms->>'incoterm' NOT IN ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF') THEN RAISE EXCEPTION 'Supported Incoterm required'; END IF;
   IF NEW.terms ? 'validUntil' THEN PERFORM (NEW.terms->>'validUntil')::timestamptz; END IF;
  ELSIF TG_TABLE_NAME='mission_selection' THEN
   SELECT * INTO a FROM app.mission_assessment WHERE tenant_id=NEW.tenant_id AND id=NEW.assessment_id AND target_id=NEW.target_id AND requirement_id=NEW.requirement_id;
   IF a.id IS NULL OR a.version<>(SELECT max(version) FROM app.mission_assessment WHERE tenant_id=NEW.tenant_id AND target_id=NEW.target_id) THEN RAISE EXCEPTION 'Current matching assessment required'; END IF;
   IF NEW.quotation_id IS NOT NULL THEN
    SELECT * INTO quote FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND id=NEW.quotation_id AND target_id=NEW.target_id AND requirement_id=NEW.requirement_id;
    IF quote.id IS NULL OR EXISTS(SELECT FROM app.mission_quotation WHERE tenant_id=NEW.tenant_id AND previous_id=quote.id) THEN RAISE EXCEPTION 'Latest matching supplier offer required'; END IF;
   END IF;
   IF NOT EXISTS(SELECT FROM app.mission_owners(NEW.tenant_id) WHERE user_id=NEW.owner_id) THEN RAISE EXCEPTION 'Active decision owner required'; END IF;
  ELSIF TG_TABLE_NAME='mission_schedule' THEN
   IF NEW.version<>coalesce((SELECT max(version) FROM app.mission_schedule WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id),0)+1 THEN RAISE EXCEPTION 'Sequential schedule version required'; END IF;
   FOR v IN SELECT * FROM jsonb_array_elements(NEW.entries) LOOP
    IF v->>'kind' NOT IN ('DESTINATION','EVENT','CANDIDATE','APPOINTMENT','AVAILABILITY','CONSTRAINT','LOGISTICS') OR length(coalesce(v->>'label',''))<3 OR length(coalesce(v->>'note',''))<3 OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=v->>'timezone') THEN RAISE EXCEPTION 'Typed schedule entry required'; END IF;
    IF v->>'kind'='APPOINTMENT' OR v ? 'meetingId' THEN
     IF NOT EXISTS(SELECT FROM app.meeting WHERE tenant_id=NEW.tenant_id AND mission_id=NEW.mission_id AND id=(v->>'meetingId')::uuid AND status IN ('SCHEDULED','HELD')) OR v ?| ARRAY['startsAt','endsAt','location'] THEN RAISE EXCEPTION 'Appointment uses actual meeting schedule only'; END IF;
    END IF;
    IF v ? 'sourceId' AND NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=(v->>'sourceId')::uuid AND retention_until>now() AND app.can_access(tenant_id,classification,purpose)) THEN RAISE EXCEPTION 'Current schedule source required'; END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; extra text; BEGIN
 FOREACH t IN ARRAY ARRAY['mission_requirements','mission_assessment','mission_rfq','mission_quotation','mission_selection','mission_schedule','commercial_mission_command'] LOOP
  extra:=CASE WHEN t IN ('mission_assessment','mission_quotation','mission_selection') THEN ' AND app.research_target_access(tenant_id,target_id)' ELSE '' END;
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO corridra_runtime USING(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'')%s)',t,extra);
  extra:=CASE WHEN t IN ('mission_assessment','mission_quotation','mission_selection') THEN ' AND app.research_target_access(tenant_id,target_id,true)' ELSE '' END;
  EXECUTE format('CREATE POLICY add ON app.%I FOR INSERT TO corridra_runtime WITH CHECK(app.can_access(tenant_id,''INTERNAL'',''synthetic_validation'') AND app.member_role(tenant_id) IN (''owner'',''admin'',''operator'') AND created_by=app.actor_id()%s)',t,extra);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO corridra_runtime',t);
  EXECUTE format('CREATE TRIGGER guard BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_commercial_mission()',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite()',t);
  EXECUTE format('CREATE TRIGGER event AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.record_change()',t);
  EXECUTE format('CREATE INDEX ON app.%I(tenant_id,mission_id,created_at,id)',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.guard_commercial_mission() FROM PUBLIC;
-- RFQ terms do not reveal an owner's private shortlist to another relationship scope.
ALTER POLICY read ON app.mission_rfq USING(app.can_access(tenant_id,'INTERNAL','synthetic_validation') AND NOT EXISTS(SELECT FROM unnest(target_ids) t WHERE NOT app.research_target_access(tenant_id,t)));
