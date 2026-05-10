-- Add form_responses JSONB column to user_configs.
-- Stores the full ProtonDB-format form answers (verdict, faultKeys, canInstall,
-- tinkering methods, etc.) so we can replay the deriveRating algorithm later
-- and compare native Pulse reports directly with ProtonDB live reports.

alter table public.user_configs
  add column if not exists form_responses jsonb;
