// MODEL — auth: thin wrappers over Supabase Auth so no view or controller
// ever talks to the auth API directly. Passwords are handled (hashed) by
// Supabase Auth exclusively; they never touch our tables.
import { supabase } from "@/services/supabase";

export interface SignUpInput {
  name: string;
  last_name: string;
  phone: string;
  email: string;
  password: string;
}

/** Which field a sign-up failure belongs to, so the UI can point at it. */
export type SignUpFailure = "email_taken" | "phone_taken" | "unknown";

/** Sign-up rejection carrying the field at fault (see SignUpFailure). */
export class SignUpError extends Error {
  constructor(readonly reason: SignUpFailure) {
    super(reason);
    this.name = "SignUpError";
  }
}

/**
 * True when no account currently uses this phone number. Backed by a
 * SECURITY DEFINER function because the caller is anonymous at sign-up
 * time and profiles RLS only exposes your own row. This is advisory only —
 * the unique index on profiles.phone is what actually prevents duplicates.
 */
export async function isPhoneAvailable(phone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_phone_available", {
    p_phone: phone,
  });
  if (error) throw error;
  return data as boolean;
}

/** Signs in with email + password. Throws on bad credentials. */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * Creates the account. The profile row is created by a database trigger
 * from the metadata passed here. Returns true when a session was started
 * immediately, false when e-mail confirmation is pending.
 *
 * Throws SignUpError so the screen can mark the offending field.
 */
export async function signUp(input: SignUpInput): Promise<boolean> {
  const { name, last_name, phone, email, password } = input;

  if (!(await isPhoneAvailable(phone))) throw new SignUpError("phone_taken");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, last_name, phone } },
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "user_already_exists" || /already registered/i.test(error.message)) {
      throw new SignUpError("email_taken");
    }
    // The profiles.phone unique index fires inside the signup trigger and
    // surfaces only as a generic database error. Duplicate emails are
    // rejected by Auth before the trigger runs, so a failure here is the
    // phone number losing the race against a concurrent signup.
    if (/database error/i.test(error.message)) {
      throw new SignUpError("phone_taken");
    }
    throw new SignUpError("unknown");
  }

  // With email-enumeration protection on, signing up with an address that
  // already exists succeeds but returns a user with no identities rather
  // than an error. Treat that as the collision it is.
  if (data.user && data.user.identities?.length === 0) {
    throw new SignUpError("email_taken");
  }

  return !!data.session;
}

/**
 * Emails a 6-digit recovery code. Resolves the same way whether or not the
 * address has an account — callers must not reveal which it was.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/**
 * Completes a reset: verifies the emailed code, then sets the new password.
 * Both halves live here because verifying starts a session — which trips the
 * (auth) route guard — so the screen can be gone before the second call
 * lands. Keeping them in one awaited chain means the password still changes.
 */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "recovery",
  });
  if (verifyError) throw verifyError;

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) throw updateError;
}

/** Ends the current session on this device. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
