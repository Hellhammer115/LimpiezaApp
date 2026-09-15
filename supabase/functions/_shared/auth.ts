// Shared caller identification for Edge Functions deployed with verify_jwt = true.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { json } from "./http.ts";

export interface Caller {
  /** RLS-scoped client acting as the signed-in user. */
  userClient: SupabaseClient;
  /** Service-role client (bypasses RLS). Use only after authorization checks. */
  admin: SupabaseClient;
  user: { id: string; email?: string };
}

/** Resolves the signed-in user, or returns a ready 401 response. */
export async function getCaller(req: Request): Promise<Caller | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return json({ error: "No autorizado" }, 401);

  return {
    userClient,
    admin: createClient(supabaseUrl, serviceKey),
    user: { id: data.user.id, email: data.user.email ?? undefined },
  };
}

/** True when the user has a row in admin_users. */
export async function requireAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
