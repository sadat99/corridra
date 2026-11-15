-- Rate limit keys no longer outlive their use. 15 November 2026, follow-up to ADR-085 (owner direction relayed by Orchestrator 12:
-- "u update the privacy section to best extent and approve by yourself"; the hashed email key kept for the helper interest form
-- must not be kept).
--
-- app.intake_rate_limit holds one counter per keyed hash per hour. Two functions write it, app.intake_budget (0007: mission intake,
-- buyer replies, delivery, helper interest) and customer.real_request_budget (real-use module, real mode intake). Neither ever
-- removed a row, so every key stayed forever.
-- A row whose window_start is more than two hours old has NO effect: its hour ended over an hour ago and the next call with that
-- key resets its count to 1. Deleting such a row therefore changes no answer for any caller.
-- This file adds ONE new function, app.intake_rate_limit_purge(), that deletes up to 500 such rows, and an index on window_start so
-- the delete does not scan the table. It also purges the rows already that old once. It replaces no existing function: app.intake_budget
-- and customer.real_request_budget are exactly as before, so every writer is covered with no module install.
-- The purge is NOT called from inside either budget function. A delete of other callers' rows inside a budget transaction can wait
-- on a row another caller's budget call is about to take, and two such calls can then wait on each other (deadlock, 40P01). The
-- application calls the purge as its own statement, in its own transaction, after the budget query. Inside that statement the rows
-- are picked FOR UPDATE SKIP LOCKED, so the purge never waits for a row and holds nothing while it runs. The two hour threshold never
-- touches a current or previous hour row, whatever the time zone or the hour boundary.
-- Blast radius: one counter table. No evidence, money, identity or event row is read or changed, and no event is written. The
-- table stays revoked from the runtime and auth logins; only the new function (definer) deletes, and only the runtime login may
-- call it.
DO $guard$
BEGIN
 IF to_regclass('app.intake_rate_limit') IS NULL OR to_regprocedure('app.intake_budget(text,integer)') IS NULL THEN
  RAISE EXCEPTION 'Intake budget prerequisite is missing';
 END IF;
END $guard$;

-- Rows more than two hours old have no effect, so removing them changes nothing.
DELETE FROM app.intake_rate_limit WHERE window_start<now()-interval '2 hours';
CREATE INDEX intake_rate_limit_window ON app.intake_rate_limit(window_start);

CREATE FUNCTION app.intake_rate_limit_purge() RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM app.intake_rate_limit WHERE key IN (
  SELECT r.key FROM app.intake_rate_limit r WHERE r.window_start<now()-interval '2 hours' ORDER BY r.window_start LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION app.intake_rate_limit_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.intake_rate_limit_purge() TO corridra_runtime;
