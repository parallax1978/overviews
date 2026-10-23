-- One draft write at a time per report: regenerateDraft claims this timestamp
-- atomically (null or older than 15 minutes) and clears it when done, so the
-- cron and the keyword page cannot both pay for the same draft.
alter table public.analyses
  add column if not exists draft_started_at timestamptz;
