-- ADR-079 slice B (built as ADR-082 slice S1): the lightweight source rights record of a catalogue organisation, the ingest wrapper
-- that writes it, the staff writers for a takedown (suppression) and for claim redaction, and the closed-claims lookup.
-- This file creates one table and new functions. It replaces nothing: the tables of suppression and redaction, their yes/no helpers
-- and every reader that honours them were created in 0013, and the 8-argument ingest function is called as it is.
-- The first statement is a guard. It fingerprints every existing function this file relies on (body, settings, security mode,
-- volatility, argument types, defaults and grants, not pg_get_functiondef) and checks that the three 0013 tables exist.
-- Nothing is changed unless all of them match. The two checks are plain SELECT statements between marker comments, so an owner can
-- copy each one, add a semicolon and run it on any database to read the live values.
DO $guard$
DECLARE spec record;
BEGIN
 FOR spec IN
  SELECT e.signature,e.fingerprint,e.grantees,q.fp,q.grantees live_grantees
  FROM (VALUES
   -- fingerprint-begin
   ('app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text)','47f4a8b05c6bd0a9560ac6f7e1bfb831c3fd8ae6419486fc5d589f4c807614f9','corridra_runtime'),
   ('customer_private.organisation_link_staff()','df9254c207422e690fff50f3d1436c2120b9024e04857cc42f734c1cf3ad6dd8',''),
   ('customer_private.organisation_link_domain_event(uuid,text,uuid,uuid,text,uuid,integer,text)','253f87cd84b1ca1d1fa9022a85b78240f682c067d0f09fc0adfa191b3ab37611',''),
   ('customer_private.organisation_link_name_key(text)','2037fdee0fabf6c8d14a152ffa99f262bcd1b9c328ad91d286be3b775d55fe40',''),
   ('customer_private.organisation_link_head(uuid)','01bc49acb517de27cea4b1faab8ec0f9719f3f042e9a03dad6d41bbc6cc86118',''),
   ('customer_private.organisation_link_same_context(boolean,boolean)','d71f868e7cb6f2b5a4487caca3a95b83afd97c532e9675c3d95bfe645bcf973b',''),
   ('customer_private.organisation_link_suppressed(uuid)','4c21b19332a305741cbb01ea8493bf603a8547d028961062170b5a3c323637d5',''),
   ('customer_private.organisation_link_redacted(uuid)','115a1bf7df47f667069765b86560cccbc426af7d928f1848ac6ca959ff632add','')
   -- fingerprint-end
  ) AS e(signature,fingerprint,grantees)
  LEFT JOIN (
   -- fingerprint-query-begin
   SELECT v.signature,f.fp,f.grantees
   FROM (VALUES
    ('app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text)'),
    ('customer_private.organisation_link_staff()'),
    ('customer_private.organisation_link_domain_event(uuid,text,uuid,uuid,text,uuid,integer,text)'),
    ('customer_private.organisation_link_name_key(text)'),
    ('customer_private.organisation_link_head(uuid)'),
    ('customer_private.organisation_link_same_context(boolean,boolean)'),
    ('customer_private.organisation_link_suppressed(uuid)'),
    ('customer_private.organisation_link_redacted(uuid)')
   ) v(signature)
   LEFT JOIN LATERAL (
    SELECT encode(sha256(convert_to(concat_ws(E'\x1f',p.prosrc,coalesce(array_to_string(p.proconfig,E'\x1e'),''),p.prosecdef::text,p.provolatile::text,
      p.proisstrict::text,p.proretset::text,p.prokind::text,p.proparallel::text,p.proleakproof::text,array_to_string(p.proargtypes::regtype[],','),
      p.prorettype::regtype::text,l.lanname,coalesce(array_to_string(p.proargnames,','),''),p.pronargdefaults::text,coalesce(pg_get_expr(p.proargdefaults,0),'')),'UTF8')),'hex') fp,
     (SELECT coalesce(string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,',' ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END),'')
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) grantees
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(v.signature)
   ) f ON true
   -- fingerprint-query-end
  ) q ON q.signature=e.signature
 LOOP
  IF spec.fp IS DISTINCT FROM spec.fingerprint OR spec.live_grantees IS DISTINCT FROM spec.grantees THEN
   RAISE EXCEPTION 'Real-use prerequisite function differs: %',split_part(spec.signature,'(',1);
  END IF;
 END LOOP;
 IF NOT (
  -- table-query-begin
  SELECT to_regclass('customer_private.organisation_suppression') IS NOT NULL AND to_regclass('customer_private.organisation_link_redaction') IS NOT NULL
   AND to_regclass('customer_private.organisation_link_search_attempt') IS NOT NULL
  -- table-query-end
 ) THEN
  RAISE EXCEPTION 'Real-use prerequisite table is missing: customer_private.organisation_suppression, organisation_link_redaction or organisation_link_search_attempt';
 END IF;
END $guard$;

-- Source rights: one row per version per organisation, the latest is current, nothing is updated. Version 1 comes from the ingest
-- wrapper (no command, no reason). Every later version, and a first version written for an organisation that was made without
-- the wrapper, comes from an adjust and carries the command, the request and a reason.
CREATE TABLE customer_private.organisation_source_rights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES app.organisation(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100000),
 source_type text NOT NULL CHECK(source_type IN ('government_registry','company_website','trade_body_list','event_list','staff_research','licensed_dataset','other')),
 basis_note text NOT NULL CHECK(basis_note=btrim(basis_note) AND length(basis_note) BETWEEN 3 AND 300),
 personal_name_flag boolean NOT NULL,
 warnings text[] NOT NULL DEFAULT '{}' CHECK(warnings <@ ARRAY['licence_not_checked','source_not_classified','personal_name_check','previously_hidden']::text[]),
 review_by timestamptz NOT NULL,
 source_tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 source_record_id uuid NOT NULL,
 staff_actor uuid NOT NULL REFERENCES identity.principal(id),
 reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]')),
 command_id uuid,
 request jsonb CHECK(request IS NULL OR jsonb_typeof(request)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organisation_id,version),
 FOREIGN KEY(source_tenant_id,source_record_id) REFERENCES app.source_record(tenant_id,id),
 CHECK((command_id IS NULL)=(request IS NULL)),
 CHECK(command_id IS NULL OR reason IS NOT NULL),
 CHECK(version=1 OR (command_id IS NOT NULL AND reason IS NOT NULL))
);
CREATE UNIQUE INDEX organisation_source_rights_command ON customer_private.organisation_source_rights(staff_actor,command_id) WHERE command_id IS NOT NULL;
CREATE TRIGGER organisation_source_rights_immutable BEFORE UPDATE OR DELETE ON customer_private.organisation_source_rights FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
ALTER TABLE customer_private.organisation_source_rights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.organisation_source_rights FROM PUBLIC,corridra_runtime,corridra_auth;

-- Default rights fields by source type (ADR-079 section 2). An unknown or missing type is stored as other.
CREATE FUNCTION customer_private.organisation_rights_defaults(p_type text)
 RETURNS TABLE(source_type text, basis_note text, review_months integer, warnings text[])
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.k,t.note,t.months,t.warn FROM (VALUES
  ('government_registry','Public register entry. Register reuse terms not checked here.',12,ARRAY[]::text[]),
  ('company_website','The company''s own public website.',6,ARRAY[]::text[]),
  ('trade_body_list','Member list published by a trade body or association.',12,ARRAY[]::text[]),
  ('event_list','Exhibitor or attendee list published for an event.',6,ARRAY[]::text[]),
  ('staff_research','Other public research by Corridra staff.',6,ARRAY[]::text[]),
  ('licensed_dataset','Dataset used under a licence. Licence terms not checked here.',12,ARRAY['licence_not_checked']),
  ('other','Source not classified.',3,ARRAY['source_not_classified'])
 ) t(k,note,months,warn)
 WHERE t.k=CASE WHEN p_type IN ('government_registry','company_website','trade_body_list','event_list','staff_research','licensed_dataset') THEN p_type ELSE 'other' END
$$;

-- The same provenance rule the readers use: the organisation is of the session side.
CREATE FUNCTION customer_private.organisation_catalogue_visible(p_organisation uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM app.organisation o WHERE o.id=p_organisation AND customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context()))
$$;

-- The tenant whose ingest roles may adjust or read the rights of an organisation: the tenant of its rights record, or for an
-- organisation made without the wrapper the tenant of its first source link. Every refusal reads the same.
CREATE FUNCTION customer_private.organisation_rights_authority(p_organisation uuid)
 RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid;
BEGIN
 IF p_organisation IS NOT NULL AND customer_private.organisation_catalogue_visible(p_organisation) THEN
  SELECT r.source_tenant_id INTO v_tenant FROM customer_private.organisation_source_rights r WHERE r.organisation_id=p_organisation ORDER BY r.version DESC LIMIT 1;
  IF v_tenant IS NULL THEN
   SELECT s.tenant_id INTO v_tenant FROM app.organisation_source s WHERE s.organisation_id=p_organisation ORDER BY s.created_at,s.id LIMIT 1;
  END IF;
  IF v_tenant IS NOT NULL AND app.member_role(v_tenant) IN ('owner','admin','operator') THEN RETURN v_tenant; END IF;
 END IF;
 RAISE EXCEPTION 'Organisation unavailable' USING ERRCODE='42501';
END $$;

-- The catalogue event of a takedown. Ids, version and state only: never the reason, the reference or any text.
CREATE FUNCTION customer_private.organisation_catalogue_domain_event(p_target uuid, p_command uuid, p_kind text, p_organisation uuid, p_version integer, p_state text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=app.actor_id(); v_eid uuid:=gen_random_uuid(); v_event_version integer;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v_event_version FROM app.domain_event e
 WHERE e.tenant_id=p_target AND e.aggregate_type='customer_organisation_catalogue' AND e.aggregate_id=p_organisation::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(v_eid,p_target,'customer.organisation_catalogue.'||p_kind,1,'customer_organisation_catalogue',p_organisation::text,v_event_version,v_actor,clock_timestamp(),p_command,p_command,
 jsonb_build_object('organisationId',p_organisation,'version',p_version,'state',p_state,'synthetic',customer_private.synthetic_context(),'initiator_kind','staff','initiator_id',v_actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),p_target,v_eid,v_actor,'customer.organisation_catalogue.'||p_kind);
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),p_target,v_eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(v_eid,p_target);
END $$;

-- Ingest with a rights record. One call is one atomic step: the organisation, its identifier, its source row, the rights row and any
-- carried takedown exist together or not at all. The 8-argument function does every authority and source check and is not changed.
-- The wrapper adds no refusal of its own. An unknown source type is stored as other.
CREATE FUNCTION app.ingest_public_organisation_with_rights(target uuid, sid uuid, company text, cc text, host text, addr text, itype text, ident text, p_source_type text DEFAULT NULL)
 RETURNS TABLE(id uuid, warnings text[])
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_org uuid; v_staff uuid; v_def record; v_warn text[]; v_personal boolean; v_old uuid; v_old_row customer_private.organisation_suppression;
 v_command uuid:=gen_random_uuid();
BEGIN
 v_org:=app.ingest_public_organisation(target,sid,company,cc,host,addr,itype,ident);
 v_staff:=app.actor_id();
 SELECT d.* INTO v_def FROM customer_private.organisation_rights_defaults(p_source_type) d;
 v_warn:=v_def.warnings;
 -- A legal-form word is deleted from the name key. If the key equals the plain letters of the name, no word was deleted and the
 -- company may be a sole trader, which is personal data. A prompt to look, not a judgement.
 v_personal:=customer_private.organisation_link_name_key(company)=regexp_replace(regexp_replace(lower(company),
  CASE WHEN customer_private.synthetic_context() THEN '^synthetic[[:space:]]+' ELSE '^$' END,''),'[^[:alnum:]]+','','g');
 IF v_personal THEN v_warn:=array_append(v_warn,'personal_name_check'); END IF;
 -- Only organisations that have a suppression row are looked at, so the cost does not grow with the catalogue.
 SELECT s.organisation_id INTO v_old
 FROM customer_private.organisation_suppression s JOIN app.organisation o ON o.id=s.organisation_id
 WHERE s.state='hidden' AND o.id<>v_org
  AND s.version=(SELECT max(x.version) FROM customer_private.organisation_suppression x WHERE x.organisation_id=s.organisation_id)
  AND customer_private.organisation_link_same_context(o.synthetic,customer_private.synthetic_context())
  AND ((o.country=cc AND customer_private.organisation_link_name_key(o.name)=customer_private.organisation_link_name_key(company))
   OR EXISTS(SELECT FROM app.public_identifier i WHERE i.organisation_id=o.id AND i.identifier_type=itype AND i.identifier=ident))
 ORDER BY s.created_at,s.id LIMIT 1;
 IF v_old IS NOT NULL THEN
  -- The same lock a decision and a show take, then the row is read again: a takedown that was just reversed is not carried over.
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.organisation:'||v_old::text,0));
  SELECT x.* INTO v_old_row FROM customer_private.organisation_suppression x WHERE x.organisation_id=v_old ORDER BY x.version DESC LIMIT 1;
  IF v_old_row.state='hidden' THEN
   INSERT INTO customer_private.organisation_suppression(organisation_id,version,state,reason,reference,staff_actor,command_id,request)
   VALUES(v_org,1,'hidden','Carry-over of an earlier takedown','Carry-over of suppression row '||v_old_row.id::text,v_staff,v_command,jsonb_build_object('carryOver',v_old));
   PERFORM customer_private.organisation_catalogue_domain_event(target,v_command,'hidden',v_org,1,'hidden');
   v_warn:=array_append(v_warn,'previously_hidden');
  END IF;
 END IF;
 INSERT INTO customer_private.organisation_source_rights(organisation_id,version,source_type,basis_note,personal_name_flag,warnings,review_by,source_tenant_id,source_record_id,staff_actor)
 VALUES(v_org,1,v_def.source_type,v_def.basis_note,v_personal,v_warn,clock_timestamp()+make_interval(months=>v_def.review_months),target,sid,v_staff);
 id:=v_org; warnings:=v_warn;
 RETURN NEXT;
END $$;

-- The rights record as staff read it. Both functions below use the same authority and the same refusal.
CREATE FUNCTION customer_private.organisation_source_rights_json(p_row customer_private.organisation_source_rights)
 RETURNS jsonb
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',p_row.version,'sourceType',p_row.source_type,'basisNote',p_row.basis_note,'personalNameFlag',p_row.personal_name_flag,
  'warnings',to_jsonb(p_row.warnings),'reviewBy',p_row.review_by,'reason',p_row.reason,'recordedAt',p_row.created_at)
$$;

CREATE FUNCTION app.adjust_organisation_source_rights(p_command uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=app.actor_id(); v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 v_org uuid; v_tenant uuid; v_prior customer_private.organisation_source_rights; v_head customer_private.organisation_source_rights;
 v_def record; v_source uuid; v_flag boolean:=false; v_carried text[]:='{}'; v_version integer; v_row customer_private.organisation_source_rights;
BEGIN
 IF p_command IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
  OR p_input-ARRAY['organisationId','sourceType','reason']<>'{}'::jsonb OR NOT (p_input ?& ARRAY['organisationId','sourceType','reason'])
  OR jsonb_typeof(p_input->'organisationId')<>'string' OR p_input->>'organisationId' !~ v_uuid
  OR jsonb_typeof(p_input->'sourceType')<>'string' OR p_input->>'sourceType' NOT IN ('government_registry','company_website','trade_body_list','event_list','staff_research','licensed_dataset','other')
  OR jsonb_typeof(p_input->'reason')<>'string' OR p_input->>'reason'<>btrim(p_input->>'reason') OR length(p_input->>'reason') NOT BETWEEN 3 AND 1000 OR p_input->>'reason' ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Invalid source rights request' USING ERRCODE='23514';
 END IF;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Organisation unavailable' USING ERRCODE='42501'; END IF;
 v_org:=(p_input->>'organisationId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.command:'||v_actor::text||':'||p_command::text,0));
 v_tenant:=customer_private.organisation_rights_authority(v_org);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.organisation:'||v_org::text,0));
 IF app.actor_id() IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Organisation unavailable' USING ERRCODE='42501'; END IF;
 SELECT r.* INTO v_prior FROM customer_private.organisation_source_rights r WHERE r.staff_actor=v_actor AND r.command_id=p_command;
 IF FOUND THEN
  IF v_prior.request IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('organisationId',v_org,'commandId',p_command)||customer_private.organisation_source_rights_json(v_prior);
 END IF;
 SELECT d.* INTO v_def FROM customer_private.organisation_rights_defaults(p_input->>'sourceType') d;
 SELECT r.* INTO v_head FROM customer_private.organisation_source_rights r WHERE r.organisation_id=v_org ORDER BY r.version DESC LIMIT 1;
 IF FOUND THEN
  v_version:=v_head.version+1; v_source:=v_head.source_record_id; v_flag:=v_head.personal_name_flag;
  v_carried:=ARRAY(SELECT w FROM unnest(v_head.warnings) w WHERE w IN ('personal_name_check','previously_hidden'));
 ELSE
  v_version:=1;
  SELECT s.source_id INTO v_source FROM app.organisation_source s WHERE s.organisation_id=v_org AND s.tenant_id=v_tenant ORDER BY s.created_at,s.id LIMIT 1;
 END IF;
 INSERT INTO customer_private.organisation_source_rights(organisation_id,version,source_type,basis_note,personal_name_flag,warnings,review_by,source_tenant_id,source_record_id,staff_actor,reason,command_id,request)
 VALUES(v_org,v_version,v_def.source_type,v_def.basis_note,v_flag,v_def.warnings||v_carried,clock_timestamp()+make_interval(months=>v_def.review_months),v_tenant,v_source,v_actor,
  p_input->>'reason',p_command,p_input) RETURNING * INTO v_row;
 RETURN jsonb_build_object('organisationId',v_org,'commandId',p_command)||customer_private.organisation_source_rights_json(v_row);
END $$;

CREATE FUNCTION app.organisation_source_rights_read(p_organisation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=customer_private.organisation_rights_authority(p_organisation); v_head customer_private.organisation_source_rights; v_history jsonb;
BEGIN
 SELECT r.* INTO v_head FROM customer_private.organisation_source_rights r WHERE r.organisation_id=p_organisation ORDER BY r.version DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('organisationId',p_organisation,'status','unrecorded'); END IF;
 SELECT coalesce(jsonb_agg(customer_private.organisation_source_rights_json(r) ORDER BY r.version),'[]'::jsonb) INTO v_history
 FROM customer_private.organisation_source_rights r WHERE r.organisation_id=p_organisation;
 RETURN jsonb_build_object('organisationId',p_organisation,'status','recorded','current',customer_private.organisation_source_rights_json(v_head),'history',v_history);
END $$;

-- Takedown. Any link reviewer may hide, the safe direction. Showing again needs owner or admin. The latest row decides.
CREATE FUNCTION app.customer_organisation_suppress(p_command uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); v_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; v_org uuid; v_state text;
 v_prior customer_private.organisation_suppression; v_head customer_private.organisation_suppression; v_version integer;
BEGIN
 IF p_command IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
  OR p_input-ARRAY['organisationId','state','reason','reference']<>'{}'::jsonb OR NOT (p_input ?& ARRAY['organisationId','state','reason','reference'])
  OR jsonb_typeof(p_input->'organisationId')<>'string' OR p_input->>'organisationId' !~ v_uuid
  OR jsonb_typeof(p_input->'state')<>'string' OR p_input->>'state' NOT IN ('hidden','shown')
  OR jsonb_typeof(p_input->'reason')<>'string' OR p_input->>'reason'<>btrim(p_input->>'reason') OR length(p_input->>'reason') NOT BETWEEN 3 AND 1000 OR p_input->>'reason' ~ '[[:cntrl:]]'
  OR jsonb_typeof(p_input->'reference')<>'string' OR p_input->>'reference'<>btrim(p_input->>'reference') OR length(p_input->>'reference') NOT BETWEEN 3 AND 120 OR p_input->>'reference' ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Invalid organisation takedown request' USING ERRCODE='23514';
 END IF;
 v_org:=(p_input->>'organisationId')::uuid; v_state:=p_input->>'state';
 IF v_state='shown' AND app.member_role(v_tenant) NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Owner or admin required to show an organisation again' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.command:'||v_staff::text||':'||p_command::text,0));
 IF NOT customer_private.organisation_catalogue_visible(v_org) THEN RAISE EXCEPTION 'Organisation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.organisation:'||v_org::text,0));
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 SELECT s.* INTO v_prior FROM customer_private.organisation_suppression s WHERE s.staff_actor=v_staff AND s.command_id=p_command;
 IF FOUND THEN
  IF v_prior.request<>p_input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('organisationId',v_org,'commandId',p_command,'state',v_prior.state,'version',v_prior.version);
 END IF;
 SELECT s.* INTO v_head FROM customer_private.organisation_suppression s WHERE s.organisation_id=v_org ORDER BY s.version DESC LIMIT 1;
 IF coalesce(v_head.state,'shown')=v_state THEN
  RAISE EXCEPTION 'That organisation is already %',v_state USING ERRCODE='23514';
 END IF;
 v_version:=coalesce(v_head.version,0)+1;
 INSERT INTO customer_private.organisation_suppression(organisation_id,version,state,reason,reference,staff_actor,command_id,request)
 VALUES(v_org,v_version,v_state,p_input->>'reason',p_input->>'reference',v_staff,p_command,p_input);
 PERFORM customer_private.organisation_catalogue_domain_event(v_tenant,p_command,v_state,v_org,v_version,v_state);
 RETURN jsonb_build_object('organisationId',v_org,'commandId',p_command,'state',v_state,'version',v_version);
END $$;

-- Redaction of the customer text of one closed claim. Owner or admin, the claim id typed twice, a reason and a reference.
CREATE FUNCTION app.customer_organisation_link_redact(p_command uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); v_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid;
 v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; c customer_private.organisation_link_claim;
 v_prior customer_private.organisation_link_redaction; v_seq integer; v_state text;
BEGIN
 IF p_command IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
  OR p_input-ARRAY['claimId','confirmClaimId','reason','reference']<>'{}'::jsonb OR NOT (p_input ?& ARRAY['claimId','confirmClaimId','reason','reference'])
  OR jsonb_typeof(p_input->'claimId')<>'string' OR p_input->>'claimId' !~ v_uuid
  OR jsonb_typeof(p_input->'confirmClaimId')<>'string' OR p_input->>'confirmClaimId' !~ v_uuid
  OR jsonb_typeof(p_input->'reason')<>'string' OR p_input->>'reason'<>btrim(p_input->>'reason') OR length(p_input->>'reason') NOT BETWEEN 3 AND 1000 OR p_input->>'reason' ~ '[[:cntrl:]]'
  OR jsonb_typeof(p_input->'reference')<>'string' OR p_input->>'reference'<>btrim(p_input->>'reference') OR length(p_input->>'reference') NOT BETWEEN 3 AND 120 OR p_input->>'reference' ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Invalid redaction request' USING ERRCODE='23514';
 END IF;
 IF app.member_role(v_tenant) NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Owner or admin required to redact a claim' USING ERRCODE='42501'; END IF;
 IF p_input->>'claimId'<>p_input->>'confirmClaimId' THEN RAISE EXCEPTION 'The confirmation does not match the claim to redact' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link.command:'||v_staff::text||':'||p_command::text,0));
 SELECT x.* INTO c FROM customer_private.organisation_link_claim x
 WHERE x.id=(p_input->>'claimId')::uuid AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(x.tenant_id),customer_private.synthetic_context());
 IF NOT FOUND THEN RAISE EXCEPTION 'Company link request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.organisation_link:'||c.tenant_id::text,0));
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 SELECT r.* INTO v_prior FROM customer_private.organisation_link_redaction r WHERE r.staff_actor=v_staff AND r.command_id=p_command;
 IF FOUND THEN
  IF v_prior.request<>p_input THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('claimId',c.id,'commandId',p_command,'redacted',true);
 END IF;
 IF customer_private.organisation_link_redacted(c.id) THEN RAISE EXCEPTION 'That claim is already redacted' USING ERRCODE='23514'; END IF;
 SELECT h.seq,h.state INTO v_seq,v_state FROM customer_private.organisation_link_head(c.id) h;
 IF v_state IS NULL OR v_state IN ('pending','needs_evidence','creation_approved') THEN
  RAISE EXCEPTION 'Reject the claim before redacting it' USING ERRCODE='23514';
 END IF;
 INSERT INTO customer_private.organisation_link_redaction(claim_id,reason,reference,staff_actor,command_id,request)
 VALUES(c.id,p_input->>'reason',p_input->>'reference',v_staff,p_command,p_input);
 PERFORM customer_private.organisation_link_domain_event(c.tenant_id,'staff',v_staff,p_command,'redacted',c.id,v_seq,v_state);
 RETURN jsonb_build_object('claimId',c.id,'commandId',p_command,'redacted',true);
END $$;

-- Finding the claim id of an erasure request while the customer switch is off: the closed claims of one workspace, ids, states and
-- times only, no text. A workspace that is unknown to the caller, of the other side or without a closed claim answers the same bytes.
CREATE FUNCTION app.customer_organisation_link_closed_claims(p_workspace uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_staff uuid:=customer_private.organisation_link_staff(); v_tenant uuid:=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid; v_claims jsonb;
BEGIN
 IF app.member_role(v_tenant) NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Owner or admin required to look up claims' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('claimId',m.id,'state',m.state,'version',m.seq,'createdAt',m.created_at,'updatedAt',m.updated_at,'redacted',m.redacted)
  ORDER BY m.created_at DESC,m.id),'[]'::jsonb) INTO v_claims
 FROM (SELECT c.id,c.created_at,head.seq,head.state,customer_private.organisation_link_redacted(c.id) redacted,
   (SELECT e.created_at FROM customer_private.organisation_link_event e WHERE e.claim_id=c.id AND e.seq=head.seq) updated_at
  FROM customer_private.organisation_link_claim c CROSS JOIN LATERAL customer_private.organisation_link_head(c.id) head
  WHERE c.tenant_id=p_workspace AND customer_private.organisation_link_same_context(app.tenant_is_synthetic(c.tenant_id),customer_private.synthetic_context())
   AND head.state NOT IN ('pending','needs_evidence','creation_approved')
  ORDER BY c.created_at DESC,c.id LIMIT 200) m;
 IF app.actor_id() IS DISTINCT FROM v_staff THEN RAISE EXCEPTION 'Staff access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('claims',v_claims);
END $$;

-- Private helpers have no grant. The entry points are granted to the runtime login only.
REVOKE ALL ON FUNCTION customer_private.organisation_rights_defaults(text),customer_private.organisation_catalogue_visible(uuid),
 customer_private.organisation_rights_authority(uuid),customer_private.organisation_catalogue_domain_event(uuid,uuid,text,uuid,integer,text),
 customer_private.organisation_source_rights_json(customer_private.organisation_source_rights),
 app.ingest_public_organisation_with_rights(uuid,uuid,text,text,text,text,text,text,text),app.adjust_organisation_source_rights(uuid,jsonb),
 app.organisation_source_rights_read(uuid),app.customer_organisation_suppress(uuid,jsonb),app.customer_organisation_link_redact(uuid,jsonb),
 app.customer_organisation_link_closed_claims(uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION app.ingest_public_organisation_with_rights(uuid,uuid,text,text,text,text,text,text,text),app.adjust_organisation_source_rights(uuid,jsonb),
 app.organisation_source_rights_read(uuid),app.customer_organisation_suppress(uuid,jsonb),app.customer_organisation_link_redact(uuid,jsonb),
 app.customer_organisation_link_closed_claims(uuid) TO corridra_runtime;
