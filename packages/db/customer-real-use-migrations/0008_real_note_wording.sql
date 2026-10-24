-- Real wording for two system-written notes. A real workspace's records must not be labelled "Synthetic".
-- customer.programme_bulk_fees_record wrote the ledger line "Synthetic participant fee from fee schedule version N" and
-- customer.programme_template_apply wrote the capacity reason "Synthetic capacity from a programme template", for every
-- workspace. Ledger and capacity history is immutable, so a real record would carry the word for ever. Sample workspaces
-- keep the exact old text; real workspaces get the same sentence without the word. Nothing else in either function changes.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_bulk_fees_record(uuid,uuid,uuid,integer,jsonb)'::regprocedure),'UTF8')),'hex')<>'421336b7acd900d9d56008a8ac06d74569bb340fdd1c48db3aa93253382d1a8e' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_bulk_fees_record'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_bulk_fees_record(command uuid, target uuid, programme uuid, expected integer, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;prior customer_private.pricing_command;sig jsonb;day date;computed jsonb;result jsonb;batch uuid;line jsonb;seqno integer;entry uuid;lines jsonb:='[]'::jsonb;total numeric;cur text;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<1 THEN RAISE EXCEPTION 'Invalid fee batch' USING ERRCODE='23514'; END IF;
 day:=customer_private.pricing_bulk_input(input);
 actor:=customer_private.pricing_scope(command,target,programme);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_pricing:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.pricing_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'bulk' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 computed:=customer_private.pricing_compute(target,programme,expected,day,input->'rows');
 cur:=computed->>'currency';total:=(computed#>>'{perCurrency,0,totalMinor}')::numeric;
 INSERT INTO customer_private.programme_fee_batch(workspace_id,programme_id,schedule_version,fee_date,group_size,row_count,currency,total_minor,created_by)
 VALUES(target,programme,expected,day,(computed->>'groupSize')::integer,(computed->>'rowCount')::integer,cur,total,actor) RETURNING id INTO batch;
 SELECT coalesce(max(seq),0) INTO seqno FROM customer_private.programme_ledger_entry WHERE programme_id=programme;
 FOR line IN SELECT * FROM jsonb_array_elements(computed->'rows') LOOP
  seqno:=seqno+1;
  INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,registration_id,amount_minor,currency,occurred_on,description,reverse_of,recorded_by)
  VALUES(target,programme,seqno,'PARTICIPANT_FEE',NULL,(line->>'registrationId')::uuid,(line->>'amountMinor')::bigint,cur,day,CASE WHEN app.tenant_is_synthetic(target) THEN 'Synthetic participant fee from fee schedule version ' ELSE 'Participant fee from fee schedule version ' END||expected,NULL,actor)
  RETURNING id INTO entry;
  INSERT INTO customer_private.programme_fee_batch_line(batch_id,registration_id,entry_id,tier,base_minor,early_bird_minor,group_minor,amount_minor)
  VALUES(batch,(line->>'registrationId')::uuid,entry,line->>'tier',(line->>'baseMinor')::bigint,(line->>'earlyBirdMinor')::bigint,(line->>'groupMinor')::bigint,(line->>'amountMinor')::bigint);
  lines:=lines||jsonb_build_array(line||jsonb_build_object('entrySeq',seqno));
 END LOOP;
 result:=(computed-'rows')||jsonb_build_object('batchId',batch,'rows',lines);
 INSERT INTO customer_private.pricing_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'bulk',sig,result);
 PERFORM customer_private.pricing_event(target,actor,command,'programme_pricing',programme,'fees_recorded',jsonb_build_object('programmeId',programme,'batchId',batch,'scheduleVersion',expected,'entries',(computed->>'rowCount')::integer));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $function$
;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_template_apply(uuid,uuid,uuid,integer,jsonb)'::regprocedure),'UTF8')),'hex')<>'14265385c188d314f03cfbc604b550398551a0ac232a0b5457f51d24bddcc4d4' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: customer.programme_template_apply'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_template_apply(command uuid, target uuid, programme uuid, expected integer, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;prior customer_private.programme_template_command;sig jsonb;tid uuid;cur integer;rev customer_private.programme_template_revision;starts_on date;
 t jsonb;k jsonb;tseq integer:=0;lseq integer;new_task uuid;result jsonb;ntasks integer;ncosts integer;cap integer;day date;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR target IS NULL OR programme IS NULL OR expected IS NULL OR expected<1 OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'Invalid application' USING ERRCODE='23514'; END IF;
 IF input-ARRAY['templateId','startDate']<>'{}'::jsonb OR NOT(input ?& ARRAY['templateId','startDate']) OR jsonb_typeof(input->'templateId')<>'string' THEN RAISE EXCEPTION 'Invalid application' USING ERRCODE='23514'; END IF;
 tid:=(input->>'templateId')::uuid;
 starts_on:=customer_private.coordination_date(input->'startDate',false);
 actor:=customer_private.participant_scope(command,target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_template:'||target::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'expected',expected,'input',input);
 SELECT * INTO prior FROM customer_private.programme_template_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.operation<>'apply' OR prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',true,'expiresAt',customer_private.coordination_expiry());
 END IF;
 IF NOT EXISTS(SELECT FROM customer_private.programme_template WHERE id=tid AND workspace_id=target) THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
 SELECT max(version) INTO cur FROM customer_private.programme_template_revision WHERE template_id=tid;
 IF cur<>expected THEN RAISE EXCEPTION 'Template changed; reload before applying' USING ERRCODE='23514'; END IF;
 SELECT * INTO rev FROM customer_private.programme_template_revision WHERE template_id=tid AND version=cur;
 IF rev.retired THEN RAISE EXCEPTION 'A retired template cannot be applied' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM customer_private.programme_template_application WHERE programme_id=programme)
  OR EXISTS(SELECT FROM customer_private.programme_task WHERE programme_id=programme)
  OR EXISTS(SELECT FROM customer_private.programme_capacity_revision WHERE programme_id=programme)
  OR EXISTS(SELECT FROM customer_private.programme_ledger_entry WHERE programme_id=programme) THEN
  RAISE EXCEPTION 'A template can only be applied to an empty programme' USING ERRCODE='23514';
 END IF;
 ntasks:=jsonb_array_length(rev.content->'tasks');ncosts:=jsonb_array_length(rev.content->'plannedCosts');
 cap:=CASE WHEN jsonb_typeof(rev.content->'capacity')='number' THEN (rev.content->>'capacity')::integer END;
 IF cap IS NOT NULL THEN
  INSERT INTO customer_private.programme_capacity_revision(programme_id,workspace_id,version,capacity,reason,set_by) VALUES(programme,target,1,cap,CASE WHEN app.tenant_is_synthetic(target) THEN 'Synthetic capacity from a programme template' ELSE 'Capacity from a programme template' END,actor);
 END IF;
 FOR t IN SELECT * FROM jsonb_array_elements(rev.content->'tasks') LOOP
  tseq:=tseq+1;
  INSERT INTO customer_private.programme_task(workspace_id,programme_id,seq,created_by) VALUES(target,programme,tseq,actor) RETURNING id INTO new_task;
  day:=CASE WHEN starts_on IS NOT NULL AND jsonb_typeof(t->'dueOffsetDays')='number' THEN starts_on+(t->>'dueOffsetDays')::integer END;
  IF day IS NOT NULL AND day>DATE '2100-01-01' THEN RAISE EXCEPTION 'A due date falls outside the supported range' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_private.programme_task_revision(task_id,workspace_id,programme_id,version,title,detail,status,due_on,assignee_label,changed_by)
  VALUES(new_task,target,programme,1,t->>'title',t->>'detail','OPEN',day,t->>'assigneeLabel',actor);
 END LOOP;
 lseq:=0;
 FOR k IN SELECT * FROM jsonb_array_elements(rev.content->'plannedCosts') LOOP
  lseq:=lseq+1;
  INSERT INTO customer_private.programme_ledger_entry(workspace_id,programme_id,seq,kind,cost_basis,registration_id,amount_minor,currency,occurred_on,description,reverse_of,recorded_by)
  VALUES(target,programme,lseq,k->>'kind','PLANNED',NULL,(k->>'amountMinor')::bigint,k->>'currency',coalesce(starts_on,current_date),k->>'description',NULL,actor);
 END LOOP;
 INSERT INTO customer_private.programme_template_application(workspace_id,programme_id,template_id,template_version,start_date,task_count,cost_count,capacity,applied_by)
 VALUES(target,programme,tid,cur,starts_on,ntasks,ncosts,cap,actor);
 result:=jsonb_build_object('templateId',tid,'templateVersion',cur,'tasksCreated',ntasks,'plannedCostsCreated',ncosts,'capacity',to_jsonb(cap),'startDate',to_char(starts_on,'YYYY-MM-DD'));
 INSERT INTO customer_private.programme_template_command(actor_id,command_id,workspace_id,operation,request,result) VALUES(actor,command,target,'apply',sig,result);
 PERFORM customer_private.template_event(target,actor,command,programme,'applied',jsonb_build_object('templateId',tid,'version',cur,'programmeId',programme,'tasks',ntasks,'plannedCosts',ncosts));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Template access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('workspaceId',target,'programmeId',programme,'commandId',command,'replayed',false,'expiresAt',customer_private.coordination_expiry());
END $function$
;

