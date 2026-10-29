# Billy

**Your bills. Handled.** A personal bill reminder web app with a receipt mascot named Billy.
Billy tells you what you owe, when it's due, what needs attention, whether you've paid it, and
reminds you from the server, so reminders arrive even when the app is closed.

Billy never moves money and never asks for bank logins. Paying happens on the biller's site;
Billy keeps the record.

- Architecture, services, data retention, backups and monitoring: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- What's built, tested, deployed and verified: [docs/CHECKLIST.md](docs/CHECKLIST.md)

## Stack

Next.js 16 (App Router, TypeScript) and Tailwind v4 on Vercel. Supabase for Auth (email code) and
Postgres (row-level security on every table). Supabase pg_cron calls the reminder endpoint every
5 minutes. Web Push (VAPID) for notifications, Resend for email.

## Local development

Requirements: Node 20.9+, a local Postgres 16 with `psql` on the PATH.

```bash
npm install
cp .env.example .env.local          # then set AUTH_MODE=dev, DEV_AUTH_SECRET (32+ chars), NOTIFY_PROVIDER=fake
npm run db:local                    # recreate billy_dev: a local DB with Supabase stand-ins and all migrations
npm run dev                         # http://localhost:3000
```

With `AUTH_MODE=dev` any email and any 6 digits sign you in. Dev auth and fake notifications are
refused when `VERCEL_ENV=production`.

To run a reminder cycle locally:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

## Tests

```bash
npm run typecheck && npm run lint
npm run test:unit       # recurrence, money, URL safety, summaries, reminder planning, Billy messages
npm run test:db         # RLS, payments/undo, reminder engine against a real local Postgres (billy_test)
npm run test:e2e        # builds, then Playwright on iPhone and desktop viewports (billy_e2e)
```

## Production setup

These are one-time steps. Never paste secret values into chat, issues or commits. They go only
into Vercel's environment variables.

1. **Supabase project** (region Canada Central). Apply `supabase/migrations/*.sql` in order.
   The `_scheduler.sql` migration enables pg_cron and pg_net, creates `private.scheduler_settings`
   with a random token generated inside the database, and schedules the 5-minute job.
2. **App database login and scheduler URL** (Supabase SQL editor). Create a limited login role for
   the app instead of using the `postgres` superuser, using your own strong password:
   ```sql
   create role billy_app login bypassrls password '<strong password>';
   grant authenticated to billy_app;
   grant usage on schema public to billy_app;
   grant select, insert, update, delete on all tables in schema public to billy_app;
   grant usage, select on all sequences in schema public to billy_app;
   grant usage on schema auth to billy_app;
   grant select, delete on auth.users to billy_app;
   grant usage on schema private to billy_app;
   grant select on private.scheduler_settings to billy_app;
   insert into private.scheduler_settings (app_url) values ('https://<your-app-domain>') on conflict (id) do update set app_url = excluded.app_url;
   ```
   `DATABASE_URL` then uses `billy_app` (as `billy_app.<project-ref>`) on the transaction pooler.
3. **Supabase Auth** (Dashboard > Authentication):
   - URL Configuration: Site URL = your app URL; add `<app URL>/auth/confirm` to Redirect URLs.
   - Emails > Magic Link template: include the code, e.g. `Your Billy sign-in code is {{ .Token }}`.
     The code is what makes sign-in work inside the installed iPhone app.
   - Optional: Emails > SMTP Settings with Resend (host `smtp.resend.com`, port 465, user `resend`,
     password = a Resend API key) to lift the built-in email rate limit.
4. **Vercel** project from this repo, with these environment variables (Production):
   `APP_URL`, `DATABASE_URL` (Supabase transaction pooler, port 6543), `AUTH_MODE=supabase`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, and optionally `ALLOWED_EMAILS`
   (comma-separated; anyone else is refused at sign-in). Generate VAPID keys with
   `npx web-push generate-vapid-keys` and secrets with `openssl rand -hex 32`.
5. Deploy, sign in, then in **Settings** check that the scheduler shows as running, turn on
   notifications on each device and use **Schedule a test in 2 minutes**.

## iPhone

Notifications on iPhone need iOS 16.4 or later, and Billy must be added to the Home Screen
(Safari > Share > Add to Home Screen) and opened from there before you turn notifications on.
Sign in inside the Home Screen app with the emailed code.
