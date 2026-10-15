// admin-products: CRUD for the full product catalog (active + inactive),
// gated on membership in admin_users. products RLS stays untouched — this
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

const productInput = z.object({
  category_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  price_cents: z.number().int().min(0),
  unit: z.string().trim().min(1).max(50),
  image_url: z.string().url().nullable(),
  stock: z.number().int().min(0),
  is_active: z.boolean(),
  sku: z.string().trim().min(1).max(50).nullable(),
  sat_key: z.string().trim().min(1).max(20).nullable(),
  brand: z.string().trim().min(1).max(100).nullable(),
  code: z.string().trim().min(1).max(100).nullable(),
  pieces_per_box: z.number().int().min(1).nullable(),
  dozen_price_cents: z.number().int().min(0).nullable(),
});

const patchInput = productInput.partial().extend({ id: z.string().uuid() });
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
      const params = new URL(req.url).searchParams;

      // auth.users isn't PostgREST-joinable, so editor emails are resolved
      // through the Admin API — once per distinct editor, in parallel.
      const withEditorEmails = async (rows: Record<string, unknown>[]) => {
        const editorIds = [
          ...new Set(
            rows.map((p) => p.updated_by as string | null).filter((id): id is string => !!id)
          ),
        ];
        const emails = await Promise.all(
          editorIds.map(async (id) => {
            const { data } = await admin.auth.admin.getUserById(id);
            return [id, data.user?.email ?? null] as const;
          })
        );
        const emailById = new Map(emails);
        return rows.map((p) => ({
          ...p,
          updated_by_email: p.updated_by ? (emailById.get(p.updated_by as string) ?? null) : null,
        }));
      };

      // Single product (edit screen) — the paged list may not contain it.
      const id = params.get("id");
      if (id) {
        if (!z.string().uuid().safeParse(id).success) return json({ error: "Solicitud inválida" }, 400);
        const { data: product, error } = await admin
          .from("products")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!product) return json({ error: "Producto no encontrado" }, 404);
        const [withEmail] = await withEditorEmails([product]);
        return json(withEmail);
      }

      // One page of the list. PostgREST caps responses at 1000 rows, so the
      // catalog (2000+ products) must be paged rather than fetched whole.
      const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
      const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10) || 50));
      const search = params.get("search")?.trim();
      let query = admin
        .from("products")
        .select("*")
        .order("name")
        .order("id") // stable tie-break so pages never skip/repeat rows
        .range(offset, offset + limit - 1);
      if (search) {
        // Match the name or the Clave (sku). Quoted so commas/parens in the
        // search text can't break out of the or() filter.
        const pattern = `"%${search.replace(/["\\]/g, (c) => `\\${c}`)}%"`;
        query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`);
      }
      const { data: products, error } = await query;
      if (error) throw error;
      return json(await withEditorEmails(products));
    }

    if (req.method === "POST") {
      const parsed = productInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { data, error } = await admin
        .from("products")
        .insert({
          ...parsed.data,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error?.code === "23505") return json({ error: "Ya existe un producto con esa clave" }, 409);
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    if (req.method === "PATCH") {
      const parsed = patchInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { id, ...fields } = parsed.data;
      const { data, error } = await admin
        .from("products")
        .update({ ...fields, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error?.code === "23505") return json({ error: "Ya existe un producto con esa clave" }, 409);
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    if (req.method === "DELETE") {
      const parsed = deleteInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { data, error } = await admin
        .from("products")
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
    console.error("admin-products failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
