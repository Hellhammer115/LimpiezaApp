-- Quote-first checkout, part 1/2: new order statuses.
-- Kept in its own migration: Postgres refuses to USE a new enum value inside
-- the transaction that added it, and the CLI wraps each file in one.
alter type public.order_status add value if not exists 'quote_requested' before 'pending';
alter type public.order_status add value if not exists 'quote_sent'      before 'pending';
