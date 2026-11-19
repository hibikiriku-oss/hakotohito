-- Hakotohito: application attempt lifecycle (candidate; requires 009 global gate)
-- Existing ledger rows are preserved. Historical paid attempts are marked fee_due=false.
BEGIN;

-- Serialize this migration with every application mutation using the shared gate.
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261116_009_global_mutation_gate.sql before this migration';
  END IF;
  IF to_regclass('public.application_attempts') IS NOT NULL THEN
    RAISE EXCEPTION 'application_attempts already exists; refusing duplicate migration';
  END IF;
  IF to_regclass('public.applications') IS NULL
     OR to_regclass('public.performance_requests') IS NULL
     OR to_regclass('public.performers') IS NULL
     OR to_regclass('public.facilities') IS NULL
     OR to_regclass('public.bands') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL
     OR to_regclass('public.coin_rate_settings') IS NULL THEN
    RAISE EXCEPTION 'Required current production tables are missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.performance_requests pr ON pr.id = a.request_id
    LEFT JOIN public.performers p ON p.id = a.performer_id
    LEFT JOIN public.facilities f ON f.id = pr.facility_id
    WHERE a.source IN ('performer_apply', 'band_apply', 'facility_invite')
      AND a.status IN ('pending', 'accepted', 'rejected')
      AND (p.user_id IS NULL OR f.user_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot backfill application attempts: missing payer user';
  END IF;
  -- Old releases contain direct_invite_fee ledger rows without application_id.
  -- The backfill below can only associate charges by application_id. Continuing
  -- would mark those pending invitations fee_due=true and could charge them
  -- a second time at match establishment. Fail closed until orphaned legacy
  -- fees have been reconciled to their application/request records.
  IF EXISTS (
    SELECT 1
    FROM public.coin_transactions ct
    WHERE ct.transaction_type IN ('direct_invite_fee', 'application_fee')
      AND ct.amount < 0
      AND ct.application_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate application fees safely: legacy application/direct-invite fee transactions have NULL application_id; reconcile them before retrying';
  END IF;
END;
$preflight$;

CREATE TABLE public.application_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.performance_requests(id) ON DELETE CASCADE,
  performer_id uuid NOT NULL REFERENCES public.performers(id),
  band_id uuid NULL REFERENCES public.bands(id),
  payer_user_id uuid NOT NULL REFERENCES public.users(id),
  source text NOT NULL CHECK (source IN ('performer_apply', 'band_apply', 'facility_invite')),
  fee_type text NOT NULL CHECK (fee_type IN ('application_fee', 'direct_invite_fee')),
  fee_amount integer NOT NULL CHECK (fee_amount > 0),
  fee_due boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'expired', 'rejected', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  matched_at timestamptz NULL,
  fee_charged_at timestamptz NULL,
  match_id uuid NULL REFERENCES public.matches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_attempts FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX application_attempts_one_pending_per_application_idx
  ON public.application_attempts(application_id)
  WHERE status = 'pending';
CREATE INDEX application_attempts_expiry_idx
  ON public.application_attempts(expires_at, id)
  WHERE status = 'pending';
CREATE INDEX application_attempts_request_idx
  ON public.application_attempts(request_id, status, started_at DESC);
CREATE UNIQUE INDEX application_attempts_one_attempt_per_match_idx
  ON public.application_attempts(match_id)
  WHERE match_id IS NOT NULL;

-- Preserve historical charge semantics. Old pending attempts that already paid
-- their fee are not charged again when matched; new attempts use fee_due=true.
INSERT INTO public.application_attempts (
  id, application_id, request_id, performer_id, band_id, payer_user_id,
  source, fee_type, fee_amount, fee_due, status, started_at, expires_at,
  matched_at, fee_charged_at, match_id, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  a.id,
  a.request_id,
  a.performer_id,
  a.band_id,
  CASE WHEN a.source = 'facility_invite' THEN f.user_id ELSE p.user_id END,
  a.source,
  CASE WHEN a.source = 'facility_invite' THEN 'direct_invite_fee' ELSE 'application_fee' END,
  COALESCE(
    CASE WHEN old_fee.amount < 0 THEN -old_fee.amount END,
    CASE WHEN a.source = 'facility_invite'
      THEN COALESCE(cr.direct_invitation_fee_coins, 100)
      ELSE COALESCE(cr.application_fee_coins, 10)
    END
  ),
  old_fee.id IS NULL AND a.status = 'pending',
  CASE
    WHEN a.status = 'pending' THEN 'pending'
    WHEN a.status = 'accepted' THEN 'matched'
    ELSE 'rejected'
  END,
  COALESCE(old_fee.created_at, a.created_at),
  COALESCE(old_fee.created_at, a.created_at) + interval '7 days',
  CASE WHEN a.status = 'accepted' THEN COALESCE(m.matched_at, a.created_at) ELSE NULL END,
  old_fee.created_at,
  m.id,
  COALESCE(old_fee.created_at, a.created_at),
  now()
FROM public.applications a
JOIN public.performance_requests pr ON pr.id = a.request_id
JOIN public.facilities f ON f.id = pr.facility_id
JOIN public.performers p ON p.id = a.performer_id
LEFT JOIN public.coin_rate_settings cr ON cr.id = 1
LEFT JOIN public.matches m ON m.application_id = a.id
LEFT JOIN LATERAL (
  SELECT ct.id, ct.amount, ct.created_at
  FROM public.coin_transactions ct
  WHERE ct.application_id = a.id
    AND ct.transaction_type = CASE
      WHEN a.source = 'facility_invite' THEN 'direct_invite_fee'
      ELSE 'application_fee'
    END
    AND ct.amount < 0
  ORDER BY ct.created_at DESC, ct.id DESC
  LIMIT 1
) old_fee ON true
WHERE a.source IN ('performer_apply', 'band_apply', 'facility_invite')
  AND a.status IN ('pending', 'accepted', 'rejected');

-- The new table must participate in the same global transaction gate.
CREATE TRIGGER trg_global_mutation_gate
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.application_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION public.acquire_global_mutation_gate_trigger();

CREATE OR REPLACE FUNCTION public.expire_pending_application_attempts(p_limit integer DEFAULT 500)
RETURNS TABLE(expired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  WITH due AS (
    SELECT aa.id, aa.application_id
    FROM public.application_attempts aa
    WHERE aa.status = 'pending'
      AND aa.expires_at <= now()
    ORDER BY aa.expires_at, aa.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000))
  ), expired AS (
    UPDATE public.application_attempts aa
    SET status = 'expired', updated_at = now()
    FROM due d
    WHERE aa.id = d.id
      AND aa.status = 'pending'
    RETURNING aa.application_id
  ), rejected AS (
    UPDATE public.applications a
    SET status = 'rejected'
    FROM expired e
    WHERE a.id = e.application_id
      AND a.status = 'pending'
    RETURNING a.id
  )
  SELECT count(*)::integer INTO v_expired FROM expired;

  RETURN QUERY SELECT v_expired;
END;
$function$;

ALTER FUNCTION public.expire_pending_application_attempts(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.expire_pending_application_attempts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_pending_application_attempts(integer) TO service_role;

COMMIT;
