-- Additive: one read-only function. Counts the delegates of one programme whose latest shared objective
-- summary is SHARED, whose registration is not ended and whose private source is still available, by the
-- same tests the organiser view of customer.programme_mission_summaries applies to each registration.
-- It returns one integer: no kind, no text, no id. Owner and admin of the programme workspace only.
-- It calls customer_private.programme_mission_source by name, so a later module that replaces that
-- function (real use) is followed without a change here.
CREATE FUNCTION customer.programme_shared_objective_count(workspace uuid,programme uuid) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer.actor_id();command uuid:=gen_random_uuid();total integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 PERFORM customer_private.participant_scope(command,workspace,programme,true);
 SELECT count(DISTINCT l.registration_id)::integer INTO total
 FROM customer_private.programme_registration r
 JOIN customer_private.programme_mission_link l ON l.registration_id=r.id
 WHERE r.workspace_id=workspace AND r.programme_id=programme
 AND NOT EXISTS(SELECT FROM customer_private.programme_participant_revocation v WHERE v.registration_id=r.id)
 AND (SELECT h.status FROM customer_private.programme_mission_revision h WHERE h.link_id=l.id ORDER BY h.version DESC LIMIT 1)='SHARED'
 AND customer_private.programme_mission_source(l.id) IS NOT NULL;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Participant source access expired' USING ERRCODE='42501'; END IF;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION customer.programme_shared_objective_count(uuid,uuid) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_shared_objective_count(uuid,uuid) TO corridra_runtime;
