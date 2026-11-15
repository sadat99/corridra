-- Rate limit keys no longer outlive their hour. 15 November 2026, follow-up to ADR-085 (owner direction relayed by Orchestrator 12:
-- "u update the privacy section to best extent and approve by yourself"; the hashed email key kept for the helper interest form
-- must not be kept).
--
-- app.intake_budget (0007) counts calls per keyed hash per hour in app.intake_rate_limit. It never removed a row, so every key (the
-- helper interest email hash, and the keys of mission intake, buyer replies and delivery) stayed forever. A row whose window_start
-- is before the current hour has NO effect: the next call with that key resets its count to 1. Deleting such rows therefore changes
-- no answer for any caller.
-- This forward file replaces the function with one that is identical (same signature, return, SECURITY DEFINER, fixed search path,
-- the 6 and 60 check and the same upsert) except that, after counting the caller, it deletes up to 500 rows of earlier hours. It also purges the
-- rows already stale once, and adds an index on window_start so the delete does not scan the table. A key therefore leaves the
-- table at the first call after its hour ends, and with a backlog of more than 500 within the next few calls. Nothing runs without
-- traffic: on a quiet site a stale key waits for the next call. customer.real_request_budget (real-use module) keeps its own upsert and
-- its stale rows are cleared by the same delete.
-- Blast radius: one counter table. No evidence, money, identity or event row is read or changed, and no event is written. Grants
-- on the function and on the table are unchanged (the table stays revoked from the runtime and auth logins).
DO $guard$
DECLARE definition text;
BEGIN
 IF to_regclass('app.intake_rate_limit') IS NULL OR to_regprocedure('app.intake_budget(text,integer)') IS NULL THEN
  RAISE EXCEPTION 'Intake budget prerequisite is missing';
 END IF;
 definition:=pg_get_functiondef('app.intake_budget(text,integer)'::regprocedure);
 IF strpos(definition,'SECURITY DEFINER')=0
 OR strpos(definition,'maximum NOT IN (6,60)')=0
 OR strpos(definition,'ON CONFLICT(key) DO UPDATE SET count=CASE WHEN app.intake_rate_limit.window_start<date_trunc(''hour'',now()) THEN 1 ELSE app.intake_rate_limit.count+1 END,window_start=date_trunc(''hour'',now()) RETURNING count INTO n;')=0 THEN
  RAISE EXCEPTION 'Reviewed intake budget baseline differs';
 END IF;
END $guard$;

-- Rows of earlier hours have no effect, so removing them changes nothing.
DELETE FROM app.intake_rate_limit WHERE window_start<date_trunc('hour',now());
CREATE INDEX intake_rate_limit_window ON app.intake_rate_limit(window_start);

CREATE OR REPLACE FUNCTION app.intake_budget(k text,maximum integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF k !~ '^[a-f0-9]{64}$' OR maximum NOT IN (6,60) THEN RAISE EXCEPTION 'Invalid budget'; END IF;
 -- The caller's own counter is taken first, so it is locked and no longer stale before any cleanup runs. Then a bounded batch of
 -- counters of earlier hours is removed; rows another call holds are skipped. Because a call never waits for a row after it has taken
 -- its own, two calls cannot wait on each other (counting after cleaning could deadlock at an hour rollover).
 INSERT INTO app.intake_rate_limit VALUES(k,date_trunc('hour',now()),1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN app.intake_rate_limit.window_start<date_trunc('hour',now()) THEN 1 ELSE app.intake_rate_limit.count+1 END,window_start=date_trunc('hour',now()) RETURNING count INTO n;
 DELETE FROM app.intake_rate_limit WHERE key IN (
  SELECT r.key FROM app.intake_rate_limit r WHERE r.window_start<date_trunc('hour',now()) ORDER BY r.window_start LIMIT 500 FOR UPDATE SKIP LOCKED);
 RETURN n<=maximum;
END $$;
-- The grants of 0007, stated again so the file is complete on its own (CREATE OR REPLACE keeps them).
REVOKE ALL ON FUNCTION app.intake_budget(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.intake_budget(text,integer) TO corridra_runtime;
