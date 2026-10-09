CREATE FUNCTION app.commercial_totals(t uuid,ids uuid[]) RETURNS TABLE(currency text,proposal_minor text,commitment_minor text,contract_minor text,invoice_minor text,reported_cash_minor text,confirmed_cash_minor text,repeat_cash_minor text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
WITH p AS MATERIALIZED(SELECT * FROM app.outcome_projection WHERE tenant_id=t AND opportunity_id IN(SELECT id FROM app.opportunity WHERE tenant_id=t AND id=ANY(ids))), r AS MATERIALIZED(SELECT entity_id id,snapshot s FROM p WHERE entity_type='commercial_record'), a AS MATERIALIZED(SELECT snapshot->>'recordId' record_id FROM p WHERE entity_type='accounting_confirmation')
    SELECT s->>'currency' currency,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='PROPOSAL'),0)::text proposal_minor,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='COMMITMENT'),0)::text commitment_minor,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='CONTRACT'),0)::text contract_minor,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='INVOICE'),0)::text invoice_minor,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='CASH_RECEIPT'),0)::text reported_cash_minor,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='CASH_RECEIPT' AND EXISTS(SELECT FROM a WHERE record_id=r.id::text)),0)::text confirmed_cash_minor,
     coalesce(sum((s->>'amountMinor')::numeric) FILTER(WHERE s->>'kind'='CASH_RECEIPT' AND EXISTS(SELECT FROM a WHERE record_id=r.id::text) AND EXISTS(SELECT FROM r rr WHERE rr.s->>'kind'='REPEAT_ORDER' AND rr.s->>'parentId'=coalesce(r.s->>'reverseOf',r.id::text))),0)::text repeat_cash_minor
    FROM r WHERE s ? 'currency' GROUP BY s->>'currency' ORDER BY s->>'currency'
$$;
REVOKE ALL ON FUNCTION app.commercial_totals(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.commercial_totals(uuid,uuid[]) TO corridra_runtime;
