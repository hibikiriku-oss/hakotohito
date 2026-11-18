BEGIN;

ALTER TABLE public.performance_requests
  ADD COLUMN IF NOT EXISTS venue_address text;

COMMENT ON COLUMN public.performance_requests.venue_address IS
  '案件ごとに明示的に公開する開催場所住所。facilities.address（施設登録住所）から自動転記・公開しない。';

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'performance_requests_venue_address_length_check'
      AND conrelid = 'public.performance_requests'::regclass
  ) THEN
    ALTER TABLE public.performance_requests
      ADD CONSTRAINT performance_requests_venue_address_length_check
      CHECK (
        venue_address IS NULL
        OR char_length(venue_address) <= 500
      );
  END IF;
END;
$check$;

COMMIT;
