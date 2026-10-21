-- Shared real-use budgets support ordinary workspace work while keeping legacy 6/60 limits intact.
CREATE FUNCTION customer.real_request_budget(k text, maximum integer) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF NOT EXISTS(SELECT FROM customer_private.real_use_configuration WHERE enabled) OR k IS NULL OR k !~ '^[a-f0-9]{64}$' OR maximum NOT IN (120,10000) THEN RAISE EXCEPTION 'Invalid real request budget' USING ERRCODE='23514';END IF;
 INSERT INTO app.intake_rate_limit VALUES(k,date_trunc('hour',now()),1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN app.intake_rate_limit.window_start<date_trunc('hour',now()) THEN 1 ELSE app.intake_rate_limit.count+1 END,window_start=date_trunc('hour',now()) RETURNING count INTO n;
 RETURN n<=maximum;
END $$;
CREATE FUNCTION customer.intake_available() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT customer_private.real_admission_open() $$;
REVOKE ALL ON FUNCTION customer.real_request_budget(text,integer),customer.intake_available() FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.real_request_budget(text,integer),customer.intake_available() TO corridra_runtime;
