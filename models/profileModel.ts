// MODEL — profile: the caller's own profile row.
// The row is created by a database trigger at signup; the password never
// exists here — it lives hashed inside Supabase Auth.
import { DEMO_MODE, DEMO_PROFILE } from "@/models/demoData";
import type { Profile } from "@/models/types";
import { supabase } from "@/services/supabase";

/** Returns the profile for the given user id, or null when missing. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (DEMO_MODE) return DEMO_PROFILE;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ProfilePatch {
  name: string;
  last_name: string;
  phone: string | null;
}

/** Updates the caller's editable profile fields (RLS scopes the write). */
export async function updateProfile(
  userId: string,
  patch: ProfilePatch
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw error;
}
