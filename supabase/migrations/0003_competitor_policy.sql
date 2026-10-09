-- Whether the written page may name other brands. Default: never recommend a
-- competitor; the page positions the author's own site or product.
alter table public.trackers
  add column if not exists competitor_policy text not null default 'avoid'
    check (competitor_policy in ('avoid', 'compare'));
