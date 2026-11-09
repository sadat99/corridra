-- CRUD G4: the programme archive guard, for a database where the programme lifecycle module was installed after this one.
-- File 0003 skips the guard when it is not installed, and a file that has run is never run again, so without this file
-- the guard would stay without the workspace gate for good. This file applies the same change as file 0003, to the same
-- reviewed text, and the installer runs it on every run (its name ends in _late). It is a clean skip when the guard is not
-- installed or already has the gate, and it stops the install when the guard is neither the reviewed text nor gated.
DO $programme$
DECLARE original text;updated text;
 anchor text:=E'\n IF EXISTS(SELECT FROM customer_private.programme_current c WHERE c.id=programme AND c.tenant_id=target AND c.archived) THEN';
BEGIN
 IF to_regprocedure('customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)') IS NULL THEN
  RAISE NOTICE 'Workspace lifecycle: customer_private.programme_archived_guard is not installed, so it was left alone';
  RETURN;
 END IF;
 original:=pg_get_functiondef('customer_private.programme_archived_guard(uuid,uuid,boolean,boolean)'::regprocedure);
 IF position('customer_private.workspace_archived(target)' IN original)>0 THEN RETURN; END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'dabbf82cb336a0ddcbbf6a9bd32d48e6fd887ceca8ab9ba950f98c3afec64ff6'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer_private.programme_archived_guard'; END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer_private.programme_archived_guard'; END IF;
 -- Same error code as the programme archive, so the participant screens handle it unchanged.
 updated:=replace(original,anchor,E'\n IF customer_private.workspace_archived(target) THEN RAISE EXCEPTION ''%'',customer_private.workspace_archived_message(organiser) USING ERRCODE=''23514''; END IF;'||anchor);
 EXECUTE updated;
END $programme$;
