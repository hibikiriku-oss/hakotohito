-- Hakotohito limited-release cancellation patch: read-only preflight
-- Run before applying 20261112_001_known_audit_fixes.sql.
-- Export/save the complete result so the live definitions can be restored if needed.

SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_functiondef(p.oid) AS function_definition,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  p.proacl AS function_acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'cancel_match_with_direct_invite_refund',
    'accept_direct_invitation_atomic',
    'withdraw_user_account',
    'reject_direct_invitation_with_refund_for_withdrawal'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- Confirm the disputed timestamp column and match/application linkage.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'matches' AND column_name IN (
      'completion_disputed_at', 'completed_at', 'application_id'
    ))
    OR (table_name = 'applications' AND column_name IN ('status', 'source'))
  )
ORDER BY table_name, ordinal_position;
