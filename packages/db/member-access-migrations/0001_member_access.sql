-- ADR-087 U5, part 1: workspace owners and admins read the saved reports of current members and download their Trip Book and
-- Supplier Book (decision 4, 4a, 4c and 4d; the decision cards are part 2, 0002_member_decision_cards.sql).
-- What this file adds, and nothing else. No existing table, policy, trigger or function is created again, replaced or dropped.
--   1. customer_private.member_access_reader(workspace): the one gate. It answers the caller's customer id only when the caller is a
--      current owner or admin of that workspace (customer.collaborative_workspaces()) and the workspace's member notice was delivered
--      at least 24 hours ago (customer_private.member_notice_delivery.opens_at <= now, ADR-087 4d). No delivery row: never open. Another
--      workspace's delivery has no effect, because the row is looked up by this workspace only.
--   2. customer_private.member_saved_item(workspace, reader, resource): a saved report of this workspace that the reader may read. It
--      was saved by a current member (customer_private.workspace_member_current, ADR-033 amendment) other than the reader, it is not
--      removed, and it arrived for a request that the same member wrote in this workspace (the rule of
--      customer_private.link_workspace_current and customer.member_notice_for_saved). Its creation time is not filtered (4a).
--   3. customer.workspace_saved_missions(workspace, after, size): the list. customer.workspace_saved_mission(workspace, resource): the
--      read only open of one report (the same app.delivery_report the member's own read returns, behind the same link checks, so an
--      expired or revoked link ends it for everyone). customer.workspace_saved_mission_book(workspace, resource, kind, command,
--      acknowledged): the Trip Book or Supplier Book. It writes the existing book record (customer_private.saved_mission_command, the
--      reader as principal, with the workspace id in its input) and the existing delivery.book.generated event, within the existing
--      limit of 30 books an hour per person and report. Its projection is a copy of customer.saved_mission_book (books 0001:15-96):
--      the install refuses unless that function is present with exactly the text this copy was made from.
--   customer.member_access_others(workspace): the count of other current members, for a current owner or admin, so /account shows the
--   tab only where there is someone to read. It reads no item and records nothing.
--   Every list with items, every open and every book writes exactly one event through the existing writer
--   customer_private.workspace_access_event, kind customer.member_item.read or customer.member_item.book, with ids only. The writer
--   records the reader as initiator_id of the app.domain_event and an app.audit_event joined to it (ADR-087, Protections kept).
-- Removing a save and withdrawing a card stay with their creator: customer.remove_saved_mission and customer.withdraw_decision_card are
-- untouched, and nothing here can remove, withdraw, answer or change anything.
-- The functions are definers executable by the runtime only (not PUBLIC, not the auth role); the two private helpers by nobody.
-- Rollback: rollback/0001_drop_member_access.sql. It deletes nothing and refuses once any U5 event or book record exists. The quicker
-- pause is the application switch CORRIDRA_MEMBER_ACCESS off, which answers 404 on every route and shows nothing.
DO $guard$
BEGIN
 IF to_regclass('customer_private.member_notice_delivery') IS NULL THEN
  RAISE EXCEPTION 'Member access needs the member notice module first (field_modules_action=member_notice)';
 END IF;
 IF to_regprocedure('customer_private.workspace_member_current(uuid,uuid)') IS NULL
  OR to_regprocedure('customer.collaborative_workspaces()') IS NULL
  OR to_regprocedure('customer_private.saved_mission_actor()') IS NULL
  OR to_regprocedure('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)') IS NULL
  OR to_regprocedure('app.delivery_authorized(text,text)') IS NULL
  OR to_regprocedure('app.delivery_report(text,text)') IS NULL
  OR to_regprocedure('app.delivery_external_event(app.delivery_link,text,uuid,jsonb)') IS NULL
  OR to_regclass('customer_private.saved_mission_command') IS NULL
  OR to_regclass('app.customer_delivery_assignment') IS NULL
  OR to_regclass('customer_private.owned_request') IS NULL THEN
  RAISE EXCEPTION 'Member access prerequisite is missing';
 END IF;
 IF to_regprocedure('customer_private.member_access_reader(uuid)') IS NOT NULL
  OR to_regprocedure('customer_private.member_saved_item(uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer_private.member_access_label(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer.member_access_others(uuid)') IS NOT NULL
  OR to_regprocedure('customer.workspace_saved_missions(uuid,uuid,integer)') IS NOT NULL
  OR to_regprocedure('customer.workspace_saved_mission(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'Member access: an object of this module already exists outside this module';
 END IF;
 -- The events are written by the real-use version of the access event writer, the one test 9 of ADR-087 U5 proves records a
 -- domain event and an audit event for a workspace that is not a sample. Any other version refuses the install.
 -- writer-begin
 IF encode(sha256(convert_to(pg_get_functiondef('customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')
  <>'9e502175e8dc049650cb7937337b6636693664bbfe34bcca3d73c305171fe392' THEN
  RAISE EXCEPTION 'Member access: the workspace access event writer differs from the real-use version this file was written against';
 END IF;
 -- writer-end
 -- The book projection below is a copy. Its source must be the text it was copied from, so the two books never drift apart.
 IF to_regprocedure('customer.saved_mission_book(uuid,text,uuid,boolean)') IS NULL THEN
  RAISE EXCEPTION 'Member access needs the Trip and Supplier book module first';
 END IF;
 -- book-begin
 IF encode(sha256(convert_to((SELECT p.prosrc FROM pg_proc p WHERE p.oid='customer.saved_mission_book(uuid,text,uuid,boolean)'::regprocedure),'UTF8')),'hex')
  <>'789ac89e0ab913219fd3deb1c0f2292e077bb70135d275b5d3c0d95f534533c0' THEN
  RAISE EXCEPTION 'Member access: customer.saved_mission_book differs from the text its copy was made from';
 END IF;
 -- book-end
END
$guard$;

-- 1. The gate.
CREATE FUNCTION customer_private.member_access_reader(workspace uuid) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid:=customer_private.saved_mission_actor();
BEGIN
 IF workspace IS NULL OR NOT EXISTS(SELECT FROM customer.collaborative_workspaces() c WHERE c.id=workspace AND c.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM customer_private.member_notice_delivery d WHERE d.workspace_id=workspace AND d.opens_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'MEMBER_ACCESS_NOT_OPEN' USING ERRCODE='42501';
 END IF;
 RETURN reader;
END $$;

-- The member's invitation label, the only name the workspace itself holds for a member. The original owner has none (NULL).
CREATE FUNCTION customer_private.member_access_label(workspace uuid,person uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.label FROM customer_private.workspace_member w JOIN customer_private.workspace_invitation i ON i.id=w.source_invitation_id
  WHERE w.tenant_id=workspace AND w.principal_id=person
   AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=w.id)
  ORDER BY w.created_at DESC LIMIT 1
$$;

-- How many current members other than the caller this workspace has, for a current owner or admin only. It reads no member item,
-- does not need the workspace to be open and records nothing: /account shows the Members' Reports tab only when it is above 0.
CREATE FUNCTION customer.member_access_others(workspace uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid:=customer_private.saved_mission_actor();
BEGIN
 IF workspace IS NULL OR NOT EXISTS(SELECT FROM customer.collaborative_workspaces() c WHERE c.id=workspace AND c.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Workspace owner or admin required' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT count(DISTINCT x.p)::integer FROM (
   SELECT m.principal_id AS p FROM customer.membership m WHERE m.tenant_id=workspace
   UNION SELECT w.principal_id FROM customer_private.workspace_member w WHERE w.tenant_id=workspace
    AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=w.id)) x
  WHERE x.p<>reader);
END $$;

-- 2. One saved report of the workspace the reader may read, or the same refusal as an unknown id.
CREATE FUNCTION customer_private.member_saved_item(workspace uuid,reader uuid,resource uuid) RETURNS customer_private.saved_mission
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved customer_private.saved_mission;
BEGIN
 SELECT s.* INTO saved FROM customer_private.saved_mission s
  WHERE s.id=resource AND s.removed_at IS NULL AND s.principal_id<>reader
   AND customer_private.workspace_member_current(workspace,s.principal_id)
   AND EXISTS(SELECT FROM app.customer_delivery_assignment a JOIN customer_private.owned_request o ON o.id=a.request_id
    WHERE a.tenant_id=s.link_tenant_id AND a.link_id=s.link_id AND o.principal_id=s.principal_id AND o.workspace_id=workspace)
  FOR SHARE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 RETURN saved;
END $$;

-- 3a. The list, 25 at most a page, by id. Unavailable reports (an expired or revoked link) are listed without a title.
CREATE FUNCTION customer.workspace_saved_missions(workspace uuid,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid:=customer_private.member_access_reader(workspace);s customer_private.saved_mission;l app.delivery_link;title text;
 items jsonb:='[]'::jsonb;ids jsonb:='[]'::jsonb;last_id uuid;more boolean:=false;label text;members uuid[]:='{}';
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 -- Driven from the workspace's own requests, then their delivery assignment (one per link), then the member's live save of
 -- that link; the same rule as customer_private.member_saved_item, ordered and paged by the save id.
 FOR s IN SELECT m.* FROM customer_private.owned_request o
  JOIN app.customer_delivery_assignment a ON a.request_id=o.id
  JOIN customer_private.saved_mission m ON m.link_tenant_id=a.tenant_id AND m.link_id=a.link_id AND m.principal_id=o.principal_id
  WHERE o.workspace_id=workspace AND m.removed_at IS NULL AND m.principal_id<>reader AND (after_id IS NULL OR m.id>after_id)
   AND customer_private.workspace_member_current(workspace,m.principal_id)
  ORDER BY m.id LIMIT page_size+1 LOOP
  IF jsonb_array_length(ids)=page_size THEN more:=true; EXIT; END IF;
  title:=NULL;l:=NULL;
  BEGIN
   l:=app.delivery_authorized(s.token_hash,'CLIENT_PROGRESS');
   IF l.id<>s.link_id OR l.tenant_id<>s.link_tenant_id OR l.expires_at<=clock_timestamp() THEN l:=NULL; END IF;
  EXCEPTION WHEN insufficient_privilege THEN l:=NULL;
  END;
  IF l.id IS NOT NULL THEN
   SELECT p.copy->>'title' INTO title FROM app.delivery_publication p WHERE p.tenant_id=l.tenant_id AND p.id=l.publication_ids[1];
  END IF;
  label:=customer_private.member_access_label(workspace,s.principal_id);
  items:=items||jsonb_build_array(jsonb_build_object('id',s.id,'available',l.id IS NOT NULL,'title',title,
   'expiresAt',CASE WHEN l.id IS NOT NULL THEN to_char(l.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
   'savedAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'memberLabel',label));
  ids:=ids||jsonb_build_array(s.id);last_id:=s.id;members:=members||s.principal_id;
 END LOOP;
 IF jsonb_array_length(ids)>0 THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||workspace::text,0));
  -- Recheck after the lock wait: a reader who lost the role, a member removed or a save removed meanwhile ends the read.
  IF customer_private.member_access_reader(workspace) IS DISTINCT FROM reader
  OR EXISTS(SELECT FROM unnest(members) p WHERE NOT customer_private.workspace_member_current(workspace,p))
  OR EXISTS(SELECT FROM jsonb_array_elements_text(ids) i JOIN customer_private.saved_mission m ON m.id=i::uuid WHERE m.removed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Member access changed' USING ERRCODE='42501';
  END IF;
  PERFORM customer_private.workspace_access_event(workspace,reader,gen_random_uuid(),'customer.member_item.read',
   jsonb_build_object('view','saved_list','resourceIds',ids));
 END IF;
 IF customer.actor_id() IS DISTINCT FROM reader THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('workspaceId',workspace,'missions',items,'nextAfter',CASE WHEN more THEN last_id END);
END $$;

-- 3b. One report, read only: the same report document the member reads, behind the same link checks.
CREATE FUNCTION customer.workspace_saved_mission(workspace uuid,resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid:=customer_private.member_access_reader(workspace);saved customer_private.saved_mission;l app.delivery_link;result jsonb;
BEGIN
 saved:=customer_private.member_saved_item(workspace,reader,resource);
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501';
 END IF;
 result:=app.delivery_report(saved.token_hash,'CLIENT_PROGRESS');
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||workspace::text,0));
 -- Recheck after the lock wait: the reader still owns or manages the open workspace, and the save is still a current member's.
 IF customer_private.member_access_reader(workspace) IS DISTINCT FROM reader THEN
  RAISE EXCEPTION 'Member access changed' USING ERRCODE='42501';
 END IF;
 saved:=customer_private.member_saved_item(workspace,reader,resource);
 PERFORM customer_private.workspace_access_event(workspace,reader,gen_random_uuid(),'customer.member_item.read',
  jsonb_build_object('view','saved_report','resourceId',resource));
 IF customer.actor_id() IS DISTINCT FROM reader OR l.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('workspaceId',workspace,'resourceId',resource,'memberLabel',customer_private.member_access_label(workspace,saved.principal_id),'report',result);
END $$;

-- 3c. The book. The projection, the replay rule and the limit are those of customer.saved_mission_book; the differences are the
-- reader as principal of the record, the workspace id in its input, the reader's lock, and one access event per book returned.
CREATE FUNCTION customer.workspace_saved_mission_book(workspace uuid,resource uuid,kind text,command uuid,acknowledged boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reader uuid;saved customer_private.saved_mission;l app.delivery_link;document jsonb;mission jsonb;projection jsonb;result jsonb;
 prior customer_private.saved_mission_command;digest text;generated text;replayed boolean:=false;
BEGIN
 IF workspace IS NULL OR resource IS NULL OR command IS NULL OR kind IS NULL OR kind NOT IN ('TRIP','SUPPLIER') OR acknowledged IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Explicit book request required' USING ERRCODE='23514';
 END IF;
 reader:=customer_private.member_access_reader(workspace);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||reader::text,0));
 IF customer.actor_id() IS DISTINCT FROM reader THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 saved:=customer_private.member_saved_item(workspace,reader,resource);
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.programme_id IS NOT NULL OR cardinality(l.publication_ids)<>1
 OR l.allow_export OR l.include_delegation OR l.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501';
 END IF;
 document:=app.delivery_report(saved.token_hash,'CLIENT_PROGRESS');
 mission:=document->'missions'->0;
 IF mission IS NULL THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 -- projection-begin
 IF kind='TRIP' THEN
  projection:=jsonb_build_object('schemaVersion',1,'kind','TRIP','title',mission->>'title','company',mission->>'company','objective',mission->>'objective',
   'reviewedAt',to_char((mission->>'reviewedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'itinerary',coalesce((SELECT jsonb_agg(q.item ORDER BY q.grp,q.starts,q.n) FROM (
     SELECT c.n,CASE WHEN c.changed THEN 2 WHEN c.starts IS NULL THEN 1 ELSE 0 END AS grp,CASE WHEN NOT c.changed THEN c.starts END AS starts,
      jsonb_build_object('label',c.i->>'label','status',c.i->>'status','changed',c.changed)
      ||CASE WHEN c.changed THEN '{}'::jsonb ELSE jsonb_strip_nulls(jsonb_build_object(
       'startsAt',to_char(c.starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',to_char(c.ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
       'timezone',c.i->>'timezone','location',c.i->>'location')) END AS item
     FROM (SELECT x.n,x.i,coalesce((x.i->>'scheduleChanged')::boolean,false) OR x.i->>'status'='RESCHEDULE_REQUIRED' AS changed,
       (x.i->>'startsAt')::timestamptz AS starts,(x.i->>'endsAt')::timestamptz AS ends
      FROM jsonb_array_elements(mission->'itinerary') WITH ORDINALITY AS x(i,n)) c) q),'[]'::jsonb));
 ELSE
  projection:=jsonb_build_object('schemaVersion',1,'kind','SUPPLIER','title',mission->>'title',
   'reviewedAt',to_char((mission->>'reviewedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'shortlist',coalesce((SELECT jsonb_agg(jsonb_build_object('company',s->>'company','country',s->>'country','fit',s->>'fit','rationale',s->>'rationale',
     'uncertainty',s->>'uncertainty','gaps',s->>'gaps','verification',s->>'verification') ORDER BY (s->>'id')::uuid)
    FROM jsonb_array_elements(mission->'experience'->'shortlist') s),'[]'::jsonb));
 END IF;
 -- projection-end
 digest:=encode(sha256(convert_to(projection::text,'UTF8')),'hex');
 SELECT * INTO prior FROM customer_private.saved_mission_command WHERE principal_id=reader AND command_id=command;
 IF FOUND THEN
  IF prior.resource_id<>resource OR (prior.input-ARRAY['digest','generatedAt','publicationId','reviewedAt','schemaVersion'])
   IS DISTINCT FROM jsonb_build_object('action','book','kind',kind,'resourceId',resource,'workspaceId',workspace) THEN
   RAISE EXCEPTION 'Book command conflicts' USING ERRCODE='23514';
  END IF;
  IF prior.input->>'digest' IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'The reviewed content changed since this download started' USING ERRCODE='23514';
  END IF;
  generated:=prior.input->>'generatedAt';
  replayed:=true;
 ELSIF jsonb_array_length(coalesce(projection->CASE kind WHEN 'TRIP' THEN 'itinerary' ELSE 'shortlist' END,'[]'::jsonb))=0 THEN
  result:=jsonb_build_object('state','EMPTY');
 ELSE
  IF (SELECT count(*) FROM customer_private.saved_mission_command WHERE principal_id=reader AND resource_id=resource AND input->>'action'='book'
   AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN
   RAISE EXCEPTION 'Too many books for this mission just now' USING ERRCODE='54000';
  END IF;
  generated:=to_char(date_trunc('second',clock_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  INSERT INTO customer_private.saved_mission_command(principal_id,command_id,input,resource_id)
  VALUES(reader,command,jsonb_build_object('action','book','kind',kind,'resourceId',resource,'workspaceId',workspace,'schemaVersion',1,'digest',digest,
   'generatedAt',generated,'publicationId',mission->>'publicationId','reviewedAt',projection->>'reviewedAt'),resource);
  PERFORM app.delivery_external_event(l,'delivery.book.generated',command,jsonb_build_object('kind',kind,
   'publicationId',mission->>'publicationId','digest',digest,'schemaVersion',1,'format','PDF'));
 END IF;
 IF result IS NULL THEN
  result:=jsonb_build_object('resourceId',resource,'kind',kind,'command',command,'digest',digest,'generatedAt',generated,
   'expiresAt',to_char((document->>'expiresAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'replayed',replayed,'projection',projection);
  PERFORM pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||workspace::text,0));
  PERFORM customer_private.workspace_access_event(workspace,reader,command,'customer.member_item.book',
   jsonb_build_object('resourceId',resource,'bookKind',kind,'commandId',command));
 END IF;
 -- Recheck after any lock wait with the real clock: access lost meanwhile rolls back the record and both events.
 IF customer_private.member_access_reader(workspace) IS DISTINCT FROM reader THEN
  RAISE EXCEPTION 'Member access changed' USING ERRCODE='42501';
 END IF;
 saved:=customer_private.member_saved_item(workspace,reader,resource);
 IF customer.actor_id() IS DISTINCT FROM reader OR l.expires_at<=clock_timestamp()
 OR app.delivery_report(saved.token_hash,'CLIENT_PROGRESS') IS DISTINCT FROM document THEN
  RAISE EXCEPTION 'Book access expired or changed' USING ERRCODE='42501';
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_private.member_access_reader(uuid),customer_private.member_saved_item(uuid,uuid,uuid),customer_private.member_access_label(uuid,uuid),
 customer.member_access_others(uuid),customer.workspace_saved_missions(uuid,uuid,integer),customer.workspace_saved_mission(uuid,uuid),
 customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.member_access_others(uuid),customer.workspace_saved_missions(uuid,uuid,integer),customer.workspace_saved_mission(uuid,uuid),
 customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean) TO corridra_runtime;
COMMENT ON FUNCTION customer.workspace_saved_missions(uuid,uuid,integer) IS
 'ADR-087 U5: a workspace owner or admin lists the saved reports of current members, once the workspace notice interval has passed. Audited.';

-- The definers are owned by whoever installs them. They call helpers that may belong to another role.
DO $owner$
DECLARE holder text; helper text;
BEGIN
 SELECT pg_get_userbyid(p.proowner) INTO holder FROM pg_proc p WHERE p.oid='customer_private.member_access_reader(uuid)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY['customer_private.workspace_member_current(uuid,uuid)','customer.collaborative_workspaces()','customer.actor_id()',
  'customer_private.saved_mission_actor()','customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb)','app.delivery_authorized(text,text)',
  'customer_private.member_access_label(uuid,uuid)','customer_private.member_access_reader(uuid)','customer_private.member_saved_item(uuid,uuid,uuid)',
  'app.delivery_report(text,text)','app.delivery_external_event(app.delivery_link,text,uuid,jsonb)'] LOOP
  IF NOT has_function_privilege(holder,helper,'EXECUTE') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',helper,holder);
  END IF;
 END LOOP;
END
$owner$;

DO $proof$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure::text AS sig,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p
  WHERE p.oid IN ('customer_private.member_access_reader(uuid)'::regprocedure,'customer_private.member_saved_item(uuid,uuid,uuid)'::regprocedure,
   'customer_private.member_access_label(uuid,uuid)'::regprocedure,'customer.member_access_others(uuid)'::regprocedure,
   'customer.workspace_saved_missions(uuid,uuid,integer)'::regprocedure,'customer.workspace_saved_mission(uuid,uuid)'::regprocedure,
   'customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean)'::regprocedure) LOOP
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
   RAISE EXCEPTION 'Member access: % is not the definer this file defines',f.sig;
  END IF;
  IF EXISTS(SELECT FROM aclexplode(f.proacl) a WHERE a.grantee=0) THEN
   RAISE EXCEPTION 'Member access: PUBLIC must not execute %',f.sig;
  END IF;
  IF has_function_privilege('corridra_auth',f.sig,'EXECUTE') THEN
   RAISE EXCEPTION 'Member access: the auth role must not execute %',f.sig;
  END IF;
 END LOOP;
 IF has_function_privilege('corridra_runtime','customer_private.member_access_reader(uuid)','EXECUTE')
  OR has_function_privilege('corridra_runtime','customer_private.member_saved_item(uuid,uuid,uuid)','EXECUTE')
  OR has_function_privilege('corridra_runtime','customer_private.member_access_label(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Member access: the runtime role must not call the private helpers';
 END IF;
 IF NOT has_function_privilege('corridra_runtime','customer.member_access_others(uuid)','EXECUTE')
  OR NOT has_function_privilege('corridra_runtime','customer.workspace_saved_missions(uuid,uuid,integer)','EXECUTE')
  OR NOT has_function_privilege('corridra_runtime','customer.workspace_saved_mission(uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('corridra_runtime','customer.workspace_saved_mission_book(uuid,uuid,text,uuid,boolean)','EXECUTE') THEN
  RAISE EXCEPTION 'Member access: the runtime role must list, open and download';
 END IF;
END
$proof$;
