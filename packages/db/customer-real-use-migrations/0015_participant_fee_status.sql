-- Participant fee status: what the organiser has recorded for the participant's OWN registration, per currency.
-- Owner mandate, 11 Nov 2026, section 11: a payment declaration is not proof of bank receipt, and Corridra does not handle,
-- collect or check payments. Participant to organiser payment happens directly with the organiser; this only shows what the
-- organiser has written in their own ledger (provenance ORGANISER_RECORDED, never verified).
-- Additive: one new function. customer.own_programme_place is not touched; no table, policy, trigger, row or event is created,
-- changed or deleted. Needs customer.own_programme_place (the guards below are the same ones it applies) and the economics ledger.
-- Safe to run more than once: CREATE OR REPLACE, then the same REVOKE and GRANT.
-- Reads only this registration's PARTICIPANT_FEE and PARTICIPANT_PAYMENT entries. No organiser cost, margin, Corridra service fee
-- or other participant's entry is read or returned. Payments are summed net of their reversals (a reversal is a negative entry),
-- the same sign rule as customer.programme_economics. Nothing is converted or summed across currencies.
DO $guard$ BEGIN
 IF to_regprocedure('customer.own_programme_place(uuid)') IS NULL
  OR to_regclass('customer_private.programme_ledger_entry') IS NULL
  OR to_regprocedure('customer_private.participant_scope(uuid,uuid,uuid,boolean)') IS NULL
  OR to_regprocedure('customer_private.coordination_registration_state(uuid)') IS NULL
  OR to_regprocedure('customer_private.coordination_expiry()') IS NULL THEN
  RAISE EXCEPTION 'Participant fee status prerequisite is missing';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION customer.own_programme_fee_status(registration uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;reg customer_private.programme_registration;fees boolean:=false;amounts jsonb:='[]'::jsonb;
BEGIN
 IF customer.actor_id() IS NULL THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 IF registration IS NULL THEN RAISE EXCEPTION 'Invalid registration' USING ERRCODE='23514'; END IF;
 SELECT * INTO reg FROM customer_private.programme_registration r WHERE r.id=registration AND r.principal_id=customer.actor_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 actor:=customer_private.participant_scope(gen_random_uuid(),reg.workspace_id,reg.programme_id,false);
 IF reg.principal_id<>actor OR customer_private.coordination_registration_state(reg.id)<>'ACTIVE' THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='42501'; END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 -- Shown only where the latest published terms say fees apply, as customer.own_programme_place does for the amount due.
 SELECT t.fees_apply INTO fees FROM customer_private.programme_terms_revision t WHERE t.programme_id=reg.programme_id ORDER BY t.version DESC LIMIT 1;
 IF coalesce(fees,false) THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('currency',s.currency,'exponent',c.exponent,'dueMinor',s.due::text,'recordedMinor',s.paid::text,
    'outstandingMinor',(s.due-s.paid)::text) ORDER BY s.currency),'[]'::jsonb) INTO amounts
  FROM (SELECT l.currency,
    coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_FEE'),0) due,
    coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_PAYMENT'),0) paid
   FROM customer_private.programme_ledger_entry l
   WHERE l.registration_id=reg.id AND l.workspace_id=reg.workspace_id AND l.programme_id=reg.programme_id AND l.kind IN ('PARTICIPANT_FEE','PARTICIPANT_PAYMENT')
   GROUP BY l.currency
   HAVING coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_FEE'),0)<>0
    OR coalesce(sum(l.amount_minor::numeric) FILTER(WHERE l.kind='PARTICIPANT_PAYMENT'),0)<>0) s
  JOIN app.currency c ON c.code=s.currency;
 END IF;
 IF customer.actor_id() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Programme access expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('registrationId',reg.id,'programmeId',reg.programme_id,'expiresAt',customer_private.coordination_expiry(),
  'provenance','ORGANISER_RECORDED','verified',false,'collectsPayments',false,'amounts',amounts);
END $$;

REVOKE ALL ON FUNCTION customer.own_programme_fee_status(uuid) FROM PUBLIC,corridra_auth;
GRANT EXECUTE ON FUNCTION customer.own_programme_fee_status(uuid) TO corridra_runtime;
