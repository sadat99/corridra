-- Optional participant label correction (CRUD gap G7, module 2): the display label a participant gave on accepting an invitation can be
-- corrected, by the participant for their own label or by a workspace owner or admin. Overlay only: customer_private.programme_registration
-- is never rewritten and consent (consented_at) is untouched. Each correction is one append-only, versioned revision; readers of the label
-- read customer_private.programme_registration_current, each behind a hash guard of the definition it replaces (needs the programme
-- lifecycle module installed first, because that module already replaced one of these readers).
CREATE TABLE customer_private.programme_registration_label_revision (
 registration_id uuid NOT NULL REFERENCES customer_private.programme_registration(id),
 workspace_id uuid NOT NULL,programme_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 display_label text NOT NULL CHECK(display_label=btrim(display_label) AND length(display_label) BETWEEN 2 AND 120 AND display_label !~ '[[:cntrl:]]'),
 changed_by uuid NOT NULL REFERENCES customer_private.principal(id),
 changed_by_role text NOT NULL CHECK(changed_by_role IN ('participant','organiser')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(registration_id,version),
 FOREIGN KEY(workspace_id,programme_id) REFERENCES app.delivery_programme(tenant_id,id)
);
CREATE TABLE customer_private.programme_registration_label_command (
 actor_id uuid NOT NULL REFERENCES customer_private.principal(id),command_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES customer.workspace(tenant_id),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER programme_registration_label_revision_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_registration_label_revision FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_registration_label_command_immutable BEFORE UPDATE OR DELETE ON customer_private.programme_registration_label_command FOR EACH ROW EXECUTE FUNCTION app.reject_rewrite();
CREATE TRIGGER programme_registration_label_revision_order BEFORE INSERT ON customer_private.programme_registration_label_revision FOR EACH ROW EXECUTE FUNCTION customer_private.coordination_version_guard('registration_id');
ALTER TABLE customer_private.programme_registration_label_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_private.programme_registration_label_command ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_private.programme_registration_label_revision,customer_private.programme_registration_label_command FROM PUBLIC,corridra_runtime,corridra_auth;

-- Same columns as the registration, with the label that is current; label_version is 0 until a correction is made.
CREATE VIEW customer_private.programme_registration_current AS
 SELECT r.id,r.workspace_id,r.programme_id,r.invitation_id,r.principal_id,coalesce(l.display_label,r.display_label) AS display_label,r.consented_at,coalesce(l.version,0) AS label_version
 FROM customer_private.programme_registration r
 LEFT JOIN LATERAL(SELECT x.display_label,x.version FROM customer_private.programme_registration_label_revision x WHERE x.registration_id=r.id ORDER BY x.version DESC LIMIT 1) l ON true;
REVOKE ALL ON customer_private.programme_registration_current FROM PUBLIC,corridra_runtime,corridra_auth;

CREATE FUNCTION customer_private.programme_label_event(target uuid,actor uuid,command uuid,aggregate uuid,detail jsonb) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE executor uuid;eid uuid:=gen_random_uuid();v integer;
BEGIN
 IF actor IS NULL OR customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 SELECT c.executor_id INTO executor FROM customer_private.configuration c JOIN identity.principal p ON p.id=c.executor_id WHERE c.synthetic AND p.kind='service' AND p.disabled_at IS NULL;
 IF executor IS NULL THEN RAISE EXCEPTION 'Customer authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(e.aggregate_version),0)+1 INTO v FROM app.domain_event e WHERE e.tenant_id=target AND e.aggregate_type='customer_programme_registration' AND e.aggregate_id=aggregate::text;
 INSERT INTO app.domain_event(id,tenant_id,type,schema_version,aggregate_type,aggregate_id,aggregate_version,actor_id,occurred_at,correlation_id,causation_id,payload)
 VALUES(eid,target,'customer.programme.label',1,'customer_programme_registration',aggregate::text,v,executor,clock_timestamp(),command,command,
 detail||jsonb_build_object('kind','label','synthetic',customer_private.synthetic_context(),'initiator_kind','customer','initiator_id',actor));
 INSERT INTO app.audit_event(id,tenant_id,domain_event_id,actor_id,action) VALUES(gen_random_uuid(),target,eid,executor,'customer.programme.label');
 INSERT INTO app.outbox(id,tenant_id,event_id) VALUES(gen_random_uuid(),target,eid);
 INSERT INTO app.outbox_delivery(event_id,tenant_id) VALUES(eid,target);
END $$;

-- Correct a participant's display label. The participant corrects their own; otherwise the caller must be an owner or admin of the
-- workspace. A command id makes a retry return the first answer; expected is the label version the person saw (0 before any correction)
-- and a stale value is refused. A withdrawn or revoked registration cannot be changed. The audit event carries the old and new label,
-- who changed it (participant or organiser) and nothing else about the person; consent is never changed.
CREATE FUNCTION customer.programme_registration_label(command uuid,registration uuid,expected integer,new_label text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;target uuid;programme uuid;reg customer_private.programme_registration;mine boolean;role text;prior customer_private.programme_registration_label_command;sig jsonb;cur customer_private.programme_registration_current;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR registration IS NULL OR expected IS NULL OR expected<0 OR expected>100000 OR new_label IS NULL
  OR length(new_label) NOT BETWEEN (CASE WHEN customer_private.synthetic_context() THEN 11 ELSE 2 END) AND 120
  OR (new_label NOT LIKE 'Synthetic %' AND customer_private.synthetic_context()) OR new_label<>btrim(new_label) OR new_label ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Invalid participant label' USING ERRCODE='23514';
 END IF;
 SELECT * INTO reg FROM customer_private.programme_registration r WHERE r.id=registration;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 target:=reg.workspace_id;programme:=reg.programme_id;
 mine:=reg.principal_id=customer.actor_id();
 role:=CASE WHEN mine THEN 'participant' ELSE 'organiser' END;
 actor:=customer_private.participant_scope(command,target,programme,NOT mine);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_label:'||registration::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant access expired' USING ERRCODE='42501'; END IF;
 sig:=jsonb_build_object('workspaceId',target,'programmeId',programme,'registrationId',registration,'expected',expected,'displayLabel',new_label);
 SELECT * INTO prior FROM customer_private.programme_registration_label_command WHERE actor_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM sig THEN RAISE EXCEPTION 'Command conflicts with original request' USING ERRCODE='23514'; END IF;
  RETURN prior.result||jsonb_build_object('commandId',command,'replayed',true);
 END IF;
 IF EXISTS(SELECT FROM customer_private.programme_participant_revocation v WHERE v.registration_id=registration) THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO cur FROM customer_private.programme_registration_current c WHERE c.id=registration;
 IF cur.label_version<>expected THEN RAISE EXCEPTION 'Label changed; reload before saving' USING ERRCODE='23514'; END IF;
 IF cur.display_label=new_label THEN RAISE EXCEPTION 'Nothing changed' USING ERRCODE='23514'; END IF;
 INSERT INTO customer_private.programme_registration_label_revision(registration_id,workspace_id,programme_id,version,display_label,changed_by,changed_by_role)
 VALUES(registration,target,programme,cur.label_version+1,new_label,actor,role);
 PERFORM customer_private.programme_label_event(target,actor,command,registration,jsonb_build_object('programmeId',programme,'registrationId',registration,'version',cur.label_version+1,
  'changedBy',role,'before',jsonb_build_object('displayLabel',cur.display_label),'after',jsonb_build_object('displayLabel',new_label)));
 result:=jsonb_build_object('registrationId',registration,'programmeId',programme,'displayLabel',new_label,'labelVersion',cur.label_version+1,'changedBy',role,'synthetic',customer_private.synthetic_context());
 INSERT INTO customer_private.programme_registration_label_command(actor_id,command_id,workspace_id,request,result) VALUES(actor,command,target,sig,result);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant access expired' USING ERRCODE='42501'; END IF;
 RETURN result||jsonb_build_object('commandId',command,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION customer_private.programme_label_event(uuid,uuid,uuid,uuid,jsonb),customer.programme_registration_label(uuid,uuid,integer,text) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_registration_label(uuid,uuid,integer,text) TO corridra_runtime;

-- Readers of the label. Each first checks that the installed function is exactly the definition it replaces.

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.own_programme_registrations(uuid,integer)'::regprocedure),'UTF8')),'hex')<>'6318e19c966237416e8b48f9af1b0beb381b38bb5349267c9da21494a969111b' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer.own_programme_registrations';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.own_programme_registrations(after_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer.actor_id();items jsonb;next_id uuid;selected uuid[];work uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid participant page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO selected FROM (SELECT id FROM customer_private.programme_registration_current WHERE principal_id=actor AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_size) page;
 FOR work IN SELECT DISTINCT workspace_id FROM customer_private.programme_registration_current WHERE id=ANY(selected) ORDER BY workspace_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||work::text,0));
  IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'programmeId',r.programme_id,'status',coalesce(v.status,'REGISTERED'),'synthetic',customer_private.synthetic_context())||
 CASE WHEN v.status IS NULL THEN jsonb_build_object('name',p.name,'reportingPurpose',p.reporting_purpose,'displayLabel',r.display_label,'labelVersion',r.label_version,'consentedAt',r.consented_at) ELSE '{}'::jsonb END ORDER BY r.id),'[]'::jsonb)
 INTO items FROM (SELECT * FROM customer_private.programme_registration_current WHERE principal_id=actor AND id=ANY(selected)) r
 JOIN customer_private.programme_current p ON p.tenant_id=r.workspace_id AND p.id=r.programme_id
 JOIN app.tenant t ON t.id=r.workspace_id AND (t.synthetic OR customer_private.real_session())
 LEFT JOIN LATERAL(SELECT CASE WHEN withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END status FROM customer_private.programme_participant_revocation WHERE registration_id=r.id) v ON true;
 IF jsonb_array_length(items)=page_size THEN
  next_id:=(items->(page_size-1)->>'id')::uuid;
  IF NOT EXISTS(SELECT FROM customer_private.programme_registration_current WHERE principal_id=actor AND id>next_id) THEN next_id:=NULL; END IF;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrations',items,'nextAfter',next_id,'synthetic',customer_private.synthetic_context());
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_economics(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'f8eeba208703d72f671732ddb139a31d86c8e1bc3815a4b809d54595c4adfccf' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer.programme_economics';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_economics(target uuid, programme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;money jsonb;people jsonb;counts jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_ledger:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 -- Totals are per currency only. Nothing is converted or summed across currencies.
 WITH t AS(
  SELECT e.currency,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_FEE'),0) fees,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_PAYMENT'),0) paid,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_EXPENSE' AND e.cost_basis='PLANNED'),0) pe,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_OBLIGATION' AND e.cost_basis='PLANNED'),0) po,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='CORRIDRA_SERVICE_FEE' AND e.cost_basis='PLANNED'),0) ps,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_EXPENSE' AND e.cost_basis='ACTUAL'),0) ae,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='ORGANISER_OBLIGATION' AND e.cost_basis='ACTUAL'),0) ao,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='CORRIDRA_SERVICE_FEE' AND e.cost_basis='ACTUAL'),0) a_s
  FROM customer_private.programme_ledger_entry e WHERE e.workspace_id=target AND e.programme_id=programme GROUP BY e.currency)
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',t.currency,'exponent',c.exponent,
  'feesDue',t.fees::text,'paymentsRecorded',t.paid::text,'outstanding',(t.fees-t.paid)::text,
  'plannedCosts',jsonb_build_object('expenses',t.pe::text,'obligations',t.po::text,'corridraServiceFees',t.ps::text,'total',(t.pe+t.po+t.ps)::text),
  'actualCosts',jsonb_build_object('expenses',t.ae::text,'obligations',t.ao::text,'corridraServiceFees',t.a_s::text,'total',(t.ae+t.ao+t.a_s)::text),
  'marginIfPlanned',(t.fees-(t.pe+t.po+t.ps))::text,'marginOnActual',(t.fees-(t.ae+t.ao+t.a_s))::text,'cashMargin',(t.paid-(t.ae+t.ao+t.a_s))::text) ORDER BY t.currency),'[]'::jsonb)
 INTO money FROM t JOIN app.currency c ON c.code=t.currency;
 WITH regs AS(
  SELECT r.id,r.display_label,CASE WHEN v.id IS NULL THEN 'ACTIVE' WHEN v.withdrawn THEN 'WITHDRAWN' ELSE 'REMOVED' END state
  FROM customer_private.programme_registration_current r LEFT JOIN customer_private.programme_participant_revocation v ON v.registration_id=r.id
  WHERE r.workspace_id=target AND r.programme_id=programme),
 per AS(
  SELECT e.registration_id,e.currency,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_FEE'),0) due,
   coalesce(sum(e.amount_minor::numeric) FILTER(WHERE e.kind='PARTICIPANT_PAYMENT'),0) paid
  FROM customer_private.programme_ledger_entry e WHERE e.workspace_id=target AND e.programme_id=programme AND e.registration_id IS NOT NULL GROUP BY e.registration_id,e.currency)
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',g.id,'label',g.display_label,'state',g.state,'amounts',
  coalesce((SELECT jsonb_agg(jsonb_build_object('currency',p.currency,'exponent',c.exponent,'due',p.due::text,'recorded',p.paid::text,
   'status',CASE WHEN p.due=0 AND p.paid=0 THEN 'NO_FEE' WHEN p.paid=0 THEN 'UNPAID' WHEN p.paid<p.due THEN 'PART_PAID' WHEN p.paid=p.due THEN 'PAID' ELSE 'OVERPAID' END) ORDER BY p.currency)
   FROM per p JOIN app.currency c ON c.code=p.currency WHERE p.registration_id=g.id),'[]'::jsonb)) ORDER BY g.display_label,g.id),'[]'::jsonb)
 INTO people FROM regs g;
 SELECT jsonb_build_object('registered',count(*),'active',count(*) FILTER(WHERE v.id IS NULL),'withdrawnOrRemoved',count(*) FILTER(WHERE v.id IS NOT NULL))
 INTO counts FROM customer_private.programme_registration_current r LEFT JOIN customer_private.programme_participant_revocation v ON v.registration_id=r.id WHERE r.workspace_id=target AND r.programme_id=programme;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Ledger access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.programme_ledger_expiry(),
  'provenance','ORGANISER_RECORDED','verified',false,'collectsPayments',false,'currencies',money,'participants',people,'counts',counts);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_participants(uuid,uuid,uuid,uuid,integer)'::regprocedure),'UTF8')),'hex')<>'80258a4e8e5fe8796090ab220e1c5077d35c72649c960f40f3ec41b2c6c28038' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer.programme_participants';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_participants(target uuid, programme uuid, invitation_after uuid DEFAULT NULL::uuid, registration_after uuid DEFAULT NULL::uuid, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);invitations jsonb;registrations jsonb;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid participant page size' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'expiresAt',i.expires_at,'status',CASE
 WHEN EXISTS(SELECT FROM customer_private.programme_registration_current WHERE invitation_id=i.id) THEN 'USED'
 WHEN NOT customer_private.participant_invitation_active(i.id) THEN 'UNAVAILABLE' ELSE 'ISSUED' END) ORDER BY i.id),'[]'::jsonb) INTO invitations
 FROM (SELECT * FROM customer_private.programme_invitation WHERE workspace_id=target AND programme_id=programme AND (invitation_after IS NULL OR id>invitation_after) ORDER BY id LIMIT page_size) i;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'displayLabel',r.display_label,'labelVersion',r.label_version,'consentedAt',r.consented_at,'status',
 coalesce((SELECT CASE WHEN v.withdrawn THEN 'WITHDRAWN' ELSE 'REVOKED' END FROM customer_private.programme_participant_revocation v WHERE v.registration_id=r.id),'REGISTERED')) ORDER BY r.id),'[]'::jsonb) INTO registrations
 FROM (SELECT * FROM customer_private.programme_registration_current WHERE workspace_id=target AND programme_id=programme AND (registration_after IS NULL OR id>registration_after) ORDER BY id LIMIT page_size) r;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('programmeId',programme,'workspaceId',target,'invitations',invitations,'registrations',registrations,'synthetic',customer_private.synthetic_context(),
 'nextInvitationAfter',CASE WHEN jsonb_array_length(invitations)=page_size AND EXISTS(SELECT FROM customer_private.programme_invitation WHERE programme_id=programme AND id>(invitations->(page_size-1)->>'id')::uuid) THEN invitations->(page_size-1)->>'id' END,
 'nextRegistrationAfter',CASE WHEN jsonb_array_length(registrations)=page_size AND EXISTS(SELECT FROM customer_private.programme_registration_current WHERE programme_id=programme AND id>(registrations->(page_size-1)->>'id')::uuid) THEN registrations->(page_size-1)->>'id' END);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_places_report(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'614818b97df2c5fcffd9fe5c10e2527597f01baa913ed52264ad7575987554dd' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer.programme_places_report';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_places_report(target uuid, programme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;cap integer;rule customer_private.programme_places_revision;tv integer;ev integer;result jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_places:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 cap:=customer_private.terms_maximum(programme);
 SELECT * INTO rule FROM customer_private.programme_places_revision r WHERE r.programme_id=programme ORDER BY r.version DESC LIMIT 1;
 SELECT coalesce(max(t.version),0) INTO tv FROM customer_private.programme_terms_revision t WHERE t.programme_id=programme;
 SELECT coalesce(max(e.version),0) INTO ev FROM customer_private.programme_eligibility_revision e WHERE e.programme_id=programme;
 WITH regs AS(SELECT r.id,r.display_label FROM customer_private.programme_registration_current r
   WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE'),
  enr AS(SELECT DISTINCT ON (e.registration_id) e.registration_id,v.status,v.queue_no,v.reasons FROM customer_private.programme_enrolment e
   JOIN customer_private.programme_enrolment_revision v ON v.enrolment_id=e.id WHERE e.programme_id=programme ORDER BY e.registration_id,v.version DESC),
  acc AS(SELECT a.registration_id,max(a.terms_version) latest,bool_or(a.terms_version=tv) current FROM customer_private.programme_terms_acceptance a WHERE a.programme_id=programme GROUP BY a.registration_id),
  rows AS(SELECT g.id,g.display_label,coalesce(en.status,'NOT_APPLIED') st,en.queue_no,coalesce(en.reasons,ARRAY[]::text[]) reasons,a.latest accepted_version,coalesce(a.current,false) accepted_current,
   CASE WHEN en.status='WAITLISTED' THEN row_number() OVER (PARTITION BY en.status ORDER BY en.queue_no) END position
   FROM regs g LEFT JOIN enr en ON en.registration_id=g.id LEFT JOIN acc a ON a.registration_id=g.id),
  latest AS(SELECT DISTINCT ON (v.record_id) r.registration_id,r.kind,v.shared,v.retracted,v.rating,v.outcome_kind FROM customer_private.programme_participant_record r
   JOIN customer_private.programme_participant_record_revision v ON v.record_id=r.id JOIN regs g ON g.id=r.registration_id WHERE r.programme_id=programme ORDER BY v.record_id,v.version DESC),
  fb AS(SELECT registration_id,shared,rating FROM latest WHERE kind='FEEDBACK' AND NOT retracted),
  oc AS(SELECT registration_id,outcome_kind FROM latest WHERE kind='OUTCOME' AND shared AND NOT retracted),
  n AS(SELECT count(*)::integer registered,count(*) FILTER(WHERE st='NOT_APPLIED')::integer not_applied,count(*) FILTER(WHERE st='PLACED')::integer placed,
   count(*) FILTER(WHERE st='WAITLISTED')::integer waiting,count(*) FILTER(WHERE st='NOT_ELIGIBLE')::integer not_eligible,count(*) FILTER(WHERE st='CANCELLED')::integer cancelled,
   count(*) FILTER(WHERE accepted_current)::integer accepted_now,
   count(*) FILTER(WHERE st IN ('PLACED','WAITLISTED') AND NOT accepted_current AND tv>0)::integer pending FROM rows)
 SELECT jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'asOf',to_char(current_date,'YYYY-MM-DD'),'verified',false,'sendsMessages',false,
  'places',jsonb_build_object('version',coalesce(rule.version,0),'minimum',rule.minimum_participants,'maximum',cap,'waitlist',coalesce(rule.waitlist,false),
   'placed',n.placed,'free',CASE WHEN cap IS NULL THEN NULL ELSE greatest(cap-n.placed,0) END,
   'fillPermille',CASE WHEN cap IS NOT NULL THEN round(1000.0*n.placed/cap)::integer END,
   'minimumMet',CASE WHEN rule.minimum_participants IS NOT NULL THEN n.placed>=rule.minimum_participants END,
   'waiting',n.waiting,'promotable',CASE WHEN cap IS NULL THEN n.waiting ELSE least(n.waiting,greatest(cap-n.placed,0)) END,'provenance','ORGANISER_RECORDED'),
  'funnel',jsonb_build_object('registered',n.registered,'notApplied',n.not_applied,'placed',n.placed,'waitlisted',n.waiting,'notEligible',n.not_eligible,'cancelled',n.cancelled),
  'eligibility',jsonb_build_object('version',ev,'notEligibleByReason',coalesce((SELECT jsonb_object_agg(x.code,x.cnt) FROM (SELECT c code,count(*)::integer cnt FROM rows,unnest(rows.reasons) c WHERE rows.st='NOT_ELIGIBLE' GROUP BY c) x),'{}'::jsonb)),
  'terms',jsonb_build_object('version',tv,'acceptedCurrent',n.accepted_now,'pendingAcceptance',n.pending,
   'acceptanceRatePermille',CASE WHEN tv>0 AND n.registered>0 THEN round(1000.0*n.accepted_now/n.registered)::integer END,'provenance','PARTICIPANT_REPORTED'),
  'satisfaction',jsonb_build_object('responses',(SELECT count(*)::integer FROM fb),'ratingCount',(SELECT count(*)::integer FROM fb WHERE shared),
   'ratingSum',coalesce((SELECT sum(rating)::integer FROM fb WHERE shared),0),'notShared',(SELECT count(*)::integer FROM fb WHERE NOT shared),
   'responsesFromPlaced',(SELECT count(*)::integer FROM fb JOIN rows ON rows.id=fb.registration_id WHERE rows.st='PLACED'),'provenance','PARTICIPANT_REPORTED'),
  'outcomes',jsonb_build_object('shared',(SELECT count(*)::integer FROM oc),'participantsWithOutcome',(SELECT count(DISTINCT registration_id)::integer FROM oc),
   'byKind',coalesce((SELECT jsonb_object_agg(k.outcome_kind,k.cnt) FROM (SELECT outcome_kind,count(*)::integer cnt FROM oc GROUP BY outcome_kind) k),'{}'::jsonb),'provenance','PARTICIPANT_REPORTED'),
  'rosterTruncated',n.registered>500,
  'roster',coalesce((SELECT jsonb_agg(jsonb_build_object('registrationId',s.id,'label',s.display_label,'status',s.st,'position',s.position,'reasons',to_jsonb(s.reasons),
    'termsAcceptedVersion',s.accepted_version,'termsCurrent',s.accepted_current) ORDER BY s.display_label,s.id) FROM (SELECT * FROM rows ORDER BY display_label,id LIMIT 500) s),'[]'::jsonb))
 INTO result FROM n;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_pricing_overview(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'5261f23851f06caf0f312e69c206b22b12a8f6a5671b03a00d973ec542e2761f' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer.programme_pricing_overview';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_pricing_overview(target uuid, programme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;cur integer;people jsonb;history jsonb;counts jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.pricing_scope(gen_random_uuid(),target,programme);
 SELECT coalesce(max(version),0) INTO cur FROM customer_private.programme_fee_schedule WHERE programme_id=programme;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',s.version,'templateId',s.template_id,'templateVersion',s.template_version,'currency',s.currency,'appliedAt',s.created_at) ORDER BY s.version DESC),'[]'::jsonb)
 INTO history FROM customer_private.programme_fee_schedule s WHERE s.programme_id=programme;
 WITH regs AS(
  SELECT r.id,r.display_label,customer_private.coordination_registration_state(r.id) state FROM customer_private.programme_registration_current r WHERE r.workspace_id=target AND r.programme_id=programme),
 fees AS(
  SELECT e.registration_id,e.currency,sum(e.amount_minor::numeric) due FROM customer_private.programme_ledger_entry e
  WHERE e.programme_id=programme AND e.kind='PARTICIPANT_FEE' AND e.registration_id IS NOT NULL GROUP BY e.registration_id,e.currency)
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',g.id,'label',g.display_label,'state',g.state,
  'hasFee',EXISTS(SELECT FROM customer_private.programme_ledger_entry e WHERE e.programme_id=programme AND e.registration_id=g.id AND e.kind='PARTICIPANT_FEE' AND e.reverse_of IS NULL
   AND NOT EXISTS(SELECT FROM customer_private.programme_ledger_entry x WHERE x.reverse_of=e.id)),
  'fees',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',f.currency,'exponent',c.exponent,'dueMinor',f.due::text) ORDER BY f.currency) FROM fees f JOIN app.currency c ON c.code=f.currency WHERE f.registration_id=g.id),'[]'::jsonb))
  ORDER BY g.display_label,g.id),'[]'::jsonb)
 INTO people FROM regs g;
 SELECT jsonb_build_object('registered',count(*),'active',count(*) FILTER(WHERE customer_private.coordination_registration_state(r.id)='ACTIVE'))
 INTO counts FROM customer_private.programme_registration_current r WHERE r.workspace_id=target AND r.programme_id=programme;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Pricing access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),
  'schedule',CASE WHEN cur>0 THEN customer_private.fee_schedule_json(programme,cur) END,'history',history,'participants',people,'counts',counts);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer.programme_report(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'0d4823ad99f0d94ba74caa139aa564960d45c99f572d5fba579c17879adc7fcd' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer.programme_report';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer.programme_report(target uuid, programme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;cap jsonb;att jsonb;tasks jsonb;fb jsonb;outc jsonb;rep jsonb;people jsonb;active_n integer;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.programme_coordination:'||programme::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO active_n FROM customer_private.programme_registration_current r WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE';
 SELECT coalesce((SELECT jsonb_build_object('capacity',c.capacity,'version',c.version,'reason',c.reason) FROM customer_private.programme_capacity_revision c WHERE c.programme_id=programme ORDER BY c.version DESC LIMIT 1),
  jsonb_build_object('capacity',NULL,'version',0,'reason',NULL)) INTO cap;
 WITH regs AS(SELECT r.id,r.display_label,customer_private.coordination_registration_state(r.id) state FROM customer_private.programme_registration_current r WHERE r.workspace_id=target AND r.programme_id=programme),
  last_att AS(SELECT DISTINCT ON (a.registration_id) a.registration_id,a.state,a.version FROM customer_private.programme_attendance_revision a WHERE a.programme_id=programme ORDER BY a.registration_id,a.version DESC)
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',g.id,'label',g.display_label,'state',g.state,'attendance',l.state,'attendanceVersion',coalesce(l.version,0)) ORDER BY g.display_label,g.id),'[]'::jsonb),
  jsonb_build_object('attended',count(*) FILTER(WHERE g.state='ACTIVE' AND l.state='ATTENDED'),'absent',count(*) FILTER(WHERE g.state='ACTIVE' AND l.state='ABSENT'),
   'notRecorded',count(*) FILTER(WHERE g.state='ACTIVE' AND l.state IS NULL),'withdrawnOrRemoved',count(*) FILTER(WHERE g.state<>'ACTIVE'),'provenance','ORGANISER_RECORDED')
 INTO people,att FROM regs g LEFT JOIN last_att l ON l.registration_id=g.id;
 WITH cur AS(SELECT DISTINCT ON (v.task_id) v.task_id,v.status,v.due_on FROM customer_private.programme_task_revision v WHERE v.programme_id=programme ORDER BY v.task_id,v.version DESC)
 SELECT jsonb_build_object('open',count(*) FILTER(WHERE status='OPEN'),'inProgress',count(*) FILTER(WHERE status='IN_PROGRESS'),'done',count(*) FILTER(WHERE status='DONE'),
  'cancelled',count(*) FILTER(WHERE status='CANCELLED'),'overdue',count(*) FILTER(WHERE status IN ('OPEN','IN_PROGRESS') AND due_on<current_date),'provenance','ORGANISER_RECORDED')
 INTO tasks FROM cur;
 WITH cur AS(SELECT DISTINCT ON (v.record_id) v.record_id,r.kind,r.registration_id,v.shared,v.retracted,v.rating,v.outcome_kind,v.occurred_on,v.note
  FROM customer_private.programme_participant_record r JOIN customer_private.programme_participant_record_revision v ON v.record_id=r.id
  WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.registration_id)='ACTIVE' ORDER BY v.record_id,v.version DESC),
  f AS(SELECT * FROM cur WHERE kind='FEEDBACK' AND NOT retracted),o AS(SELECT * FROM cur WHERE kind='OUTCOME' AND NOT retracted)
 SELECT jsonb_build_object('responses',(SELECT count(*) FROM f),'shared',(SELECT count(*) FROM f WHERE shared),'notShared',(SELECT count(*) FROM f WHERE NOT shared),
   'ratingCount',(SELECT count(*) FROM f WHERE shared),'ratingSum',coalesce((SELECT sum(rating) FROM f WHERE shared),0),
   'distribution',jsonb_build_object('1',(SELECT count(*) FROM f WHERE shared AND rating=1),'2',(SELECT count(*) FROM f WHERE shared AND rating=2),'3',(SELECT count(*) FROM f WHERE shared AND rating=3),
    '4',(SELECT count(*) FROM f WHERE shared AND rating=4),'5',(SELECT count(*) FROM f WHERE shared AND rating=5)),
   'comments',coalesce((SELECT jsonb_agg(f.note ORDER BY f.record_id) FROM f WHERE f.shared AND f.note IS NOT NULL),'[]'::jsonb),'provenance','PARTICIPANT_REPORTED'),
  jsonb_build_object('total',(SELECT count(*) FROM o),'shared',(SELECT count(*) FROM o WHERE shared),'notShared',(SELECT count(*) FROM o WHERE NOT shared),
   'byKind',coalesce((SELECT jsonb_object_agg(k.outcome_kind,k.n) FROM (SELECT outcome_kind,count(*) n FROM o WHERE shared GROUP BY outcome_kind) k),'{}'::jsonb),
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('label',g.display_label,'outcomeKind',o.outcome_kind,'occurredOn',to_char(o.occurred_on,'YYYY-MM-DD'),'note',o.note) ORDER BY o.occurred_on DESC,o.record_id)
     FROM o JOIN customer_private.programme_registration_current g ON g.id=o.registration_id WHERE o.shared),'[]'::jsonb),'provenance','PARTICIPANT_REPORTED')
 INTO fb,outc;
 SELECT jsonb_build_object('returningParticipants',count(*),'basis','Active registrants who also registered in another programme of this workspace') INTO rep
 FROM customer_private.programme_registration_current r WHERE r.workspace_id=target AND r.programme_id=programme AND customer_private.coordination_registration_state(r.id)='ACTIVE'
  AND EXISTS(SELECT FROM customer_private.programme_registration_current o WHERE o.workspace_id=target AND o.principal_id=r.principal_id AND o.programme_id<>programme);
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coordination access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',target,'programmeId',programme,'expiresAt',customer_private.coordination_expiry(),'asOf',to_char(current_date,'YYYY-MM-DD'),
  'verified',false,'sendsMessages',false,'activeParticipants',active_n,'capacity',cap,'attendance',att,'tasks',tasks,'feedback',fb,'outcomes',outc,'repeat',rep,'participants',people);
END $function$;

DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('customer_private.programme_ledger_entry_json(uuid)'::regprocedure),'UTF8')),'hex')<>'c0a650c364266d506be9104fce46c823474faa66ad8bb337291b7fcf914a4b61' THEN RAISE EXCEPTION 'Participant label prerequisite function differs: customer_private.programme_ledger_entry_json';END IF;END $guard$;
CREATE OR REPLACE FUNCTION customer_private.programme_ledger_entry_json(entry uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',e.id,'seq',e.seq,'kind',e.kind,'costBasis',e.cost_basis,'registrationId',e.registration_id,
  'registrationLabel',r.display_label,'amountMinor',e.amount_minor::text,'currency',e.currency,'exponent',c.exponent,'occurredOn',to_char(e.occurred_on,'YYYY-MM-DD'),
  'description',e.description,'reverseOf',e.reverse_of,'reversedBy',(SELECT x.id FROM customer_private.programme_ledger_entry x WHERE x.reverse_of=e.id),
  'provenance',e.provenance,'recordedAt',e.created_at)
 FROM customer_private.programme_ledger_entry e JOIN app.currency c ON c.code=e.currency
 LEFT JOIN customer_private.programme_registration_current r ON r.id=e.registration_id WHERE e.id=entry
$function$;
