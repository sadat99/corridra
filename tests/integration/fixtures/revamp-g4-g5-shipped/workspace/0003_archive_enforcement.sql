-- CRUD G4: an archived workspace refuses new private requests, new invitations and new registrations until it is
-- restored. Nothing else changes: records stay readable, issued invitations are neither revoked nor extended (they cannot
-- be used while archived), and service requests and drafts stay open. A never-archived workspace behaves exactly as before.
-- Three existing functions are changed by adding one gate each. Each change is made only when the live text is exactly the
-- reviewed text, so a newer or different definition stops the install instead of being overwritten, and one that is not
-- installed (an optional module) is skipped. The gate is customer_private.workspace_open_guard (file 0001), called inside
-- the writing transaction under the access lock of the workspace, which is the lock an archive takes.
-- The reviewed hashes were recorded from a database built in production order: the real-use schema, then the programme
-- lifecycle module.
DO $request$
DECLARE original text;updated text;
 anchor text:=E'\n SELECT * INTO plan FROM customer_private.request_attestation a';
BEGIN
 IF to_regprocedure('customer.submit_private_request(uuid,uuid,jsonb)') IS NULL THEN
  RAISE NOTICE 'Workspace lifecycle: customer.submit_private_request is not installed, so it was left alone';
  RETURN;
 END IF;
 original:=pg_get_functiondef('customer.submit_private_request(uuid,uuid,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'e750eaff1dcdf55e7334fc8512b72d976e888aad24c143aad6b61ffb2fea70f1'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer.submit_private_request'; END IF;
 -- After the replay of an earlier answer and the access check, so a first answer is always returned and an outsider learns nothing.
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer.submit_private_request'; END IF;
 updated:=replace(original,anchor,E'\n PERFORM customer_private.workspace_open_guard(target);'||anchor);
 EXECUTE updated;
END $request$;

DO $access$
DECLARE original text;updated text;
 invite text:=E'\n IF operation=''invite'' THEN\n  INSERT INTO customer_private.workspace_invitation(';
 accept text:=E'\n  ELSE\n   IF invitation.expires_at<=clock_timestamp() OR EXISTS(';
BEGIN
 IF to_regprocedure('customer.workspace_access_command(uuid,text,jsonb)') IS NULL THEN
  RAISE NOTICE 'Workspace lifecycle: customer.workspace_access_command is not installed, so it was left alone';
  RETURN;
 END IF;
 original:=pg_get_functiondef('customer.workspace_access_command(uuid,text,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'6c91411dd1d6c474bdfaeccb874ef27786f39aec3afb256c2f9a85cf37dd83b2'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer.workspace_access_command'; END IF;
 -- Issuing an invitation, and the first acceptance of one. A repeat of an accepted invitation, a revocation and a replay are not gated.
 IF length(original)-length(replace(original,invite,''))<>length(invite)
 OR length(original)-length(replace(original,accept,''))<>length(accept)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer.workspace_access_command'; END IF;
 updated:=replace(original,invite,E'\n IF operation=''invite'' THEN\n  PERFORM customer_private.workspace_open_guard(target);\n  INSERT INTO customer_private.workspace_invitation(');
 updated:=replace(updated,accept,E'\n  ELSE\n   PERFORM customer_private.workspace_open_guard(target,false);\n   IF invitation.expires_at<=clock_timestamp() OR EXISTS(');
 EXECUTE updated;
END $access$;

DO $programme$
DECLARE original text;updated text;
 anchor text:=E'\n IF EXISTS(SELECT FROM customer_private.programme_current c WHERE c.id=programme AND c.tenant_id=target AND c.archived) THEN';
BEGIN
 IF to_regprocedure('customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)') IS NULL THEN
  RAISE NOTICE 'Workspace lifecycle: customer_private.programme_archived_guard is not installed, so it was left alone';
  RETURN;
 END IF;
 original:=pg_get_functiondef('customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'dabbf82cb336a0ddcbbf6a9bd32d48e6fd887ceca8ab9ba950f98c3afec64ff6'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer_private.programme_archived_guard'; END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer_private.programme_archived_guard'; END IF;
 -- Same error code as the programme archive, so the participant screens handle it unchanged.
 updated:=replace(original,anchor,E'\n IF customer_private.workspace_archived(target) THEN RAISE EXCEPTION ''%'',customer_private.workspace_archived_message(organiser) USING ERRCODE=''23514''; END IF;'||anchor);
 EXECUTE updated;
END $programme$;
