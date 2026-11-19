-- v23 migration 011 schema rollback only.
-- This removes the trigger/function; it does NOT restore lesson_applications.status
-- values already changed to rejected by a completed withdrawal. Those rows must
-- not be blindly re-opened. Review operational consequences before rollback.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);
DROP TRIGGER IF EXISTS trg_close_pending_lesson_applications_on_withdrawal ON public.users;
DROP FUNCTION IF EXISTS public.close_pending_lesson_applications_on_withdrawal();
NOTIFY pgrst, 'reload schema';
COMMIT;
