-- CRUD G4 follow-up: the archive gate of file 0003 on customer.submit_private_request and customer.workspace_access_command,
-- checked again on every install (its name ends in _late). File 0003 runs once, so a later module that replaces either
-- function with text that has no gate would silently let an archived workspace take new requests, invitations and
-- registrations. Here, a function that has the gate is left alone; one that has lost it but is exactly the reviewed
-- text of file 0003 gets the gate again; anything else stops the install with a plain message instead of being overwritten
-- or left open. A function that is not installed is skipped.
DO $request$
DECLARE original text;updated text;
 anchor text:=E'\n SELECT * INTO plan FROM customer_private.request_attestation a';
BEGIN
 IF to_regprocedure('customer.submit_private_request(uuid,uuid,jsonb)') IS NULL THEN
  RAISE NOTICE 'Workspace lifecycle: customer.submit_private_request is not installed, so it was left alone';
  RETURN;
 END IF;
 original:=pg_get_functiondef('customer.submit_private_request(uuid,uuid,jsonb)'::regprocedure);
 IF position('customer_private.workspace_open_guard(target)' IN original)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'e750eaff1dcdf55e7334fc8512b72d976e888aad24c143aad6b61ffb2fea70f1'
 THEN RAISE EXCEPTION 'Workspace lifecycle gate is missing and the function differs: customer.submit_private_request. Review it and restore the archive gate'; END IF;
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
 IF position('customer_private.workspace_open_guard(target)' IN original)>0
 AND position('customer_private.workspace_open_guard(target,false)' IN original)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'6c91411dd1d6c474bdfaeccb874ef27786f39aec3afb256c2f9a85cf37dd83b2'
 THEN RAISE EXCEPTION 'Workspace lifecycle gate is missing and the function differs: customer.workspace_access_command. Review it and restore the archive gate'; END IF;
 IF length(original)-length(replace(original,invite,''))<>length(invite)
 OR length(original)-length(replace(original,accept,''))<>length(accept)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer.workspace_access_command'; END IF;
 updated:=replace(original,invite,E'\n IF operation=''invite'' THEN\n  PERFORM customer_private.workspace_open_guard(target);\n  INSERT INTO customer_private.workspace_invitation(');
 updated:=replace(updated,accept,E'\n  ELSE\n   PERFORM customer_private.workspace_open_guard(target,false);\n   IF invitation.expires_at<=clock_timestamp() OR EXISTS(');
 EXECUTE updated;
END $access$;
