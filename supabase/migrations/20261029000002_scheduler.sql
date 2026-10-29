-- Background scheduler (Supabase only; skipped by the local test databases).
-- Every 5 minutes pg_cron asks the app to run a reminder cycle.
-- The request carries a token generated here, inside the database. The app reads the same row
-- to check it, so the token is never copied between services or seen by anyone.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Not exposed through Supabase's Data API (only "public" is), and no grants to client roles.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.scheduler_settings (
  id smallint primary key default 1 check (id = 1),
  app_url text not null check (app_url ~ '^https://'),
  cron_token text not null default encode(extensions.gen_random_bytes(32), 'hex')
);

-- The app's database login (see docs/ARCHITECTURE.md) reads the token to check requests.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'billy_app') then
    grant usage on schema private to billy_app;
    grant select on private.scheduler_settings to billy_app;
  end if;
end $$;

-- Set the app URL once it's known, e.g.:
--   insert into private.scheduler_settings (app_url) values ('https://<your-app>')
--   on conflict (id) do update set app_url = excluded.app_url;

select cron.schedule(
  'billy-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := s.app_url || '/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.cron_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from private.scheduler_settings s
  where s.id = 1;
  $job$
);

-- Housekeeping: keep scheduler logs small.
select cron.schedule(
  'billy-housekeeping',
  '17 4 * * *',
  $job$
  delete from public.job_runs where started_at < now() - interval '30 days';
  delete from public.rate_limits where window_start < now() - interval '2 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  $job$
);
