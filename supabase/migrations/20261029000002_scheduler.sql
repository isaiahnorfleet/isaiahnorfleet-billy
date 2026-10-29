-- Background scheduler (Supabase only; skipped by the local test databases).
-- Every 5 minutes pg_cron asks the app to run a reminder cycle. The app URL and the shared
-- CRON_SECRET live in Supabase Vault, never in this file:
--   select vault.create_secret('https://<your-app>', 'billy_app_url');
--   select vault.create_secret('<same value as CRON_SECRET>', 'billy_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'billy-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'billy_app_url') || '/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'billy_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
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
