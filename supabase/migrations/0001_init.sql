-- Legiit Overviews: initial schema.
-- Apply with `supabase db push` (Supabase CLI) or paste into the SQL editor.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- trackers: one row per keyword a user is tracking
-- ---------------------------------------------------------------------------
create table if not exists public.trackers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null check (char_length(keyword) between 1 and 200),
  location_code int not null default 2840,
  location_name text not null default 'United States',
  language_code text not null default 'en',
  device text not null default 'desktop' check (device in ('desktop', 'mobile')),
  target_domain text,
  user_edge text,
  status text not null default 'tracking'
    check (status in ('tracking', 'ready', 'analyzing', 'analyzed', 'paused', 'error')),
  days_target int not null default 7 check (days_target between 2 and 30),
  day_count int not null default 0,
  next_capture_at timestamptz,
  keep_tracking boolean not null default false,
  cited_on_day int,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists trackers_user_id_idx on public.trackers (user_id, created_at desc);
create index if not exists trackers_due_idx on public.trackers (next_capture_at)
  where status in ('tracking', 'analyzed', 'ready') ;

-- ---------------------------------------------------------------------------
-- snapshots: one row per tracker per captured day
-- ---------------------------------------------------------------------------
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trackers(id) on delete cascade,
  day_number int not null check (day_number >= 1),
  captured_at timestamptz not null default now(),
  has_overview boolean not null,
  overview_text text,
  overview_markdown text,
  "references" jsonb not null default '[]'::jsonb,
  inline_links jsonb not null default '[]'::jsonb,
  raw jsonb,
  content_hash text,
  diff jsonb,
  cost_usd numeric(10, 6) not null default 0,
  unique (tracker_id, day_number)
);

create index if not exists snapshots_tracker_idx on public.snapshots (tracker_id, day_number);

-- ---------------------------------------------------------------------------
-- analyses: output of the Claude pattern + citation research call
-- ---------------------------------------------------------------------------
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trackers(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  step text,
  model text,
  patterns jsonb,
  citation_research jsonb,
  blueprint jsonb,
  summary_md text,
  usage jsonb,
  error text
);

create index if not exists analyses_tracker_idx on public.analyses (tracker_id, created_at desc);

-- ---------------------------------------------------------------------------
-- drafts: the written page
-- ---------------------------------------------------------------------------
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trackers(id) on delete cascade,
  analysis_id uuid references public.analyses(id) on delete set null,
  created_at timestamptz not null default now(),
  title text,
  meta_description text,
  h1 text,
  outline jsonb,
  content_md text,
  why_better_md text,
  notes text,
  model text,
  usage jsonb
);

create index if not exists drafts_tracker_idx on public.drafts (tracker_id, created_at desc);

-- ---------------------------------------------------------------------------
-- api_log: every external API call, for cost reporting (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.api_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  tracker_id uuid,
  provider text not null,
  endpoint text not null,
  status int,
  cost_usd numeric(10, 6),
  duration_ms int,
  error text
);

create index if not exists api_log_created_idx on public.api_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Users read/write their own trackers. Child rows are readable through
-- tracker ownership. All writes to child rows happen server-side with the
-- service role, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.trackers enable row level security;
alter table public.snapshots enable row level security;
alter table public.analyses enable row level security;
alter table public.drafts enable row level security;
alter table public.api_log enable row level security;

drop policy if exists "trackers: owner select" on public.trackers;
create policy "trackers: owner select" on public.trackers
  for select using (auth.uid() = user_id);

drop policy if exists "trackers: owner insert" on public.trackers;
create policy "trackers: owner insert" on public.trackers
  for insert with check (auth.uid() = user_id);

drop policy if exists "trackers: owner update" on public.trackers;
create policy "trackers: owner update" on public.trackers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "trackers: owner delete" on public.trackers;
create policy "trackers: owner delete" on public.trackers
  for delete using (auth.uid() = user_id);

drop policy if exists "snapshots: owner select" on public.snapshots;
create policy "snapshots: owner select" on public.snapshots
  for select using (
    exists (select 1 from public.trackers t where t.id = tracker_id and t.user_id = auth.uid())
  );

drop policy if exists "analyses: owner select" on public.analyses;
create policy "analyses: owner select" on public.analyses
  for select using (
    exists (select 1 from public.trackers t where t.id = tracker_id and t.user_id = auth.uid())
  );

drop policy if exists "drafts: owner select" on public.drafts;
create policy "drafts: owner select" on public.drafts
  for select using (
    exists (select 1 from public.trackers t where t.id = tracker_id and t.user_id = auth.uid())
  );

-- api_log has RLS enabled and no policies: only the service role can touch it.
