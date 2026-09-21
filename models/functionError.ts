// MODEL — Edge Function error decoding. supabase.functions.invoke wraps a
// non-2xx response in FunctionsHttpError with the Response in `context`;
// our functions always answer { error: "<Spanish message>" }, which is safe
// to show the user (stock names, status conflicts...).
import { FunctionsHttpError } from "@supabase/supabase-js";

export async function functionErrorMessage(
  error: unknown,
  fallback: string
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await (error.context as Response).json();
      if (body && typeof body.error === "string" && body.error) return body.error;
    } catch {
      // Non-JSON body: fall through to the generic message.
    }
  }
  return fallback;
}
