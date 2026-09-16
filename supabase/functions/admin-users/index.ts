// admin-users: recipient lookup for admin-created cotizaciones. Admin-gated;
// searches profiles by email or phone with the service role and never
// returns addresses. Deployed with verify_jwt = true.
import { getCaller, requireAdmin } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { admin, user } = caller;
    if (!(await requireAdmin(admin, user.id))) return json({ error: "Prohibido" }, 403);

    // Strip PostgREST filter syntax characters before interpolating.
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/[%,()]/g, "");
    if (q.length < 3) return json({ error: "Escribe al menos 3 caracteres" }, 400);

    const { data, error } = await admin
      .from("profiles")
      .select("user_id, name, last_name, email, phone")
      .or(`email.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("email")
      .limit(10);
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("admin-users failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
