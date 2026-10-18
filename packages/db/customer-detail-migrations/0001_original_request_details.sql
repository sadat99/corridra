-- Reopen only the creator's original request. No staff research, contacts,
-- quotations or other publication authority is implied by this reference.
CREATE FUNCTION customer.private_request_detail(resource uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=customer_private.request_actor(); owned customer_private.owned_request;
 result jsonb; original jsonb; retained_until timestamptz;
BEGIN
 IF resource IS NULL THEN RAISE EXCEPTION 'Request reference required' USING ERRCODE='23514'; END IF;
 -- request_result locks the immutable ownership row and applies the original
 -- principal/admission/revocation and receipt checks before any source read.
 result:=customer_private.request_result(resource,actor);
 SELECT * INTO owned FROM customer_private.owned_request WHERE id=resource AND principal_id=actor;
 IF (result->>'available')::boolean THEN
  SELECT i.brief,i.retention_until INTO original,retained_until FROM app.mission_intake i
   WHERE i.tenant_id=owned.mission_tenant_id AND i.id=owned.mission_id
   AND i.retention_until>clock_timestamp();
 END IF;
 -- Use wall-clock checks after all reads; transaction-start now() must not
 -- disclose source content after retention or the short provider proof expires.
 IF customer.actor_id() IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'Customer request access expired' USING ERRCODE='42501';
 END IF;
 IF original IS NULL OR retained_until<=clock_timestamp() THEN
  RETURN (result || jsonb_build_object('available',false,'progress',NULL,'original',NULL));
 END IF;
 RETURN result || jsonb_build_object('original',original);
END $$;
REVOKE ALL ON FUNCTION customer.private_request_detail(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.private_request_detail(uuid) TO corridra_runtime;
