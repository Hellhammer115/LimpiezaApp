// CONTROLLER — legal documents: the current Términos / Aviso de Privacidad
// and the signed-in user's pending (re-)acceptance.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import { DEMO_MODE } from "@/models/demoData";
import {
  acceptLegalDocuments,
  fetchCurrentLegalDocuments,
  fetchPendingLegalDocuments,
  toVersions,
} from "@/models/legalModel";

export type { LegalDocument, LegalSlug, LegalVersions } from "@/models/legalModel";

/** Collapses a document list into { terms, privacy } versions (null if one is missing). */
export const legalVersionsOf = toVersions;

/** Latest published version of each legal document (readable signed out). */
export function useCurrentLegalDocuments() {
  return useQuery({
    queryKey: ["legal", "current"],
    queryFn: fetchCurrentLegalDocuments,
  });
}

/** Current documents the signed-in user still has to accept. */
export function usePendingLegalDocuments() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["legal", "pending", userId],
    enabled: !DEMO_MODE && !!userId,
    queryFn: fetchPendingLegalDocuments,
  });
}

/** Records acceptance of the given document ids, then re-checks what's pending. */
export function useAcceptLegal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentIds: string[]) => acceptLegalDocuments(documentIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["legal"] }),
  });
}
