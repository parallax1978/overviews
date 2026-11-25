-- A keyword's report can be shared with anyone who has the link: a long random
-- token, set and cleared only by server code (keyword writes are server-only).
-- The public page reads the report with the service role by this token.
alter table public.trackers add column if not exists share_token text;
create unique index if not exists trackers_share_token_idx on public.trackers (share_token) where share_token is not null;
