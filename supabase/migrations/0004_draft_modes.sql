-- Two kinds of draft per report:
--   researched   = ready to publish; every figure comes from a cited web source
--   placeholders = the author fills in their own data where [ADD YOUR DATA: ...] marks it
alter table public.drafts
  add column if not exists mode text not null default 'placeholders'
    check (mode in ('placeholders', 'researched'));

-- Sources a researched draft relied on: [{ url, title, used_for }]
alter table public.drafts
  add column if not exists sources jsonb;

create index if not exists drafts_tracker_mode_idx on public.drafts (tracker_id, mode, created_at desc);
