-- ADR-076 items 1 to 3. The Trip Book and Supplier Book: one function that turns the saved report the same customer
-- can already read into a named-field projection, and records each new generation. Nothing existing is replaced, no
-- table or policy is added and no file is stored. The generation record is a row in the existing immutable
-- saved-mission command ledger plus one event through the existing delivery audit and outbox writer.
DO $guard$ BEGIN
 IF to_regprocedure('customer.saved_mission_action(uuid,uuid,uuid,text)') IS NULL
 OR to_regprocedure('customer_private.saved_mission_actor()') IS NULL
 OR to_regprocedure('app.delivery_authorized(text,text)') IS NULL
 OR to_regprocedure('app.delivery_external_event(app.delivery_link,text,uuid,jsonb)') IS NULL
 OR to_regclass('customer_private.saved_mission_command') IS NULL THEN
  RAISE EXCEPTION 'Trip and Supplier book prerequisite is missing';
 END IF;
END $guard$;

CREATE FUNCTION customer.saved_mission_book(resource uuid,kind text,command uuid,acknowledged boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;saved customer_private.saved_mission;l app.delivery_link;document jsonb;mission jsonb;projection jsonb;result jsonb;
 prior customer_private.saved_mission_command;digest text;generated text;replayed boolean:=false;
BEGIN
 IF resource IS NULL OR command IS NULL OR kind IS NULL OR kind NOT IN ('TRIP','SUPPLIER') OR acknowledged IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Explicit book request required' USING ERRCODE='23514';
 END IF;
 actor:=customer_private.saved_mission_actor();
 -- One generation at a time per customer, so a double submit and the hourly limit see each other.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||actor::text,0));
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Customer access expired' USING ERRCODE='42501'; END IF;
 -- The existing saved-mission read enforces ownership, an unrevoked and unexpired link, valid sources and retention.
 document:=customer.saved_mission_action(resource)->'report';
 SELECT * INTO saved FROM customer_private.saved_mission WHERE id=resource AND principal_id=actor AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 l:=app.delivery_authorized(saved.token_hash,'CLIENT_PROGRESS');
 IF l.id<>saved.link_id OR l.tenant_id<>saved.link_tenant_id OR l.programme_id IS NOT NULL OR cardinality(l.publication_ids)<>1
 OR l.allow_export OR l.include_delegation OR l.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501';
 END IF;
 mission:=document->'missions'->0;
 IF mission IS NULL THEN RAISE EXCEPTION 'Saved mission unavailable' USING ERRCODE='42501'; END IF;
 -- Named fields only. Times are written in UTC so a digest never depends on the session time zone.
 IF kind='TRIP' THEN
  projection:=jsonb_build_object('schemaVersion',1,'kind','TRIP','title',mission->>'title','company',mission->>'company','objective',mission->>'objective',
   'reviewedAt',to_char((mission->>'reviewedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   -- The order of the Trip view (apps/web/lib/trip.ts orderTrip): dated by start, then undated, then changed ones,
   -- each group in the report's own order. A changed schedule or RESCHEDULE_REQUIRED carries no old time or place.
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
  -- The report lists the shortlist without an order. Sort by the company's id, which is then dropped, so a retry
  -- can never reorder the book and change its digest.
  projection:=jsonb_build_object('schemaVersion',1,'kind','SUPPLIER','title',mission->>'title',
   'reviewedAt',to_char((mission->>'reviewedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'shortlist',coalesce((SELECT jsonb_agg(jsonb_build_object('company',s->>'company','country',s->>'country','fit',s->>'fit','rationale',s->>'rationale',
     'uncertainty',s->>'uncertainty','gaps',s->>'gaps','verification',s->>'verification') ORDER BY (s->>'id')::uuid)
    FROM jsonb_array_elements(mission->'experience'->'shortlist') s),'[]'::jsonb));
 END IF;
 digest:=encode(sha256(convert_to(projection::text,'UTF8')),'hex');
 SELECT * INTO prior FROM customer_private.saved_mission_command WHERE principal_id=actor AND command_id=command;
 IF FOUND THEN
  -- An exact retry returns the recorded generation. Any other use of the id, or content that changed since, is refused
  -- and writes nothing: a new download needs a new command.
  IF prior.resource_id<>resource OR (prior.input-ARRAY['digest','generatedAt','publicationId','reviewedAt','schemaVersion'])
   IS DISTINCT FROM jsonb_build_object('action','book','kind',kind,'resourceId',resource) THEN
   RAISE EXCEPTION 'Book command conflicts' USING ERRCODE='23514';
  END IF;
  IF prior.input->>'digest' IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'The reviewed content changed since this download started' USING ERRCODE='23514';
  END IF;
  generated:=prior.input->>'generatedAt';
  replayed:=true;
 ELSIF jsonb_array_length(coalesce(projection->CASE kind WHEN 'TRIP' THEN 'itinerary' ELSE 'shortlist' END,'[]'::jsonb))=0 THEN
  -- Nothing reviewed for this book: no record and no event.
  result:=jsonb_build_object('state','EMPTY');
 ELSE
  IF (SELECT count(*) FROM customer_private.saved_mission_command WHERE principal_id=actor AND resource_id=resource AND input->>'action'='book'
   AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN
   RAISE EXCEPTION 'Too many books for this mission just now' USING ERRCODE='54000';
  END IF;
  generated:=to_char(date_trunc('second',clock_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  INSERT INTO customer_private.saved_mission_command(principal_id,command_id,input,resource_id)
  VALUES(actor,command,jsonb_build_object('action','book','kind',kind,'resourceId',resource,'schemaVersion',1,'digest',digest,'generatedAt',generated,
   'publicationId',mission->>'publicationId','reviewedAt',projection->>'reviewedAt'),resource);
  -- The event names the book, its link (added by the writer) and its publication, never the customer's private saved-mission id.
  PERFORM app.delivery_external_event(l,'delivery.book.generated',command,jsonb_build_object('kind',kind,
   'publicationId',mission->>'publicationId','digest',digest,'schemaVersion',1,'format','PDF'));
 END IF;
 IF result IS NULL THEN
  result:=jsonb_build_object('resourceId',resource,'kind',kind,'command',command,'digest',digest,'generatedAt',generated,
   'expiresAt',to_char((document->>'expiresAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'replayed',replayed,'projection',projection);
 END IF;
 -- Recheck after any lock wait with the real clock: access lost meanwhile rolls back the record and the event.
 IF customer.actor_id() IS DISTINCT FROM actor OR l.expires_at<=clock_timestamp()
 OR (customer.saved_mission_action(resource)->'report') IS DISTINCT FROM document THEN
  RAISE EXCEPTION 'Book access expired or changed' USING ERRCODE='42501';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer.saved_mission_book(uuid,text,uuid,boolean) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.saved_mission_book(uuid,text,uuid,boolean) TO corridra_runtime;
