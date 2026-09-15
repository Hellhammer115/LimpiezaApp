// Best-effort transactional email through Resend's REST API.
// Never throws: a missing secret or a failed request is logged and ignored,
// because an email problem must never fail the business operation.
export interface EmailInput {
  to: string[];
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailInput): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("QUOTES_FROM_EMAIL");
  if (!apiKey || !from) {
    console.warn("Email skipped: RESEND_API_KEY / QUOTES_FROM_EMAIL not configured");
    return;
  }
  if (to.length === 0) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) console.error("Email failed", res.status, await res.text());
  } catch (error) {
    console.error("Email failed", error);
  }
}

/** Minimal HTML escaping for values interpolated into email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
