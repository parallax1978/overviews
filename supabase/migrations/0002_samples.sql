-- Several samples per day: Google generates a different AI Overview for every
-- request, so each daily capture now takes SAMPLES_PER_DAY (3) snapshots.

alter table public.snapshots
  add column if not exists sample int not null default 1 check (sample >= 1);

alter table public.snapshots
  drop constraint if exists snapshots_tracker_id_day_number_key;

alter table public.snapshots
  drop constraint if exists snapshots_tracker_day_sample_key;

alter table public.snapshots
  add constraint snapshots_tracker_day_sample_key unique (tracker_id, day_number, sample);

-- How much data a report was built from, so the UI can say "cited in 18 of 21 samples".
alter table public.analyses
  add column if not exists samples_total int,
  add column if not exists days_total int;
