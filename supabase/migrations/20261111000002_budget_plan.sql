-- Budget planning: money set aside before spending (savings, investing, debt payoff, ...) and an
-- option to let Billy work out category limits each month. Additive only.

-- A set-aside is either a fixed amount per month or a share of the month's income.
create table public.budget_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  amount_minor bigint check (amount_minor is null or (amount_minor > 0 and amount_minor <= 100000000000)),
  -- Basis points of monthly income: 1000 = 10%.
  percent_bp integer check (percent_bp is null or (percent_bp > 0 and percent_bp <= 10000)),
  -- Optional, for projections: what the user is aiming for, what's already saved toward it, and an
  -- expected yearly return (basis points; 500 = 5%/yr) for investing-type goals.
  target_minor bigint check (target_minor is null or (target_minor > 0 and target_minor <= 100000000000)),
  balance_minor bigint not null default 0 check (balance_minor >= 0 and balance_minor <= 100000000000),
  annual_return_bp integer not null default 0 check (annual_return_bp between 0 and 3000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((amount_minor is null) <> (percent_bp is null))
);
create unique index budget_goals_user_name_idx on public.budget_goals (user_id, lower(btrim(name)));
create trigger budget_goals_updated_at before update on public.budget_goals
  for each row execute function public.set_updated_at();

-- One row per user. auto_limits: Billy splits the spending money across categories that have no
-- fixed limit, every month, from what's actually left after bills and goals.
create table public.budget_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  auto_limits boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger budget_settings_updated_at before update on public.budget_settings
  for each row execute function public.set_updated_at();

alter table public.budget_goals enable row level security;
alter table public.budget_settings enable row level security;

create policy budget_goals_all on public.budget_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy budget_settings_all on public.budget_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.budget_goals, public.budget_settings from anon, authenticated;
grant select, insert, update, delete on public.budget_goals, public.budget_settings to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'billy_app') then
    grant select, insert, update, delete on public.budget_goals, public.budget_settings to billy_app;
  end if;
end $$;
