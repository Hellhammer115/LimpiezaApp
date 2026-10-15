import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/controllers/useAuth";
import { usePendingLegalDocuments } from "@/controllers/useLegal";
import { DEMO_MODE } from "@/models/demoData";
import { LegalUpdateGate } from "@/views/LegalUpdateGate";

export default function ProtectedLayout() {
  const { session, loading } = useAuth();
  const pendingLegal = usePendingLegalDocuments();

  if (loading) return null;
  // DEMO_MODE is a build-time preview flag (bundled sample data, no backend);
  // production builds never set it.
  if (!session && !DEMO_MODE) return <Redirect href="/sign-in" />;

  // Users must accept the current Términos / Aviso de Privacidad before using
  // the app. Rendered in place of the Stack (not a redirect) so there's no
  // route to bounce between. If the check itself fails we let the user in
  // rather than lock them out on a network error.
  if (pendingLegal.isLoading) return null;
  if (pendingLegal.data?.length) return <LegalUpdateGate pending={pendingLegal.data} />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="cart" options={{ presentation: "modal" }} />
    </Stack>
  );
}
