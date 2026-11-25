-- Keywords cost credits now, so a browser must not create or change one
-- directly through the database API: that would skip the charge (or flip a
-- keyword onto the app's keys). The server creates and updates keywords with
-- the service role after checking the plan, the credits and ownership.
-- Owners can still read and delete their own keywords.
drop policy if exists "trackers: owner insert" on public.trackers;
drop policy if exists "trackers: owner update" on public.trackers;
