// admin-categories: CRUD for the full category list (active + inactive),
// gated on membership in admin_users. categories RLS stays untouched — this
// is the only write path, using the service role after the admin check.
// Deployed with verify_jwt = true.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const categoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  icon: z.string().trim().min(1).max(50),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});

const patchInput = categoryInput.partial().extend({ id: z.string().uuid() });
const deleteInput = z.object({ id: z.string().uuid() });

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);
    const user = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) return json({ error: "Prohibido" }, 403);

    if (req.method === "GET") {
      const { data: categories, error } = await admin
        .from("categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;

      // auth.users isn't PostgREST-joinable, so editor emails are resolved
      // through the Admin API — once per distinct editor in this batch.
      const editorIds = [
        ...new Set(
          categories
            .map((c) => c.updated_by as string | null)
            .filter((id): id is string => !!id)
        ),
      ];
      const emailById = new Map<string, string>();
      for (const id of editorIds) {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data.user?.email) emailById.set(id, data.user.email);
      }
      const withEmail = categories.map((c) => ({
        ...c,
        updated_by_email: c.updated_by ? (emailById.get(c.updated_by) ?? null) : null,
      }));
      return json(withEmail);
    }

    if (req.method === "POST") {
      const parsed = categoryInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { data, error } = await admin
        .from("categories")
        .insert({
          ...parsed.data,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    if (req.method === "PATCH") {
      const parsed = patchInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { id, ...fields } = parsed.data;
      const { data, error } = await admin
        .from("categories")
        .update({ ...fields, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    if (req.method === "DELETE") {
      const parsed = deleteInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { data, error } = await admin
        .from("categories")
        .update({
          is_active: false,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", parsed.data.id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    return json({ error: "Método no permitido" }, 405);
  } catch (error) {
    console.error("admin-categories failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
