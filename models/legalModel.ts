// MODEL — legal documents (Términos y Condiciones, Aviso de Privacidad).
// Documents are versioned and immutable once published; acceptances are
// recorded only server-side (the sign-up trigger or accept_legal_documents),
// with server timestamps. See 20261014120100_legal_documents.sql.
import { DEMO_MODE } from "@/models/demoData";
import { supabase } from "@/services/supabase";

export type LegalSlug = "terms" | "privacy";

export interface LegalDocument {
  id: string;
  slug: LegalSlug;
  version: number;
  title: string;
  body: string;
  published_at: string;
}

/** Current version of each document, keyed by slug. */
export type LegalVersions = Record<LegalSlug, number>;

const DEMO_DOCUMENTS: LegalDocument[] = [
  {
    id: "demo-terms",
    slug: "terms",
    version: 1,
    title: "Términos y Condiciones",
    body: "Modo demostración: aquí se muestran los Términos y Condiciones publicados.",
    published_at: "2026-10-14T00:00:00Z",
  },
  {
    id: "demo-privacy",
    slug: "privacy",
    version: 1,
    title: "Aviso de Privacidad",
    body: "Modo demostración: aquí se muestra el Aviso de Privacidad publicado.",
    published_at: "2026-10-14T00:00:00Z",
  },
];

/** The latest published version of every legal document. */
export async function fetchCurrentLegalDocuments(): Promise<LegalDocument[]> {
  if (DEMO_MODE) return DEMO_DOCUMENTS;
  const { data, error } = await supabase
    .from("current_legal_documents")
    .select("*")
    .order("slug");
  if (error) throw error;
  return data as LegalDocument[];
}

/** Current documents the signed-in user hasn't accepted yet. */
export async function fetchPendingLegalDocuments(): Promise<LegalDocument[]> {
  if (DEMO_MODE) return [];
  const { data, error } = await supabase.rpc("pending_legal_documents");
  if (error) throw error;
  return data as LegalDocument[];
}

/**
 * Records the signed-in user's acceptance of the given document versions
 * (by id). The server refuses any that are no longer current, so the user
 * can only accept exactly what was on screen.
 */
export async function acceptLegalDocuments(documentIds: string[]): Promise<void> {
  if (DEMO_MODE) return;
  const { error } = await supabase.rpc("accept_legal_documents", {
    p_document_ids: documentIds,
  });
  if (error) throw error;
}

/** Collapses a document list into { terms, privacy } versions (null if one is missing). */
export function toVersions(documents: LegalDocument[]): LegalVersions | null {
  const terms = documents.find((d) => d.slug === "terms");
  const privacy = documents.find((d) => d.slug === "privacy");
  if (!terms || !privacy) return null;
  return { terms: terms.version, privacy: privacy.version };
}
