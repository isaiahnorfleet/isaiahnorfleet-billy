-- Which bank account an autopay bill is charged to, as the user's own label (e.g. "TD Chequing ••1234").
-- Additive and nullable: existing bills are unaffected.
alter table public.bills add column if not exists autopay_account text check (char_length(autopay_account) <= 60);
