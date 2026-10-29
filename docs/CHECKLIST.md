# Billy implementation checklist

Status words mean exactly this:
**implemented** (code exists) → **locally tested** (automated tests pass against a real local
Postgres and a production build) → **deployed** (running on Vercel + Supabase) →
**verified end to end** (checked on the live site, on a real device where needed).

_Last updated: 2026-10-29._

## Build phases

| # | Phase | Status |
|---|---|---|
| 1 | Scaffold, design tokens, components, Billy SVG mascot (6 moods, reduced motion) | locally tested |
| 2 | Schema, migrations, RLS, column grants, cross-user tests | locally tested; schema applied to Supabase |
| 3 | Recurrence engine (anchor, month end, leap year, DST, local dates) | locally tested |
| 4 | Bills / occurrences / payments with undo, correction, per-occurrence edits | locally tested |
| 5 | Screens: onboarding, dashboard, bills, add/edit, calendar, history, settings, demo | locally tested |
| 6 | Reminder engine: planner, claims, push + email, quiet hours, snooze, cap, delivery log | locally tested (fake providers) |
| 7 | PWA: manifest, icons, service worker, per-device push setup, iOS install steps | locally tested (Chromium) |
| 8 | Security: validation, rate limits, URL safety, protected cron, export, account deletion | locally tested |
| 9 | Tests: unit (42), database (37), browser on iPhone + desktop viewports (36 + 2 skipped by design) | passing |
| 10 | Deploy, configure services, verify a real scheduled reminder with the app closed | in progress |

## Required workflows (brief §14)

| # | Workflow | Where it's tested |
|---|---|---|
| 1 | Add a bill, reload, persists | e2e `a bill persists across reload…`, db `a created bill is stored…` |
| 2 | Same bill on another device | e2e `…visible from a second device` (separate browser context) |
| 3 | Mark paid updates dashboard and history | e2e `mark paid updates dashboard and history…` |
| 4 | Undo an accidental payment | e2e `…undo restores it`, `undo from the toast…`; db `undo voids the payment…` |
| 5 | Recurrence keeps its anchor | unit `monthly recurrence keeps its anchor`; db `…31st keeps its anchor through February` |
| 6 | Overdue stays visible across cycles | unit + db `an unpaid occurrence stays overdue…`; e2e `overdue stays overdue…` |
| 7 | Reminders stop after payment | db `stops pending reminders once the occurrence is paid…`; e2e `…stops after payment` |
| 8 | Snooze leaves due date unchanged | unit + db `snoozing moves the next reminder and leaves the due date unchanged` |
| 9 | Time zones and DST | unit `time zones`, `keeps 9:00 local across the November DST change`; db `…in the user's own zone` |
| 10 | Month end and leap year | unit `handles leap-year February`, `…Feb 29…` |
| 11 | No duplicate reminders from repeated/overlapping jobs | db `repeated and overlapping runs never create duplicate…` |
| 12 | Notification failures handled and visible | db `delivery failures are recorded and visible`; e2e `…failures show in Settings` |
| 13 | One user can't access another's records | db `row-level security…` (7 tests); e2e `one user cannot open another user's bill` |
| 14 | Denied notification permission doesn't break the app | e2e `denied notification permission…` (desktop), iPhone install-steps test |
| 15 | Mobile navigation and forms, no horizontal overflow | e2e `mobile layouts have no horizontal overflow` (iPhone 13 viewport) |
| 16 | Keyboard, focus, contrast, reduced motion | e2e axe (WCAG 2 A/AA serious+critical), keyboard flow, reduced motion |

## Production

| Item | Status |
|---|---|
| Supabase project "billy" (Canada Central), schema + RLS migration | deployed |
| Scheduler migration (pg_cron + pg_net, Vault secrets) | pending: needs the live app URL |
| Supabase Auth: Site URL, redirect URL, code in the email template | pending: dashboard step for Isaiah |
| Vercel project + environment variables | pending: Vercel connector needs team access approval |
| Resend API key and sender | pending |
| Live sign-in, bills, cross-device, payments | pending |
| Scheduled reminder received with the app closed (iPhone) | pending: needs Isaiah's iPhone |

## Known limitations (release 1)

- Full-payment confirmation only; no partial payments.
- Email reminders go only to the Resend account owner's address until a domain is verified.
- Push delivery is "accepted by the push service", not confirmed on-screen.
- Offline: cached pages are viewable with an offline banner; changes need a connection.
- Calendar export is not included.
