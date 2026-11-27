# Norfleet One bridge (Norfleet One Release 11D)

Approved by Isaiah on 2026-11-27 (L-04: narrowly scoped Billy changes; L-10: business and mixed obligations only,
unclassified bills as a count). Norfleet One shows these bills in Capital → Obligations. Billy never calls Norfleet One.

## What changes in Billy

- **For the business?** on each bill (optional): Business, Personal, Partly business (with the business part as a
  percent), or Not sorted yet. Every existing bill starts Not sorted yet, so nothing is shared until Isaiah sorts it.
  Reminders, payments and the budget don't change.
- **Settings → Norfleet One**: how many bills are shared or unsorted, the keys (never shown again after they're made),
  Make a key for Norfleet One, Revoke. At most two active keys, 180-day expiry.
- **Read-only API** `GET /api/connect/v1/health` and `GET /api/connect/v1/obligations?from=&to=&cursor=&limit=`.

## What is shared

Occurrences of business and partly-business bills, as the `billy.obligations` v1.0.0 contract (`contracts/`): bill
name, amount and currency, due date, recurrence, category, business use and share, open/paid/skipped, the paid date
and amount, autopay, last change. Unsorted bills are a count only ("3 bills in Billy aren't sorted yet").

Never shared: personal or unsorted bills by name, notes, payment links, autopay account nicknames, reminders, devices,
income, budget categories, expenses, goals, your email.

## Security

- Each request is signed by Norfleet One (Norfleet Connect v1: HMAC-SHA256 over method, path, sorted query, timestamp,
  nonce and body hash; `src/lib/connect/signing.ts`, a checksummed copy of Norfleet One's). Requests older than 5
  minutes, replayed nonces, unknown, revoked or expired keys get a plain 401. At most 60 requests a minute per key.
- The key's secret is kept in this project's Vault (the endpoint needs it to check signatures); `connect.keys` keeps
  its id, a SHA-256 of it and its scope. Revoking deletes the secret at once.
- The endpoint runs as the app's database login, which may run only `connect.api_key`, `api_use`, `api_health` and
  `api_obligations`. Signed-in users can make, list and revoke only their own keys and can't call the API functions.
- Migration `supabase/migrations/20261127000001_norfleet_one_connect.sql` (additive; RLS on, no table grants).

## Deploy (each step needs Isaiah's go)

1. Apply the migration to Billy's Supabase project.
2. Merge to main (Vercel deploys main).
3. In Billy, mark the business bills, then Settings → Norfleet One → Make a key, and paste it in Norfleet One
   (Settings → Connected Ecosystem → Billy). Norfleet One's connect-sync reads `BILLY_CONNECT_URL`
   (this app's URL + `/api/connect/v1`).

Rollback: revoke the key (Norfleet One stops reading at once). The two new columns can stay; dropping them loses only
the business sorting.
