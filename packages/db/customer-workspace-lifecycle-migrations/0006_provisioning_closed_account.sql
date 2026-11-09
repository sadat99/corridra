-- CRUD G4 follow-up: giving a person a new workspace to own and closing that person's account now take the same lock, the
-- account lifecycle lock, so they run in turn. Before, a person whose only workspaces were archived could close while a new
-- workspace was being provisioned and both committed, leaving a live workspace owned by a closed account. Now whichever
-- comes second sees the first: a close sees the new workspace and refuses, a provisioning sees the closed account and refuses.
-- The lock is taken before the provisioning lock, which no close takes, so the order cannot deadlock. Provisioning is the only
-- function that creates a workspace and its owner (the personal workspace calls it); accepting an ownership offer takes the
-- same lock in file 0002. Changed only when the live text is exactly the reviewed text of the real-use install.
DO $provision$
DECLARE original text;updated text;
 lock_anchor text:=E'\n PERFORM pg_advisory_xact_lock(hashtextextended(''customer.provision:''||actor::text,0));';
 closed_anchor text:=E'\n SELECT c.executor_id INTO executor FROM customer_private.configuration c';
BEGIN
 original:=pg_get_functiondef('customer.provision_workspace(uuid,text)'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'0ab5b0fd1fb00d8d891cc6643f58f8c51c8f7cf7cd6b27ac7d26f8d239867e0c'
 THEN RAISE EXCEPTION 'Workspace lifecycle prerequisite differs: customer.provision_workspace'; END IF;
 IF length(original)-length(replace(original,lock_anchor,''))<>length(lock_anchor)
 OR length(original)-length(replace(original,closed_anchor,''))<>length(closed_anchor)
 THEN RAISE EXCEPTION 'Workspace lifecycle replacement differs: customer.provision_workspace'; END IF;
 updated:=replace(original,lock_anchor,E'\n PERFORM customer_private.lock_person_lifecycle(actor);'||lock_anchor);
 -- After the replay of an earlier answer, so a first answer is still returned; before anything is written.
 updated:=replace(updated,closed_anchor,E'\n IF customer_private.closed_person(actor) THEN RAISE EXCEPTION ''That account is closed'' USING ERRCODE=''23514''; END IF;'||closed_anchor);
 EXECUTE updated;
END $provision$;
