const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/** Formats integer cents as MXN, e.g. 3490 -> "$34.90" */
export function formatMXN(cents: number): string {
  return mxn.format(cents / 100);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Parses a pesos string typed by a user ("120", "120.5", "$1,200.50") into
 * integer cents. Returns null when the text isn't a non-negative amount.
 */
export function parseMXNInput(text: string): number | null {
  if (text.includes("-")) return null;
  const cleaned = text.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Inverse of parseMXNInput for prefilling inputs: 12050 -> "120.50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
