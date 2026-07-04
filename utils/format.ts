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
