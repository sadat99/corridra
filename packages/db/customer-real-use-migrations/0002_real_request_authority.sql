-- ADR056. Explicit real provenance and verified customer authority; legacy data is never relabelled.
CREATE FUNCTION app.tenant_is_synthetic(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT synthetic FROM app.tenant WHERE id=t $$;
CREATE FUNCTION app.real_use_allowed(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT coalesce(NOT app.tenant_is_synthetic(t),false) AND EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled) $$;
CREATE FUNCTION app.tenant_processing_purpose(t uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT CASE WHEN app.tenant_is_synthetic(t)=false THEN 'commercial_qualification' ELSE 'synthetic_validation' END $$;
REVOKE ALL ON FUNCTION app.tenant_is_synthetic(uuid),app.real_use_allowed(uuid),app.tenant_processing_purpose(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION app.tenant_is_synthetic(uuid),app.real_use_allowed(uuid),app.tenant_processing_purpose(uuid) TO corridra_runtime;
CREATE FUNCTION customer_private.real_session() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM customer_private.session_proof s JOIN customer_private.real_use_configuration c ON c.issuer=s.issuer AND c.enabled JOIN customer_private.principal p ON p.issuer=s.issuer AND p.subject=s.subject AND p.disabled_at IS NULL WHERE s.hash=current_setting('corridra.customer_proof_hash',true) AND s.expires_at>clock_timestamp() AND s.data_mode='real' AND s.verified_email_hash IS NOT NULL)
$$;
CREATE FUNCTION customer_private.synthetic_context() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN customer_private.real_session() THEN coalesce((SELECT synthetic FROM app.tenant WHERE id=NULLIF(current_setting('corridra.customer_workspace_id',true),'')::uuid),false)
 ELSE NOT coalesce(app.real_use_allowed(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) AND app.can_access(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid,'INTERNAL','commercial_qualification'),false) END
$$;
REVOKE ALL ON FUNCTION customer_private.real_session(),customer_private.synthetic_context() FROM PUBLIC,corridra_runtime,corridra_auth;

ALTER TABLE app.accounting_confirmation DROP CONSTRAINT accounting_confirmation_purpose_check;
ALTER TABLE app.accounting_confirmation ADD CONSTRAINT accounting_confirmation_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.buyer_link DROP CONSTRAINT buyer_link_purpose_check;
ALTER TABLE app.buyer_link ADD CONSTRAINT buyer_link_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.buyer_link_revocation DROP CONSTRAINT buyer_link_revocation_purpose_check;
ALTER TABLE app.buyer_link_revocation ADD CONSTRAINT buyer_link_revocation_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.buyer_response DROP CONSTRAINT buyer_response_purpose_check;
ALTER TABLE app.buyer_response ADD CONSTRAINT buyer_response_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.commercial_command DROP CONSTRAINT commercial_command_purpose_check;
ALTER TABLE app.commercial_command ADD CONSTRAINT commercial_command_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.commercial_record DROP CONSTRAINT commercial_record_purpose_check;
ALTER TABLE app.commercial_record ADD CONSTRAINT commercial_record_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.communication DROP CONSTRAINT communication_purpose_check;
ALTER TABLE app.communication ADD CONSTRAINT communication_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.communication_command DROP CONSTRAINT communication_command_purpose_check;
ALTER TABLE app.communication_command ADD CONSTRAINT communication_command_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.communication_optout DROP CONSTRAINT communication_optout_purpose_check;
ALTER TABLE app.communication_optout ADD CONSTRAINT communication_optout_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.communication_policy DROP CONSTRAINT communication_policy_purpose_check;
ALTER TABLE app.communication_policy ADD CONSTRAINT communication_policy_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.communication_template DROP CONSTRAINT communication_template_purpose_check;
ALTER TABLE app.communication_template ADD CONSTRAINT communication_template_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.follow_up DROP CONSTRAINT follow_up_purpose_check;
ALTER TABLE app.follow_up ADD CONSTRAINT follow_up_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.meeting DROP CONSTRAINT meeting_purpose_check;
ALTER TABLE app.meeting ADD CONSTRAINT meeting_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.meeting_brief DROP CONSTRAINT meeting_brief_purpose_check;
ALTER TABLE app.meeting_brief ADD CONSTRAINT meeting_brief_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.meeting_command DROP CONSTRAINT meeting_command_purpose_check;
ALTER TABLE app.meeting_command ADD CONSTRAINT meeting_command_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.meeting_outcome DROP CONSTRAINT meeting_outcome_purpose_check;
ALTER TABLE app.meeting_outcome ADD CONSTRAINT meeting_outcome_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.meeting_participant DROP CONSTRAINT meeting_participant_purpose_check;
ALTER TABLE app.meeting_participant ADD CONSTRAINT meeting_participant_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.mission DROP CONSTRAINT mission_purpose_check;
ALTER TABLE app.mission ADD CONSTRAINT mission_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.opportunity DROP CONSTRAINT opportunity_purpose_check;
ALTER TABLE app.opportunity ADD CONSTRAINT opportunity_purpose_check CHECK ((purpose='synthetic_validation' AND app.tenant_is_synthetic(tenant_id)) OR (purpose='commercial_qualification' AND NOT app.tenant_is_synthetic(tenant_id)));

ALTER TABLE app.accounting_confirmation ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.buyer_link ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.buyer_link_revocation ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.buyer_response ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.commercial_command ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.commercial_record ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.communication ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.communication_command ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.communication_optout ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.communication_policy ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.communication_template ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.follow_up ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.meeting ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.meeting_brief ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.meeting_command ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.meeting_outcome ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.meeting_participant ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.mission ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.mission_intake ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.mission_reply ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

ALTER TABLE app.opportunity ALTER COLUMN purpose SET DEFAULT coalesce(nullif(current_setting('corridra.purpose',true),''),'synthetic_validation');

CREATE POLICY "real_use_read" ON app."accounting_confirmation" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."accounting_confirmation".tenant_id) AND (((tenant_id = ( SELECT (NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid AS "nullif")) AND ( SELECT app.can_access((NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid, 'INTERNAL'::text, app.tenant_processing_purpose(app."accounting_confirmation".tenant_id)) AS can_access) AND ((opportunity_id IS NULL) OR (opportunity_id IN ( SELECT opportunity.id
   FROM app.opportunity))))));

CREATE POLICY "real_use_add" ON app."ai_attempt" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_attempt".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_attempt".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."ai_attempt" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_attempt".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_attempt".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."ai_completion" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_completion".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_completion".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."ai_completion" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_completion".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_completion".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."ai_mission_budget" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_mission_budget".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_mission_budget".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_ai_budget_read" ON app."ai_mission_budget" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_mission_budget".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_mission_budget".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['operator'::text, 'reviewer'::text])) AND (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = ai_mission_budget.tenant_id) AND (s.id = ai_mission_budget.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose)))))));

CREATE POLICY "real_use_read" ON app."ai_mission_budget" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_mission_budget".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_mission_budget".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = ai_mission_budget.tenant_id) AND (s.id = ai_mission_budget.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_add" ON app."ai_model_policy" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_model_policy".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_model_policy".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."ai_model_policy" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_model_policy".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_model_policy".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."ai_result" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_result".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_result".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."ai_result" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_result".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_result".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."ai_review" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_review".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_review".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."ai_review" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_review".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_review".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."ai_run" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."ai_run".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_run".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."ai_run" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."ai_run".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."ai_run".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."assessment_definition" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."assessment_definition".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."assessment_definition".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."assessment_definition" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."assessment_definition".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."assessment_definition".tenant_id))));

CREATE POLICY "real_use_read" ON app."commercial_command" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."commercial_command".tenant_id) AND (((tenant_id = ( SELECT (NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid AS "nullif")) AND ( SELECT app.can_access((NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_command".tenant_id)) AS can_access) AND ((opportunity_id IS NULL) OR (opportunity_id IN ( SELECT opportunity.id
   FROM app.opportunity))))));

CREATE POLICY "real_use_modify" ON app."commercial_intent" FOR UPDATE TO corridra_runtime USING (app.real_use_allowed(app."commercial_intent".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_intent".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text]))))) WITH CHECK (app.real_use_allowed(app."commercial_intent".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_intent".tenant_id))));

CREATE POLICY "real_use_read" ON app."commercial_intent" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."commercial_intent".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_intent".tenant_id))));

CREATE POLICY "real_use_add" ON app."commercial_mission_command" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."commercial_mission_command".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_mission_command".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."commercial_mission_command" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."commercial_mission_command".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_mission_command".tenant_id))));

CREATE POLICY "real_use_add" ON app."commercial_origin" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."commercial_origin".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_origin".tenant_id)) AND app.research_target_access(tenant_id, target_id, true))));

CREATE POLICY "real_use_read" ON app."commercial_origin" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."commercial_origin".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_origin".tenant_id)) AND app.research_target_access(tenant_id, target_id))));

CREATE POLICY "real_use_read" ON app."commercial_record" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."commercial_record".tenant_id) AND (((tenant_id = ( SELECT (NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid AS "nullif")) AND ( SELECT app.can_access((NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid, 'INTERNAL'::text, app.tenant_processing_purpose(app."commercial_record".tenant_id)) AS can_access) AND ((opportunity_id IS NULL) OR (opportunity_id IN ( SELECT opportunity.id
   FROM app.opportunity))))));

CREATE POLICY "real_use_add" ON app."configuration_decision" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."configuration_decision".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."configuration_decision".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."configuration_decision" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."configuration_decision".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."configuration_decision".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."configuration_proposal" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."configuration_proposal".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."configuration_proposal".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."configuration_proposal" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."configuration_proposal".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."configuration_proposal".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."contribution" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."contribution".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."contribution".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."contribution" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."contribution".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."contribution".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."corridor_definition" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."corridor_definition".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."corridor_definition".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."corridor_definition" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."corridor_definition".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."corridor_definition".tenant_id))));

CREATE POLICY "real_use_add" ON app."corridor_pack_version" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."corridor_pack_version".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."corridor_pack_version".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."corridor_pack_version" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."corridor_pack_version".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."corridor_pack_version".tenant_id))));

CREATE POLICY "real_use_add" ON app."corridor_route" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."corridor_route".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."corridor_route".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."corridor_route" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."corridor_route".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."corridor_route".tenant_id))));

CREATE POLICY "real_use_add" ON app."customer_delivery_assignment" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."customer_delivery_assignment".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."customer_delivery_assignment".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_read" ON app."customer_delivery_assignment" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."customer_delivery_assignment".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."customer_delivery_assignment".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."data_rights_policy" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."data_rights_policy".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."data_rights_policy".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."data_rights_policy" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."data_rights_policy".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."data_rights_policy".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."delivery_acceptance" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_acceptance".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_acceptance".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_acceptance" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_acceptance".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_acceptance".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_agenda" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_agenda".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_agenda".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."delivery_agenda" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_agenda".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_agenda".tenant_id)) AND (NOT (EXISTS ( SELECT
   FROM jsonb_array_elements_text((delivery_agenda.details -> 'meetingIds'::text)) mid(value)
  WHERE (NOT app.meeting_access(delivery_agenda.tenant_id, (mid.value)::uuid))))))));

CREATE POLICY "real_use_add" ON app."delivery_decision_publication" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_decision_publication".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_decision_publication".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_read" ON app."delivery_decision_publication" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_decision_publication".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_decision_publication".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_experience_publication" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_experience_publication".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_experience_publication".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."delivery_experience_publication" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_experience_publication".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_experience_publication".tenant_id)) AND (NOT (EXISTS ( SELECT
   FROM unnest(delivery_experience_publication.target_ids) tid(tid)
  WHERE (NOT app.research_target_access(delivery_experience_publication.tenant_id, tid.tid))))))));

CREATE POLICY "real_use_read" ON app."delivery_export" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_export".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_export".tenant_id))));

CREATE POLICY "real_use_read" ON app."delivery_export_artifact" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_export_artifact".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_export_artifact".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_import" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_import".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_import".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_import" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_import".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_import".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_link" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_link".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_link".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_link" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_link".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_link".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_participant" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_participant".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_participant".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_participant" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_participant".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_participant".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_participant_identity" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_participant_identity".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_participant_identity".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."delivery_participant_identity" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_participant_identity".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_participant_identity".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_programme" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_programme".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_programme".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_programme" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_programme".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_programme".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_programme_context" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_programme_context".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_programme_context".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."delivery_programme_context" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_programme_context".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_programme_context".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_publication" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_publication".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_publication".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_publication" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_publication".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_publication".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_request" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_request".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_request".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_request" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_request".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_request".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_request_close" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_request_close".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_request_close".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_request_close" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_request_close".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_request_close".tenant_id))));

CREATE POLICY "real_use_read" ON app."delivery_response" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_response".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_response".tenant_id))));

CREATE POLICY "real_use_add" ON app."delivery_revocation" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."delivery_revocation".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_revocation".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."delivery_revocation" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."delivery_revocation".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."delivery_revocation".tenant_id))));

CREATE POLICY "real_use_modify" ON app."mission" FOR UPDATE TO corridra_runtime USING (app.real_use_allowed(app."mission".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text]))))) WITH CHECK (app.real_use_allowed(app."mission".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission".tenant_id))));

CREATE POLICY "real_use_read" ON app."mission" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_assessment" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_assessment".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_assessment".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()) AND app.research_target_access(tenant_id, target_id, true))));

CREATE POLICY "real_use_read" ON app."mission_assessment" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_assessment".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_assessment".tenant_id)) AND app.research_target_access(tenant_id, target_id))));

CREATE POLICY "real_use_add" ON app."mission_command" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_command".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_command".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."mission_command" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_command".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_command".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_effort" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_effort".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_effort".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."mission_effort" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_effort".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_effort".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = mission_effort.tenant_id) AND (s.id = mission_effort.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_read" ON app."mission_ingress_command" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_ingress_command".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_ingress_command".tenant_id))));

CREATE POLICY "real_use_read" ON app."mission_intake" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_intake".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_intake".tenant_id))));

CREATE POLICY "real_use_modify" ON app."mission_market" FOR UPDATE TO corridra_runtime USING (app.real_use_allowed(app."mission_market".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_market".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text]))))) WITH CHECK (app.real_use_allowed(app."mission_market".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_market".tenant_id))));

CREATE POLICY "real_use_read" ON app."mission_market" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_market".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_market".tenant_id))));

CREATE POLICY "real_use_read" ON app."mission_objective" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_objective".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_objective".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_operations_context" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_operations_context".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_operations_context".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_operator_context" ON app."mission_operations_context" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_operations_context".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_operations_context".tenant_id)) AND (app.member_role(tenant_id) = 'operator'::text) AND (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = mission_operations_context.tenant_id) AND (s.id = mission_operations_context.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose)))))));

CREATE POLICY "real_use_read" ON app."mission_operations_context" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_operations_context".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_operations_context".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = mission_operations_context.tenant_id) AND (s.id = mission_operations_context.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_read" ON app."mission_participant" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_participant".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_participant".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_quotation" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_quotation".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_quotation".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()) AND app.research_target_access(tenant_id, target_id, true))));

CREATE POLICY "real_use_read" ON app."mission_quotation" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_quotation".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_quotation".tenant_id)) AND app.research_target_access(tenant_id, target_id))));

CREATE POLICY "real_use_add" ON app."mission_reply" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_reply".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_reply".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."mission_reply" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_reply".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_reply".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_requirements" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_requirements".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_requirements".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."mission_requirements" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_requirements".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_requirements".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_rfq" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_rfq".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_rfq".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."mission_rfq" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_rfq".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_rfq".tenant_id)) AND (NOT (EXISTS ( SELECT
   FROM unnest(mission_rfq.target_ids) t(t)
  WHERE (NOT app.research_target_access(mission_rfq.tenant_id, t.t))))))));

CREATE POLICY "real_use_add" ON app."mission_route_assignment" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_route_assignment".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_route_assignment".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."mission_route_assignment" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_route_assignment".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_route_assignment".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_schedule" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_schedule".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_schedule".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."mission_schedule" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_schedule".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_schedule".tenant_id))));

CREATE POLICY "real_use_add" ON app."mission_selection" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_selection".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_selection".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])) AND (created_by = app.actor_id()) AND app.research_target_access(tenant_id, target_id, true))));

CREATE POLICY "real_use_read" ON app."mission_selection" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_selection".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_selection".tenant_id)) AND app.research_target_access(tenant_id, target_id))));

CREATE POLICY "real_use_add" ON app."mission_type_definition" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."mission_type_definition".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_type_definition".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."mission_type_definition" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_type_definition".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_type_definition".tenant_id))));

CREATE POLICY "real_use_read" ON app."mission_window" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."mission_window".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."mission_window".tenant_id))));

CREATE POLICY "real_use_add" ON app."network_event" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."network_event".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."network_event".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."network_event" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."network_event".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."network_event".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."network_profile" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."network_profile".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."network_profile".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."network_profile" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."network_profile".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."network_profile".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."network_task" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."network_task".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."network_task".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."network_task" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."network_task".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."network_task".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'reviewer'::text])))));

CREATE POLICY "real_use_add" ON app."operations_case" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."operations_case".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."operations_case".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_operator_cases" ON app."operations_case" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."operations_case".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."operations_case".tenant_id)) AND (app.member_role(tenant_id) = 'operator'::text) AND (owner_id = app.actor_id()) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = operations_case.tenant_id) AND (s.id = operations_case.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_read" ON app."operations_case" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."operations_case".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."operations_case".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = operations_case.tenant_id) AND (s.id = operations_case.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_add" ON app."operations_command" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."operations_command".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."operations_command".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."operations_command" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."operations_command".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."operations_command".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_read" ON app."opportunity" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."opportunity".tenant_id) AND (((tenant_id = ( SELECT (NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid AS "nullif")) AND ( SELECT app.can_access((NULLIF(current_setting('corridra.tenant_id'::text, true), ''::text))::uuid, 'INTERNAL'::text, app.tenant_processing_purpose(app."opportunity".tenant_id)) AS can_access) AND (((meeting_id IS NOT NULL) AND app.meeting_access(tenant_id, meeting_id)) OR ((origin_id IS NOT NULL) AND app.research_target_access(tenant_id, target_id))))));

CREATE POLICY "real_use_read" ON app."recipient_detail_response" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."recipient_detail_response".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."recipient_detail_response".tenant_id)) AND app.buyer_link_access(tenant_id, link_id) AND (retention_until > now()))));

CREATE POLICY "real_use_add" ON app."recipient_disclosure" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."recipient_disclosure".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."recipient_disclosure".tenant_id)) AND (created_by = app.actor_id()) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."recipient_disclosure" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."recipient_disclosure".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."recipient_disclosure".tenant_id)) AND app.buyer_link_access(tenant_id, link_id))));

CREATE POLICY "real_use_add" ON app."requirement_definition" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."requirement_definition".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."requirement_definition".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND app.fresh_mfa() AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."requirement_definition" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."requirement_definition".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."requirement_definition".tenant_id))));

CREATE POLICY "real_use_add" ON app."reward_reconciliation" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."reward_reconciliation".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."reward_reconciliation".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."reward_reconciliation" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."reward_reconciliation".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."reward_reconciliation".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."reward_rule_version" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."reward_rule_version".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."reward_rule_version".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."reward_rule_version" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."reward_rule_version".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."reward_rule_version".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."route_readiness" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."route_readiness".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_readiness".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_operator_readiness" ON app."route_readiness" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."route_readiness".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_readiness".tenant_id)) AND (app.member_role(tenant_id) = 'operator'::text) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = route_readiness.tenant_id) AND (s.id = route_readiness.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_read" ON app."route_readiness" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."route_readiness".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_readiness".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = route_readiness.tenant_id) AND (s.id = route_readiness.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_add" ON app."route_release" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."route_release".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_release".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_operator_release" ON app."route_release" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."route_release".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_release".tenant_id)) AND (app.member_role(tenant_id) = 'operator'::text))));

CREATE POLICY "real_use_read" ON app."route_release" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."route_release".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."route_release".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."service_document" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."service_document".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."service_document".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."service_document" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."service_document".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."service_document".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((source_id IS NULL) OR (EXISTS ( SELECT
   FROM app.source_record s
  WHERE ((s.tenant_id = service_document.tenant_id) AND (s.id = service_document.source_id) AND app.can_access(s.tenant_id, s.classification, s.purpose))))))));

CREATE POLICY "real_use_add" ON app."service_ledger" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."service_ledger".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."service_ledger".tenant_id)) AND (created_by = app.actor_id()))));

CREATE POLICY "real_use_read" ON app."service_ledger" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."service_ledger".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."service_ledger".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE POLICY "real_use_add" ON app."target_profile" FOR INSERT TO corridra_runtime WITH CHECK (app.real_use_allowed(app."target_profile".tenant_id) AND ((app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."target_profile".tenant_id)) AND (app.member_role(tenant_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])))));

CREATE POLICY "real_use_read" ON app."target_profile" FOR SELECT TO corridra_runtime USING (app.real_use_allowed(app."target_profile".tenant_id) AND (app.can_access(tenant_id, 'INTERNAL'::text, app.tenant_processing_purpose(app."target_profile".tenant_id))));

ALTER TABLE app.mission_intake DROP CONSTRAINT mission_intake_notice_version_check;
ALTER TABLE app.mission_intake ADD CONSTRAINT mission_intake_notice_version_check CHECK((notice_version='synthetic-intake-2026-10-05-v1' AND app.tenant_is_synthetic(tenant_id)) OR (notice_version='real-intake-2026-10-21-v1' AND NOT app.tenant_is_synthetic(tenant_id)));
ALTER TABLE app.mission_intake DROP CONSTRAINT mission_intake_brief_check;
ALTER TABLE app.mission_intake ADD CONSTRAINT mission_intake_brief_check CHECK(jsonb_typeof(brief)='object' AND length(brief::text)<16000 AND ((app.tenant_is_synthetic(tenant_id) AND brief->>'email' LIKE '%@example.invalid') OR (NOT app.tenant_is_synthetic(tenant_id) AND customer_private.real_brief_valid(brief))));

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.workspaces()'::regprocedure),'UTF8')),'hex')<>'fa77020ce47f5cbcaea9e6ef5d47c2e9963f3e4318db296ab738f9dbb226fbc2' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.workspaces';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.workspaces()
 RETURNS TABLE(id uuid, name text, role text, synthetic boolean, organisation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.id,t.name,m.role,t.synthetic,NULL::uuid
 FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id
 JOIN app.tenant t ON t.id=w.tenant_id
 WHERE m.principal_id=actor AND (t.synthetic OR customer_private.real_session()) ORDER BY w.created_at,w.tenant_id;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.collaborative_workspaces()'::regprocedure),'UTF8')),'hex')<>'dcb69838ee2232696479398e94f6984abfcb01c378af2dddd39ee55c8108b613' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.collaborative_workspaces';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.collaborative_workspaces()
 RETURNS TABLE(id uuid, name text, role text, synthetic boolean, organisation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.id,t.name,access.role,t.synthetic,NULL::uuid FROM (
  SELECT m.tenant_id,m.role FROM customer.membership m WHERE m.principal_id=actor
  UNION ALL SELECT m.tenant_id,customer_private.workspace_member_role_now(m.id) FROM customer_private.workspace_member m
  WHERE m.principal_id=actor AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=m.id)
  AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=m.tenant_id AND original.principal_id=actor)
 ) access JOIN customer.workspace w ON w.tenant_id=access.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE (t.synthetic OR customer_private.real_session()) ORDER BY w.created_at,w.tenant_id;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.actor_id()'::regprocedure),'UTF8')),'hex')<>'49be2dc2e2eced204224b482d59e733b64bfe21a13e9eaa01530f58383d359bf' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.actor_id';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.actor_id()
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT p.id FROM customer_private.session_proof s
 JOIN customer_private.configuration c ON c.issuer=s.issuer AND c.synthetic
 JOIN customer_private.principal p ON p.issuer=s.issuer AND p.subject=s.subject
 WHERE s.hash=current_setting('corridra.customer_proof_hash',true)
 AND (s.data_mode='synthetic' OR customer_private.real_session()) AND s.expires_at>clock_timestamp() AND p.disabled_at IS NULL
$function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.provision_workspace(uuid,text)'::regprocedure),'UTF8')),'hex')<>'d167b3c2fad7e7de7205379fdef1a3662aa7ba51d6ae055e67e1db92bb0ae38d' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.provision_workspace';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.provision_workspace(command uuid, workspace_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id(); existing customer.provision_request%ROWTYPE;
 target uuid:=gen_random_uuid(); executor uuid; eid uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 -- Lock the admitted principal against concurrent revocation during this command.
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR workspace_name IS NULL OR workspace_name<>btrim(workspace_name)
 OR length(workspace_name) NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120 OR (workspace_name NOT LIKE 'Synthetic %' AND customer_private.synthetic_context())
 OR workspace_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'A labelled synthetic workspace and command are required' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.provision:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM customer.provision_request WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  IF existing.name<>workspace_name THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM customer.membership WHERE tenant_id=existing.tenant_id AND principal_id=actor AND role='owner') THEN
   RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501';
  END IF;
  RETURN existing.tenant_id;
 END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c
 JOIN identity.principal p ON p.id=c.executor_id AND p.kind='service' AND p.disabled_at IS NULL
 WHERE c.synthetic;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO app.tenant(id,name,synthetic) VALUES(target,workspace_name,customer_private.synthetic_context());
 INSERT INTO customer.workspace(tenant_id,created_by) VALUES(target,actor);
 INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES(target,actor,'owner');
 INSERT INTO customer.provision_request(principal_id,command_id,tenant_id,name) VALUES(actor,command,target,workspace_name);
 -- Executor is accurately a service principal. The separate customer initiator
 -- is explicit; it is never represented as a staff person or given staff access.
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.workspace.provisioned',1,'customer_workspace',target::text,1,executor,clock_timestamp(),command,command,
 jsonb_build_object('id',target,'synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor,'organisation_linked',false));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.workspace.provisioned');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
 RETURN target;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.admit_verified_subject(text)'::regprocedure),'UTF8')),'hex')<>'6ffffb16fe61af3afd54971493153dc62679b04ab4ebb826d8ed5cb88e6484c9' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.admit_verified_subject';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.admit_verified_subject(proof text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE attested customer_private.session_proof%ROWTYPE; existing customer_private.principal%ROWTYPE; admitted uuid;
 cap constant integer:=2000;
 reason text;
BEGIN
 IF proof IS NULL OR proof !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501';
 END IF;
 -- Only a fresh provider attestation written by the auth role for the pinned synthetic issuer counts.
 SELECT * INTO attested FROM customer_private.session_proof WHERE hash=proof AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer_private.configuration c WHERE c.issuer=attested.issuer AND c.synthetic) THEN
  RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501';
 END IF;
 IF attested.data_mode='real' AND (attested.verified_email_hash IS NULL OR NOT EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled AND issuer=attested.issuer)) THEN RAISE EXCEPTION 'Real admission unavailable' USING ERRCODE='42501';END IF;
 reason:=CASE WHEN attested.data_mode='real' THEN 'Owner-approved real-use admission: fresh email-verified customer identity' ELSE 'Open synthetic admission: email-verified account, owner-approved test period' END;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.open_admission',0));
 -- An existing principal is returned as is. A disabled principal is never re-enabled here and gets no request authority.
 SELECT * INTO existing FROM customer_private.principal p WHERE p.issuer=attested.issuer AND p.subject=attested.subject;
 IF FOUND THEN
  IF existing.disabled_at IS NULL THEN
   INSERT INTO customer_private.request_admission(principal_id,reason) VALUES(existing.id,reason)
   ON CONFLICT(principal_id) DO NOTHING;
  END IF;
  RETURN existing.id;
 END IF;
 -- A hard ceiling so an abusive burst of signups cannot grow the database without bound.
 IF (SELECT count(*) FROM customer_private.principal)>=cap THEN
  RAISE EXCEPTION 'Customer admission is full' USING ERRCODE='53400';
 END IF;
 INSERT INTO customer_private.principal(issuer,subject,admission_reason)
 VALUES(attested.issuer,attested.subject,reason)
 RETURNING id INTO admitted;
 INSERT INTO customer_private.request_admission(principal_id,reason) VALUES(admitted,reason);
 RETURN admitted;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.organisation_profile_role(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'1a3baf4d1e128d5f45779a605ab6d16514b012cfaa8c5b4ee06884ce1ba6c787' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.organisation_profile_role';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.organisation_profile_role(target uuid, actor uuid) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE found_role text;BEGIN
 SELECT r.role INTO found_role FROM (SELECT CASE WHEN m.role IN ('owner','admin') THEN 'writer' ELSE 'reader' END
 FROM customer.membership m JOIN customer.workspace w ON w.tenant_id=m.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE m.tenant_id=target AND m.principal_id=actor AND (t.synthetic OR customer_private.real_session())
 UNION ALL
 SELECT CASE WHEN customer_private.workspace_member_role_now(wm.id)='admin' THEN 'writer' ELSE 'reader' END FROM customer_private.workspace_member wm JOIN customer.workspace w ON w.tenant_id=wm.tenant_id JOIN app.tenant t ON t.id=w.tenant_id
 WHERE wm.tenant_id=target AND wm.principal_id=actor AND (t.synthetic OR customer_private.real_session())
 AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=wm.id)
 AND NOT EXISTS(SELECT FROM customer.membership original WHERE original.tenant_id=wm.tenant_id AND original.principal_id=actor)
 ORDER BY 1 DESC LIMIT 1) r(role);
 IF found_role IS NOT NULL THEN PERFORM set_config('corridra.customer_workspace_id',target::text,true),set_config('corridra.purpose',app.tenant_processing_purpose(target),true);END IF;RETURN found_role;END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.lock_workspace_access(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'bb7064a0b113c836f5f16c5352d500461238cffa96ada1ae4da9c4dc205c5ece' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.lock_workspace_access';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.lock_workspace_access(command uuid, target uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL THEN RAISE EXCEPTION 'Command required' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM customer_private.principal WHERE id=actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||target::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id WHERE w.tenant_id=target AND (t.synthetic OR customer_private.real_session())) THEN
  RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM customer_private.organisation_profile_role(target,actor);
 RETURN actor;
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.private_requests(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'2f77b05f963b0f3ef48e09a58b6032125b294af57f96d1005a66eb6b80f58c63' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.private_requests';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.private_requests(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.request_actor(); items jsonb; next_id uuid;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(customer_private.request_result(o.id,actor) ORDER BY o.id),'[]'::jsonb) INTO items
 FROM (SELECT r.id FROM customer_private.owned_request r WHERE r.principal_id=actor AND (after_id IS NULL OR r.id>after_id)
 AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id) ORDER BY r.id LIMIT page_size) o;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.owned_request r WHERE r.principal_id=actor AND r.id>next_id
    AND NOT EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=r.id)) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requests',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.request_result(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'64bea434e7fe43cbdf5d1ad6a8ee4a03c57c453881de2ca56b12e44146fc52c6' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer_private.request_result';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.request_result(resource uuid, actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE owned customer_private.owned_request; progress jsonb;
BEGIN
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO owned FROM customer_private.owned_request o WHERE o.id=resource AND o.principal_id=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor OR EXISTS(SELECT FROM customer_private.request_revocation r WHERE r.request_id=owned.id) THEN
  RAISE EXCEPTION 'Private request unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM app.mission_intake i WHERE i.id=owned.mission_id AND i.tenant_id=owned.mission_tenant_id AND i.retention_until>clock_timestamp()) THEN
  progress:=app.mission_receipt(owned.receipt_hash);
 END IF;
 RETURN jsonb_build_object('id',owned.id,'workspaceId',owned.workspace_id,'createdAt',owned.created_at,
 'synthetic',app.tenant_is_synthetic(owned.mission_tenant_id),'progress',progress,'available',progress IS NOT NULL);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.submit_mission(uuid,text,text,jsonb,text)'::regprocedure),'UTF8')),'hex')<>'f9ab29d78e98ea773c8a47a4f50bb21ce10a4184c7c1232faa65f94dfc9540e4' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.submit_mission';END IF;END $guard$;
CREATE OR REPLACE FUNCTION app.submit_mission(k uuid, h text, r text, b jsonb, n text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d app.intake_destination;old app.mission_intake;mid uuid:=gen_random_uuid();
BEGIN
 IF n='real-intake-2026-10-21-v1' THEN
  IF NOT customer_private.real_admission_open() OR NOT customer_private.real_session() OR NOT EXISTS(SELECT FROM customer_private.request_attestation a WHERE a.proof_hash=current_setting('corridra.customer_proof_hash',true) AND a.request_key=k AND a.payload_hash=h AND a.receipt_hash=r AND a.notice_version=n AND a.brief_digest=encode(sha256(convert_to(b::text,'UTF8')),'hex') AND NOT app.tenant_is_synthetic(a.workspace_id)) THEN RAISE EXCEPTION 'Verified private request attestation required' USING ERRCODE='42501';END IF;
  SELECT true,intake_tenant_id,executor_id,owner_id,enabled,notice_version INTO d FROM customer_private.real_use_configuration WHERE enabled;
  IF NOT app.real_use_allowed(d.tenant_id) OR NOT customer_private.real_brief_valid(b) THEN RAISE EXCEPTION 'Real intake unavailable or invalid' USING ERRCODE='23514';END IF;
  PERFORM set_config('corridra.purpose','commercial_qualification',true);
 ELSE
  SELECT * INTO d FROM app.intake_destination WHERE singleton AND enabled;
 END IF;
 IF d.tenant_id IS NULL OR NOT EXISTS(SELECT FROM app.tenant WHERE id=d.tenant_id AND (synthetic OR (n='real-intake-2026-10-21-v1' AND app.real_use_allowed(d.tenant_id)))) OR NOT EXISTS(SELECT FROM identity.principal WHERE id=d.service_id AND kind='service' AND disabled_at IS NULL) THEN RAISE EXCEPTION 'Intake unavailable' USING ERRCODE='42501'; END IF;
 IF h IS NULL OR r IS NULL OR n IS NULL OR b IS NULL OR h !~ '^[a-f0-9]{64}$' OR r !~ '^[a-f0-9]{64}$' OR n<>d.notice_version OR NOT (b ?& ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','outcomes','notes','name','company','email','acknowledged']) OR b->>'acknowledged'<>'true' OR (b->>'email' NOT LIKE '%@example.invalid' AND n<>'real-intake-2026-10-21-v1') OR length(b::text)>16000 OR length(b->>'offer') NOT BETWEEN 10 AND 2000 OR length(b->>'market') NOT BETWEEN 2 AND 120 OR length(b->>'name') NOT BETWEEN 2 AND 120 OR length(b->>'company') NOT BETWEEN 2 AND 160 OR length(b->>'email')>254 OR length(b->>'notes')>1000 OR (b->>'website'<>'' AND b->>'website' !~ '^https?://') OR jsonb_typeof(b->'outcomes')<>'array' THEN RAISE EXCEPTION 'Invalid intake' USING ERRCODE='23514'; END IF;
 IF b->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR EXISTS(SELECT FROM jsonb_each(b) v WHERE v.key=ANY(ARRAY['objective','market','attendance','startDate','endDate','timezone','offer','website','notes','name','company','email']) AND jsonb_typeof(v.value)<>'string') OR jsonb_array_length(b->'outcomes') NOT BETWEEN 1 AND 7 OR EXISTS(SELECT FROM jsonb_array_elements_text(b->'outcomes') o WHERE o.value NOT IN ('Relevant meetings','Buyers / customers','Distributor conversations','Supplier visits','Market validation','Local commercial intelligence','Something else')) OR b->>'objective' NOT IN ('Sell in a new market','Find customers or distributors','Source suppliers','Make an upcoming business trip more productive','Run a multi-company mission','Something else') OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=b->>'timezone') THEN RAISE EXCEPTION 'Invalid intake structure' USING ERRCODE='23514'; END IF;
 -- Serialize duplicate detection across instances and different retry keys.
 PERFORM pg_advisory_xact_lock(hashtext('corridra:intake'));
 SELECT * INTO old FROM app.mission_intake WHERE request_key=k;
 IF old.id IS NOT NULL THEN
  IF old.payload_hash<>h OR old.receipt_hash<>r THEN RAISE EXCEPTION 'Retry key reused' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('id',old.id,'duplicate',true);
 END IF;
 IF EXISTS(SELECT FROM app.mission_intake WHERE payload_hash=h AND created_at>now()-interval '24 hours') THEN RETURN jsonb_build_object('duplicate',true); END IF;
 PERFORM set_config('corridra.correlation_id',gen_random_uuid()::text,true),set_config('corridra.causation_id',k::text,true);
 INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES(mid,d.tenant_id,d.owner_id,'Review submitted brief',now()+interval '1 day',CASE WHEN n='real-intake-2026-10-21-v1' THEN 'Private customer request received' ELSE 'Public test intake received' END,d.service_id);
 INSERT INTO app.mission_intake(id,tenant_id,request_key,payload_hash,receipt_hash,brief,notice_version) VALUES(mid,d.tenant_id,k,h,r,b,n);
 INSERT INTO app.mission_objective(tenant_id,mission_id,objective,outcomes) VALUES(d.tenant_id,mid,b->>'objective',b->'outcomes');
 INSERT INTO app.mission_participant(tenant_id,mission_id,name,company,email) VALUES(d.tenant_id,mid,b->>'name',b->>'company',b->>'email');
 INSERT INTO app.mission_market(tenant_id,mission_id,original_text) VALUES(d.tenant_id,mid,b->>'market');
 INSERT INTO app.mission_window(tenant_id,mission_id,attendance,start_date,end_date,timezone) VALUES(d.tenant_id,mid,b->>'attendance',NULLIF(b->>'startDate','')::date,NULLIF(b->>'endDate','')::date,b->>'timezone');
 INSERT INTO app.commercial_intent(tenant_id,mission_id,original_text) VALUES(d.tenant_id,mid,b->>'offer');
 RETURN jsonb_build_object('id',mid,'duplicate',false);
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.submit_private_request(uuid,uuid,jsonb)'::regprocedure),'UTF8')),'hex')<>'7f975719b7a3d1720939c76100e0b957efe1dc9beacb9ed071730f2656f913e7' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.submit_private_request';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.submit_private_request(command uuid, target uuid, b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.request_actor(); old jsonb; plan customer_private.request_attestation;
 result jsonb; intake app.mission_intake; resource uuid:=gen_random_uuid(); executor uuid; eid uuid:=gen_random_uuid();
BEGIN
 IF command IS NULL OR target IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Request context required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.request.command:'||actor::text||':'||command::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||target::text,0));
 PERFORM pg_advisory_xact_lock(hashtext('corridra:intake'));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 old:=customer.request_retry(command,target,b);
 IF old IS NOT NULL THEN RETURN old; END IF;
 IF NOT EXISTS(SELECT FROM customer.collaborative_workspaces() w WHERE w.id=target) THEN
  RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO plan FROM customer_private.request_attestation a
 WHERE a.proof_hash=current_setting('corridra.customer_proof_hash',true) AND a.command_id=command
 AND a.workspace_id=target AND a.brief_digest=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'Submission attestation required' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id
 WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 -- No identity/session impersonation: the original intake service executes this command.
 result:=app.submit_mission(plan.request_key,plan.payload_hash,plan.receipt_hash,b,plan.notice_version);
 IF result->>'id' IS NULL THEN RAISE EXCEPTION 'Duplicate brief has no private ownership grant' USING ERRCODE='23514'; END IF;
 SELECT * INTO intake FROM app.mission_intake i WHERE i.id=(result->>'id')::uuid
 AND i.request_key=plan.request_key AND i.receipt_hash=plan.receipt_hash AND i.brief=b;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical request binding mismatch' USING ERRCODE='42501'; END IF;
 -- Never adopt a previously created anonymous/other request, even with a forged plan.
 IF (result->>'duplicate')::boolean THEN RAISE EXCEPTION 'Canonical request is already owned or external' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501'; END IF;
 INSERT INTO customer_private.owned_request(id,principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
 VALUES(resource,actor,command,target,intake.tenant_id,intake.id,plan.request_key,plan.brief_digest,plan.receipt_hash);
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.request.bound',1,'customer_private_request',resource::text,1,executor,clock_timestamp(),command,command,
 jsonb_build_object('id',resource,'synthetic',app.tenant_is_synthetic(target),'initiator_kind','customer','initiator_id',actor,'scope','receipt_progress_only'));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.request.bound');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
 RETURN customer_private.request_result(resource,actor);
END $function$
;


CREATE TABLE customer_private.personal_workspace (
 principal_id uuid PRIMARY KEY REFERENCES customer_private.principal(id),
 workspace_id uuid NOT NULL UNIQUE REFERENCES customer.workspace(tenant_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE customer_private.personal_workspace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.personal_workspace FROM PUBLIC,corridra_runtime,corridra_auth;
CREATE TRIGGER personal_workspace_immutable BEFORE UPDATE OR DELETE ON customer_private.personal_workspace FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE FUNCTION customer.personal_workspace(command uuid, workspace_name text) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor();target uuid;
BEGIN
 IF NOT customer_private.real_session() THEN RAISE EXCEPTION 'Real customer identity required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.personal.workspace:'||actor::text,0));
 SELECT workspace_id INTO target FROM customer_private.personal_workspace WHERE principal_id=actor;
 IF target IS NULL THEN
  PERFORM set_config('corridra.customer_workspace_id','',true);
  target:=customer.provision_workspace(command,workspace_name);
  INSERT INTO customer_private.personal_workspace(principal_id,workspace_id) VALUES(actor,target);
 END IF;
 IF customer_private.organisation_profile_role(target,actor) IS DISTINCT FROM 'writer' OR app.tenant_is_synthetic(target) THEN RAISE EXCEPTION 'Personal workspace unavailable' USING ERRCODE='42501';END IF;
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION customer.personal_workspace(uuid,text) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.personal_workspace(uuid,text) TO corridra_runtime;
CREATE FUNCTION customer.workspace_mode(target uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF customer_private.organisation_profile_role(target,customer.actor_id()) IS NULL THEN RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';END IF;
 RETURN app.tenant_is_synthetic(target);
END $$;
REVOKE ALL ON FUNCTION customer.workspace_mode(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.workspace_mode(uuid) TO corridra_runtime;
