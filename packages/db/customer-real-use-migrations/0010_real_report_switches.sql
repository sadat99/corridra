-- Two owner switches for shared reports that belong to real workspaces. 0009 gave a verified real customer session the
-- real purpose when it reads a non-sample tenant's share. This replaces only that helper so the application can also:
--  * turn signed-in access off: the application sets corridra.real_report_signed_in to 'off' in every customer session
--    while the owner switch is off, and a real session then gets the ordinary (sample) purpose, so the share is refused;
--  * open the public link: the application sets corridra.real_report_public to 'on', for one transaction, on the
--    anonymous view and respond calls only while the owner switch is on.
-- A missing signed-in setting means on, which is exactly the behaviour of 0009. The public setting never applies to a
-- sample tenant, and nothing else about the staff re-check changes: the share's creator must still hold an owner or admin
-- role, a verified authenticator, the real purpose and the real-use authority in that tenant.
DO $guard$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('app.delivery_purpose(uuid)'::regprocedure),'UTF8')),'hex')<>'f982df2687ea688ef6a5d890a4a55505ea8d9628455269be0cd1b57dae403007' THEN RAISE EXCEPTION 'Real-use prerequisite function differs: app.delivery_purpose'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app.delivery_purpose(t uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN NULLIF(current_setting('corridra.tenant_id',true),'') IS NULL AND app.tenant_is_synthetic(t)=false AND (
   (customer_private.real_session() AND coalesce(NULLIF(current_setting('corridra.real_report_signed_in',true),''),'on')<>'off')
   OR current_setting('corridra.real_report_public',true)='on')
 THEN 'commercial_qualification'
 ELSE app.tenant_processing_purpose(NULLIF(current_setting('corridra.tenant_id',true),'')::uuid) END
$$;
