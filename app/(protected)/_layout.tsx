import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/demo";

export default function ProtectedLayout() {
  const { session, loading } = useAuth();

  if (loading) return null;
  // DEMO_MODE is a build-time preview flag (bundled sample data, no backend);
  // production builds never set it.
  if (!session && !DEMO_MODE) return <Redirect href="/sign-in" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="cart" options={{ presentation: "modal" }} />
    </Stack>
  );
}
