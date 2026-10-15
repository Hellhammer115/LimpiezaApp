-- Server-side mirror of the sign-up / profile form rules (models/authRules.ts).
-- The client validates the same things for nice inline errors; these
-- constraints are what actually holds, because the signup metadata and the
-- profile update both come from the (untrusted) client.
--
-- NOT VALID: existing rows are not re-checked, but every insert (the
-- handle_new_user signup trigger) and every update (profile screen) is.
-- Once you've confirmed old rows comply, run
--   alter table public.profiles validate constraint <name>;
-- for each one.
--
-- Consequence: an auth user created without name/last_name/phone metadata
-- (e.g. Dashboard → Add user) is now rejected. Accounts are created from
-- the app's sign-up screen.

alter table public.profiles
  add constraint profiles_name_check
    check (char_length(btrim(name)) between 1 and 80) not valid,
  add constraint profiles_last_name_check
    check (char_length(btrim(last_name)) between 1 and 80) not valid,
  add constraint profiles_phone_check
    check (phone is null or phone ~ '^[0-9]{10}$') not valid;
