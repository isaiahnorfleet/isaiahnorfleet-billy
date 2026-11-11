-- Budget: income sources, spending categories with optional monthly limits, and logged spending.
-- Additive only: no existing table changes. Bills feed the budget from bill_occurrences.

-- Money coming in. Uses the same recurrence rules as bills, so a biweekly paycheque lands two
-- or three times a month depending on the calendar.
create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  currency char(3) not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  recurrence public.recurrence not null,
  -- First pay date. Later dates are computed from it, the same way bills are.
  anchor_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index income_sources_user_idx on public.income_sources (user_id);
create trigger income_sources_updated_at before update on public.income_sources
  for each row execute function public.set_updated_at();

-- Spending categories (Groceries, Eating out, ...). A null limit means "track only".
create table public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  monthly_limit_minor bigint check (monthly_limit_minor is null or (monthly_limit_minor >= 0 and monthly_limit_minor <= 100000000000)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index budget_categories_user_name_idx on public.budget_categories (user_id, lower(btrim(name)));
create trigger budget_categories_updated_at before update on public.budget_categories
  for each row execute function public.set_updated_at();

-- Money going out that isn't a bill. Deleting a category keeps its spending as "Uncategorized".
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid references public.budget_categories (id) on delete set null,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  currency char(3) not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  spent_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index expenses_user_spent_on_idx on public.expenses (user_id, spent_on desc);
create index expenses_category_idx on public.expenses (category_id);

alter table public.income_sources enable row level security;
alter table public.budget_categories enable row level security;
alter table public.expenses enable row level security;

create policy income_sources_all on public.income_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy budget_categories_all on public.budget_categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Spending can only point at the user's own category.
create policy expenses_all on public.expenses for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (category_id is null or exists (
      select 1 from public.budget_categories c where c.id = category_id and c.user_id = (select auth.uid())
    ))
  );

-- Supabase's default privileges grant anon/authenticated ALL on new tables; start from nothing.
revoke all on public.income_sources, public.budget_categories, public.expenses from anon, authenticated;
grant select, insert, update, delete on public.income_sources, public.budget_categories, public.expenses to authenticated;

-- The app's own login role (README step 2) got table grants before these tables existed.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'billy_app') then
    grant select, insert, update, delete on public.income_sources, public.budget_categories, public.expenses to billy_app;
  end if;
end $$;
