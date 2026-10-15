// MODEL — auth: thin wrappers over Supabase Auth so no view or controller
// ever talks to the auth API directly. Passwords are handled (hashed) by
// Supabase Auth exclusively; they never touch our tables.
import {
  fetchCurrentLegalDocuments,
  toVersions,
  type LegalVersions,
} from "@/models/legalModel";
import { supabase } from "@/services/supabase";

export interface SignUpInput {
  name: string;
  last_name: string;
  phone: string;
  email: string;
  password: string;
  /** Versions of the legal documents the user ticked "acepto" for. */
  legalVersions: LegalVersions;
  /** Captcha (Turnstile) token; Supabase Auth verifies it when captcha is enabled. */
  captchaToken?: string;
}

/** Which field a sign-up failure belongs to, so the UI can point at it. */
export type SignUpFailure =
  | "email_taken"
  | "phone_taken"
  | "weak_password"
  | "captcha_failed"
  | "terms_outdated"
  | "unknown";

/** Sign-up rejection carrying the field at fault (see SignUpFailure). */
export class SignUpError extends Error {
  constructor(readonly reason: SignUpFailure) {
    super(reason);
    this.name = "SignUpError";
  }
}

/** Supabase Auth error code (e.g. "captcha_failed", "weak_password"), if any. */
function authErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/** True when Supabase Auth rejected the request's captcha token. */
export function isCaptchaError(error: unknown): boolean {
  return authErrorCode(error) === "captcha_failed";
}

/** True when Supabase Auth rejected a password against its strength policy. */
export function isWeakPasswordError(error: unknown): boolean {
  return authErrorCode(error) === "weak_password";
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

/** Signs in with email + password. Throws on bad credentials or captcha. */
export async function signIn(
  email: string,
  password: string,
  captchaToken?: string
): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error) throw error;
}

/**
 * Creates the account. The profile row (and the legal acceptance records)
 * are created by a database trigger from the metadata passed here. Returns
 * true when a session was started immediately, false when e-mail
 * confirmation is pending.
 *
 * Throws SignUpError so the screen can mark the offending field.
 */
export async function signUp(input: SignUpInput): Promise<boolean> {
  const { name, last_name, phone, email, password, legalVersions, captchaToken } = input;

  if (!(await isPhoneAvailable(phone))) throw new SignUpError("phone_taken");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      // handle_new_user validates these and records the acceptance; it
      // rejects the sign-up unless both versions are the current ones.
      data: {
        name,
        last_name,
        phone,
        terms_version: legalVersions.terms,
        privacy_version: legalVersions.privacy,
      },
    },
  });

  if (error) {
    const code = authErrorCode(error);
    if (code === "user_already_exists" || /already registered/i.test(error.message)) {
      throw new SignUpError("email_taken");
    }
    if (code === "weak_password") throw new SignUpError("weak_password");
    if (code === "captcha_failed") throw new SignUpError("captcha_failed");
    // Anything raised inside the signup trigger (phone unique index, the
    // profiles CHECKs, stale legal versions) surfaces only as a generic
    // database error. Duplicate emails are rejected by Auth before the
    // trigger runs, so re-check the likely causes to name the right one.
    if (/database error/i.test(error.message)) {
      throw new SignUpError(await diagnoseTriggerFailure(phone, legalVersions));
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

/** Best guess at which signup-trigger guard rejected a sign-up. */
async function diagnoseTriggerFailure(
  phone: string,
  sent: LegalVersions
): Promise<SignUpFailure> {
  try {
    if (!(await isPhoneAvailable(phone))) return "phone_taken";
    const current = toVersions(await fetchCurrentLegalDocuments());
    if (current?.terms !== sent.terms || current?.privacy !== sent.privacy) {
      return "terms_outdated";
    }
  } catch {
    // Best-effort: fall through to the generic failure.
  }
  return "unknown";
}

/**
 * Emails a 6-digit recovery code. Resolves the same way whether or not the
 * address has an account — callers must not reveal which it was.
 */
export async function requestPasswordReset(
  email: string,
  captchaToken?: string
): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { captchaToken });
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
