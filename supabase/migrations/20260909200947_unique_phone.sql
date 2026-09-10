-- Account validation: one account per phone number.
-- The partial unique index is the real guard (it also covers the race
-- between a client-side check and the insert). is_phone_available is only
-- there so the sign-up / profile screens can point at the offending field
-- instead of showing a generic failure.

create unique index profiles_phone_unique_idx
  on public.profiles (phone)
  where phone is not null;

-- SECURITY DEFINER on purpose: at sign-up time the caller is anonymous, and
-- the profiles RLS policy only exposes the caller's own row — a plain select
-- would always report "available". Returns a bare boolean and never exposes
-- any profile data. Callable by anon because sign-up happens signed out.
create or replace function public.is_phone_available(p_phone text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles where phone = p_phone
  );
$$;

revoke execute on function public.is_phone_available(text) from public;
grant execute on function public.is_phone_available(text) to anon, authenticated;
