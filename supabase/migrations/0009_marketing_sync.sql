-- When the user was added to the GetResponse list (lib/getresponse.ts).
-- Null means not yet: the app adds them on their next visit to the signed-in area.
alter table public.accounts add column if not exists marketing_synced_at timestamptz;
