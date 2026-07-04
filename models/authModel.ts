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

/** Signs in with email + password. Throws on bad credentials. */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * Creates the account. The profile row is created by a database trigger
 * from the metadata passed here. Returns true when a session was started
 * immediately, false when e-mail confirmation is pending.
 */
export async function signUp(input: SignUpInput): Promise<boolean> {
  const { name, last_name, phone, email, password } = input;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, last_name, phone } },
  });
  if (error) throw error;
  return !!data.session;
}

/** Ends the current session on this device. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
