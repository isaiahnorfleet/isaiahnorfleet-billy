-- Billy initial schema.
-- Conventions:
--   * Every user-owned row carries user_id and is protected by row-level security.
--   * Money is stored as integer minor units (cents) in bigint columns.
--   * Due dates are calendar dates in the user's time zone (type date, never timestamptz).
--   * Instants (send times, audit times) are timestamptz.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.billy_tone as enum ('gentle', 'straight', 'extra');
create type public.recurrence as enum ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');
create type public.bill_status as enum ('active', 'archived');
create type public.occurrence_status as enum ('open', 'paid', 'skipped');
create type public.reminder_kind as enum ('before', 'due', 'overdue', 'snooze', 'test');
create type public.channel as enum ('push', 'email');
create type public.reminder_status as enum ('pending', 'claimed', 'sent', 'failed', 'canceled', 'skipped');
create type public.delivery_status as enum ('accepted', 'failed', 'expired');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.is_valid_time_zone(tz text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_timezone_names where name = tz)
$$;

-- ---------------------------------------------------------------------------
-- Profiles and preferences
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  currency char(3) not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'America/Toronto' check (public.is_valid_time_zone(time_zone)),
  tone public.billy_tone not null default 'straight',
  onboarded_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default false,
  email_address text check (email_address is null or (char_length(email_address) <= 254 and email_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  -- Days before the due date to remind. 0 means "on the due date".
  default_offsets smallint[] not null default '{3,1,0}'
    check (cardinality(default_offsets) <= 6 and 0 <= all (default_offsets) and 30 >= all (default_offsets)),
  -- Local hour (0-23) at which reminders for a day are sent.
  reminder_hour smallint not null default 9 check (reminder_hour between 0 and 23),
  overdue_followups boolean not null default true,
  overdue_followup_days smallint not null default 5 check (overdue_followup_days between 0 and 14),
  quiet_hours_enabled boolean not null default true,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  max_per_day smallint not null default 6 check (max_per_day between 1 and 20),
  -- When false, push notifications avoid bill names and amounts on the lock screen.
  lock_screen_details boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Bills (recurring definitions)
-- ---------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  amount_minor bigint not null check (amount_minor >= 0 and amount_minor <= 100000000000),
  currency char(3) not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'other' check (category in (
    'housing', 'utilities', 'phone_internet', 'insurance', 'loan', 'credit_card',
    'subscription', 'transportation', 'health', 'education', 'taxes', 'other')),
  recurrence public.recurrence not null,
  -- The original first due date. All future dates are computed from this anchor so that
  -- a bill due on the 31st returns to the 31st after a short month.
  anchor_date date not null,
  -- Occurrences are generated from this date forward. Set when the bill is created and when its
  -- schedule changes, so a schedule change never back-fills cycles that were never tracked.
  track_from date not null,
  autopay boolean not null default false,
  payment_url text check (payment_url is null or (char_length(payment_url) <= 2048 and payment_url ~* '^https?://')),
  notes text check (notes is null or char_length(notes) <= 1000),
  reminders_enabled boolean not null default true,
  -- Null means "use the global default offsets".
  reminder_offsets smallint[] check (reminder_offsets is null or (
    cardinality(reminder_offsets) <= 6 and 0 <= all (reminder_offsets) and 30 >= all (reminder_offsets))),
  status public.bill_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bills_user_idx on public.bills (user_id, status);
create trigger bills_updated_at before update on public.bills
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Occurrences (one row per billing cycle)
-- ---------------------------------------------------------------------------
create table public.bill_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bill_id uuid not null references public.bills (id) on delete cascade,
  -- Date produced by the recurrence rule. Never changes; used for idempotent generation.
  scheduled_date date not null,
  -- Date the bill is actually due. Equal to scheduled_date unless overridden for this occurrence.
  due_date date not null,
  amount_minor bigint not null check (amount_minor >= 0 and amount_minor <= 100000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_overridden boolean not null default false,
  due_overridden boolean not null default false,
  status public.occurrence_status not null default 'open',
  -- "Can't pay yet" support. Does not change due_date or overdue status.
  planned_payment_date date,
  note text check (note is null or char_length(note) <= 500),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_id, scheduled_date)
);
create index bill_occurrences_user_due_idx on public.bill_occurrences (user_id, due_date);
create index bill_occurrences_open_idx on public.bill_occurrences (due_date) where status = 'open';
create trigger bill_occurrences_updated_at before update on public.bill_occurrences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payments (records that the user confirmed a payment; Billy never moves money)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bill_id uuid not null references public.bills (id) on delete cascade,
  occurrence_id uuid not null references public.bill_occurrences (id) on delete cascade,
  amount_minor bigint not null check (amount_minor >= 0 and amount_minor <= 100000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null,
  note text check (note is null or char_length(note) <= 500),
  -- Undo/correction never deletes: the payment is voided and kept for history.
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  created_at timestamptz not null default now()
);
-- Release 1 supports full-payment confirmation only: one active payment per occurrence.
create unique index payments_one_active_per_occurrence on public.payments (occurrence_id) where voided_at is null;
create index payments_user_paid_on_idx on public.payments (user_id, paid_on desc);

-- ---------------------------------------------------------------------------
-- Push subscriptions (one per browser/device)
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  device_label text not null default 'This device' check (char_length(device_label) <= 80),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  failure_count integer not null default 0,
  disabled_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where disabled_at is null;

-- ---------------------------------------------------------------------------
-- Reminders (durable scheduled work) and delivery attempts
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  occurrence_id uuid references public.bill_occurrences (id) on delete cascade,
  kind public.reminder_kind not null,
  channel public.channel not null,
  -- The local calendar day this reminder belongs to (e.g. "3 days before" day).
  slot_date date not null,
  send_at timestamptz not null,
  -- Unique delivery key: prevents duplicate planning across overlapping workers.
  dedupe_key text not null unique,
  status public.reminder_status not null default 'pending',
  claim_token uuid,
  claimed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  skip_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'test' or occurrence_id is not null)
);
create index reminders_due_idx on public.reminders (send_at) where status in ('pending', 'claimed');
create index reminders_user_idx on public.reminders (user_id, created_at desc);
create index reminders_occurrence_idx on public.reminders (occurrence_id) where status = 'pending';
create trigger reminders_updated_at before update on public.reminders
  for each row execute function public.set_updated_at();

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reminder_id uuid references public.reminders (id) on delete set null,
  channel public.channel not null,
  push_subscription_id uuid references public.push_subscriptions (id) on delete set null,
  -- One batch = one notification shown to the user (several reminders may be grouped into it).
  batch_id uuid not null,
  -- 'accepted' means the push service / email provider accepted the message.
  -- It does NOT mean the device displayed it or that the user saw it.
  status public.delivery_status not null,
  http_status integer,
  provider_message_id text,
  error text check (error is null or char_length(error) <= 500),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create index notification_deliveries_user_idx on public.notification_deliveries (user_id, created_at desc);
create index notification_deliveries_batch_idx on public.notification_deliveries (batch_id);

-- Simple fixed-window rate limiter for sensitive actions.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Scheduler heartbeat so the app can show whether the background job is running.
create table public.job_runs (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb
);
create index job_runs_job_idx on public.job_runs (job, started_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.bills enable row level security;
alter table public.bill_occurrences enable row level security;
alter table public.payments enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.rate_limits enable row level security;
alter table public.job_runs enable row level security;

-- Profiles: a user sees and edits only their own row.
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy prefs_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy bills_all on public.bills for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Occurrences must reference a bill owned by the same user.
create policy occurrences_all on public.bill_occurrences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.bills b where b.id = bill_id and b.user_id = (select auth.uid()))
  );

-- Payments: insert/update only against the user's own occurrence. No hard deletes from clients.
create policy payments_select on public.payments for select to authenticated using (user_id = (select auth.uid()));
create policy payments_insert on public.payments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.bill_occurrences o
      where o.id = occurrence_id and o.bill_id = payments.bill_id and o.user_id = (select auth.uid())
    )
  );
create policy payments_update on public.payments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Reminders and deliveries are written by the scheduler (privileged role).
-- Users may read them and cancel/snooze their own pending reminders.
create policy reminders_select on public.reminders for select to authenticated using (user_id = (select auth.uid()));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (user_id = (select auth.uid()) and kind in ('snooze', 'test'));
create policy reminders_update on public.reminders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy deliveries_select on public.notification_deliveries for select to authenticated
  using (user_id = (select auth.uid()));
-- rate_limits and job_runs: no policies, so only privileged roles can touch them.

-- Grants for the authenticated role (Supabase grants these on public by default; explicit for clarity).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.notification_preferences, public.bills,
  public.bill_occurrences, public.push_subscriptions to authenticated;
grant select, insert on public.payments, public.reminders to authenticated;
-- Column-level update grants: clients can void/annotate a payment or reschedule/cancel a
-- reminder, but can never re-point a row at another bill, occurrence or user.
grant update (voided_at, void_reason, note) on public.payments to authenticated;
grant update (status, send_at, skip_reason) on public.reminders to authenticated;
grant select on public.notification_deliveries to authenticated;
revoke all on public.rate_limits, public.job_runs from anon, authenticated;
revoke all on all tables in schema public from anon;
