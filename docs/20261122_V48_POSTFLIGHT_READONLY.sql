-- V48 postflight: SELECT-only. Run after V48 migrations.
SELECT
  to_regclass('public.application_participant_claims') IS NOT NULL AS participant_claims_table_exists,
  to_regclass('public.application_band_trade_history') IS NOT NULL AS band_trade_history_table_exists,
  to_regprocedure('public.update_band_profile(uuid,uuid,text,text)') IS NOT NULL AS band_profile_rpc_exists;

SELECT table_name,column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('application_attempts','matches')
  AND column_name IN (
    'participant_performer_ids','participant_snapshot_available',
    'band_name_snapshot','band_description_snapshot',
    'band_leader_performer_id_snapshot','band_snapshot_available',
    'snapshot_quarantine_reason'
  )
ORDER BY table_name,ordinal_position;

SELECT c.relname AS table_name,t.tgname AS trigger_name,t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND t.tgname IN (
    'trg_capture_application_attempt_participants',
    'trg_claim_application_attempt_participants',
    'trg_prevent_application_attempt_snapshot_mutation',
    'trg_apply_application_attempt_snapshot_to_match',
    'trg_prevent_match_participant_snapshot_mutation'
  )
ORDER BY c.relname,t.tgname;

SELECT
  (SELECT count(*) FROM public.application_participant_claims) AS participant_claims,
  (SELECT count(*) FROM public.application_band_trade_history) AS band_trade_claims,
  (SELECT count(*) FROM public.application_attempts WHERE band_id IS NOT NULL AND status='pending' AND participant_snapshot_available=false) AS quarantined_pending_band_attempts;

SELECT
  has_function_privilege('anon','public.update_band_profile(uuid,uuid,text,text)','EXECUTE') AS anon_can_edit_band,
  has_function_privilege('authenticated','public.update_band_profile(uuid,uuid,text,text)','EXECUTE') AS authenticated_can_edit_band,
  has_function_privilege('service_role','public.update_band_profile(uuid,uuid,text,text)','EXECUTE') AS service_role_can_edit_band;
