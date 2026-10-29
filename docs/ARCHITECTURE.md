# Billy architecture

## Overview

```
iPhone / desktop browser (PWA, service worker)
        │  HTTPS (pages, server actions)            ▲ Web Push (Apple / Google / Mozilla push services)
        ▼                                           │
Vercel: Next.js app ── server-only code ──► Supabase Postgres (RLS on every table)
        ▲     │                                     │
        │     └──► Resend (email)                   │ pg_cron every 5 min ──► pg_net POST
        └───────────── /api/cron/reminders ◄────────┘   (Bearer token generated in the DB)
```

| Concern | Owner | Notes |
|---|---|---|
| Hosting, server code, env secrets | Vercel (Hobby) | Secrets live only in Vercel environment variables |
| Auth | Supabase Auth | Email 6-digit code. Codes, not links, because an installed iPhone web app doesn't share Safari's cookies |
| Data | Supabase Postgres (Canada Central) | Migrations in `supabase/migrations` |
| Scheduler | Supabase pg_cron + pg_net | Vercel Hobby cron is daily only; a daily Vercel cron in `vercel.json` is a backup |
| Push | Standard Web Push with VAPID keys (`web-push`) | No third-party push vendor |
| Email | Resend | Idempotency key per delivery batch |

## Data access and security

- The browser never talks to the database. Server code connects to Postgres directly
  (`src/lib/db/client.ts`). `withUser()` runs each request in a transaction as role
  `authenticated` with the user's JWT claims, so **row-level security applies to every user
  query**. `withService()` (privileged) is used only by the scheduler, sign-in bookkeeping and
  account deletion.
- RLS policies restrict every row to `auth.uid()`. Column-level grants stop a client from
  re-pointing a payment or reminder at another user, bill or occurrence. Supabase's default
  table grants to `anon`/`authenticated` are revoked first.
- The app logs in as a limited role `billy_app` (member of `authenticated`, can bypass RLS only
  for `withService()` work, may read and delete `auth.users` for account deletion), not as `postgres`.
- The scheduler's token is generated inside the database (`private.scheduler_settings`, not exposed
  through the Data API). pg_cron sends it; the app reads the same row to check it, so it is never
  copied between services. `CRON_SECRET` is still accepted for the daily Vercel backup cron.
- Secrets: `DATABASE_URL`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, `CRON_SECRET` are server-only.
  Only `NEXT_PUBLIC_SUPABASE_URL`, the publishable key and the VAPID public key reach the browser.
- Validation with zod on every server action. Payment links must be `http(s)` with a real host and
  no credentials, and open with `rel="noopener noreferrer"`. CSV export guards against formula
  injection. Sign-in codes and verifications are rate limited. `ALLOWED_EMAILS` can lock sign-in to
  specific addresses.
- Security headers (HSTS, nosniff, frame denial, referrer and permissions policy) in `next.config.ts`.

## Data model

`profiles`, `notification_preferences`, `bills` (definition + recurrence anchor),
`bill_occurrences` (one row per cycle), `payments` (records only; voided, never deleted),
`push_subscriptions` (one per device), `reminders` (durable scheduled work with a unique
`dedupe_key`), `notification_deliveries` (every attempt and its result), `rate_limits`, `job_runs`.

- Money is integer minor units. Due dates are calendar dates in the user's time zone.
- Recurrence always computes from the anchor date, so a bill due on the 31st returns to the 31st
  after a short month; Feb 29 yearly bills fall back to Feb 28.
- Occurrences are materialized 45 days ahead; the calendar projects later cycles.
- Overdue occurrences stay overdue until paid or skipped. Paying one occurrence never changes the
  schedule or other occurrences. Editing a bill's schedule keeps paid and overdue history.

## Reminder engine (`src/lib/reminders/engine.ts`)

Each run (every 5 minutes):

1. Materialize upcoming occurrences for active bills.
2. Plan reminders (before / due / overdue follow-ups) from preferences and per-bill overrides,
   applying quiet hours and snooze, and insert them with `ON CONFLICT (dedupe_key) DO NOTHING`.
3. Claim due reminders with `FOR UPDATE SKIP LOCKED` (stale claims are retried after 10 minutes),
   re-check eligibility at send time (paid, skipped, archived, reminders off, snoozed), group a
   user's reminders per channel into one notification, enforce the daily cap, send, and record
   each attempt in `notification_deliveries`.
4. Failures retry with backoff up to 3 attempts. Push endpoints that return 404/410 are disabled.

Delivery is **at-least-once with dedupe**, not exactly-once. "Accepted" means the push service or
email provider accepted the message, not that it was seen. Billy's tone setting changes wording
only, never how often reminders are sent.

## Monitoring notification failures

- **Settings → Notifications** shows whether the scheduler has run recently (from `job_runs`),
  push and email configuration, each device's last success/failure, upcoming reminders, and
  recent deliveries with failures highlighted.
- `/api/health` returns the scheduler heartbeat (for an uptime monitor if wanted).
- Vercel function logs carry the cycle summary; Supabase `cron.job_run_details` and
  `net._http_response` show whether pg_cron reached the app.

## Data retention and account deletion

- Bills, occurrences and payments are kept until the user deletes them or the account.
- `job_runs` older than 30 days and `rate_limits` older than 2 days are purged nightly;
  pg_cron run details older than 7 days are purged.
- **Export**: Settings → Your data gives all data as JSON and payments as CSV.
- **Delete account**: Settings → Account (type DELETE). Deleting the auth user cascades to
  every user-owned row, sessions and refresh tokens. Supabase's own backups age out per its
  retention schedule.

## Backup and restore

- Supabase Free includes daily backups for 7 days (Dashboard → Database → Backups). Restoring
  replaces the whole database, so export first.
- Manual backup: `pg_dump "$DATABASE_URL_DIRECT" --schema=public --data-only > billy.sql` using the
  direct (port 5432) connection string, or use Settings → Your data per user.
- Restore into a fresh project: apply migrations, then `psql < billy.sql`. Auth users must exist
  first (restore `auth.users` from a full dump, or have users sign in again before importing).
- Schema changes go through new, additive migration files. Destructive migrations need a backup
  and explicit sign-off first.

## Free-tier limits worth knowing

- Supabase Free pauses a project after about a week without activity; the 5-minute scheduler
  counts as activity.
- Supabase's built-in auth email is rate limited (a few per hour). Configure Resend SMTP in
  Supabase Auth to lift it.
- Resend Free: 3,000 emails/month, 100/day. Without a verified domain it can only send to the
  account owner's own address.
- iPhone push requires iOS 16.4+ and Billy installed to the Home Screen.
