-- Norfleet One bridge (Norfleet One Release 11D; Isaiah approved L-04 and L-10 on 2026-11-27).
--
-- Billy shares the bills Isaiah marks as business (or partly business) with Norfleet One, read-only:
--  * bills get "For the business?": business / personal / mixed (with the business share), or unclassified until he
--    sorts them. Every existing bill starts unclassified, so nothing is shared until he says so.
--  * Isaiah makes a read-only key in Settings → Norfleet One (shown once). Norfleet One signs each GET with it
--    (HMAC-SHA256, Norfleet Connect v1); /api/connect/v1/{health,obligations} check the signature, the nonce and the
--    key's scope, then call the connect.api_* functions below and nothing else.
--  * Only business and mixed bills' occurrences are sent (with the share). Unclassified bills are a count only, never
--    by name. Personal bills, notes, payment links, autopay account nicknames, budget and expenses never leave Billy.
--  * The secret is kept in this project's Vault (the endpoint needs it to check the signature); the table keeps the key
--    id, a SHA-256 of the secret and the scope. At most two active keys (rotation), 180-day expiry.
-- Reminders, payments and the budget are unchanged. Nothing here writes to a bill. Idempotent.

-- ───────────────────────── bills: For the business? ─────────────────────────
alter table public.bills add column if not exists business_use text not null default 'unclassified';
alter table public.bills add column if not exists business_share_bp int;
do $$ begin
  alter table public.bills add constraint bills_business_use_check
    check (business_use in ('business', 'personal', 'mixed', 'unclassified'));
exception when duplicate_object then null; end $$;
-- Mixed needs its business share (1 % to 99 %, in basis points); the others never carry one.
do $$ begin
  alter table public.bills add constraint bills_business_share_check
    check (case when business_use = 'mixed' then coalesce(business_share_bp between 1 and 9999, false) else business_share_bp is null end);
exception when duplicate_object then null; end $$;

-- ───────────────────────── keys and nonces ─────────────────────────
create schema if not exists connect;
revoke all on schema connect from public;
do $$ begin execute 'revoke all on schema connect from anon, authenticated'; exception when undefined_object then null; end $$;

create table if not exists connect.keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  consumer text not null default 'norfleet-one' check (consumer = 'norfleet-one'),
  key_id text not null unique check (key_id ~ '^[a-z0-9]{8,16}$'),
  secret_sha256 char(64) not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  secret_ref uuid not null, -- vault.secrets id
  scopes text[] not null default array['obligations:read'] check (scopes <@ array['obligations:read'] and cardinality(scopes) >= 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index if not exists keys_user on connect.keys (user_id);

-- Replay protection and rate limit: a nonce is refused if seen in the last 10 minutes; at most 60 requests a minute.
create table if not exists connect.nonces (
  key_id text not null,
  nonce text not null,
  seen_at timestamptz not null default now(),
  primary key (key_id, nonce)
);
create index if not exists nonces_seen on connect.nonces (key_id, seen_at);

alter table connect.keys enable row level security;
alter table connect.nonces enable row level security;
revoke all on connect.keys, connect.nonces from public;
do $$ begin execute 'revoke all on connect.keys, connect.nonces from anon, authenticated'; exception when undefined_object then null; end $$;

-- ───────────────────────── Settings → Norfleet One (signed-in user) ─────────────────────────
/** Makes a read-only key for Norfleet One. The full key is returned once and never again. At most two active keys. */
create or replace function public.connect_create_key() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_key_id text; v_secret text; v_ref uuid;
begin
  if v_user is null or not exists (select 1 from public.profiles p where p.id = v_user) then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (select count(*) from connect.keys k where k.user_id = v_user and k.revoked_at is null and k.expires_at > now()) >= 2 then
    raise exception 'two keys are already active: revoke the old one first' using errcode = '23514';
  end if;
  v_key_id := left(encode(uuid_send(gen_random_uuid()), 'hex'), 12);
  v_secret := translate(rtrim(encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'base64'), '='), '+/', '-_');
  v_ref := vault.create_secret(v_secret, 'connect:norfleet-one:' || v_key_id, 'Norfleet One read key');
  insert into connect.keys (user_id, key_id, secret_sha256, secret_ref, expires_at)
  values (v_user, v_key_id, encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), v_ref, now() + interval '180 days');
  return jsonb_build_object('key', 'nck_' || v_key_id || '_' || v_secret, 'key_id', v_key_id, 'expires_at', now() + interval '180 days');
end $$;

/** Revokes one of the user's keys at once and deletes its secret from the Vault. */
create or replace function public.connect_revoke_key(p_key_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k connect.keys;
begin
  select * into k from connect.keys where user_id = auth.uid() and key_id = p_key_id for update;
  if k.id is null then raise exception 'key not found' using errcode = '22023'; end if;
  if k.revoked_at is null then
    update connect.keys set revoked_at = now() where id = k.id;
    delete from vault.secrets where id = k.secret_ref;
  end if;
  return jsonb_build_object('revoked', p_key_id);
end $$;

/** What the Settings card shows: the user's keys (never a secret) and how the bills are sorted. */
create or replace function public.connect_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'keys', coalesce((select jsonb_agg(jsonb_build_object('key_id', k.key_id, 'created_at', k.created_at, 'expires_at', k.expires_at,
                        'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at,
                        'active', k.revoked_at is null and k.expires_at > now()) order by k.created_at desc)
                      from connect.keys k where k.user_id = auth.uid()), '[]'::jsonb),
    'bills', (select jsonb_build_object(
                'business', count(*) filter (where b.business_use = 'business'),
                'mixed', count(*) filter (where b.business_use = 'mixed'),
                'personal', count(*) filter (where b.business_use = 'personal'),
                'unclassified', count(*) filter (where b.business_use = 'unclassified'))
              from public.bills b where b.user_id = auth.uid() and b.status = 'active'))
$$;

revoke all on function public.connect_create_key(), public.connect_revoke_key(text), public.connect_status() from public;
do $$ begin execute 'revoke all on function public.connect_create_key(), public.connect_revoke_key(text), public.connect_status() from anon';
exception when undefined_object then null; end $$;
grant execute on function public.connect_create_key(), public.connect_revoke_key(text), public.connect_status() to authenticated;

-- ───────────────────────── the API (/api/connect/v1 only) ─────────────────────────
/** Secret of an active key, or nothing. */
create or replace function connect.api_key(p_key_id text) returns text
language sql stable security definer set search_path = '' as $$
  select ds.decrypted_secret
  from connect.keys k join vault.decrypted_secrets ds on ds.id = k.secret_ref
  where k.key_id = p_key_id and k.revoked_at is null and k.expires_at > now()
$$;

/** Records a nonce. 'ok', 'unknown', 'replay' (seen in the last 10 minutes) or 'rate_limited' (over 60 a minute). */
create or replace function connect.api_use(p_key_id text, p_nonce text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from connect.keys where key_id = p_key_id and revoked_at is null and expires_at > now()) then return 'unknown'; end if;
  delete from connect.nonces where seen_at < now() - interval '10 minutes';
  if (select count(*) from connect.nonces where key_id = p_key_id and seen_at > now() - interval '1 minute') >= 60 then return 'rate_limited'; end if;
  insert into connect.nonces (key_id, nonce) values (p_key_id, p_nonce) on conflict do nothing;
  if not found then return 'replay'; end if;
  update connect.keys set last_used_at = now() where key_id = p_key_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return 'ok';
end $$;

/** Health for Norfleet One: versions, scopes, key expiry and how many active bills are shared or still unsorted (counts only). */
create or replace function connect.api_health(p_key_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', 'ok', 'supported_versions', jsonb_build_array('1'), 'contract_version', '1.0.0',
    'scopes', to_jsonb(k.scopes), 'key_expires_at', k.expires_at,
    'shared_bills', (select count(*) from public.bills b where b.user_id = k.user_id and b.status = 'active' and b.business_use in ('business', 'mixed')),
    'unclassified_bills', (select count(*) from public.bills b where b.user_id = k.user_id and b.status = 'active' and b.business_use = 'unclassified'))
  from connect.keys k where k.key_id = p_key_id and k.revoked_at is null and k.expires_at > now()
$$;

/**
 * One page of obligations (occurrences of business and mixed bills) due between p_from and p_to, after the cursor
 * (an occurrence id), oldest id first. Null when the key can't read obligations. Each record is shaped exactly as the
 * billy.obligations v1 contract (Norfleet One's app/contracts/billy). A $0 occurrence is left out and counted.
 */
create or replace function connect.api_obligations(p_key_id text, p_after text, p_limit int, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  k connect.keys;
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_rows jsonb; v_n int; v_last text; v_unsorted int; v_zero int; v_notes jsonb := '[]'::jsonb;
begin
  select * into k from connect.keys where key_id = p_key_id and revoked_at is null and expires_at > now();
  if k.id is null or not ('obligations:read' = any (k.scopes)) then return null; end if;
  with page as (
    select 'occ_' || replace(o.id::text, '-', '') as occ_id,
      jsonb_build_object(
        'id', 'occ_' || replace(o.id::text, '-', ''),
        'bill_id', 'bill_' || replace(b.id::text, '-', ''),
        'version', 1,
        'name', b.name,
        'due_date', to_char(o.due_date, 'YYYY-MM-DD'),
        'amount_minor', o.amount_minor,
        'currency', o.currency::text,
        'recurrence', b.recurrence::text,
        'category', b.category,
        'business_use', b.business_use,
        'business_share_bp', case when b.business_use = 'mixed' then b.business_share_bp else 10000 end,
        'status', o.status::text,
        'paid_on', case when o.status = 'paid' then (select to_char(max(p.paid_on), 'YYYY-MM-DD') from public.payments p where p.occurrence_id = o.id and p.voided_at is null) end,
        'payment_amount_minor', case when o.status = 'paid' then (select sum(p.amount_minor) from public.payments p where p.occurrence_id = o.id and p.voided_at is null) end,
        'autopay', b.autopay,
        'updated_at', to_char(greatest(o.updated_at, b.updated_at,
                        coalesce((select max(greatest(p.created_at, coalesce(p.voided_at, p.created_at))) from public.payments p where p.occurrence_id = o.id), o.updated_at))
                      at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) as rec
    from public.bill_occurrences o join public.bills b on b.id = o.bill_id
    where o.user_id = k.user_id and b.user_id = k.user_id and b.business_use in ('business', 'mixed') and o.amount_minor > 0
      and o.due_date between p_from and p_to
      and 'occ_' || replace(o.id::text, '-', '') > coalesce(p_after, '')
    order by 1
    limit v_limit + 1)
  select coalesce(jsonb_agg(rec order by occ_id) filter (where rn <= v_limit), '[]'::jsonb), count(*)::int, max(occ_id) filter (where rn <= v_limit)
    into v_rows, v_n, v_last
    from (select page.*, row_number() over (order by occ_id) as rn from page) p2;

  select count(*) into v_unsorted from public.bills b where b.user_id = k.user_id and b.status = 'active' and b.business_use = 'unclassified';
  select count(*) into v_zero from public.bill_occurrences o join public.bills b on b.id = o.bill_id
    where o.user_id = k.user_id and b.business_use in ('business', 'mixed') and o.amount_minor = 0 and o.due_date between p_from and p_to;
  if v_unsorted > 0 then v_notes := v_notes || to_jsonb(v_unsorted || case when v_unsorted = 1 then ' bill in Billy isn''t sorted yet' else ' bills in Billy aren''t sorted yet' end); end if;
  if v_zero > 0 then v_notes := v_notes || to_jsonb(v_zero || ' occurrence(s) at $0 left out'); end if;
  return jsonb_build_object(
    'data', v_rows,
    'next_cursor', case when v_n > v_limit then v_last end,
    'limit', v_limit,
    'unclassified_bills', v_unsorted,
    'completeness', jsonb_build_object('status', case when v_unsorted > 0 then 'partial' else 'complete' end, 'notes', v_notes));
end $$;

revoke all on function connect.api_key(text), connect.api_use(text, text), connect.api_health(text),
  connect.api_obligations(text, text, int, date, date) from public;
do $$ begin
  execute 'revoke all on function connect.api_key(text), connect.api_use(text, text), connect.api_health(text), connect.api_obligations(text, text, int, date, date) from anon, authenticated';
exception when undefined_object then null; end $$;
-- The app's database login (docs/ARCHITECTURE.md) runs the endpoint; it gets these four functions and nothing else here.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'billy_app') then
    grant usage on schema connect to billy_app;
    grant execute on function connect.api_key(text), connect.api_use(text, text), connect.api_health(text),
      connect.api_obligations(text, text, int, date, date) to billy_app;
  end if;
end $$;
