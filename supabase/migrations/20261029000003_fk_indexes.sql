-- Covering indexes for foreign keys (keeps cascades on bill/account deletion fast).
create index if not exists payments_bill_idx on public.payments (bill_id);
create index if not exists notification_deliveries_reminder_idx on public.notification_deliveries (reminder_id);
create index if not exists notification_deliveries_push_subscription_idx on public.notification_deliveries (push_subscription_id);
