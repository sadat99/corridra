-- The helper is used inside owner-executed capability functions, never as an
-- independently callable runtime probe of another publisher's membership.
REVOKE EXECUTE ON FUNCTION app.delivery_subject_access(uuid,uuid,text,text) FROM corridra_runtime;
