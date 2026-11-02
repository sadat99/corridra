-- GAP-007: optional invitation address and an explicit, freshly authorized email action.
-- Canonical acceptance/revocation, one-time code disclosure and existing grants remain unchanged.
ALTER TABLE customer_private.programme_invitation ADD COLUMN IF NOT EXISTS recipient_email text
 CHECK(recipient_email IS NULL OR (length(recipient_email) BETWEEN 3 AND 254 AND recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'));

DO $patch$
DECLARE original text:=pg_get_functiondef('customer.programme_participant_command(uuid,text,jsonb)'::regprocedure);updated text;
BEGIN
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'d01d1c536141c02dec5959b1b4555c80cbc5db5e9407918e57788fa95598c749' THEN
  RAISE EXCEPTION 'Participant email prerequisite differs';
 END IF;
 updated:=replace(original,
  ' IF operation=''invite'' THEN',
  ' IF operation=''invite'' THEN
  IF input ? ''recipientEmail'' AND (jsonb_typeof(input->''recipientEmail'') IS DISTINCT FROM ''string'' OR length(input->>''recipientEmail'') NOT BETWEEN 3 AND 254
   OR input->>''recipientEmail'' !~ ''^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'' OR input->>''recipientEmail''<>lower(btrim(input->>''recipientEmail''))) THEN
   RAISE EXCEPTION ''Invalid participant email'' USING ERRCODE=''23514'';
  END IF;');
 updated:=replace(updated,'ARRAY[''workspaceId'',''programmeId'',''label'',''tokenHash'',''acknowledged'']','ARRAY[''workspaceId'',''programmeId'',''label'',''tokenHash'',''acknowledged'',''recipientEmail'']');
 updated:=replace(updated,'request:=input-''tokenHash'';',
  'request:=input-ARRAY[''tokenHash'',''recipientEmail''];
  IF input ? ''recipientEmail'' THEN request:=request||jsonb_build_object(''recipientEmailHash'',encode(sha256(convert_to(input->>''recipientEmail'',''UTF8'')),''hex''));END IF;');
 updated:=replace(updated,'created_by,label,token_hash,expires_at)','created_by,label,token_hash,expires_at,recipient_email)');
 updated:=replace(updated,'clock_timestamp()+interval ''7 days''-interval ''1 second'') RETURNING * INTO invitation;',
  'clock_timestamp()+interval ''7 days''-interval ''1 second'',input->>''recipientEmail'') RETURNING * INTO invitation;');
 IF updated=original OR position('recipientEmailHash' IN updated)=0 OR position('expires_at,recipient_email' IN updated)=0 THEN
  RAISE EXCEPTION 'Participant email replacement differs';
 END IF;
 EXECUTE updated;
END $patch$;

CREATE FUNCTION customer.programme_invitation_email(selected uuid,target uuid,programme uuid,digest text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.participant_scope(gen_random_uuid(),target,programme,true);invitation customer_private.programme_invitation;
BEGIN
 SELECT * INTO invitation FROM customer_private.programme_invitation WHERE id=selected AND workspace_id=target AND programme_id=programme FOR SHARE;
 IF NOT FOUND OR digest IS NULL OR digest<>invitation.token_hash OR NOT customer_private.participant_invitation_active(selected)
  OR EXISTS(SELECT FROM customer_private.programme_registration WHERE invitation_id=selected) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
 END IF;
 IF invitation.recipient_email IS NULL THEN RAISE EXCEPTION 'Invitation email unavailable' USING ERRCODE='23514';END IF;
 IF customer_private.participant_scope(gen_random_uuid(),target,programme,true) IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'Participant access expired' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('id',invitation.id,'programmeId',programme,'recipientEmail',invitation.recipient_email,'synthetic',customer_private.synthetic_context());
END $$;
REVOKE ALL ON FUNCTION customer.programme_invitation_email(uuid,uuid,uuid,text) FROM PUBLIC,corridra_runtime,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.programme_invitation_email(uuid,uuid,uuid,text) TO corridra_runtime;
