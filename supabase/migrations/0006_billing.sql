-- Billing: two ways to pay for the API calls a keyword needs.
--   own keys  = the user saves their own DataForSEO and Anthropic keys; free.
--   platform  = the app's keys, paid with plan credits (Stripe subscription).
-- Every keyword records which one it runs on (trackers.billing_source).

-- ---------------------------------------------------------------------------
-- accounts: plan, Stripe link and credit balance, one row per user
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro', 'agency', 'staff')),
  subscription_status text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  credits_balance int not null default 0 check (credits_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which plan's credits were granted for which billing period, so an upgrade
-- mid-period tops up only the difference and a renewal starts fresh.
alter table public.accounts add column if not exists granted_plan text;
alter table public.accounts add column if not exists granted_period_start timestamptz;

alter table public.accounts enable row level security;
drop policy if exists "accounts: owner select" on public.accounts;
create policy "accounts: owner select" on public.accounts
  for select using (auth.uid() = user_id);
-- No insert/update policies: only server code (service role) changes accounts.

-- ---------------------------------------------------------------------------
-- credit_ledger: every credit added or spent, for history and idempotency
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  balance_after int not null,
  reason text not null,
  tracker_id uuid references public.trackers(id) on delete set null,
  external_id text unique,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;
drop policy if exists "credit_ledger: owner select" on public.credit_ledger;
create policy "credit_ledger: owner select" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_api_keys: a user's own DataForSEO and Anthropic keys, encrypted by the
-- app (AES-256-GCM) before they reach the database. Service role only.
-- ---------------------------------------------------------------------------
create table if not exists public.user_api_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dataforseo_login_enc text,
  dataforseo_password_enc text,
  dataforseo_hint text,
  dataforseo_checked_at timestamptz,
  anthropic_key_enc text,
  anthropic_workspace_id text,
  anthropic_hint text,
  anthropic_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_api_keys enable row level security;
-- No policies at all: browsers can never read this table.

-- ---------------------------------------------------------------------------
-- Which keys a keyword runs on, and who paid for each API call
-- ---------------------------------------------------------------------------
alter table public.trackers
  add column if not exists billing_source text not null default 'platform'
    check (billing_source in ('platform', 'own_keys'));

alter table public.api_log add column if not exists billing_source text not null default 'platform';
alter table public.api_log add column if not exists user_id uuid;
create index if not exists api_log_platform_day_idx on public.api_log (created_at)
  where billing_source = 'platform';

-- ---------------------------------------------------------------------------
-- Credit functions. Atomic, and callable only with the service role.
-- ---------------------------------------------------------------------------

-- Spend credits. Returns the new balance, or null when the balance is too low
-- (nothing changes then).
create or replace function public.spend_credits(
  p_user uuid,
  p_amount int,
  p_reason text,
  p_tracker uuid default null,
  p_note text default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if p_amount <= 0 then
    raise exception 'spend_credits: amount must be positive';
  end if;
  update accounts
     set credits_balance = credits_balance - p_amount, updated_at = now()
   where user_id = p_user and credits_balance >= p_amount
  returning credits_balance into new_balance;
  if new_balance is null then
    return null;
  end if;
  insert into credit_ledger (user_id, delta, balance_after, reason, tracker_id, note)
  values (p_user, -p_amount, new_balance, p_reason, p_tracker, p_note);
  return new_balance;
end;
$$;

-- Add credits (plan grants, refunds). With p_external_id the call is
-- idempotent: a second call with the same id changes nothing. With p_cap the
-- balance is first trimmed to p_cap (the rollover limit) and the trimmed
-- credits are recorded as expired. Returns the new balance.
create or replace function public.add_credits(
  p_user uuid,
  p_amount int,
  p_reason text,
  p_external_id text default null,
  p_tracker uuid default null,
  p_note text default null,
  p_cap int default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance int;
  trimmed int;
  new_balance int;
begin
  if p_amount < 0 then
    raise exception 'add_credits: amount must not be negative';
  end if;
  insert into accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select credits_balance into current_balance from accounts where user_id = p_user for update;

  if p_external_id is not null and exists (select 1 from credit_ledger where external_id = p_external_id) then
    return current_balance;
  end if;

  if p_cap is not null and current_balance > p_cap then
    trimmed := current_balance - p_cap;
    current_balance := p_cap;
    insert into credit_ledger (user_id, delta, balance_after, reason, note)
    values (p_user, -trimmed, current_balance, 'expired', 'Unused credits above the rollover limit');
  end if;

  new_balance := current_balance + p_amount;
  update accounts set credits_balance = new_balance, updated_at = now() where user_id = p_user;
  insert into credit_ledger (user_id, delta, balance_after, reason, tracker_id, external_id, note)
  values (p_user, p_amount, new_balance, p_reason, p_tracker, p_external_id, p_note);
  return new_balance;
end;
$$;

-- Remove every remaining credit (subscription ended). Returns 0.
create or replace function public.expire_credits(p_user uuid, p_note text default null) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance int;
begin
  select credits_balance into current_balance from accounts where user_id = p_user for update;
  if current_balance is null or current_balance = 0 then
    return 0;
  end if;
  update accounts set credits_balance = 0, updated_at = now() where user_id = p_user;
  insert into credit_ledger (user_id, delta, balance_after, reason, note)
  values (p_user, -current_balance, 0, 'expired', p_note);
  return 0;
end;
$$;

-- security definer functions are callable through the API by default: lock
-- them to the service role so no signed-in user can grant themselves credits.
revoke all on function public.spend_credits(uuid, int, text, uuid, text) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, int, text, text, uuid, text, int) from public, anon, authenticated;
revoke all on function public.expire_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, int, text, uuid, text) to service_role;
grant execute on function public.add_credits(uuid, int, text, text, uuid, text, int) to service_role;
grant execute on function public.expire_credits(uuid, text) to service_role;

-- The app's own API spend since a moment (the daily safety ceiling reads it).
create or replace function public.platform_spend_since(p_since timestamptz) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0) from api_log where billing_source = 'platform' and created_at >= p_since;
$$;

revoke all on function public.platform_spend_since(timestamptz) from public, anon, authenticated;
grant execute on function public.platform_spend_since(timestamptz) to service_role;
