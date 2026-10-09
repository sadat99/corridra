-- Tenant-scoped, actor/MFA-checked insertion guards call publication validation
-- internally. Runtime callers cannot probe another tenant's publication validity.
ALTER FUNCTION app.delivery_guard() SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION app.delivery_publication_valid(uuid) FROM corridra_runtime;
