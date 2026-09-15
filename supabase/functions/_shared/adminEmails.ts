// Resolves every admin's email. auth.users is not PostgREST-joinable, so
// each id goes through the Admin API (same approach as admin-products).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function listAdminEmails(admin: SupabaseClient): Promise<string[]> {
  const { data: rows, error } = await admin.from("admin_users").select("user_id");
  if (error || !rows) return [];
  const emails: string[] = [];
  for (const row of rows) {
    const { data } = await admin.auth.admin.getUserById(row.user_id as string);
    if (data.user?.email) emails.push(data.user.email);
  }
  return emails;
}
