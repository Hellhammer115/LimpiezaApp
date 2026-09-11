-- Revoke EXECUTE from PUBLIC on SECURITY DEFINER functions.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- anon/authenticated inherit that grant *through* PUBLIC. The initial schema
-- did:
--
--   revoke execute on function public.decrement_stock_for_order(uuid)
--     from anon, authenticated;
--
-- which had no effect, because it never touched the PUBLIC grant. The ACL
-- stayed `=X/postgres` (the empty grantee before `=` is PUBLIC), so the
-- function remained callable by anon over
-- POST /rest/v1/rpc/decrement_stock_for_order using the publishable key that
-- ships inside the app bundle. As a SECURITY DEFINER function it writes
-- products.stock while bypassing RLS, and each call decrements again, so a
-- caller who knows an order id could drive stock to zero.
--
-- Revoke from PUBLIC first, then grant back only to the roles that need it.

-- Stock mutation belongs to the Edge Functions (service role) only, matching
-- the invariant that orders/order_items are written only by the service role.
revoke execute on function public.decrement_stock_for_order(uuid)
  from public, anon, authenticated;
grant execute on function public.decrement_stock_for_order(uuid)
  to service_role;

-- Trigger function for auth.users. Postgres checks EXECUTE when the trigger is
-- created, not when it fires, so revoking here does not affect sign-up.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

-- Event trigger function (returns event_trigger, so PostgREST cannot expose
-- it). Revoked for consistency; event triggers fire as their owner.
revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;

-- Deliberately NOT changed: public.is_phone_available(text). Sign-up calls it
-- from the client to validate phone uniqueness, so anon and authenticated keep
-- EXECUTE. It already carries explicit grants and no PUBLIC grant.
