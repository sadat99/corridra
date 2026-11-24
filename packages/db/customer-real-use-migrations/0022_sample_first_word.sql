-- B7b (owner, 23 November 2026: nothing a customer reads may say Synthetic). Sample workspaces may start their free
-- text with "Sample " as well as "Synthetic ". Before this, every check below refused sample text unless it began
-- "Synthetic ". "Synthetic " stays accepted, so every existing row and every caller that still sends it keeps working.
-- A real workspace is not affected: its branch of each check (NOT customer_private.synthetic_context()) is unchanged.
-- The minimum length of sample text stays 11.
--
-- What changes: the one comparison  x LIKE 'Synthetic %'  becomes  x ~ '^(Synthetic|Sample) '  in
--   seven functions last defined by this module (named below, each guarded by the SHA-256 of its current definition
--   and by the exact number of comparisons it holds), and
--   twenty-seven CHECK constraints of customer_private (named below, each must hold exactly one such comparison).
-- Nothing else in those definitions is touched: owner, grants, SECURITY DEFINER and search_path are kept by
-- CREATE OR REPLACE, and each constraint keeps its name.
--
-- No row is read, rewritten or deleted. The constraints are re-added NOT VALID: new and changed rows are checked
-- exactly as before, existing rows are not re-read. That matters because these checks ask
-- customer_private.synthetic_context(), which answers "sample" inside the installer's own session, so a validating
-- re-add would wrongly test real workspaces' rows against the sample rule. No user, identity, principal, sign-in row,
-- membership, workspace or customer account is renamed, closed or removed.
--
-- Not covered here, on purpose: what a later module owns or fingerprints (the workspace name and the workspace
-- invitation command, the participant invitation label and display label with their two CHECK constraints, public
-- programme page text, billing notes). Changing them here would make that module refuse to install on a fresh
-- database. They are covered by customer-workspace-lifecycle-migrations/0010_sample_first_word_late.sql, which the
-- installer runs after this module and repeats on every run.
--
-- Rollback (additive, nothing to restore): run this file's two loops with the replacement reversed, that is
--   replace(def, '~ ''^(Synthetic|Sample) ''', '~~ ''Synthetic %''') for the constraints (again NOT VALID) and
--   '!~ ''^(Synthetic|Sample) ''' -> 'NOT LIKE ''Synthetic %''', '~ ''^(Synthetic|Sample) ''' -> 'LIKE ''Synthetic %'''
-- for the functions, as a new numbered migration. Rows written with "Sample " meanwhile stay as they are; a NOT VALID
-- constraint does not re-read them. Do not edit or delete this file once applied (the installer checks its hash).
DO $sample$
DECLARE
 item text[];
 original text;
 updated text;
 found integer;
 old_like constant text:='LIKE ''Synthetic %''';
 old_not_like constant text:='NOT LIKE ''Synthetic %''';
 new_match constant text:='~ ''^(Synthetic|Sample) ''';
 new_not_match constant text:='!~ ''^(Synthetic|Sample) ''';
 old_check constant text:='~~ ''Synthetic %''::text';
 new_check constant text:='~ ''^(Synthetic|Sample) ''::text';
 relation regclass;
BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
  ['customer.organisation_link_command(uuid,text,jsonb)','fce0c8614198d4df0dc80b6698feaf66fe5b794e9ae722b1c51e7ede579ba76d','2'],
  ['customer.programme_context_command(uuid,uuid,uuid,integer,jsonb,boolean)','62441853b83c053b9965dcd84028bd0700174ef496e64eaa970240fc0995581f','2'],
  ['customer.programme_mission_command(uuid,text,jsonb)','9f612118fb244845eff013cb9a154ef77efcf3b4fc2c8f86941f2d2b228ee99d','1'],
  ['customer_private.coordination_text(jsonb,integer,integer,boolean)','ef3fd0043bd86d72a0e45bf05ff0bbcc765269e3954e03c784d51504493897d5','1'],
  ['customer_private.mission_draft_valid(jsonb,uuid)','67fa319bf4fbfde6a7506464c0f5859ef43538537619a5cf4b0feb42f517539d','5'],
  ['customer_private.organisation_profile_valid(jsonb)','b21692ad6a25d99273c856f1fa93a4a706aeaef5f889288176f86f1c091bbf60','2'],
  ['customer_private.service_synthetic_ok(text,integer)','ac7ece045a59f182ad69d62e75cecfe0853db93085f0033f16ae39bf483d9ffa','1']
 ] LOOP
  original:=pg_get_functiondef(item[1]::regprocedure);
  IF encode(sha256(convert_to(original,'UTF8')),'hex')<>item[2] THEN
   RAISE EXCEPTION 'Sample first word prerequisite function differs: %',item[1];
  END IF;
  found:=(length(original)-length(replace(original,old_like,'')))/length(old_like);
  IF found<>item[3]::integer THEN RAISE EXCEPTION 'Sample first word comparison count differs: %',item[1]; END IF;
  updated:=replace(replace(original,old_not_like,new_not_match),old_like,new_match);
  IF position('Synthetic %' IN updated)>0
  OR (length(updated)-length(replace(updated,'''^(Synthetic|Sample) ''','')))/length('''^(Synthetic|Sample) ''')<>found THEN
   RAISE EXCEPTION 'Sample first word replacement differs: %',item[1];
  END IF;
  EXECUTE updated;
 END LOOP;

 FOREACH item SLICE 1 IN ARRAY ARRAY[
  ['customer_private.organisation_link_claim','organisation_link_claim_note_check'],
  ['customer_private.organisation_link_evidence','organisation_link_evidence_statement_check'],
  ['customer_private.pricing_template_revision','pricing_template_revision_description_check'],
  ['customer_private.pricing_template_revision','pricing_template_revision_name_check'],
  ['customer_private.programme_capacity_revision','programme_capacity_revision_reason_check'],
  ['customer_private.programme_eligibility_revision','programme_eligibility_revision_reason_check'],
  ['customer_private.programme_ledger_entry','programme_ledger_entry_description_check'],
  ['customer_private.programme_mission_revision','programme_mission_revision_check'],
  ['customer_private.programme_participant_record_revision','programme_participant_record_revision_note_check'],
  ['customer_private.programme_payment_decision','programme_payment_decision_reason_check'],
  ['customer_private.programme_payment_declaration','programme_payment_declaration_note_check'],
  ['customer_private.programme_payment_declaration','programme_payment_declaration_payer_reference_check'],
  ['customer_private.programme_places_revision','programme_places_revision_reason_check'],
  ['customer_private.programme_series_revision','programme_series_revision_description_check'],
  ['customer_private.programme_series_revision','programme_series_revision_name_check'],
  ['customer_private.programme_task_revision','programme_task_revision_assignee_label_check'],
  ['customer_private.programme_task_revision','programme_task_revision_detail_check'],
  ['customer_private.programme_task_revision','programme_task_revision_title_check'],
  ['customer_private.programme_template_revision','programme_template_revision_description_check'],
  ['customer_private.programme_template_revision','programme_template_revision_name_check'],
  ['customer_private.programme_terms_revision','programme_terms_revision_cancellation_terms_check'],
  ['customer_private.programme_terms_revision','programme_terms_revision_change_terms_check'],
  ['customer_private.programme_terms_revision','programme_terms_revision_excluded_check'],
  ['customer_private.programme_terms_revision','programme_terms_revision_fee_note_check'],
  ['customer_private.programme_terms_revision','programme_terms_revision_included_check'],
  ['customer_private.programme_terms_revision','programme_terms_revision_reason_check'],
  ['customer_private.workspace_invitation','workspace_invitation_label_check']
 ] LOOP
  relation:=item[1]::regclass;
  SELECT pg_get_constraintdef(c.oid) INTO original FROM pg_constraint c
  WHERE c.conrelid=relation AND c.conname=item[2] AND c.contype='c';
  IF original IS NULL THEN RAISE EXCEPTION 'Sample first word constraint is missing: %.%',item[1],item[2]; END IF;
  IF (length(original)-length(replace(original,old_check,'')))/length(old_check)<>1 THEN
   RAISE EXCEPTION 'Sample first word constraint differs: %.%',item[1],item[2];
  END IF;
  updated:=replace(original,old_check,new_check);
  IF position('Synthetic %' IN updated)>0 THEN
   RAISE EXCEPTION 'Sample first word constraint replacement differs: %.%',item[1],item[2];
  END IF;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',relation,item[2]);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID',relation,item[2],updated);
 END LOOP;
END $sample$;
